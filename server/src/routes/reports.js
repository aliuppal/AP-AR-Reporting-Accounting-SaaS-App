import { Router } from 'express';
import { AGING_BUCKETS, agingBucket, diffDays, endOfMonth, monthKey, monthsBetween, resolveCurrency, startOfMonth, toCsv, today } from '../domain.js';

const round = (n) => Math.round(n);

export async function agingRows(db, type, asOf, currency) {
  const table = type === 'ar' ? 'invoices' : 'bills';
  const docs = await db.many(
    `SELECT d.*, c.name AS contact_name, c.company AS contact_company
       FROM ${table} d JOIN contacts c ON c.id = d.contact_id
      WHERE d.status IN ('open','partial') AND d.issue_date <= $1 AND d.total_cents > d.paid_cents
        AND d.currency = $2
      ORDER BY d.due_date`,
    [asOf, currency],
  );

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
    currency,
    buckets: AGING_BUCKETS,
    rows,
    totals,
    overdueCents: overdue,
    currentCents: totals.current,
    documentCount: docs.length,
  };
}

export async function cashFlow(db, from, to, currency) {
  const months = monthsBetween(from, to);
  const rows = await db.many(
    `SELECT direction, to_char(date, 'YYYY-MM') AS period, SUM(amount_cents)::int AS total
       FROM payments
      WHERE date >= $1 AND date <= $2 AND currency = $3
      GROUP BY direction, period`,
    [startOfMonth(from), endOfMonth(to), currency],
  );
  const byKey = new Map(rows.map((r) => [`${r.direction}:${r.period}`, r.total]));
  let running = 0;
  const series = months.map((period) => {
    const inflow = byKey.get(`in:${period}`) ?? 0;
    const outflow = byKey.get(`out:${period}`) ?? 0;
    const net = inflow - outflow;
    running += net;
    return { period, inflowCents: inflow, outflowCents: outflow, netCents: net, cumulativeCents: running };
  });

  return {
    from,
    to,
    currency,
    series,
    totals: {
      inflowCents: series.reduce((s, r) => s + r.inflowCents, 0),
      outflowCents: series.reduce((s, r) => s + r.outflowCents, 0),
      netCents: series.reduce((s, r) => s + r.netCents, 0),
    },
  };
}

