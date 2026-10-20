import { Router } from 'express';
import { AGING_BUCKETS, agingBucket, diffDays, endOfMonth, monthKey, monthsBetween, startOfMonth, toCsv, today } from '../domain.js';

const round = (n) => Math.round(n);

function agingRows(db, type, asOf) {
  const table = type === 'ar' ? 'invoices' : 'bills';
  const docs = db.prepare(
    `SELECT d.*, c.name AS contact_name, c.company AS contact_company
       FROM ${table} d JOIN contacts c ON c.id = d.contact_id
      WHERE d.status IN ('open','partial') AND d.issue_date <= ? AND d.total_cents > d.paid_cents
      ORDER BY d.due_date`
  ).all(asOf);

  const map = new Map();
  for (const doc of docs) {
    const balance = doc.total_cents - doc.paid_cents;
    const days = diffDays(asOf, doc.due_date);
    const bucket = agingBucket(days);
    let row = map.get(doc.contact_id);
    if (!row) {
      row = {
        contactId: doc.contact_id,
        contactName: doc.contact_name,
        company: doc.contact_company,
        current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0,
        total: 0,
        oldestDays: 0,
        documentCount: 0,
      };
      map.set(doc.contact_id, row);
    }
    row[bucket] += balance;
    row.total += balance;
    row.oldestDays = Math.max(row.oldestDays, Math.max(0, days));
    row.documentCount += 1;
  }

  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
  for (const row of rows) for (const key of Object.keys(totals)) totals[key] += row[key];
  const overdue = totals.d1_30 + totals.d31_60 + totals.d61_90 + totals.d90plus;
  return {
    type,
    asOf,
    buckets: AGING_BUCKETS,
    rows,
    totals,
    overdueCents: overdue,
    currentCents: totals.current,
    documentCount: docs.length,
  };
}

function cashFlow(db, from, to) {
  const months = monthsBetween(from, to);
  const rows = db.prepare(
    `SELECT direction,
            substr(date, 1, 7) AS period,
            SUM(amount_cents) AS total
       FROM payments
      WHERE date >= ? AND date <= ?
      GROUP BY direction, period`
  ).all(startOfMonth(from), endOfMonth(to));
  const byKey = new Map(rows.map((r) => [`${r.direction}:${r.period}`, r.total]));
  let running = 0;
  const series = months.map((m) => {
    const inflow = byKey.get(`in:${m}`) ?? 0;
    const outflow = byKey.get(`out:${m}`) ?? 0;
    const net = inflow - outflow;
    running += net;
    return { period: m, inflowCents: inflow, outflowCents: outflow, netCents: net, cumulativeCents: running };
  });
  return {
    from, to,
    series,
    totals: {
      inflowCents: series.reduce((s, r) => s + r.inflowCents, 0),
      outflowCents: series.reduce((s, r) => s + r.outflowCents, 0),
      netCents: series.reduce((s, r) => s + r.netCents, 0),
    },
  };
}

