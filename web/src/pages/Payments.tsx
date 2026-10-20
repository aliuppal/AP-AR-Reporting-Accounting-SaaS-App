import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Payment } from '../types';
import { formatDate } from '../lib/format';
import { useViewCurrency } from '../lib/currency';
import { useQueryParam, useRouter } from '../lib/router';
import { Button, Card, EmptyState, Icon, Modal, Money, Segmented, SkeletonRows, useToast } from '../ui';

type Filter = 'all' | 'in' | 'out';

export function Payments() {
  const { currency } = useViewCurrency();
  const queryNew = useQueryParam('new');
  const { navigate } = useRouter();
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<{ items: Payment[]; total: number; inflowCents: number; outflowCents: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<'in' | 'out' | null>(null);
  const [detail, setDetail] = useState<Payment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Payment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get(`/payments?direction=${filter}&q=${encodeURIComponent(debounced)}&limit=100&currency=${currency}`));
    } finally {
      setLoading(false);
    }
  }, [filter, debounced, currency]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 220);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (queryNew === '1') {
      setDirection('in');
      navigate('/payments', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryNew]);

  const items = data?.items ?? [];

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await api.del(`/payments/${confirmDelete.id}`);
      toast.push('Payment deleted and allocations reversed');
      setConfirmDelete(null);
      setDetail(null);
      load();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Delete failed', 'err');
    }
  };

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h1>Payments</h1>
          <div className="muted small">Cash in from customers and cash out to vendors · showing {currency}</div>
        </div>
        <div className="row gap-8">
          <Button onClick={() => setDirection('out')}><Icon name="arrowUp" size={14} /> Pay a bill</Button>
          <Button variant="primary" onClick={() => setDirection('in')}><Icon name="arrowDown" size={14} /> Receive payment</Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="card kpi">
          <div className="kpi-accent" />
          <div className="kpi-label"><Icon name="arrowDown" size={14} />Cash in</div>
          <div className="kpi-value"><Money cents={data?.inflowCents ?? 0} currency={currency} /></div>
          <div className="kpi-meta">Customer receipts</div>
        </div>
        <div className="card kpi">
          <div className="kpi-accent neg" />
          <div className="kpi-label"><Icon name="arrowUp" size={14} />Cash out</div>
          <div className="kpi-value"><Money cents={data?.outflowCents ?? 0} currency={currency} /></div>
          <div className="kpi-meta">Vendor payments</div>
        </div>
        <div className="card kpi">
          <div className="kpi-accent info" />
          <div className="kpi-label"><Icon name="bank" size={14} />Net movement</div>
          <div className="kpi-value"><Money cents={(data?.inflowCents ?? 0) - (data?.outflowCents ?? 0)} currency={currency} /></div>
          <div className="kpi-meta">In flows minus out flows</div>
        </div>
        <div className="card kpi">
          <div className="kpi-accent" />
          <div className="kpi-label"><Icon name="payments" size={14} />Payments</div>
          <div className="kpi-value">{data?.total ?? 0}</div>
          <div className="kpi-meta">Matching current filter</div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'Received' }, { value: 'out', label: 'Paid' }]} />
        <div className="search">
          <Icon name="search" />
          <input className="input" placeholder="Search payments…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payments" />
        </div>
      </div>

      <Card className={loading && data ? 'is-refreshing' : ''}>
        {loading && !data ? <SkeletonRows rows={8} columns={6} /> : items.length === 0 ? (
          <EmptyState
            icon="payments"
            title={search ? 'No payments match' : `No ${currency} payments yet`}
            body={search
              ? `Nothing matches “${search}”.`
              : 'Record money received from a customer or paid to a vendor — it settles their oldest open documents automatically.'}
            action={search ? <Button onClick={() => setSearch('')}>Clear search</Button> : (
              <div className="row gap-8 wrap" style={{ justifyContent: 'center' }}>
                <Button variant="primary" onClick={() => setDirection('in')}><Icon name="arrowDown" size={14} /> Receive a payment</Button>
                <Button onClick={() => setDirection('out')}><Icon name="arrowUp" size={14} /> Pay a bill</Button>
              </div>
            )}
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Date</th>
                  <th>Contact</th>
                  <th>Method</th>
                  <th>Applied to</th>
                  <th className="num">Amount</th>
                  <th className="num">Unapplied</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p, index) => (
                  <tr
                    key={p.id}
                    className="clickable enter"
                    style={{ '--enter-delay': `${Math.min(index, 14) * 22}ms` } as React.CSSProperties}
                    onClick={() => setDetail(p)}
                  >
                    <td>
                      <div className="row gap-8">
                        <span className={`badge ${p.direction === 'in' ? 'badge-in' : 'badge-out'}`}>{p.direction === 'in' ? 'IN' : 'OUT'}</span>
                        <span className="doc-no">{p.number}</span>
                      </div>
                    </td>
                    <td className="muted small nowrap">{formatDate(p.date)}</td>
                    <td style={{ fontWeight: 500 }}>{p.contact?.name ?? '—'}</td>
                    <td className="muted small">{p.method}{p.reference ? <div className="sub-line">{p.reference}</div> : null}</td>
                    <td className="small">
                      {p.allocations.length === 0 ? <span className="muted">Unapplied</span> : p.allocations.map((a) => a.docNumber).join(', ')}
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}><Money cents={p.amountCents} currency={p.currency} /></td>
                    <td className="num">{p.unappliedCents > 0 ? <Money cents={p.unappliedCents} currency={p.currency} className="warn" /> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {direction ? (
        <PaymentModalWrapper
          direction={direction}
          onClose={() => setDirection(null)}
          onSaved={() => { setDirection(null); load(); }}
        />
      ) : null}

      {detail ? (
        <Modal
          title={`Payment ${detail.number}`}
          sub={`${detail.direction === 'in' ? 'Received from' : 'Paid to'} ${detail.contact?.name ?? ''} · ${formatDate(detail.date, 'long')}`}
          onClose={() => setDetail(null)}
          footer={(
            <>
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(detail)} style={{ marginRight: 'auto' }}><Icon name="trash" size={14} /> Delete</Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          )}
        >
          <div className="row gap-24" style={{ marginBottom: 16 }}>
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny muted">Amount</span>
              <Money cents={detail.amountCents} currency={detail.currency} />
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny muted">Unapplied</span>
              <Money cents={detail.unappliedCents} currency={detail.currency} />
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny muted">Method</span>
              <span className="small">{detail.method}</span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny muted">Reference</span>
              <span className="small">{detail.reference || '—'}</span>
            </div>
          </div>
          <table className="line-table">
            <thead>
              <tr><th>Document</th><th>Type</th><th className="right">Applied</th></tr>
            </thead>
            <tbody>
              {detail.allocations.length === 0 ? (
                <tr><td colSpan={3} className="muted small">No allocations — this payment is unapplied credit.</td></tr>
              ) : detail.allocations.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 550 }}>{a.docNumber}</td>
                  <td className="small muted">{a.docType === 'invoice' ? 'Invoice' : 'Bill'}</td>
                  <td className="right"><Money cents={a.amountCents} currency={detail.currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal
          title={`Delete ${confirmDelete.number}?`}
          onClose={() => setConfirmDelete(null)}
          width="sm"
          footer={(
            <>
              <Button onClick={() => setConfirmDelete(null)} style={{ marginLeft: 'auto' }}>Cancel</Button>
              <Button variant="danger" onClick={remove}>Delete payment</Button>
            </>
          )}
        >
          <p className="small">The payment is removed and any documents it was applied to return to their previous open balance.</p>
        </Modal>
      ) : null}
    </div>
  );
}

import { PaymentModal } from '../components/PaymentModal';

function PaymentModalWrapper({ direction, onClose, onSaved }: { direction: 'in' | 'out'; onClose: () => void; onSaved: () => void }) {
  return <PaymentModal direction={direction} onClose={onClose} onSaved={onSaved} />;
}
