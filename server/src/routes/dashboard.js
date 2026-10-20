import { Router } from 'express';
import { addDays, today } from '../domain.js';
import { agingRows, cashFlow, profitLoss, summary } from './reports.js';

/** Compact projection used by dashboard cards and side lists. */
function briefDoc(row, table, asOf) {
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
    daysOverdue: row.due_date < asOf
      ? Math.max(0, Math.round((new Date(asOf) - new Date(row.due_date)) / 86400000))
      : 0,
    kind: table,
  };
}

export function dashboardRouter(db) {
  const router = Router();

  router.get('/', async (req, res) => {
    const asOf = req.query.asOf ?? today();

    const [recentInvoices, recentBills, overdueInvoices, overdueBills, currentSummary, ar, ap, trend, cash] = await Promise.all([
      db.many(
        `SELECT d.*, c.name AS contact_name FROM invoices d JOIN contacts c ON c.id = d.contact_id
          ORDER BY d.issue_date DESC, d.id DESC LIMIT 6`),
      db.many(
        `SELECT d.*, c.name AS contact_name FROM bills d JOIN contacts c ON c.id = d.contact_id
          ORDER BY d.issue_date DESC, d.id DESC LIMIT 6`),
      db.many(
        `SELECT d.*, c.name AS contact_name FROM invoices d JOIN contacts c ON c.id = d.contact_id
          WHERE d.status IN ('open','partial') AND d.due_date < $1 AND d.total_cents > d.paid_cents
          ORDER BY (d.total_cents - d.paid_cents) DESC LIMIT 5`, [asOf]),
      db.many(
        `SELECT d.*, c.name AS contact_name FROM bills d JOIN contacts c ON c.id = d.contact_id
          WHERE d.status IN ('open','partial') AND d.due_date < $1 AND d.total_cents > d.paid_cents
          ORDER BY (d.total_cents - d.paid_cents) DESC LIMIT 5`, [asOf]),
      summary(db, asOf),
      agingRows(db, 'ar', asOf),
      agingRows(db, 'ap', asOf),
      profitLoss(db, `${addDays(asOf, -183).slice(0, 7)}-01`, asOf),
      cashFlow(db, `${addDays(asOf, -183).slice(0, 7)}-01`, asOf),
    ]);

    const topOverdue = [
      ...overdueInvoices.map((row) => briefDoc(row, 'invoice', asOf)),
      ...overdueBills.map((row) => briefDoc(row, 'bill', asOf)),
    ].sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 6);

    res.json({
      summary: currentSummary,
      aging: { ar: ar.totals, ap: ap.totals },
      trend,
      cash,
      recentInvoices: recentInvoices.map((row) => briefDoc(row, 'invoice', asOf)),
      recentBills: recentBills.map((row) => briefDoc(row, 'bill', asOf)),
      topOverdue,
    });
  });

  return router;
}