function profitLoss(db, from, to) {
  const months = monthsBetween(from, to);
  const revenueLines = db.prepare(
    `SELECT substr(d.issue_date, 1, 7) AS period, l.category, SUM(l.amount_cents) AS amount
       FROM invoice_lines l JOIN invoices d ON d.id = l.invoice_id
      WHERE d.status NOT IN ('draft','void') AND d.issue_date >= ? AND d.issue_date <= ?
      GROUP BY period, l.category`
  ).all(from, to);
  const expenseLines = db.prepare(
    `SELECT substr(d.issue_date, 1, 7) AS period, l.category, SUM(l.amount_cents) AS amount
       FROM bill_lines l JOIN bills d ON d.id = l.bill_id
      WHERE d.status NOT IN ('draft','void') AND d.issue_date >= ? AND d.issue_date <= ?
      GROUP BY period, l.category`
  ).all(from, to);
  const discounts = db.prepare(
    `SELECT substr(issue_date, 1, 7) AS period, SUM(discount_cents) AS amount
       FROM invoices WHERE status NOT IN ('draft','void') AND issue_date >= ? AND issue_date <= ?
      GROUP BY period`
  ).all(from, to);

  const discountByPeriod = new Map(discounts.map((d) => [d.period, d.amount]));

  const categoryTotals = (rows) => {
    const map = new Map();
    for (const r of rows) map.set(r.category || 'Uncategorised', (map.get(r.category || 'Uncategorised') ?? 0) + r.amount);
    return [...map.entries()].map(([category, amountCents]) => ({ category, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);
  };

  const series = months.map((m) => {
    const revenue = revenueLines.filter((r) => r.period === m).reduce((s, r) => s + r.amount, 0) - (discountByPeriod.get(m) ?? 0);
    const expenses = expenseLines.filter((r) => r.period === m).reduce((s, r) => s + r.amount, 0);
    return { period: m, revenueCents: revenue, expenseCents: expenses, netCents: revenue - expenses };
  });

  const totalRevenue = series.reduce((s, r) => s + r.revenueCents, 0);
  const totalExpenses = series.reduce((s, r) => s + r.expenseCents, 0);

  return {
    from, to,
    series,
    revenueByCategory: categoryTotals(revenueLines),
    expenseByCategory: categoryTotals(expenseLines),
    totals: {
      revenueCents: totalRevenue,
      expenseCents: totalExpenses,
      netCents: totalRevenue - totalExpenses,
      marginPct: totalRevenue ? round(((totalRevenue - totalExpenses) / totalRevenue) * 1000) / 10 : 0,
      discountCents: [...discountByPeriod.values()].reduce((s, v) => s + v, 0),
    },
  };
}

function summary(db, asOf = today()) {
  const openAR = db.prepare(
    `SELECT COALESCE(SUM(total_cents - paid_cents),0) AS total,
            COALESCE(SUM(CASE WHEN due_date < ? THEN total_cents - paid_cents ELSE 0 END),0) AS overdue,
            COUNT(*) AS docs
       FROM invoices WHERE status IN ('open','partial')`
  ).get(asOf);
  const openAP = db.prepare(
    `SELECT COALESCE(SUM(total_cents - paid_cents),0) AS total,
            COALESCE(SUM(CASE WHEN due_date < ? THEN total_cents - paid_cents ELSE 0 END),0) AS overdue,
            COUNT(*) AS docs
       FROM bills WHERE status IN ('open','partial')`
  ).get(asOf);

  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const revenueYtd = db.prepare(
    `SELECT COALESCE(SUM(l.amount_cents),0) AS s FROM invoice_lines l JOIN invoices d ON d.id = l.invoice_id
      WHERE d.status NOT IN ('draft','void') AND d.issue_date BETWEEN ? AND ?`
  ).get(yearStart, asOf).s;
  const expenseYtd = db.prepare(
    `SELECT COALESCE(SUM(l.amount_cents),0) AS s FROM bill_lines l JOIN bills d ON d.id = l.bill_id
      WHERE d.status NOT IN ('draft','void') AND d.issue_date BETWEEN ? AND ?`
  ).get(yearStart, asOf).s;

  const cashIn30 = db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE direction = 'in' AND date > date(?, '-30 days')`
  ).get(asOf).s;
  const cashOut30 = db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE direction = 'out' AND date > date(?, '-30 days')`
  ).get(asOf).s;

  // Trailing-90-day revenue/expense annualised into days-sales-outstanding style metrics.
  const rev90 = db.prepare(
    `SELECT COALESCE(SUM(l.amount_cents),0) AS s FROM invoice_lines l JOIN invoices d ON d.id = l.invoice_id
      WHERE d.status NOT IN ('draft','void') AND d.issue_date > date(?, '-90 days') AND d.issue_date <= ?`
  ).get(asOf, asOf).s;
  const exp90 = db.prepare(
    `SELECT COALESCE(SUM(l.amount_cents),0) AS s FROM bill_lines l JOIN bills d ON d.id = l.bill_id
      WHERE d.status NOT IN ('draft','void') AND d.issue_date > date(?, '-90 days') AND d.issue_date <= ?`
  ).get(asOf, asOf).s;

  const dso = rev90 > 0 ? Math.round((openAR.total / (rev90 / 90)) * 10) / 10 : 0;
  const dpo = exp90 > 0 ? Math.round((openAP.total / (exp90 / 90)) * 10) / 10 : 0;

  return {
    asOf,
    receivableCents: openAR.total,
    receivableOverdueCents: openAR.overdue,
    payableCents: openAP.total,
    payableOverdueCents: openAP.overdue,
    openInvoiceCount: openAR.docs,
    openBillCount: openAP.docs,
    revenueYtdCents: revenueYtd,
    expenseYtdCents: expenseYtd,
    netYtdCents: revenueYtd - expenseYtd,
    cashIn30Cents: cashIn30,
    cashOut30Cents: cashOut30,
    dsoDays: dso,
    dpoDays: dpo,
    workingCapitalCents: openAR.total - openAP.total,
  };
}

export function reportsRouter(db) {
  const r = Router();

  const parseType = (value) => {
    if (value !== 'ar' && value !== 'ap') throw new Error('type must be ar or ap');
    return value;
  };

  r.get('/summary', (req, res) => {
    res.json(summary(db, req.query.asOf ?? today()));
  });

  r.get('/aging', (req, res) => {
    const type = req.query.type === 'ap' ? 'ap' : 'ar';
    res.json(agingRows(db, type, req.query.asOf ?? today()));
  });

  r.get('/profit-loss', (req, res) => {
    const to = req.query.to ?? today();
    const from = req.query.from ?? `${to.slice(0, 4)}-01-01`;
    res.json(profitLoss(db, from, to));
  });

  r.get('/cash-flow', (req, res) => {
    const to = req.query.to ?? today();
    const from = req.query.from ?? startOfMonth(monthKey(to));
    res.json(cashFlow(db, from, to));
  });

  r.get('/contact-balances', (req, res) => {
    const type = req.query.type === 'ap' ? 'ap' : 'ar';
    const rows = agingRows(db, type, req.query.asOf ?? today());
    res.json(rows);
  });

  r.get('/export', (req, res) => {
    const report = String(req.query.report ?? 'ar-aging');
    const asOf = req.query.asOf ?? today();
    let csv = '';
    let filename = 'report.csv';
    if (report === 'ar-aging' || report === 'ap-aging') {
      const type = report === 'ar-aging' ? 'ar' : 'ap';
      const data = agingRows(db, type, asOf);
      csv = toCsv(
        [
          { key: 'contactName', label: 'Contact' },
          { key: 'current', label: 'Current' },
          { key: 'd1_30', label: '1-30 days' },
          { key: 'd31_60', label: '31-60 days' },
          { key: 'd61_90', label: '61-90 days' },
          { key: 'd90plus', label: '90+ days' },
          { key: 'total', label: 'Total' },
        ],
        data.rows.map((row) => ({ ...row, current: row.current / 100, d1_30: row.d1_30 / 100, d31_60: row.d31_60 / 100, d61_90: row.d61_90 / 100, d90plus: row.d90plus / 100, total: row.total / 100 })),
      );
      filename = `${report}-${asOf}.csv`;
    } else if (report === 'profit-loss') {
      const to = req.query.to ?? today();
      const from = req.query.from ?? `${to.slice(0, 4)}-01-01`;
      const data = profitLoss(db, from, to);
      csv = toCsv(
        [
          { key: 'period', label: 'Period' },
          { key: 'revenue', label: 'Revenue' },
          { key: 'expenses', label: 'Expenses' },
          { key: 'net', label: 'Net' },
        ],
        data.series.map((s) => ({ period: s.period, revenue: (s.revenueCents / 100).toFixed(2), expenses: (s.expenseCents / 100).toFixed(2), net: (s.netCents / 100).toFixed(2) })),
      );
      filename = `profit-loss-${from}-to-${to}.csv`;
    } else if (report === 'cash-flow') {
      const to = req.query.to ?? today();
      const from = req.query.from ?? startOfMonth(monthKey(to));
      const data = cashFlow(db, from, to);
      csv = toCsv(
        [
          { key: 'period', label: 'Period' },
          { key: 'inflow', label: 'Cash in' },
          { key: 'outflow', label: 'Cash out' },
          { key: 'net', label: 'Net' },
        ],
        data.series.map((s) => ({ period: s.period, inflow: (s.inflowCents / 100).toFixed(2), outflow: (s.outflowCents / 100).toFixed(2), net: (s.netCents / 100).toFixed(2) })),
      );
      filename = `cash-flow-${from}-to-${to}.csv`;
    } else {
      throw new Error(`Unknown report: ${report}`);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  return r;
}

export { agingRows, cashFlow, profitLoss, summary };
