import { Router } from 'express';
import { z } from 'zod';
import { nextNumber, tx } from '../db.js';
import { ApiError, conflict, notFound, pagination, parse } from '../http.js';

const contactSchema = z.object({
  type: z.enum(['customer', 'vendor', 'both']),
  name: z.string().trim().min(1).max(160),
  company: z.string().trim().max(160).optional().default(''),
  email: z.string().trim().max(200).optional().default(''),
  phone: z.string().trim().max(60).optional().default(''),
  address: z.string().trim().max(400).optional().default(''),
  city: z.string().trim().max(120).optional().default(''),
  country: z.string().trim().max(120).optional().default(''),
  taxId: z.string().trim().max(60).optional().default(''),
  termsDays: z.coerce.number().int().min(0).max(365).optional().default(30),
  notes: z.string().trim().max(2000).optional().default(''),
  archived: z.boolean().optional().default(false),
});

function serialize(row, stats) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    country: row.country,
    taxId: row.tax_id,
    termsDays: row.terms_days,
    notes: row.notes,
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openReceivableCents: stats?.receivable ?? 0,
    openPayableCents: stats?.payable ?? 0,
    overdueCents: stats?.overdue ?? 0,
  };
}

export function contactsRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const { limit, offset } = pagination(req.query);
    const clauses = [];
    const params = [];
    if (req.query.type && req.query.type !== 'all') {
      clauses.push('(type = ? OR type = \'both\')');
      params.push(req.query.type);
    }
    if (req.query.archived !== 'true') clauses.push('archived = 0');
    if (req.query.q) {
      clauses.push('(name LIKE ? OR company LIKE ? OR email LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM contacts ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM contacts ${where}`).get(...params).c;

    const stats = new Map();
    for (const row of rows) {
      const rec = db.prepare(
        `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS open,
                COALESCE(SUM(CASE WHEN due_date < date('now') THEN total_cents - paid_cents ELSE 0 END), 0) AS overdue
           FROM invoices WHERE contact_id = ? AND status IN ('open','partial')`
      ).get(row.id);
      const pay = db.prepare(
        `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS open,
                COALESCE(SUM(CASE WHEN due_date < date('now') THEN total_cents - paid_cents ELSE 0 END), 0) AS overdue
           FROM bills WHERE contact_id = ? AND status IN ('open','partial')`
      ).get(row.id);
      stats.set(row.id, { receivable: rec.open, payable: pay.open, overdue: rec.overdue + pay.overdue });
    }
    res.json({ items: rows.map((row) => serialize(row, stats.get(row.id))), total, limit, offset });
  });

  r.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(req.params.id));
    if (!row) throw notFound('Contact not found');
    const invoices = db.prepare('SELECT * FROM invoices WHERE contact_id = ? ORDER BY issue_date DESC LIMIT 20').all(row.id);
    const bills = db.prepare('SELECT * FROM bills WHERE contact_id = ? ORDER BY issue_date DESC LIMIT 20').all(row.id);
    const rec = db.prepare(
      `SELECT COALESCE(SUM(total_cents - paid_cents),0) AS open FROM invoices WHERE contact_id = ? AND status IN ('open','partial')`
    ).get(row.id);
    const pay = db.prepare(
      `SELECT COALESCE(SUM(total_cents - paid_cents),0) AS open FROM bills WHERE contact_id = ? AND status IN ('open','partial')`
    ).get(row.id);
    res.json({
      ...serialize(row, { receivable: rec.open, payable: pay.open }),
      invoices: invoices.map((d) => ({ id: d.id, number: d.number, issueDate: d.issue_date, dueDate: d.due_date, status: d.status, totalCents: d.total_cents, balanceCents: d.total_cents - d.paid_cents })),
      bills: bills.map((d) => ({ id: d.id, number: d.number, issueDate: d.issue_date, dueDate: d.due_date, status: d.status, totalCents: d.total_cents, balanceCents: d.total_cents - d.paid_cents })),
    });
  });

  r.post('/', (req, res) => {
    const body = parse(contactSchema, req.body);
    const result = db.prepare(
      `INSERT INTO contacts (type, name, company, email, phone, address, city, country, tax_id, terms_days, notes, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(body.type, body.name, body.company, body.email, body.phone, body.address, body.city, body.country, body.taxId, body.termsDays, body.notes, body.archived ? 1 : 0);
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(result.lastInsertRowid));
    res.status(201).json(serialize(row));
  });

  r.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!existing) throw notFound('Contact not found');
    const body = parse(contactSchema, req.body);
    db.prepare(
      `UPDATE contacts SET type = ?, name = ?, company = ?, email = ?, phone = ?, address = ?, city = ?, country = ?,
       tax_id = ?, terms_days = ?, notes = ?, archived = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(body.type, body.name, body.company, body.email, body.phone, body.address, body.city, body.country, body.taxId, body.termsDays, body.notes, body.archived ? 1 : 0, id);
    res.json(serialize(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)));
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!row) throw notFound('Contact not found');
    const docs = db.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE contact_id = ?) + (SELECT COUNT(*) FROM bills WHERE contact_id = ?) AS c').get(id, id).c;
    if (docs > 0) {
      db.prepare(`UPDATE contacts SET archived = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
      return res.json({ archived: true, message: 'Contact has documents and was archived instead of deleted' });
    }
    tx(db, () => db.prepare('DELETE FROM contacts WHERE id = ?').run(id));
    res.status(204).end();
  });

  return r;
}

export { contactSchema };
