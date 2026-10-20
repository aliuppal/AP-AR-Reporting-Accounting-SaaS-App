import { Router } from 'express';
import { z } from 'zod';
import { nextNumber, recomputeDocumentTotals, tx } from '../db.js';
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
    table, lineTable, fk, kind, contactType, prefixKey, sendStatus = 'open',
  } = opts;
  const r = Router();

  const serialize = (row) => {
    const lines = db.prepare(`SELECT * FROM ${lineTable} WHERE ${fk} = ? ORDER BY position, id`).all(row.id);
    const contact = db.prepare('SELECT id, name, company, email FROM contacts WHERE id = ?').get(row.contact_id);
    const allocations = db.prepare(
      `SELECT a.*, p.number AS payment_number, p.date AS payment_date, p.method
         FROM allocations a JOIN payments p ON p.id = a.payment_id
        WHERE a.${fk} = ? ORDER BY p.date`
    ).all(row.id);
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
      payments: allocations.map((a) => ({
        paymentId: a.payment_id,
        number: a.payment_number,
        date: a.payment_date,
        method: a.method,
        amountCents: a.amount_cents,
      })),
    };
    doc.isOverdue = isOverdue(doc);
    return doc;
  };

  const find = (id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

  const writeLines = (id, lines) => {
    db.prepare(`DELETE FROM ${lineTable} WHERE ${fk} = ?`).run(id);
    const insert = db.prepare(
      `INSERT INTO ${lineTable} (${fk}, description, category, quantity, unit_price_cents, tax_rate, amount_cents, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    lines.forEach((l, i) => {
      const amount = Math.round(l.quantity * l.unitPriceCents);
      insert.run(id, l.description, l.category || '', l.quantity, l.unitPriceCents, l.taxRate || 0, amount, i);
    });
  };

  r.get('/', (req, res) => {
    const { limit, offset } = pagination(req.query);
    const clauses = [];
    const params = [];
    const status = String(req.query.status || 'all');
    if (status === 'overdue') {
      clauses.push(`status IN ('open','partial') AND due_date < date('now')`);
    } else if (status !== 'all') {
      clauses.push('status = ?');
      params.push(status);
    }
    if (req.query.contactId) {
      clauses.push('contact_id = ?');
      params.push(Number(req.query.contactId));
    }
    if (req.query.from) {
      clauses.push('issue_date >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push('issue_date <= ?');
      params.push(req.query.to);
    }
    if (req.query.q) {
      const like = `%${String(req.query.q).trim()}%`;
      clauses.push(`(number LIKE ? OR reference LIKE ? OR contact_id IN (SELECT id FROM contacts WHERE name LIKE ?))`);
      params.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params).c;
    const rows = db.prepare(
      `SELECT * FROM ${table} ${where} ORDER BY issue_date DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const aggregate = db.prepare(
      `SELECT COALESCE(SUM(total_cents - paid_cents),0) AS open,
              COALESCE(SUM(CASE WHEN due_date < date('now') THEN total_cents - paid_cents ELSE 0 END),0) AS overdue
         FROM ${table} WHERE status IN ('open','partial')`
    ).get();
    res.json({
      items: rows.map(serialize),
      total,
      limit,
      offset,
      openBalanceCents: aggregate.open,
      overdueBalanceCents: aggregate.overdue,
    });
  });

  r.get('/:id', (req, res) => {
    const row = find(Number(req.params.id));
    if (!row) throw notFound('Document not found');
    res.json(serialize(row));
  });

  r.post('/', (req, res) => {
    const body = parse(docSchema, req.body);
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(body.contactId);
    if (!contact) throw badRequest('Contact not found');
    if (contact.type !== contactType && contact.type !== 'both') {
      throw badRequest(`Contact is not a ${contactType}`);
    }
    const dueDate = body.dueDate ?? addDays(body.issueDate, contact.terms_days);
    if (dueDate < body.issueDate) throw badRequest('Due date must be on or after the issue date');

    const doc = tx(db, () => {
      const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      const number = nextNumber(db, kind, body.issueDate, settings[prefixKey]);
      const inserted = db.prepare(
        `INSERT INTO ${table} (number, contact_id, issue_date, due_date, status, currency, discount_cents, notes, reference, ${kind === 'invoice' ? 'sent_at' : 'approved_at'})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        number, body.contactId, body.issueDate, dueDate, body.status, settings.currency,
        body.discountCents, body.notes, body.reference, body.status === sendStatus ? new Date().toISOString() : null,
      );
      const id = Number(inserted.lastInsertRowid);
      writeLines(id, body.lines);
      recomputeDocumentTotals(db, table, id);
      return id;
    });
    res.status(201).json(serialize(find(doc)));
  });

  r.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = find(id);
    if (!existing) throw notFound('Document not found');
    if (existing.status === 'void') throw conflict('Voided documents cannot be edited');
    const body = parse(docSchema, req.body);
    const dueDate = body.dueDate ?? addDays(body.issueDate, 30);
    if (dueDate < body.issueDate) throw badRequest('Due date must be on or after the issue date');

    tx(db, () => {
      const keepStatus = ['paid', 'partial'].includes(existing.status) ? existing.status : body.status;
      db.prepare(
        `UPDATE ${table} SET contact_id = ?, issue_date = ?, due_date = ?, status = ?, discount_cents = ?,
         notes = ?, reference = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(body.contactId, body.issueDate, dueDate, keepStatus, body.discountCents, body.notes, body.reference, id);
      writeLines(id, body.lines);
      const totals = recomputeDocumentTotals(db, table, id);
      if (totals.paid > totals.total) throw badRequest('Total is lower than payments already applied to this document');
    });
    res.json(serialize(find(id)));
  });

  r.post('/:id/send', (req, res) => {
    const id = Number(req.params.id);
    const existing = find(id);
    if (!existing) throw notFound('Document not found');
    if (existing.status !== 'draft') throw conflict('Only drafts can be sent');
    db.prepare(`UPDATE ${table} SET status = 'open', ${kind === 'invoice' ? 'sent_at' : 'approved_at'} = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
    res.json(serialize(find(id)));
  });

  r.post('/:id/void', (req, res) => {
    const id = Number(req.params.id);
    const existing = find(id);
    if (!existing) throw notFound('Document not found');
    if (existing.paid_cents > 0) throw conflict('Remove applied payments before voiding this document');
    db.prepare(`UPDATE ${table} SET status = 'void', updated_at = datetime('now') WHERE id = ?`).run(id);
    res.json(serialize(find(id)));
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = find(id);
    if (!existing) throw notFound('Document not found');
    if (existing.paid_cents > 0) throw conflict('Documents with payments cannot be deleted');
    if (!['draft', 'void'].includes(existing.status)) throw conflict('Only drafts or voided documents can be deleted');
    tx(db, () => {
      db.prepare(`DELETE FROM ${lineTable} WHERE ${fk} = ?`).run(id);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    });
    res.status(204).end();
  });

  return r;
}
