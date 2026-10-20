import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { Contact, DocumentDoc, Payment } from '../types';
import { centsToInput, formatDate, todayISO } from '../lib/format';
import { Button, Field, Icon, Modal, Money, MoneyInput, useToast } from '../ui';

interface Props {
  direction: 'in' | 'out';
  presetContactId?: number;
  presetDoc?: { docType: 'invoice' | 'bill'; docId: number };
  onClose: () => void;
  onSaved: (payment: Payment) => void;
}

interface ApplyRow {
  docType: 'invoice' | 'bill';
  docId: number;
  number: string;
  dueDate: string;
  balanceCents: number;
  amountCents: number;
  checked: boolean;
}

export function PaymentModal({ direction, presetContactId, presetDoc, onClose, onSaved }: Props) {
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [methods, setMethods] = useState<string[]>(['Bank transfer', 'Credit card', 'Cash', 'Cheque', 'Other']);
  const [contactId, setContactId] = useState(presetContactId ?? 0);
  const [date, setDate] = useState(todayISO());
  const [amountCents, setAmountCents] = useState(0);
  const [method, setMethod] = useState('Bank transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ApplyRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<{ items: Contact[] }>(`/contacts?type=${direction === 'in' ? 'customer' : 'vendor'}&limit=200`),
      api.get<{ paymentMethods: string[] }>('/settings'),
    ]).then(([c, s]) => {
      setContacts(c.items);
      setMethods(s.paymentMethods);
      setMethod(s.paymentMethods[0] ?? 'Bank transfer');
    }).catch((err) => setError(err.message));
  }, [direction]);

  const loadOpenDocs = async (id: number) => {
    const res = await api.get<{ items: DocumentDoc[] }>(`${direction === 'in' ? '/invoices' : '/bills'}?contactId=${id}&limit=100`);
    const open = res.items.filter((d) => ['open', 'partial'].includes(d.status) && d.balanceCents > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    setRows(open.map((d) => ({
      docType: direction === 'in' ? 'invoice' : 'bill',
      docId: d.id,
      number: d.number,
      dueDate: d.dueDate,
      balanceCents: d.balanceCents,
      amountCents: 0,
      checked: false,
    })));
  };

  useEffect(() => {
    if (contactId) loadOpenDocs(contactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // Auto-apply the payment oldest-first whenever the amount changes (unless the user hand-tuned it).
  const autoApply = useMemo(() => {
    if (amountCents <= 0) return rows.map((r) => ({ ...r, amountCents: 0, checked: false }));
    let remaining = amountCents;
    return rows.map((r) => {
      const applied = Math.min(r.balanceCents, remaining);
      remaining -= applied;
      const isPreset = presetDoc && r.docId === presetDoc.docId;
      const checked = applied > 0 || !!isPreset;
      const value = isPreset ? Math.min(r.balanceCents, amountCents) : applied;
      return { ...r, amountCents: checked ? value : 0, checked };
    });
  }, [rows, amountCents, presetDoc]);

  const [manual, setManual] = useState(false);
  const applyRows = manual ? rows : autoApply;
  const allocated = applyRows.filter((r) => r.checked).reduce((s, r) => s + r.amountCents, 0);

  const submit = async () => {
    setError('');
    if (!contactId) return setError('Select a contact');
    if (amountCents <= 0) return setError('Enter an amount greater than zero');
    if (allocated > amountCents) return setError('Allocations exceed the payment amount');
    setBusy(true);
    try {
      const payment = await api.post<Payment>('/payments', {
        direction,
        contactId,
        date,
        amountCents,
        method,
        reference,
        notes,
        allocations: applyRows.filter((r) => r.checked && r.amountCents > 0)
          .map((r) => ({ docType: r.docType, docId: r.docId, amountCents: r.amountCents })),
      });
      toast.push(`Payment ${payment.number} recorded`);
      onSaved(payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={direction === 'in' ? 'Record a customer payment' : 'Pay a vendor bill'}
      sub={direction === 'in' ? 'Money received into the business' : 'Money paid out of the business'}
      onClose={onClose}
      footer={(
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            Applied <strong className="num">{centsToInput(allocated)}</strong> of <strong className="num">{centsToInput(amountCents)}</strong>
          </span>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</Button>
        </>
      )}
    >
      {error ? <div className="banner banner-neg" style={{ marginBottom: 12 }}><Icon name="alert" size={15} />{error}</div> : null}

      <div className="form-grid">
        <div className="col-6">
          <Field label={direction === 'in' ? 'Customer' : 'Vendor'}>
            <select className="select" value={contactId || ''} onChange={(e) => setContactId(Number(e.target.value))}>
              <option value="">Select…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-3">
          <Field label="Payment date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="col-3">
          <Field label="Amount">
            <MoneyInput className="input num" cents={amountCents} onCents={setAmountCents} />
          </Field>
        </div>
        <div className="col-4">
          <Field label="Method">
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-4">
          <Field label="Reference">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque #, ACH ref…" />
          </Field>
        </div>
        <div className="col-4">
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Apply to open documents</strong>
          <label className="row gap-4 small muted" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={manual}
              onChange={(e) => {
                setManual(e.target.checked);
                if (e.target.checked) setRows((prev) => prev.map((r) => ({ ...r, amountCents: r.checked ? r.amountCents : 0 })));
              }}
            />
            Manual allocation
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="banner banner-info">
            <Icon name="clock" size={15} />
            No open documents for this contact. The payment will be recorded as unapplied credit.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            <table className="line-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Document</th>
                  <th>Due</th>
                  <th className="right">Balance</th>
                  <th className="right" style={{ width: 120 }}>Apply</th>
                </tr>
              </thead>
              <tbody>
                {applyRows.map((row, index) => (
                  <tr key={`${row.docType}-${row.docId}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(e) => {
                          setManual(true);
                          setRows((prev) => prev.map((r, i) => (i === index
                            ? { ...r, checked: e.target.checked, amountCents: e.target.checked ? Math.min(r.balanceCents, Math.max(amountCents - allocated, 0)) : 0 }
                            : r)));
                        }}
                        aria-label={`Apply to ${row.number}`}
                      />
                    </td>
                    <td><span style={{ fontWeight: 550 }}>{row.number}</span></td>
                    <td className="muted small">{formatDate(row.dueDate)}</td>
                    <td className="right"><Money cents={row.balanceCents} /></td>
                    <td className="right">
                      <MoneyInput
                        className="input input-sm num"
                        disabled={!row.checked}
                        cents={row.amountCents}
                        onCents={(value) => {
                          setManual(true);
                          setRows((prev) => prev.map((r, i) => (i === index ? { ...r, amountCents: value } : r)));
                        }}
                        style={{ textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {allocated < amountCents ? (
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {centsToInput(amountCents - allocated)} will remain unapplied and can be allocated later.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
