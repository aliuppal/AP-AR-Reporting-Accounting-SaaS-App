import { Router } from 'express';
import { addDays, today } from '../domain.js';
import { agingRows, cashFlow, profitLoss, summary } from './reports.js';

/** Compact projection used by dashboard cards and side lists. */
function briefDoc(row, table) {
  return {
    id: row.id,
    number: row.number,
    contactId: row.contact_id,
    contactName: row.contact_name,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    totalCents: row.total_cents,
    balanceCents: row.total_cents - row.paid_cents,
    daysOverdue: row.due_date < row.asOf ? Math.max(0, Math.round((new Date(row.asOf) - new Date(row.due_date)) / 86400000)) : 0,
    kind: table,
  };
}

export function dashboardRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const asOf = req.query.asOf ?? today();
    const from = `${asOf.slice(0, 4)}-01-01`;

    const recentInvoices = db.prepare(
      `SELECT d.*, c.name AS contact_name FROM invoices d JOIN contacts c ON c.id = d.contact_id
        ORDER BY d.issue_date DESC, d.id DESC LIMIT 6`
    ).all().map((row) => briefDoc({ ...row, asOf }, 'invoice'));

    const recentBills = db.prepare(
      `SELECT d.*, c.name AS contact_name FROM bills d JOIN contacts c ON c.id = d.contact_id
        ORDER BY d.issue_date DESC, d.id DESC LIMIT 6`
    ).all().map((row) => briefDoc({ ...row, asOf }, 'bill'));

    const topOverdue = [
      ...db.prepare(
        `SELECT d.*, c.name AS contact_name FROM invoices d JOIN contacts c ON c.id = d.contact_id
          WHERE d.status IN ('open','partial') AND d.due_date < ? AND d.total_cents > d.paid_cents
          ORDER BY (d.total_cents - d.paid_cents) DESC LIMIT 5`
      ).all(asOf).map((row) => briefDoc({ ...row, asOf }, 'invoice')),
      ...db.prepare(
        `SELECT d.*, c.name AS contact_name FROM bills d JOIN contacts c ON c.id = d.contact_id
          WHERE d.status IN ('open','partial') AND d.due_date < ? AND d.total_cents > d.paid_cents
          ORDER BY (d.total_cents - d.paid_cents) DESC LIMIT 5`
      ).all(asOf).map((row) => briefDoc({ ...row, asOf }, 'bill')),
    ].sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 6);

    const sixMonthsAgo = addDays(asOf, -183).slice(0, 7) + '-01';
    const trend = profitLoss(db, sixMonthsAgo, asOf);
    const cash = cashFlow(db, sixMonthsAgo, asOf);

    res.json({
      summary: summary(db, asOf),
      aging: {
        ar: agingRows(db, 'ar', asOf).totals,
        ap: agingRows(db, 'ap', asOf).totals,
      },
      trend,
      cash,
      recentInvoices,
      recentBills,
      topOverdue,
      revenueFrom: from,
    });
  });

  return r;
}
