import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Dashboard as DashboardData, RecentDoc } from '../types';
import { formatDate, moneyShort, relativeDue } from '../lib/format';
import { AgingBar, BarPairChart, Card, CardHead, EmptyState, Icon, Money, Spinner, StatusBadge } from '../ui';
import { Link } from '../lib/router';

function Kpi({ label, value, meta, accent, icon }: { label: string; value: string; meta?: React.ReactNode; accent?: 'warn' | 'neg' | 'info'; icon?: string }) {
  return (
    <div className="card kpi">
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
        <Money cents={doc.balanceCents || doc.totalCents} />
        <span className={`tiny ${due.tone === 'neg' ? 'neg' : 'muted'}`}>{due.label}</span>
      </div>
    </Link>
  );
}

export function Dashboard() {
  const { user, settings } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const currency = settings?.currency ?? 'USD';

  useEffect(() => {
    api.get<DashboardData>('/dashboard')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="banner banner-neg">{error}</div>;
  if (!data) return <Spinner />;

  const { summary, aging, trend, cash } = data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="stack gap-16" style={{ gap: 18 }}>
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
          value={moneyShort(summary.receivableCents, currency)}
          meta={<><span className="neg">{moneyShort(summary.receivableOverdueCents, currency)}</span> overdue</>}
        />
        <Kpi
          label="Payables outstanding"
          icon="bill"
          accent="warn"
          value={moneyShort(summary.payableCents, currency)}
          meta={<><span className="neg">{moneyShort(summary.payableOverdueCents, currency)}</span> overdue</>}
        />
        <Kpi
          label="Working capital"
          icon="reports"
          accent={summary.workingCapitalCents >= 0 ? undefined : 'neg'}
          value={moneyShort(summary.workingCapitalCents, currency)}
          meta={<>AR − AP</>}
        />
        <Kpi
          label="Net cash · 30 days"
          icon="bank"
          accent="info"
          value={moneyShort(summary.cashIn30Cents - summary.cashOut30Cents, currency)}
          meta={<>{moneyShort(summary.cashIn30Cents, currency)} in · {moneyShort(summary.cashOut30Cents, currency)} out</>}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 14 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        <Card>
          <CardHead title="Latest invoices" actions={<Link to="/invoices" className="btn btn-ghost btn-sm">All</Link>} />
          {data.recentInvoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
            <div className="list">
              {data.recentInvoices.slice(0, 5).map((doc) => <RecentRow key={`${doc.kind}-${doc.id}`} doc={doc} />)}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Latest bills" actions={<Link to="/bills" className="btn btn-ghost btn-sm">All</Link>} />
          {data.recentBills.length === 0 ? <EmptyState title="No bills yet" /> : (
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
