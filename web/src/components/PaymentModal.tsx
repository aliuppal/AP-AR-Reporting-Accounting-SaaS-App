import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { Contact, DocumentDoc, Payment } from '../types';
import { CURRENCIES, CURRENCY_NAMES, formatDate, isCurrency, money, todayISO, type Currency } from '../lib/format';
import { useViewCurrency } from '../lib/currency';
import { Button, Field, Icon, Modal, Money, MoneyInput, Skeleton, useToast } from '../ui';

interface Props {
  direction: 'in' | 'out';
  presetContactId?: number;
  presetDoc?: { docType: 'invoice' | 'bill'; docId: number; currency?: string };
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
  const view = useViewCurrency();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [methods, setMethods] = useState<string[]>(['Bank transfer', 'Credit card', 'Cash', 'Cheque', 'Other']);
  const [contactId, setContactId] = useState(presetContactId ?? 0);
  const [date, setDate] = useState(todayISO());
  const [amountCents, setAmountCents] = useState(0);
  // Paying a specific document fixes the currency to that document's.
  const [currency, setCurrency] = useState<Currency>(isCurrency(presetDoc?.currency) ? presetDoc.currency : view.currency);
  const [method, setMethod] = useState('Bank transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ApplyRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Progressive disclosure: most payments just settle the oldest documents first.
  const [showAllocation, setShowAllocation] = useState(false);
  const [manual, setManual] = useState(false);

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

  useEffect(() => {
    if (!contactId) { setRows([]); return undefined; }
    let cancelled = false;
    setLoadingDocs(true);
    api.get<{ items: DocumentDoc[] }>(`${direction === 'in' ? '/invoices' : '/bills'}?contactId=${contactId}&currency=${currency}&limit=100`)
      .then((res) => {
        if (cancelled) return;
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
        setManual(false);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoadingDocs(false); });
    return () => { cancelled = true; };
  }, [contactId, currency, direction]);

  // Smart allocation: the document the payment was opened from is settled first, then the
  // rest goes to the oldest due. The total applied can never exceed the payment.
  const autoApply = useMemo(() => {
    if (amountCents <= 0) return rows.map((r) => ({ ...r, amountCents: 0, checked: false }));
    const order = [...rows.keys()].sort((a, b) => {
      const pa = presetDoc && rows[a].docId === presetDoc.docId ? 0 : 1;
      const pb = presetDoc && rows[b].docId === presetDoc.docId ? 0 : 1;
      return pa - pb || a - b;
    });
    const applied = new Map<number, number>();
    let remaining = amountCents;
    for (const i of order) {
      const value = Math.min(rows[i].balanceCents, remaining);
      remaining -= value;
      applied.set(i, value);
    }
    return rows.map((r, i) => {
      const value = applied.get(i) ?? 0;
      return { ...r, amountCents: value, checked: value > 0 };
    });
  }, [rows, amountCents, presetDoc]);

  const applyRows = manual ? rows : autoApply;
  const allocated = applyRows.filter((r) => r.checked).reduce((s, r) => s + r.amountCents, 0);
  const appliedRows = applyRows.filter((r) => r.checked && r.amountCents > 0);
  const totalOpen = rows.reduce((s, r) => s + r.balanceCents, 0);

  /** Hand-tuning starts from the smart split instead of from zero. */
  const editRow = (index: number, patch: (row: ApplyRow) => ApplyRow) => {
    if (!manual) setRows(autoApply);
    setManual(true);
    setRows((prev) => prev.map((r, i) => (i === index ? patch(r) : r)));
  };

  const submit = async () => {
    setError('');
    if (!contactId) return setError(`Select a ${direction === 'in' ? 'customer' : 'vendor'}`);
    if (amountCents <= 0) return setError('Enter an amount greater than zero');
    if (allocated > amountCents) return setError('Allocations exceed the payment amount');
    setBusy(true);
    try {
      const payment = await api.post<Payment>('/payments', {
        direction,
        contactId,
        date,
        amountCents,
        currency,
        method,
        reference,
        notes,
        allocations: appliedRows.map((r) => ({ docType: r.docType, docId: r.docId, amountCents: r.amountCents })),
      });
      toast.push(`Payment ${payment.number} recorded`);
      onSaved(payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const docWord = direction === 'in' ? 'invoice' : 'bill';

  return (
    <Modal
      title={direction === 'in' ? 'Record a customer payment' : 'Pay a vendor bill'}
      sub={direction === 'in' ? 'Money received into the business' : 'Money paid out of the business'}
      onClose={onClose}
      footer={(
        <>
          <span className="muted small hide-mobile" style={{ marginRight: 'auto' }}>
            Applied <strong className="num">{money(allocated, currency)}</strong> of <strong className="num">{money(amountCents, currency)}</strong>
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
        <div className="col-2">
          <Field label="Currency">
            <select
              className="select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              disabled={!!presetDoc}
              aria-label="Payment currency"
            >
              {CURRENCIES.map((c) => <option key={c} value={c} title={CURRENCY_NAMES[c]}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-4">
          <Field label={`Amount (${currency})`}>
            <MoneyInput className="input num" cents={amountCents} onCents={setAmountCents} />
          </Field>
        </div>
        <div className="col-3">
          <Field label="Payment date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="col-3">
          <Field label="Method">
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-3">
          <Field label="Reference">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque #, transfer ref…" />
          </Field>
        </div>
        <div className="col-3">
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </div>

      <div className="alloc">
        {!contactId ? null : loadingDocs ? (
          <div className="alloc-summary"><Skeleton width="60%" height={12} /><Skeleton width="40%" height={10} style={{ marginTop: 8 }} /></div>
        ) : rows.length === 0 ? (
          <div className="banner banner-info">
            <Icon name="clock" size={15} />
            No open {currency} {docWord}s for this contact. The payment will be kept as unapplied credit.
          </div>
        ) : (
          <>
            <div className="alloc-summary">
              <div className="row gap-8" style={{ alignItems: 'flex-start' }}>
                <span className="alloc-icon"><Icon name={manual ? 'edit' : 'check'} size={14} /></span>
                <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                  <strong className="small">{manual ? 'Custom allocation' : 'Smart allocate · oldest due first'}</strong>
                  <span className="tiny muted">
                    {amountCents <= 0
                      ? `${rows.length} open ${docWord}${rows.length === 1 ? '' : 's'} · ${money(totalOpen, currency)} outstanding. Enter an amount to apply it.`
                      : appliedRows.length === 0
                        ? 'Nothing applied — the full amount stays as credit.'
                        : appliedRows.map((r) => `${r.number} ${money(r.amountCents, currency)}`).join(' · ')}
                  </span>
                </div>
                {manual ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManual(false)}>Reset</button>
                ) : null}
              </div>
              <button
                type="button"
                className="alloc-toggle"
                aria-expanded={showAllocation}
                aria-controls="alloc-table"
                onClick={() => setShowAllocation((v) => !v)}
              >
                <Icon name="chevronDown" size={14} style={{ transform: showAllocation ? 'rotate(180deg)' : undefined, transition: 'transform 160ms ease' }} />
                {showAllocation ? 'Hide allocation' : 'Adjust allocation'}
              </button>
            </div>

            {showAllocation ? (
              <div id="alloc-table" className="alloc-table">
                <table className="line-table">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} />
                      <th>Document</th>
                      <th>Due</th>
                      <th className="right">Balance</th>
                      <th className="right" style={{ width: 130 }}>Apply</th>
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
                              const on = e.target.checked;
                              editRow(index, (r) => ({ ...r, checked: on, amountCents: on ? Math.min(r.balanceCents, Math.max(amountCents - allocated, 0)) : 0 }));
                            }}
                            aria-label={`Apply to ${row.number}`}
                          />
                        </td>
                        <td><span style={{ fontWeight: 550 }}>{row.number}</span></td>
                        <td className="muted small">{formatDate(row.dueDate)}</td>
                        <td className="right"><Money cents={row.balanceCents} currency={currency} /></td>
                        <td className="right">
                          <MoneyInput
                            className="input input-sm num"
                            disabled={!row.checked}
                            cents={row.amountCents}
                            onCents={(value) => editRow(index, (r) => ({ ...r, amountCents: value }))}
                            style={{ textAlign: 'right' }}
                            aria-label={`Amount applied to ${row.number}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
        {amountCents > 0 && allocated < amountCents ? (
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {money(amountCents - allocated, currency)} will remain unapplied and can be allocated later.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
