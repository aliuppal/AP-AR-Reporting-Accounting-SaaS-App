import { useCallback, useEffect, useState } from 'react';
import { api, downloadUrl, qs } from '../api';
import { useViewCurrency } from '../lib/currency';
import type { AgingReport, CashFlow, ProfitLoss } from '../types';
import { formatDate, moneyShort, monthLabel, startOfMonthISO, startOfYearISO, todayISO } from '../lib/format';
import { useQueryParam, useRouter } from '../lib/router';
import { AgingBar, BarPairChart, Button, Card, CardHead, EmptyState, Icon, Money, Segmented, SkeletonKpis, SkeletonRows } from '../ui';

type Tab = 'ar-aging' | 'ap-aging' | 'pl' | 'cash';

const TABS: { value: Tab; label: string }[] = [
  { value: 'ar-aging', label: 'AR aging' },
  { value: 'ap-aging', label: 'AP aging' },
  { value: 'pl', label: 'Profit & loss' },
  { value: 'cash', label: 'Cash flow' },
];

export function Reports() {
  const { currency } = useViewCurrency();
  const tabParam = useQueryParam('tab');
  const { navigate } = useRouter();
  const [tab, setTab] = useState<Tab>((TABS.some((t) => t.value === tabParam) ? tabParam : 'ar-aging') as Tab);

  useEffect(() => {
    if (tabParam && TABS.some((t) => t.value === tabParam) && tabParam !== tab) setTab(tabParam as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  const changeTab = (next: Tab) => {
    setTab(next);
    navigate(`/reports?tab=${next}`, { replace: true });
  };

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h1>Reports</h1>
          <div className="muted small">Aging, profitability and cash movement in {currency} — always live from the ledger</div>
        </div>
        <Segmented value={tab} onChange={changeTab} options={TABS} />
      </div>

      {tab === 'ar-aging' || tab === 'ap-aging' ? <AgingView type={tab === 'ar-aging' ? 'ar' : 'ap'} currency={currency} /> : null}
      {tab === 'pl' ? <ProfitLossView currency={currency} /> : null}
      {tab === 'cash' ? <CashFlowView currency={currency} /> : null}
    </div>
  );
}

function ExportButton({ report, params }: { report: string; params: Record<string, string> }) {
  return (
    <a className="btn btn-sm" href={downloadUrl(`/reports/export${qs({ report, ...params })}`)}>
      <Icon name="download" size={14} /> Export CSV
    </a>
  );
}

function AgingView({ type, currency }: { type: 'ar' | 'ap'; currency: string }) {
  const [asOf, setAsOf] = useState(todayISO());
  const [data, setData] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<AgingReport>(`/reports/aging${qs({ type, asOf, currency })}`));
    } finally {
      setLoading(false);
    }
  }, [type, asOf, currency]);

  useEffect(() => { load(); }, [load]);

  const label = type === 'ar' ? 'Receivables' : 'Payables';

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <label className="row gap-8 small muted">
          As of
          <input className="input input-sm" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 150 }} />
        </label>
        <div className="row gap-8" style={{ marginLeft: 'auto' }}>
          <ExportButton report={type === 'ar' ? 'ar-aging' : 'ap-aging'} params={{ asOf, currency }} />
          <Button size="sm" onClick={() => window.print()}><Icon name="print" size={14} /> Print</Button>
        </div>
      </div>

      {loading && !data ? <><SkeletonKpis /><div className="card"><SkeletonRows rows={6} columns={6} /></div></> : data ? (
        <>
          <div className="kpi-grid">
            <div className="card kpi">
              <div className="kpi-accent" />
              <div className="kpi-label">{label} outstanding</div>
              <div className="kpi-value"><Money cents={data.totals.total} currency={currency} /></div>
              <div className="kpi-meta">{data.documentCount} open documents</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent neg" />
              <div className="kpi-label">Overdue</div>
              <div className="kpi-value"><Money cents={data.overdueCents} currency={currency} /></div>
              <div className="kpi-meta">Past the due date</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent info" />
              <div className="kpi-label">Current</div>
              <div className="kpi-value"><Money cents={data.currentCents} currency={currency} /></div>
              <div className="kpi-meta">Not yet due</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent warn" />
              <div className="kpi-label">90+ days</div>
              <div className="kpi-value"><Money cents={data.totals.d90plus} currency={currency} /></div>
              <div className="kpi-meta">Escalate collection</div>
            </div>
          </div>

          <Card>
            <CardHead title={`${label} aging`} sub={`As of ${formatDate(asOf, 'long')} · by contact`} />
            <div className="card-body" style={{ paddingBottom: 8 }}>
              <AgingBar totals={data.totals} currency={currency} />
            </div>
            {data.rows.length === 0 ? (
              <EmptyState icon="check" title="Nothing outstanding" body={`No open ${label.toLowerCase()} for this date.`} />
            ) : (
              <div className="table-wrap">
                <table className="table table-stack">
                  <thead>
                    <tr>
                      <th>Contact</th>
                      <th className="num">Current</th>
                      <th className="num">1–30</th>
                      <th className="num">31–60</th>
                      <th className="num">61–90</th>
                      <th className="num">90+</th>
                      <th className="num">Total</th>
                      <th className="num">Oldest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.contactId}>
                        <td>
                          <div style={{ fontWeight: 550 }}>{row.contactName}</div>
                          <div className="sub-line">{row.documentCount} document{row.documentCount === 1 ? '' : 's'}</div>
                        </td>
                        <td className="num">{row.current ? <Money cents={row.current} currency={currency} /> : <span className="muted">—</span>}</td>
                        <td className="num">{row.d1_30 ? <Money cents={row.d1_30} currency={currency} /> : <span className="muted">—</span>}</td>
                        <td className="num">{row.d31_60 ? <Money cents={row.d31_60} currency={currency} /> : <span className="muted">—</span>}</td>
                        <td className="num">{row.d61_90 ? <Money cents={row.d61_90} currency={currency} /> : <span className="muted">—</span>}</td>
                        <td className="num">{row.d90plus ? <Money cents={row.d90plus} currency={currency} className="neg" /> : <span className="muted">—</span>}</td>
                        <td className="num" style={{ fontWeight: 600 }}><Money cents={row.total} currency={currency} /></td>
                        <td className="num muted small">{row.oldestDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num"><Money cents={data.totals.current} currency={currency} compact /></td>
                      <td className="num"><Money cents={data.totals.d1_30} currency={currency} compact /></td>
                      <td className="num"><Money cents={data.totals.d31_60} currency={currency} compact /></td>
                      <td className="num"><Money cents={data.totals.d61_90} currency={currency} compact /></td>
                      <td className="num"><Money cents={data.totals.d90plus} currency={currency} compact /></td>
                      <td className="num"><Money cents={data.totals.total} currency={currency} compact /></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ProfitLossView({ currency }: { currency: string }) {
  const [from, setFrom] = useState(startOfYearISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<ProfitLoss | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<ProfitLoss>(`/reports/profit-loss${qs({ from, to, currency })}`));
    } finally {
      setLoading(false);
    }
  }, [from, to, currency]);

  useEffect(() => { load(); }, [load]);

  const maxCategory = (rows: { amountCents: number }[]) => Math.max(1, ...rows.map((r) => Math.abs(r.amountCents)));

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <label className="row gap-8 small muted">From <input className="input input-sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} /></label>
        <label className="row gap-8 small muted">To <input className="input input-sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} /></label>
        <div className="row gap-8" style={{ marginLeft: 'auto' }}>
          <ExportButton report="profit-loss" params={{ from, to, currency }} />
          <Button size="sm" onClick={() => window.print()}><Icon name="print" size={14} /> Print</Button>
        </div>
      </div>

      {loading && !data ? <><SkeletonKpis /><div className="card"><SkeletonRows rows={6} columns={6} /></div></> : data ? (
        <>
          <div className="kpi-grid">
            <div className="card kpi">
              <div className="kpi-accent" />
              <div className="kpi-label">Revenue</div>
              <div className="kpi-value"><Money cents={data.totals.revenueCents} currency={currency} /></div>
              <div className="kpi-meta">{formatDate(from, 'short')} – {formatDate(to, 'short')}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent neg" />
              <div className="kpi-label">Expenses</div>
              <div className="kpi-value"><Money cents={data.totals.expenseCents} currency={currency} /></div>
              <div className="kpi-meta">{data.expenseByCategory.length} categories</div>
            </div>
            <div className="card kpi">
              <div className={`kpi-accent ${data.totals.netCents >= 0 ? '' : 'neg'}`} style={data.totals.netCents >= 0 ? { background: 'var(--pos)' } : undefined} />
              <div className="kpi-label">Net profit</div>
              <div className="kpi-value"><Money cents={data.totals.netCents} currency={currency} /></div>
              <div className="kpi-meta">Margin {data.totals.marginPct}%</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent info" />
              <div className="kpi-label">Discounts given</div>
              <div className="kpi-value"><Money cents={data.totals.discountCents} currency={currency} /></div>
              <div className="kpi-meta">Applied to invoices</div>
            </div>
          </div>

          <Card>
            <CardHead title="Revenue vs expenses" sub="Accrual basis, by month" />
            <div className="card-body">
              <BarPairChart
                currency={currency}
                height={220}
                data={data.series.map((row) => ({ label: monthLabel(row.period), a: row.revenueCents, b: row.expenseCents }))}
              />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Month</th><th className="num">Revenue</th><th className="num">Expenses</th><th className="num">Net</th></tr>
                </thead>
                <tbody>
                  {data.series.map((row) => (
                    <tr key={row.period}>
                      <td>{monthLabel(row.period)}</td>
                      <td className="num"><Money cents={row.revenueCents} currency={currency} /></td>
                      <td className="num"><Money cents={row.expenseCents} currency={currency} /></td>
                      <td className={`num ${row.netCents >= 0 ? 'pos' : 'neg'}`}><Money cents={row.netCents} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num"><Money cents={data.totals.revenueCents} currency={currency} /></td>
                    <td className="num"><Money cents={data.totals.expenseCents} currency={currency} /></td>
                    <td className="num"><Money cents={data.totals.netCents} currency={currency} /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <CardHead title="Revenue by category" />
              <div className="card-body stack gap-12" style={{ gap: 12 }}>
                {data.revenueByCategory.length === 0 ? <span className="muted small">No revenue in this period.</span> : data.revenueByCategory.map((row) => (
                  <div key={row.category} className="stack" style={{ gap: 5 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="small">{row.category}</span>
                      <Money cents={row.amountCents} currency={currency} />
                    </div>
                    <div style={{ height: 6, background: '#2d2d2d', borderRadius: 99 }}>
                      <div style={{ width: `${(Math.abs(row.amountCents) / maxCategory(data.revenueByCategory)) * 100}%`, height: '100%', background: '#3cffd0', borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHead title="Expenses by category" />
              <div className="card-body stack gap-12" style={{ gap: 12 }}>
                {data.expenseByCategory.length === 0 ? <span className="muted small">No expenses in this period.</span> : data.expenseByCategory.map((row) => (
                  <div key={row.category} className="stack" style={{ gap: 5 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="small">{row.category}</span>
                      <Money cents={row.amountCents} currency={currency} />
                    </div>
                    <div style={{ height: 6, background: '#2d2d2d', borderRadius: 99 }}>
                      <div style={{ width: `${(Math.abs(row.amountCents) / maxCategory(data.expenseByCategory)) * 100}%`, height: '100%', background: '#ff5ca8', borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CashFlowView({ currency }: { currency: string }) {
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<CashFlow>(`/reports/cash-flow${qs({ from, to, currency })}`));
    } finally {
      setLoading(false);
    }
  }, [from, to, currency]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <label className="row gap-8 small muted">From <input className="input input-sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} /></label>
        <label className="row gap-8 small muted">To <input className="input input-sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} /></label>
        <div className="row gap-8" style={{ marginLeft: 'auto' }}>
          <ExportButton report="cash-flow" params={{ from, to, currency }} />
          <Button size="sm" onClick={() => window.print()}><Icon name="print" size={14} /> Print</Button>
        </div>
      </div>

      {loading && !data ? <><SkeletonKpis /><div className="card"><SkeletonRows rows={6} columns={6} /></div></> : data ? (
        <>
          <div className="kpi-grid">
            <div className="card kpi">
              <div className="kpi-accent" />
              <div className="kpi-label">Cash in</div>
              <div className="kpi-value"><Money cents={data.totals.inflowCents} currency={currency} /></div>
              <div className="kpi-meta">Customer receipts</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent neg" />
              <div className="kpi-label">Cash out</div>
              <div className="kpi-value"><Money cents={data.totals.outflowCents} currency={currency} /></div>
              <div className="kpi-meta">Vendor payments</div>
            </div>
            <div className="card kpi">
              <div className={`kpi-accent ${data.totals.netCents >= 0 ? '' : 'neg'}`} style={data.totals.netCents >= 0 ? { background: 'var(--pos)' } : undefined} />
              <div className="kpi-label">Net movement</div>
              <div className="kpi-value"><Money cents={data.totals.netCents} currency={currency} /></div>
              <div className="kpi-meta">{formatDate(from, 'short')} – {formatDate(to, 'short')}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-accent info" />
              <div className="kpi-label">Closing balance</div>
              <div className="kpi-value"><Money cents={data.series[data.series.length - 1]?.cumulativeCents ?? 0} currency={currency} /></div>
              <div className="kpi-meta">Cumulative from period start</div>
            </div>
          </div>

          <Card>
            <CardHead title="Cash movement" sub="Inflows and outflows by month" />
            <div className="card-body">
              <BarPairChart
                currency={currency}
                height={220}
                data={data.series.map((row) => ({ label: monthLabel(row.period), a: row.inflowCents, b: row.outflowCents }))}
              />
            </div>
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr><th>Month</th><th className="num">In</th><th className="num">Out</th><th className="num">Net</th><th className="num">Cumulative</th></tr>
                </thead>
                <tbody>
                  {data.series.map((row) => (
                    <tr key={row.period}>
                      <td>{monthLabel(row.period)}</td>
                      <td className="num"><Money cents={row.inflowCents} currency={currency} /></td>
                      <td className="num"><Money cents={row.outflowCents} currency={currency} /></td>
                      <td className={`num ${row.netCents >= 0 ? 'pos' : 'neg'}`}><Money cents={row.netCents} currency={currency} /></td>
                      <td className="num muted"><Money cents={row.cumulativeCents} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num"><Money cents={data.totals.inflowCents} currency={currency} /></td>
                    <td className="num"><Money cents={data.totals.outflowCents} currency={currency} /></td>
                    <td className="num"><Money cents={data.totals.netCents} currency={currency} /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <div className="muted tiny">Total collected {moneyShort(data.totals.inflowCents, currency)} against {moneyShort(data.totals.outflowCents, currency)} paid out.</div>
        </>
      ) : null}
    </div>
  );
}