export async function profitLoss(db, from, to, currency) {
  const months = monthsBetween(from, to);

  const [revenueLines, expenseLines, discounts] = await Promise.all([
    db.many(
      `SELECT to_char(d.issue_date, 'YYYY-MM') AS period, l.category, SUM(l.amount_cents)::int AS amount
         FROM invoice_lines l JOIN invoices d ON d.id = l.invoice_id
        WHERE d.status NOT IN ('draft','void') AND d.issue_date >= $1 AND d.issue_date <= $2 AND d.currency = $3
        GROUP BY period, l.category`,
      [from, to, currency],
    ),
    db.many(
      `SELECT to_char(d.issue_date, 'YYYY-MM') AS period, l.category, SUM(l.amount_cents)::int AS amount
         FROM bill_lines l JOIN bills d ON d.id = l.bill_id
        WHERE d.status NOT IN ('draft','void') AND d.issue_date >= $1 AND d.issue_date <= $2 AND d.currency = $3
        GROUP BY period, l.category`,
      [from, to, currency],
    ),
    db.many(
      `SELECT to_char(issue_date, 'YYYY-MM') AS period, SUM(discount_cents)::int AS amount
         FROM invoices
        WHERE status NOT IN ('draft','void') AND issue_date >= $1 AND issue_date <= $2 AND currency = $3
        GROUP BY period`,
      [from, to, currency],
    ),
  ]);

  const discountByPeriod = new Map(discounts.map((d) => [d.period, d.amount]));

  const categoryTotals = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = row.category || 'Uncategorised';
      map.set(key, (map.get(key) ?? 0) + row.amount);
    }
    return [...map.entries()]
      .map(([category, amountCents]) => ({ category, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);
  };

  const series = months.map((period) => {
    const revenue = revenueLines
      .filter((row) => row.period === period)
      .reduce((sum, row) => sum + row.amount, 0) - (discountByPeriod.get(period) ?? 0);
    const expenses = expenseLines
      .filter((row) => row.period === period)
      .reduce((sum, row) => sum + row.amount, 0);
    return { period, revenueCents: revenue, expenseCents: expenses, netCents: revenue - expenses };
  });

  const totalRevenue = series.reduce((s, r) => s + r.revenueCents, 0);
  const totalExpenses = series.reduce((s, r) => s + r.expenseCents, 0);

  return {
    from,
    to,
    currency,
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

export async function summary(db, asOf = today(), currency) {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;

  const [openAR, openAP, revenueYtd, expenseYtd, cashIn30, cashOut30, rev90, exp90] = await Promise.all([
    db.one(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0)::int AS total,
              COALESCE(SUM(CASE WHEN due_date < $1 THEN total_cents - paid_cents ELSE 0 END), 0)::int AS overdue,
              COUNT(*)::int AS docs
         FROM invoices WHERE status IN ('open','partial') AND currency = $2`, [asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0)::int AS total,
              COALESCE(SUM(CASE WHEN due_date < $1 THEN total_cents - paid_cents ELSE 0 END), 0)::int AS overdue,
              COUNT(*)::int AS docs
         FROM bills WHERE status IN ('open','partial') AND currency = $2`, [asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(l.amount_cents), 0)::int AS s FROM invoice_lines l
         JOIN invoices d ON d.id = l.invoice_id
        WHERE d.status NOT IN ('draft','void') AND d.issue_date BETWEEN $1 AND $2 AND d.currency = $3`, [yearStart, asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(l.amount_cents), 0)::int AS s FROM bill_lines l
         JOIN bills d ON d.id = l.bill_id
        WHERE d.status NOT IN ('draft','void') AND d.issue_date BETWEEN $1 AND $2 AND d.currency = $3`, [yearStart, asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS s FROM payments
        WHERE direction = 'in' AND date > ($1::date - INTERVAL '30 days') AND currency = $2`, [asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS s FROM payments
        WHERE direction = 'out' AND date > ($1::date - INTERVAL '30 days') AND currency = $2`, [asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(l.amount_cents), 0)::int AS s FROM invoice_lines l
         JOIN invoices d ON d.id = l.invoice_id
        WHERE d.status NOT IN ('draft','void')
          AND d.issue_date > ($1::date - INTERVAL '90 days') AND d.issue_date <= $1::date AND d.currency = $2`, [asOf, currency]),
    db.one(
      `SELECT COALESCE(SUM(l.amount_cents), 0)::int AS s FROM bill_lines l
         JOIN bills d ON d.id = l.bill_id
        WHERE d.status NOT IN ('draft','void')
          AND d.issue_date > ($1::date - INTERVAL '90 days') AND d.issue_date <= $1::date AND d.currency = $2`, [asOf, currency]),
  ]);

  const dso = rev90.s > 0 ? Math.round((openAR.total / (rev90.s / 90)) * 10) / 10 : 0;
  const dpo = exp90.s > 0 ? Math.round((openAP.total / (exp90.s / 90)) * 10) / 10 : 0;

  return {
    asOf,
    currency,
    receivableCents: openAR.total,
    receivableOverdueCents: openAR.overdue,
    payableCents: openAP.total,
    payableOverdueCents: openAP.overdue,
    openInvoiceCount: openAR.docs,
    openBillCount: openAP.docs,
    revenueYtdCents: revenueYtd.s,
    expenseYtdCents: expenseYtd.s,
    netYtdCents: revenueYtd.s - expenseYtd.s,
    cashIn30Cents: cashIn30.s,
    cashOut30Cents: cashOut30.s,
    dsoDays: dso,
    dpoDays: dpo,
    workingCapitalCents: openAR.total - openAP.total,
  };
}

export function reportsRouter(db) {
  const router = Router();

  router.get('/summary', async (req, res) => {
    res.json(await summary(db, req.query.asOf ?? today(), await resolveCurrency(db, req.query.currency)));
  });

  router.get('/aging', async (req, res) => {
    const type = req.query.type === 'ap' ? 'ap' : 'ar';
    res.json(await agingRows(db, type, req.query.asOf ?? today(), await resolveCurrency(db, req.query.currency)));
  });

  router.get('/profit-loss', async (req, res) => {
    const to = req.query.to ?? today();
    const from = req.query.from ?? `${to.slice(0, 4)}-01-01`;
    res.json(await profitLoss(db, from, to, await resolveCurrency(db, req.query.currency)));
  });

  router.get('/cash-flow', async (req, res) => {
    const to = req.query.to ?? today();
    const from = req.query.from ?? startOfMonth(monthKey(to));
    res.json(await cashFlow(db, from, to, await resolveCurrency(db, req.query.currency)));
  });

  router.get('/contact-balances', async (req, res) => {
    const type = req.query.type === 'ap' ? 'ap' : 'ar';
    res.json(await agingRows(db, type, req.query.asOf ?? today(), await resolveCurrency(db, req.query.currency)));
  });

  router.get('/export', async (req, res) => {
    const report = String(req.query.report ?? 'ar-aging');
    const asOf = req.query.asOf ?? today();
    const currency = await resolveCurrency(db, req.query.currency);
    let csv = '';
    let filename = 'report.csv';

    if (report === 'ar-aging' || report === 'ap-aging') {
      const type = report === 'ar-aging' ? 'ar' : 'ap';
      const data = await agingRows(db, type, asOf, currency);
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
        data.rows.map((row) => ({
          ...row,
          current: row.current / 100,
          d1_30: row.d1_30 / 100,
          d31_60: row.d31_60 / 100,
          d61_90: row.d61_90 / 100,
          d90plus: row.d90plus / 100,
          total: row.total / 100,
        })),
      );
      filename = `${report}-${currency}-${asOf}.csv`;
    } else if (report === 'profit-loss') {
      const to = req.query.to ?? today();
      const from = req.query.from ?? `${to.slice(0, 4)}-01-01`;
      const data = await profitLoss(db, from, to, currency);
      csv = toCsv(
        [
          { key: 'period', label: 'Period' },
          { key: 'revenue', label: 'Revenue' },
          { key: 'expenses', label: 'Expenses' },
          { key: 'net', label: 'Net' },
        ],
        data.series.map((s) => ({
          period: s.period,
          revenue: (s.revenueCents / 100).toFixed(2),
          expenses: (s.expenseCents / 100).toFixed(2),
          net: (s.netCents / 100).toFixed(2),
        })),
      );
      filename = `profit-loss-${currency}-${from}-to-${to}.csv`;
    } else if (report === 'cash-flow') {
      const to = req.query.to ?? today();
      const from = req.query.from ?? startOfMonth(monthKey(to));
      const data = await cashFlow(db, from, to, currency);
      csv = toCsv(
        [
          { key: 'period', label: 'Period' },
          { key: 'inflow', label: 'Cash in' },
          { key: 'outflow', label: 'Cash out' },
          { key: 'net', label: 'Net' },
        ],
        data.series.map((s) => ({
          period: s.period,
          inflow: (s.inflowCents / 100).toFixed(2),
          outflow: (s.outflowCents / 100).toFixed(2),
          net: (s.netCents / 100).toFixed(2),
        })),
      );
      filename = `cash-flow-${currency}-${from}-to-${to}.csv`;
    } else {
      throw new Error(`Unknown report: ${report}`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  return router;
}
