import { Router } from 'express';
import { z } from 'zod';
import { notFound, pagination, parse } from '../http.js';

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
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openReceivableCents: stats?.receivable ?? 0,
    openPayableCents: stats?.payable ?? 0,
    overdueCents: stats?.overdue ?? 0,
  };
}

export function contactsRouter(db) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const clauses = [];
    const params = [];
    if (req.query.type && req.query.type !== 'all') {
      params.push(String(req.query.type));
      clauses.push(`(type = $${params.length} OR type = 'both')`);
    }
    if (req.query.archived !== 'true') clauses.push('archived = false');
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const i = params.length;
      clauses.push(`(name ILIKE $${i} OR company ILIKE $${i} OR email ILIKE $${i})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // One query with pre-aggregated balances: a per-contact loop would be 2N round trips,
    // which is painful against a managed Postgres.
    const rows = await db.many(
      `SELECT c.*,
              COALESCE(rec.open_cents, 0)::int AS rec_open,
              COALESCE(rec.overdue_cents, 0)::int AS rec_overdue,
              COALESCE(pay.open_cents, 0)::int AS pay_open,
              COALESCE(pay.overdue_cents, 0)::int AS pay_overdue
         FROM contacts c
         LEFT JOIN (
              SELECT contact_id,
                     SUM(total_cents - paid_cents) AS open_cents,
                     SUM(CASE WHEN due_date < CURRENT_DATE THEN total_cents - paid_cents ELSE 0 END) AS overdue_cents
                FROM invoices WHERE status IN ('open','partial') GROUP BY contact_id
         ) rec ON rec.contact_id = c.id
         LEFT JOIN (
              SELECT contact_id,
                     SUM(total_cents - paid_cents) AS open_cents,
                     SUM(CASE WHEN due_date < CURRENT_DATE THEN total_cents - paid_cents ELSE 0 END) AS overdue_cents
                FROM bills WHERE status IN ('open','partial') GROUP BY contact_id
         ) pay ON pay.contact_id = c.id
         ${where}
        ORDER BY lower(c.name)
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const total = (await db.one(`SELECT COUNT(*)::int AS c FROM contacts ${where}`, params)).c;

    const items = rows.map((row) => serialize(row, {
      receivable: row.rec_open,
      payable: row.pay_open,
      overdue: row.rec_overdue + row.pay_overdue,
    }));

    res.json({ items, total, limit, offset });
  });

  router.get('/:id', async (req, res) => {
    const row = await db.one('SELECT * FROM contacts WHERE id = $1', [Number(req.params.id)]);
    if (!row) throw notFound('Contact not found');

    const invoices = await db.many('SELECT * FROM invoices WHERE contact_id = $1 ORDER BY issue_date DESC LIMIT 20', [row.id]);
    const bills = await db.many('SELECT * FROM bills WHERE contact_id = $1 ORDER BY issue_date DESC LIMIT 20', [row.id]);
    const rec = await db.one(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0)::int AS open FROM invoices
        WHERE contact_id = $1 AND status IN ('open','partial')`, [row.id],
    );
    const pay = await db.one(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0)::int AS open FROM bills
        WHERE contact_id = $1 AND status IN ('open','partial')`, [row.id],
    );

    const brief = (d) => ({
      id: d.id, number: d.number, issueDate: d.issue_date, dueDate: d.due_date,
      status: d.status, totalCents: d.total_cents, balanceCents: d.total_cents - d.paid_cents,
    });

    res.json({
      ...serialize(row, { receivable: rec.open, payable: pay.open }),
      invoices: invoices.map(brief),
      bills: bills.map(brief),
    });
  });

  router.post('/', async (req, res) => {
    const body = parse(contactSchema, req.body);
    const row = await db.one(
      `INSERT INTO contacts (type, name, company, email, phone, address, city, country, tax_id, terms_days, notes, archived)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [body.type, body.name, body.company, body.email, body.phone, body.address, body.city, body.country, body.taxId, body.termsDays, body.notes, body.archived],
    );
    res.status(201).json(serialize(row));
  });

  router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.one('SELECT * FROM contacts WHERE id = $1', [id]);
    if (!existing) throw notFound('Contact not found');
    const body = parse(contactSchema, req.body);
    const row = await db.one(
      `UPDATE contacts SET type = $1, name = $2, company = $3, email = $4, phone = $5, address = $6,
              city = $7, country = $8, tax_id = $9, terms_days = $10, notes = $11, archived = $12,
              updated_at = now()
        WHERE id = $13 RETURNING *`,
      [body.type, body.name, body.company, body.email, body.phone, body.address, body.city, body.country, body.taxId, body.termsDays, body.notes, body.archived, id],
    );
    res.json(serialize(row));
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = await db.one('SELECT * FROM contacts WHERE id = $1', [id]);
    if (!row) throw notFound('Contact not found');

    const docs = await db.one(
      `SELECT ((SELECT COUNT(*) FROM invoices WHERE contact_id = $1) + (SELECT COUNT(*) FROM bills WHERE contact_id = $1))::int AS c`,
      [id],
    );
    if (docs.c > 0) {
      await db.query('UPDATE contacts SET archived = true, updated_at = now() WHERE id = $1', [id]);
      return res.json({ archived: true, message: 'Contact has documents and was archived instead of deleted' });
    }
    await db.query('DELETE FROM contacts WHERE id = $1', [id]);
    res.status(204).end();
  });

  return router;
}

export { contactSchema };
