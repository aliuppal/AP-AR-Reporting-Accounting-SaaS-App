import { Router } from 'express';
import { z } from 'zod';
import { addDays, diffDays, isOverdue, today } from '../domain.js';
import { badRequest, conflict, notFound, pagination, parse } from '../http.js';

const lineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  category: z.string().trim().max(80).optional().default(''),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unitPriceCents: z.coerce.number().int().min(0).max(1_000_000_000),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
});

const docSchema = z.object({
  contactId: z.coerce.number().int().positive(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'open']).optional().default('open'),
  notes: z.string().max(4000).optional().default(''),
  reference: z.string().max(120).optional().default(''),
  discountCents: z.coerce.number().int().min(0).max(1_000_000_000).optional().default(0),
  lines: z.array(lineSchema).min(1, 'At least one line item is required'),
});

/**
 * Invoice (AR) and bill (AP) share identical mechanics; only the tables,
 * numbering prefix and accepted contact type differ.
 */
export function documentRouter(db, opts) {
  const {
    table, lineTable, fk, kind, contactType, prefixKey, stampColumn,
  } = opts;

  const router = Router();

  const serialize = (row, lines, contact, payments = []) => {
    const doc = {
      id: row.id,
      number: row.number,
      contactId: row.contact_id,
      contact: contact ?? null,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      status: row.status,
      currency: row.currency,
      notes: row.notes,
      reference: row.reference,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      discountCents: row.discount_cents,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      balanceCents: row.total_cents - row.paid_cents,
      daysOverdue: Math.max(0, diffDays(today(), row.due_date)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        category: l.category,
        quantity: l.quantity,
        unitPriceCents: l.unit_price_cents,
        taxRate: l.tax_rate,
        amountCents: l.amount_cents,
      })),
      payments,
    };
    doc.isOverdue = isOverdue(doc);
    return doc;
  };

  /** Batch-load lines and contacts for a page of documents (avoids N+1 round trips). */
  const attachAll = async (rows) => {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const contactIds = [...new Set(rows.map((r) => r.contact_id))];
    const [lines, contacts] = await Promise.all([
      db.many(`SELECT * FROM ${lineTable} WHERE ${fk} = ANY($1::int[]) ORDER BY position, id`, [ids]),
      db.many('SELECT id, name, company, email FROM contacts WHERE id = ANY($1::int[])', [contactIds]),
    ]);
    const lineMap = new Map();
    for (const line of lines) {
      const list = lineMap.get(line[fk]) ?? [];
      list.push(line);
      lineMap.set(line[fk], list);
    }
    const contactMap = new Map(contacts.map((c) => [c.id, c]));
    return rows.map((row) => serialize(row, lineMap.get(row.id) ?? [], contactMap.get(row.contact_id) ?? null));
  };

  const loadDetail = async (id) => {
    const row = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!row) return null;
    const [lines, contact, payments] = await Promise.all([
      db.many(`SELECT * FROM ${lineTable} WHERE ${fk} = $1 ORDER BY position, id`, [id]),
      db.one('SELECT id, name, company, email FROM contacts WHERE id = $1', [row.contact_id]),
      db.many(
        `SELECT a.*, p.number AS payment_number, p.date AS payment_date, p.method
           FROM allocations a JOIN payments p ON p.id = a.payment_id
          WHERE a.${fk} = $1 ORDER BY p.date`,
        [id],
      ),
    ]);
    return serialize(
      row,
      lines,
      contact,
      payments.map((a) => ({
        paymentId: a.payment_id,
        number: a.payment_number,
        date: a.payment_date,
        method: a.method,
        amountCents: a.amount_cents,
      })),
    );
  };

  const writeLines = async (client, id, lines) => {
    await client.query(`DELETE FROM ${lineTable} WHERE ${fk} = $1`, [id]);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const amount = Math.round(line.quantity * line.unitPriceCents);
      await client.query(
        `INSERT INTO ${lineTable} (${fk}, description, category, quantity, unit_price_cents, tax_rate, amount_cents, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, line.description, line.category || '', line.quantity, line.unitPriceCents, line.taxRate || 0, amount, i],
      );
    }
  };

  router.get('/', async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const clauses = [];
    const params = [];
    const status = String(req.query.status || 'all');
    if (status === 'overdue') {
      clauses.push(`status IN ('open','partial') AND due_date < CURRENT_DATE`);
    } else if (status !== 'all') {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (req.query.contactId) {
      params.push(Number(req.query.contactId));
      clauses.push(`contact_id = $${params.length}`);
    }
    if (req.query.from) {
      params.push(String(req.query.from));
      clauses.push(`issue_date >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(String(req.query.to));
      clauses.push(`issue_date <= $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const i = params.length;
      clauses.push(`(number ILIKE $${i} OR reference ILIKE $${i} OR contact_id IN (SELECT id FROM contacts WHERE name ILIKE $${i}))`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = (await db.one(`SELECT COUNT(*)::int AS c FROM ${table} ${where}`, params)).c;
    const rows = await db.many(
      `SELECT * FROM ${table} ${where} ORDER BY issue_date DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const aggregate = await db.one(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0)::int AS open,
              COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN total_cents - paid_cents ELSE 0 END), 0)::int AS overdue
         FROM ${table} WHERE status IN ('open','partial')`,
    );

    res.json({
      items: await attachAll(rows),
      total,
      limit,
      offset,
      openBalanceCents: aggregate.open,
      overdueBalanceCents: aggregate.overdue,
    });
  });

  router.get('/:id', async (req, res) => {
    const doc = await loadDetail(Number(req.params.id));
    if (!doc) throw notFound('Document not found');
    res.json(doc);
  });

  router.post('/', async (req, res) => {
    const body = parse(docSchema, req.body);
    const contact = await db.one('SELECT * FROM contacts WHERE id = $1', [body.contactId]);
    if (!contact) throw badRequest('Contact not found');
    if (contact.type !== contactType && contact.type !== 'both') throw badRequest(`Contact is not a ${contactType}`);

    const dueDate = body.dueDate ?? addDays(body.issueDate, contact.terms_days);
    if (dueDate < body.issueDate) throw badRequest('Due date must be on or after the issue date');

    const id = await db.tx(async (client) => {
      const settings = (await client.query('SELECT * FROM settings WHERE id = 1')).rows[0];
      const number = await db.nextNumber(client, kind, body.issueDate, settings[prefixKey]);
      const inserted = await client.query(
        `INSERT INTO ${table} (number, contact_id, issue_date, due_date, status, currency, discount_cents, notes, reference, ${stampColumn})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          number, body.contactId, body.issueDate, dueDate, body.status, settings.currency,
          body.discountCents, body.notes, body.reference, body.status === 'open' ? new Date().toISOString() : null,
        ],
      );
      const newId = inserted.rows[0].id;
      await writeLines(client, newId, body.lines);
      await db.recomputeDocumentTotals(client, table, newId);
      return newId;
    });

    res.status(201).json(await loadDetail(id));
  });

  router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!existing) throw notFound('Document not found');
    if (existing.status === 'void') throw conflict('Voided documents cannot be edited');

    const body = parse(docSchema, req.body);
    const dueDate = body.dueDate ?? addDays(body.issueDate, 30);
    if (dueDate < body.issueDate) throw badRequest('Due date must be on or after the issue date');

    await db.tx(async (client) => {
      const keepStatus = ['paid', 'partial'].includes(existing.status) ? existing.status : body.status;
      await client.query(
        `UPDATE ${table} SET contact_id = $1, issue_date = $2, due_date = $3, status = $4,
                discount_cents = $5, notes = $6, reference = $7, updated_at = now()
          WHERE id = $8`,
        [body.contactId, body.issueDate, dueDate, keepStatus, body.discountCents, body.notes, body.reference, id],
      );
      await writeLines(client, id, body.lines);
      const totals = await db.recomputeDocumentTotals(client, table, id);
      if (totals.paid > totals.total) throw badRequest('Total is lower than payments already applied to this document');
    });

    res.json(await loadDetail(id));
  });

  router.post('/:id/send', async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!existing) throw notFound('Document not found');
    if (existing.status !== 'draft') throw conflict('Only drafts can be sent');
    await db.query(
      `UPDATE ${table} SET status = 'open', ${stampColumn} = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    res.json(await loadDetail(id));
  });

  router.post('/:id/void', async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!existing) throw notFound('Document not found');
    if (existing.paid_cents > 0) throw conflict('Remove applied payments before voiding this document');
    await db.query(`UPDATE ${table} SET status = 'void', updated_at = now() WHERE id = $1`, [id]);
    res.json(await loadDetail(id));
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!existing) throw notFound('Document not found');
    if (existing.paid_cents > 0) throw conflict('Documents with payments cannot be deleted');
    if (!['draft', 'void'].includes(existing.status)) throw conflict('Only drafts or voided documents can be deleted');
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    res.status(204).end();
  });

  return router;
}
