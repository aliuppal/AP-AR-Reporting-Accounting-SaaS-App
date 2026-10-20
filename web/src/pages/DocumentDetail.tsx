import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { DocumentDoc } from '../types';
import { formatDate, relativeDue } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { Button, Card, CardHead, Icon, Modal, Money, Skeleton, StatusBadge, useToast } from '../ui';
import { DocumentEditor } from '../components/DocumentEditor';
import { PaymentModal } from '../components/PaymentModal';

export function DocumentDetail({ kind, id }: { kind: 'invoice' | 'bill'; id: number }) {
  const isInvoice = kind === 'invoice';
  const base = isInvoice ? '/invoices' : '/bills';
  const { settings } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();
  const [doc, setDoc] = useState<DocumentDoc | null>(null);
  const currency = doc?.currency ?? 'PKR';
  // Celebrate the moment a payment settles the document (not when opening one that was already paid).
  const prevStatus = useRef<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  useEffect(() => {
    if (!doc) return undefined;
    const was = prevStatus.current;
    prevStatus.current = doc.status;
    if (was && was !== 'paid' && doc.status === 'paid') {
      setJustPaid(true);
      const timer = window.setTimeout(() => setJustPaid(false), 2400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [doc]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'void' | 'delete' | null>(null);

  const load = useCallback(async () => {
    try {
      setDoc(await api.get<DocumentDoc>(`${base}/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load document');
    }
  }, [base, id]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="stack gap-16">
        <div className="banner banner-neg"><Icon name="alert" size={15} />{error}</div>
        <Link to={base} className="btn">Back to {isInvoice ? 'receivables' : 'payables'}</Link>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="stack" style={{ gap: 16 }} role="status" aria-label="Loading document">
        <div className="row gap-12"><Skeleton width={34} height={34} radius={10} /><div className="stack" style={{ gap: 8 }}><Skeleton width={180} height={18} /><Skeleton width={120} height={10} /></div></div>
        <div className="doc-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16 }}>
          <div className="card card-body stack" style={{ gap: 14 }}>
            <Skeleton width="40%" height={16} /><Skeleton width="60%" height={11} /><Skeleton height={140} radius={10} />
            <Skeleton width="35%" height={14} style={{ alignSelf: 'flex-end' }} />
          </div>
          <div className="card card-body stack" style={{ gap: 12 }}><Skeleton height={12} /><Skeleton height={12} /><Skeleton width="70%" height={12} /></div>
        </div>
      </div>
    );
  }

  const due = relativeDue(doc.dueDate, doc.status);

  const send = async () => {
    try {
      const updated = await api.post<DocumentDoc>(`${base}/${doc.id}/send`);
      setDoc(updated);
      toast.push(isInvoice ? 'Invoice sent' : 'Bill approved');
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Action failed', 'err');
    }
  };

  const runConfirm = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction === 'void') {
        setDoc(await api.post<DocumentDoc>(`${base}/${doc.id}/void`));
        toast.push('Document voided');
      } else {
        await api.del(`${base}/${doc.id}`);
        toast.push('Document deleted');
        navigate(base);
      }
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Action failed', 'err');
    } finally {
      setConfirmAction(null);
    }
  };

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar no-print" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="row gap-12">
          <Link to={base} className="icon-btn" aria-label="Back"><Icon name="chevronRight" size={17} style={{ transform: 'rotate(180deg)' }} /></Link>
          <div className="stack" style={{ gap: 2 }}>
            <div className="row gap-8">
              <h1 style={{ fontSize: 20 }}>{doc.number}</h1>
              <span className={justPaid ? 'paid-pulse' : ''}><StatusBadge status={doc.status} overdue={doc.isOverdue} /></span>
              <span className="badge badge-neutral" title="Document currency">{doc.currency}</span>
            </div>
            <div className="muted small">{isInvoice ? 'Invoice' : 'Bill'} · {doc.contact?.name}</div>
          </div>
        </div>
        <div className="row gap-8 wrap">
          {(doc.status === 'open' || doc.status === 'partial') ? (
            <Button variant="primary" onClick={() => setPaying(true)}><Icon name="bank" size={15} /> Record payment</Button>
          ) : null}
          {doc.status === 'draft' ? (
            <Button onClick={send}><Icon name="send" size={15} /> {isInvoice ? 'Send' : 'Approve'}</Button>
          ) : null}
          <Button onClick={() => setEditing(true)} disabled={doc.status === 'void'}><Icon name="edit" size={14} /> Edit</Button>
          <Button onClick={() => window.print()}><Icon name="print" size={14} /> Print</Button>
        </div>
      </div>

      {justPaid ? (
        <div className="banner banner-pos paid-banner" role="status">
          <span className="paid-check"><Icon name="check" size={15} /></span>
          <strong>Paid in full.</strong> {doc.number} is settled — nothing left to {isInvoice ? 'collect' : 'pay'}.
        </div>
      ) : null}

      <div className="doc-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        <Card>
          <div className="card-body" style={{ padding: '26px 28px' }}>
            <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
              <div className="stack" style={{ gap: 2 }}>
                <div className="row gap-8">
                  <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 14 }}>L</div>
                  <strong style={{ fontSize: 16 }}>{settings?.companyName}</strong>
                </div>
                <span className="small muted">{settings?.legalName || settings?.companyName}</span>
                <span className="small muted">{doc.currency} · Net {settings?.defaultTermsDays} days</span>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end', gap: 3 }}>
                <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{isInvoice ? 'Invoice' : 'Bill'}</span>
                <strong style={{ fontSize: 18, letterSpacing: '-0.02em' }}>{doc.number}</strong>
                <span className="small muted">Issued {formatDate(doc.issueDate)}</span>
                <span className={`small ${due.tone === 'neg' ? 'neg' : 'muted'}`}>Due {formatDate(doc.dueDate)} · {due.label}</span>
              </div>
            </div>

            <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div className="stack" style={{ gap: 3 }}>
                <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>{isInvoice ? 'Billed to' : 'Vendor'}</span>
                <strong>{doc.contact?.name}</strong>
                <span className="small muted">{doc.contact?.company}</span>
                <span className="small muted">{doc.contact?.email}</span>
              </div>
              <div className="stack" style={{ gap: 3 }}>
                <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>Reference</span>
                <span className="small">{doc.reference || '—'}</span>
                <span className="tiny muted" style={{ marginTop: 6 }}>Terms</span>
                <span className="small">Net {settings?.defaultTermsDays} days</span>
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 24 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    <th className="num">Tax</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line) => (
                    <tr key={line.id}>
                      <td style={{ fontWeight: 500 }}>{line.description}</td>
                      <td className="muted small">{line.category || '—'}</td>
                      <td className="num">{line.quantity}</td>
                      <td className="num"><Money cents={line.unitPriceCents} currency={currency} /></td>
                      <td className="num muted">{line.taxRate}%</td>
                      <td className="num"><Money cents={line.amountCents ?? Math.round(line.quantity * line.unitPriceCents)} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
              <div className="totals">
                <div className="totals-row"><span>Subtotal</span><Money cents={doc.subtotalCents} currency={currency} /></div>
                <div className="totals-row"><span>Tax</span><Money cents={doc.taxCents} currency={currency} /></div>
                {doc.discountCents > 0 ? <div className="totals-row"><span>Discount</span><span className="num neg">−<Money cents={doc.discountCents} currency={currency} /></span></div> : null}
                <div className="totals-row grand"><span>Total</span><Money cents={doc.totalCents} currency={currency} /></div>
                {doc.paidCents > 0 ? <div className="totals-row"><span>Paid</span><span className="num pos">−<Money cents={doc.paidCents} currency={currency} /></span></div> : null}
                <div className={`totals-row ${justPaid ? 'settled' : ''}`} style={{ fontWeight: 650 }}><span>Balance due</span><Money cents={doc.balanceCents} currency={currency} /></div>
              </div>
            </div>

            {doc.notes ? (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Notes</div>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{doc.notes}</p>
              </div>
            ) : null}
          </div>
        </Card>

        <div className="stack gap-16 no-print" style={{ gap: 14 }}>
          <Card>
            <CardHead title="Summary" />
            <div className="card-body stack gap-12" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Status</span><StatusBadge status={doc.status} overdue={doc.isOverdue} /></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Total</span><Money cents={doc.totalCents} currency={currency} /></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Paid</span><Money cents={doc.paidCents} currency={currency} /></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Balance</span><Money cents={doc.balanceCents} currency={currency} className="strong" /></div>
              {doc.daysOverdue > 0 && doc.balanceCents > 0 ? (
                <div className="banner banner-warn" style={{ fontSize: 12 }}><Icon name="alert" size={14} />{doc.daysOverdue} days past due</div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHead title="Payments applied" sub={`${doc.payments.length} payment${doc.payments.length === 1 ? '' : 's'}`} />
            {doc.payments.length === 0 ? (
              <div className="card-body small muted">No payments recorded yet.</div>
            ) : (
              <div className="list">
                {doc.payments.map((p) => (
                  <div key={`${p.paymentId}-${p.date}`} className="list-row">
                    <div className="stack grow" style={{ gap: 2 }}>
                      <span className="list-title">{p.number}</span>
                      <span className="list-sub">{formatDate(p.date)} · {p.method}</span>
                    </div>
                    <Money cents={p.amountCents} currency={currency} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Danger zone" />
            <div className="card-body stack gap-8" style={{ gap: 8 }}>
              {doc.status !== 'void' ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmAction('void')} disabled={doc.paidCents > 0}>
                  <Icon name="close" size={14} /> Void {isInvoice ? 'invoice' : 'bill'}
                </Button>
              ) : null}
              {['draft', 'void'].includes(doc.status) ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmAction('delete')}>
                  <Icon name="trash" size={14} /> Delete permanently
                </Button>
              ) : null}
              <p className="tiny muted">
                Voiding keeps the audit trail. Documents with payments cannot be voided until payments are removed.
              </p>
            </div>
          </Card>
        </div>
      </div>

      {editing ? (
        <DocumentEditor
          kind={kind}
          doc={doc}
          onClose={() => setEditing(false)}
          onSaved={(saved) => { setDoc(saved); setEditing(false); }}
        />
      ) : null}

      {paying ? (
        <PaymentModal
          direction={isInvoice ? 'in' : 'out'}
          presetContactId={doc.contactId}
          presetDoc={{ docType: isInvoice ? 'invoice' : 'bill', docId: doc.id, currency: doc.currency }}
          onClose={() => setPaying(false)}
          onSaved={() => { setPaying(false); load(); }}
        />
      ) : null}

      {confirmAction ? (
        <Modal
          title={confirmAction === 'void' ? `Void ${doc.number}?` : `Delete ${doc.number}?`}
          onClose={() => setConfirmAction(null)}
          width="sm"
          footer={(
            <>
              <Button onClick={() => setConfirmAction(null)} style={{ marginLeft: 'auto' }}>Cancel</Button>
              <Button variant="danger" onClick={runConfirm}>
                {confirmAction === 'void' ? 'Void document' : 'Delete forever'}
              </Button>
            </>
          )}
        >
          <p className="small">
            {confirmAction === 'void'
              ? 'The document stays in your records marked as void and stops counting toward AR/AP.'
              : 'This permanently removes the document and its line items. This cannot be undone.'}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
