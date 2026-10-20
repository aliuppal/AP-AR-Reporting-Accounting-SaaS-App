import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { Contact, DocumentDoc, LineItem } from '../types';
import { addDaysISO, todayISO } from '../lib/format';
import { Button, Field, Icon, Modal, MoneyInput, useToast } from '../ui';

interface Props {
  kind: 'invoice' | 'bill';
  doc?: DocumentDoc | null;
  presetContactId?: number;
  onClose: () => void;
  onSaved: (doc: DocumentDoc) => void;
}

interface LineState {
  key: string;
  description: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  taxRate: number;
}

const emptyLine = (category: string): LineState => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  category,
  quantity: 1,
  unitPriceCents: 0,
  taxRate: 0,
});

export function DocumentEditor({ kind, doc, presetContactId, onClose, onSaved }: Props) {
  const isInvoice = kind === 'invoice';
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<{ currency: string; defaultTaxRate: number; defaultTermsDays: number; revenueCategories: string[]; expenseCategories: string[] } | null>(null);
  const [contactId, setContactId] = useState<number>(doc?.contactId ?? presetContactId ?? 0);
  const [issueDate, setIssueDate] = useState(doc?.issueDate ?? todayISO());
  const [dueDate, setDueDate] = useState(doc?.dueDate ?? '');
  const [reference, setReference] = useState(doc?.reference ?? '');
  const [notes, setNotes] = useState(doc?.notes ?? '');
  const [discountCents, setDiscountCents] = useState(doc?.discountCents ?? 0);
  const [lines, setLines] = useState<LineState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const categories = isInvoice ? settings?.revenueCategories ?? [] : settings?.expenseCategories ?? [];

  useEffect(() => {
    Promise.all([
      api.get<{ items: Contact[] }>(`/contacts?type=${isInvoice ? 'customer' : 'vendor'}&limit=200`),
      api.get<{ currency: string; defaultTaxRate: number; defaultTermsDays: number; revenueCategories: string[]; expenseCategories: string[] }>('/settings'),
    ]).then(([contactRes, settingsRes]) => {
      setContacts(contactRes.items);
      setSettings(settingsRes);
      const cat = isInvoice ? settingsRes.revenueCategories[0] ?? '' : settingsRes.expenseCategories[0] ?? '';
      setLines(doc
        ? doc.lines.map((l) => ({
            key: Math.random().toString(36).slice(2),
            description: l.description,
            category: l.category || cat,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            taxRate: l.taxRate,
          }))
        : [{ ...emptyLine(cat), taxRate: settingsRes.defaultTaxRate }]);
      if (!doc) setDueDate(addDaysISO(issueDate, settingsRes.defaultTermsDays));
    }).catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const selectedContact = contacts.find((c) => c.id === contactId);

  useEffect(() => {
    if (!doc && selectedContact) setDueDate(addDaysISO(issueDate, selectedContact.termsDays ?? settings?.defaultTermsDays ?? 30));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const totals = useMemo(() => {
    const computed = lines.map((l) => {
      const amount = Math.round(l.quantity * l.unitPriceCents);
      return { amount, tax: Math.round((amount * l.taxRate) / 100) };
    });
    const subtotal = computed.reduce((s, c) => s + c.amount, 0);
    const tax = computed.reduce((s, c) => s + c.tax, 0);
    const discount = Math.min(Math.max(0, discountCents), subtotal);
    return { subtotal, tax, discount, total: subtotal - discount + tax };
  }, [lines, discountCents]);

  const updateLine = (key: string, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const submit = async (status: 'draft' | 'open') => {
    setError('');
    if (!contactId) return setError(`Select a ${isInvoice ? 'customer' : 'vendor'}`);
    if (!lines.some((l) => l.description.trim() && l.unitPriceCents > 0)) {
      return setError('Add at least one line item with a description and amount');
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        contactId,
        issueDate,
        dueDate: dueDate || addDaysISO(issueDate, 30),
        status,
        reference,
        notes,
        discountCents,
        lines: lines
          .filter((l) => l.description.trim())
          .map<LineItem>((l) => ({
            description: l.description.trim(),
            category: l.category,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            taxRate: l.taxRate,
          })),
      };
      const base = isInvoice ? '/invoices' : '/bills';
      const saved = doc
        ? await api.put<DocumentDoc>(`${base}/${doc.id}`, payload)
        : await api.post<DocumentDoc>(base, payload);
      toast.push(doc ? `${saved.number} updated` : `${saved.number} created`);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.details?.length ? `${err.message}: ${err.details.map((d) => `${d.path} ${d.message}`).join(', ')}` : err.message);
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={doc ? `Edit ${doc.number}` : isInvoice ? 'New invoice' : 'New bill'}
      sub={isInvoice ? 'Bill a customer and track the receivable' : 'Record what you owe a vendor'}
      onClose={onClose}
      footer={(
        <>
          <span className="muted small hide-mobile" style={{ marginRight: 'auto' }}>
            {doc ? `Status: ${doc.status}` : 'Saved as draft until you send it'}
          </span>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          {(!doc || doc.status === 'draft') ? (
            <Button onClick={() => submit('draft')} disabled={busy}>Save draft</Button>
          ) : null}
          <Button variant="primary" onClick={() => submit(doc && doc.status !== 'draft' ? 'open' : 'open')} disabled={busy}>
            {busy ? 'Saving…' : doc ? 'Save changes' : isInvoice ? 'Save & send' : 'Save & approve'}
          </Button>
        </>
      )}
    >
      {error ? <div className="banner banner-neg" style={{ marginBottom: 14 }}><Icon name="alert" size={15} />{error}</div> : null}

      <div className="form-grid">
        <div className="col-6">
          <Field label={isInvoice ? 'Customer' : 'Vendor'}>
            <select className="select" value={contactId || ''} onChange={(e) => setContactId(Number(e.target.value))}>
              <option value="">Select a {isInvoice ? 'customer' : 'vendor'}…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-3">
          <Field label={isInvoice ? 'Invoice date' : 'Bill date'}>
            <input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
        </div>
        <div className="col-3">
          <Field label="Due date" hint={selectedContact ? `Net ${selectedContact.termsDays}` : undefined}>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="col-12">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 550, color: 'var(--ink-3)' }}>Line items</label>
            <span className="tiny muted">Amounts in {settings?.currency ?? 'USD'}</span>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflowX: 'auto' }}>
            <table className="line-table">
              <thead>
                <tr>
                  <th style={{ width: '34%' }}>Description</th>
                  <th style={{ width: '17%' }}>Category</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 110 }}>Rate</th>
                  <th style={{ width: 70 }}>Tax %</th>
                  <th style={{ width: 100 }} className="right">Amount</th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td><input className="input input-sm" placeholder="What are you billing for?" value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} /></td>
                    <td>
                      <select className="select select-sm" value={line.category} onChange={(e) => updateLine(line.key, { category: e.target.value })}>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                        {categories.length === 0 ? <option value="">—</option> : null}
                      </select>
                    </td>
                    <td><input className="input input-sm num" type="number" min="0" step="0.25" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: Number(e.target.value) })} /></td>
                    <td><MoneyInput className="input input-sm num" cents={line.unitPriceCents} onCents={(unitPriceCents) => updateLine(line.key, { unitPriceCents })} /></td>
                    <td><input className="input input-sm num" type="number" min="0" max="100" step="0.25" value={line.taxRate} onChange={(e) => updateLine(line.key, { taxRate: Number(e.target.value) })} /></td>
                    <td className="line-amt num">{(Math.round(line.quantity * line.unitPriceCents) / 100).toFixed(2)}</td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remove line"
                        disabled={lines.length === 1}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row gap-8" style={{ marginTop: 8 }}>
            <Button size="sm" onClick={() => setLines((prev) => [...prev, emptyLine(categories[0] ?? '')])}>
              <Icon name="plus" size={14} /> Add line
            </Button>
            <span className="tiny muted">Quantities can be fractional; tax is applied per line.</span>
          </div>
        </div>

        <div className="col-7">
          <div className="form-grid" style={{ gap: 12 }}>
            <div className="col-6">
              <Field label="Reference" hint="PO number, project code…">
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
            <div className="col-6">
              <Field label="Discount" hint="Applied before tax">
                <MoneyInput className="input num" cents={discountCents} onCents={setDiscountCents} />
              </Field>
            </div>
            <div className="col-12">
              <Field label="Notes">
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isInvoice ? 'Payment instructions, thank-you note…' : 'Internal context for this bill…'} />
              </Field>
            </div>
          </div>
        </div>

        <div className="col-5">
          <div className="totals">
            <div className="totals-row"><span>Subtotal</span><span className="num">{(totals.subtotal / 100).toFixed(2)}</span></div>
            <div className="totals-row"><span>Tax</span><span className="num">{(totals.tax / 100).toFixed(2)}</span></div>
            {totals.discount > 0 ? <div className="totals-row"><span>Discount</span><span className="num neg">−{(totals.discount / 100).toFixed(2)}</span></div> : null}
            <div className="totals-row grand"><span>Total</span><span className="num">{(totals.total / 100).toFixed(2)}</span></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
