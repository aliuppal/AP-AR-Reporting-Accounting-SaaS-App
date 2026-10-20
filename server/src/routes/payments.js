import { Router } from 'express';
import { z } from 'zod';
import { allocatePayment, nextNumber, recomputeDocumentTotals, tx } from '../db.js';
import { badRequest, notFound, pagination, parse } from '../http.js';

const allocationSchema = z.object({
  docType: z.enum(['invoice', 'bill']),
  docId: z.coerce.number().int().positive(),
  amountCents: z.coerce.number().int().positive(),
});

const paymentSchema = z.object({
  direction: z.enum(['in', 'out']),
  contactId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.coerce.number().int().positive(),
  method: z.string().trim().max(60).optional().default('Bank transfer'),
  reference: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
  allocations: z.array(allocationSchema).optional(),
});

function serialize(db, row) {
  const allocations = db.prepare(
    `SELECT a.*, i.number AS invoice_number, b.number AS bill_number
       FROM allocations a
       LEFT JOIN invoices i ON i.id = a.invoice_id
       LEFT JOIN bills b ON b.id = a.bill_id
      WHERE a.payment_id = ?`
  ).all(row.id);
  const contact = db.prepare('SELECT id, name, company FROM contacts WHERE id = ?').get(row.contact_id);
  const allocated = allocations.reduce((s, a) => s + a.amount_cents, 0);
  return {
    id: row.id,
    number: row.number,
    direction: row.direction,
    contactId: row.contact_id,
    contact: contact ?? null,
    date: row.date,
    amountCents: row.amount_cents,
    allocatedCents: allocated,
    unappliedCents: row.amount_cents - allocated,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
    allocations: allocations.map((a) => ({
      id: a.id,
      docType: a.invoice_id ? 'invoice' : 'bill',
      docId: a.invoice_id ?? a.bill_id,
      docNumber: a.invoice_number ?? a.bill_number,
      amountCents: a.amount_cents,
    })),
  };
}

export function paymentsRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const { limit, offset } = pagination(req.query);
    const clauses = [];
    const params = [];
    if (req.query.direction && req.query.direction !== 'all') {
      clauses.push('direction = ?');
      params.push(req.query.direction);
    }
    if (req.query.contactId) {
      clauses.push('contact_id = ?');
      params.push(Number(req.query.contactId));
    }
    if (req.query.from) {
      clauses.push('date >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      clauses.push('date <= ?');
      params.push(String(req.query.to));
    }
    if (req.query.q) {
      const like = `%${String(req.query.q).trim()}%`;
      clauses.push('(number LIKE ? OR reference LIKE ? OR contact_id IN (SELECT id FROM contacts WHERE name LIKE ?))');
      params.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS c FROM payments ${where}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM payments ${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const totals = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_cents ELSE 0 END),0) AS inflow,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_cents ELSE 0 END),0) AS outflow
         FROM payments ${where}`
    ).get(...params);
    res.json({ items: rows.map((row) => serialize(db, row)), total, limit, offset, inflowCents: totals.inflow, outflowCents: totals.outflow });
  });

  r.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.id));
    if (!row) throw notFound('Payment not found');
    res.json(serialize(db, row));
  });

  r.post('/', (req, res) => {
    const body = parse(paymentSchema, req.body);
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(body.contactId);
    if (!contact) throw badRequest('Contact not found');

    const id = tx(db, () => {
      const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      const number = nextNumber(db, 'payment', body.date, settings.payment_prefix);
      const inserted = db.prepare(
        `INSERT INTO payments (number, direction, contact_id, date, amount_cents, method, reference, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(number, body.direction, body.contactId, body.date, body.amountCents, body.method, body.reference, body.notes);
      const paymentId = Number(inserted.lastInsertRowid);

      if (body.allocations?.length) {
        try {
          allocatePayment(db, paymentId, body.allocations);
        } catch (err) {
          throw badRequest(err.message);
        }
      } else {
        // Auto-apply oldest open documents first, up to the payment amount.
        const table = body.direction === 'in' ? 'invoices' : 'bills';
        const docs = db.prepare(
          `SELECT * FROM ${table} WHERE contact_id = ? AND status IN ('open','partial')
            ORDER BY due_date, id`
        ).all(body.contactId);
        let remaining = body.amountCents;
        for (const doc of docs) {
          if (remaining <= 0) break;
          const balance = doc.total_cents - doc.paid_cents;
          if (balance <= 0) continue;
          const amount = Math.min(balance, remaining);
          const key = body.direction === 'in' ? 'invoice' : 'bill';
          db.prepare(`INSERT INTO allocations (payment_id, ${body.direction === 'in' ? 'invoice_id' : 'bill_id'}, amount_cents) VALUES (?, ?, ?)`)
            .run(paymentId, doc.id, amount);
          recomputeDocumentTotals(db, table, doc.id);
          remaining -= amount;
        }
        if (remaining === body.amountCents && body.amountCents > 0) {
          // Nothing to apply to: keep the payment as unapplied cash (valid in accounting).
        }
      }
      const sum = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM allocations WHERE payment_id = ?').get(paymentId).s;
      if (sum > body.amountCents) throw badRequest('Allocations exceed the payment amount');
      return paymentId;
    });

    res.status(201).json(serialize(db, db.prepare('SELECT * FROM payments WHERE id = ?').get(id)));
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!row) throw notFound('Payment not found');
    tx(db, () => {
      const allocs = db.prepare('SELECT * FROM allocations WHERE payment_id = ?').all(id);
      db.prepare('DELETE FROM allocations WHERE payment_id = ?').run(id);
      for (const a of allocs) {
        if (a.invoice_id) recomputeDocumentTotals(db, 'invoices', a.invoice_id);
        if (a.bill_id) recomputeDocumentTotals(db, 'bills', a.bill_id);
      }
      db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    });
    res.status(204).end();
  });

  return r;
}
