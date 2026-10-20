import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Dashboard as DashboardData, RecentDoc } from '../types';
import { formatDate, moneyShort, relativeDue, type Currency } from '../lib/format';
import { useViewCurrency } from '../lib/currency';
import { AgingBar, BarPairChart, Card, CardHead, EmptyState, Icon, Money, Skeleton, SkeletonKpis, SkeletonRows, StatusBadge } from '../ui';
import { Link } from '../lib/router';

function Kpi({ label, value, meta, accent, icon, delay = 0 }: { label: string; value: string; meta?: React.ReactNode; accent?: 'warn' | 'neg' | 'info'; icon?: string; delay?: number }) {
  return (
    <div className="card kpi lift enter" style={{ '--enter-delay': `${delay}ms` } as React.CSSProperties}>
      <div className={`kpi-accent ${accent ?? ''}`} />
      <div className="kpi-label">
        {icon ? <Icon name={icon} size={14} /> : null}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {meta ? <div className="kpi-meta">{meta}</div> : null}
    </div>
  );
}

function RecentRow({ doc }: { doc: RecentDoc }) {
  const due = relativeDue(doc.dueDate, doc.status);
  const href = doc.kind === 'invoice' ? `/invoices/${doc.id}` : `/bills/${doc.id}`;
  return (
    <Link to={href} className="list-row">
      <div className="stack grow" style={{ minWidth: 0, gap: 2 }}>
        <span className="list-title">{doc.contactName}</span>
        <span className="list-sub">{doc.number} · {formatDate(doc.issueDate, 'short')}</span>
      </div>
      <div className="stack" style={{ alignItems: 'flex-end', gap: 3 }}>
        <Money cents={doc.balanceCents || doc.totalCents} currency={doc.currency} />
        <span className={`tiny ${due.tone === 'neg' ? 'neg' : 'muted'}`}>{due.label}</span>
      </div>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="stack" style={{ gap: 18 }} role="status" aria-label="Loading dashboard">
      <div className="stack" style={{ gap: 8 }}>
        <Skeleton width={260} height={22} />
        <Skeleton width={320} height={11} />
      </div>
      <SkeletonKpis />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 14 }} className="dash-split">
        <div className="card card-body"><Skeleton height={190} radius={10} /></div>
        <div className="card card-body stack" style={{ gap: 18 }}>
          <Skeleton height={10} radius={99} /><Skeleton width="80%" height={10} />
          <Skeleton height={10} radius={99} /><Skeleton width="70%" height={10} />
        </div>
      </div>
      <div className="card"><SkeletonRows rows={4} columns={3} /></div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { currency, setCurrency } = useViewCurrency();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    api.get<DashboardData>(`/dashboard?currency=${currency}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [currency]);

  if (error) return <div className="banner banner-neg">{error}</div>;
  // Keep the previous figures on screen while a currency switch loads; skeleton only on first paint.
  if (!data) return <DashboardSkeleton />;

  const { summary, aging, trend, cash } = data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const switching = data.currency !== currency;
  const hasActivity = data.recentInvoices.length + data.recentBills.length > 0;
  const otherWithData = data.currenciesInUse.find((c) => c.currency !== currency && c.documentCount > 0);

  return (
    <div className={`stack gap-16 ${switching ? 'is-refreshing' : ''}`} style={{ gap: 18 }} aria-busy={switching}>
      {!hasActivity && !switching ? (
        <div className="banner banner-info onboarding">
          <Icon name="payments" size={16} />
          <div className="grow">
            <strong>No {currency} activity yet.</strong>{' '}
            {otherWithData
              ? `Your existing records are in ${otherWithData.currency}. Switch the view, or raise your first ${currency} invoice.`
              : `Draft your first invoice or bill in ${currency} to see receivables, payables and cash flow here.`}
          </div>
          <div className="row gap-8 wrap">
            {otherWithData ? (
              <button type="button" className="btn btn-sm" onClick={() => setCurrency(otherWithData.currency as Currency)}>
                Show {otherWithData.currency}
              </button>
            ) : null}
            <Link to="/invoices?new=1" className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> New {currency} invoice</Link>
          </div>
        </div>
      ) : null}
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="stack" style={{ gap: 3 }}>
          <h1>{greeting}, {firstName}</h1>
          <div className="muted small">
            {summary.openInvoiceCount} open invoices · {summary.openBillCount} open bills · fiscal year {summary.asOf.slice(0, 4)}
          </div>
        </div>
        <div className="row gap-8 wrap">
          <Link to="/payments?new=1" className="btn btn-sm"><Icon name="bank" size={15} /> Record payment</Link>
          <Link to="/invoices?new=1" className="btn btn-primary btn-sm"><Icon name="plus" size={15} /> New invoice</Link>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi
          label="Receivables outstanding"
          icon="invoice"
          delay={0}
          value={moneyShort(summary.receivableCents, currency)}
          meta={<><span className="neg">{moneyShort(summary.receivableOverdueCents, currency)}</span> overdue</>}
        />
        <Kpi
          label="Payables outstanding"
          icon="bill"
          delay={60}
          accent="warn"
          value={moneyShort(summary.payableCents, currency)}
          meta={<><span className="neg">{moneyShort(summary.payableOverdueCents, currency)}</span> overdue</>}
        />
        <Kpi
          label="Working capital"
          icon="reports"
          delay={120}
          accent={summary.workingCapitalCents >= 0 ? undefined : 'neg'}
          value={moneyShort(summary.workingCapitalCents, currency)}
          meta={<>AR − AP</>}
        />
        <Kpi
          label="Net cash · 30 days"
          icon="bank"
          delay={180}
          accent="info"
          value={moneyShort(summary.cashIn30Cents - summary.cashOut30Cents, currency)}
          meta={<>{moneyShort(summary.cashIn30Cents, currency)} in · {moneyShort(summary.cashOut30Cents, currency)} out</>}
        />
      </div>

      <div className="dash-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 14 }}>
        <Card>
          <CardHead
            title="Revenue vs expenses"
            sub="Accrual basis, last 6 months"
            actions={<Link to="/reports?tab=pl" className="btn btn-ghost btn-sm">Open report <Icon name="chevronRight" size={14} /></Link>}
          />
          <div className="card-body">
            <BarPairChart
              currency={currency}
              data={trend.series.map((row) => ({ label: formatDate(`${row.period}-01`, 'short').replace(/\s\d+$/, ''), a: row.revenueCents, b: row.expenseCents }))}
            />
            <div className="row gap-24" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="tiny muted">Revenue YTD</span>
                <Money cents={summary.revenueYtdCents} currency={currency} className="pos" />
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <span className="tiny muted">Expenses YTD</span>
                <Money cents={summary.expenseYtdCents} currency={currency} className="neg" />
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <span className="tiny muted">Net profit</span>
                <Money cents={summary.netYtdCents} currency={currency} className={summary.netYtdCents >= 0 ? 'pos' : 'neg'} />
              </div>
              <div className="stack" style={{ gap: 2, marginLeft: 'auto', textAlign: 'right' }}>
                <span className="tiny muted">DSO / DPO</span>
                <span className="num small">{summary.dsoDays}d / {summary.dpoDays}d</span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Aging summary"
            sub={`As of ${formatDate(summary.asOf)}`}
            actions={<Link to="/reports?tab=ar-aging" className="btn btn-ghost btn-sm">Details</Link>}
          />
          <div className="card-body stack gap-16" style={{ gap: 16 }}>
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 7 }}>
                <span className="small" style={{ fontWeight: 550 }}>Receivables</span>
                <Money cents={aging.ar.total} currency={currency} />
              </div>
              <AgingBar totals={aging.ar} />
            </div>
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 7 }}>
                <span className="small" style={{ fontWeight: 550 }}>Payables</span>
                <Money cents={aging.ap.total} currency={currency} />
              </div>
              <AgingBar totals={aging.ap} />
            </div>
          </div>
        </Card>
      </div>

      <div className="dash-three" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        <Card>
          <CardHead title="Latest invoices" actions={<Link to="/invoices" className="btn btn-ghost btn-sm">All</Link>} />
          {data.recentInvoices.length === 0 ? (
            <EmptyState
              icon="invoice"
              title={`No ${currency} invoices yet`}
              body="Bill a customer to start tracking what you're owed."
              action={<Link to="/invoices?new=1" className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> Draft your first invoice</Link>}
            />
          ) : (
            <div className="list">
              {data.recentInvoices.slice(0, 5).map((doc) => <RecentRow key={`${doc.kind}-${doc.id}`} doc={doc} />)}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Latest bills" actions={<Link to="/bills" className="btn btn-ghost btn-sm">All</Link>} />
          {data.recentBills.length === 0 ? (
            <EmptyState
              icon="bill"
              title={`No ${currency} bills yet`}
              body="Record what you owe vendors to plan payables."
              action={<Link to="/bills?new=1" className="btn btn-sm"><Icon name="plus" size={14} /> Add a bill</Link>}
            />
          ) : (
            <div className="list">
              {data.recentBills.slice(0, 5).map((doc) => <RecentRow key={`${doc.kind}-${doc.id}`} doc={doc} />)}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Needs attention" sub="Largest overdue balances" />
          {data.topOverdue.length === 0 ? <EmptyState icon="check" title="All clear" body="Nothing past due." /> : (
            <div className="list">
              {data.topOverdue.map((doc) => (
                <Link key={`${doc.kind}-${doc.id}`} to={doc.kind === 'invoice' ? `/invoices/${doc.id}` : `/bills/${doc.id}`} className="list-row">
                  <div className="stack grow" style={{ minWidth: 0, gap: 2 }}>
                    <span className="list-title">{doc.contactName}</span>
                    <span className="list-sub">{doc.number} · <span className="neg">{doc.daysOverdue}d overdue</span></span>
                  </div>
                  <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Money cents={doc.balanceCents} currency={currency} />
                    <StatusBadge status={doc.status} overdue />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="muted tiny">
        Cash movement last 6 months: {moneyShort(cash.totals.inflowCents, currency)} collected · {moneyShort(cash.totals.outflowCents, currency)} paid
      </div>
    </div>
  );
}

