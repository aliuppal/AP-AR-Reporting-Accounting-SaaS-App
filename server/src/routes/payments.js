import { Router } from 'express';
import { z } from 'zod';
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

function shape(row, allocations, contact) {
  const allocated = allocations.reduce((sum, a) => sum + a.amount_cents, 0);
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
  const router = Router();

  router.get('/', async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const clauses = [];
    const params = [];
    if (req.query.direction && req.query.direction !== 'all') {
      params.push(String(req.query.direction));
      clauses.push(`direction = $${params.length}`);
    }
    if (req.query.contactId) {
      params.push(Number(req.query.contactId));
      clauses.push(`contact_id = $${params.length}`);
    }
    if (req.query.from) {
      params.push(String(req.query.from));
      clauses.push(`date >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(String(req.query.to));
      clauses.push(`date <= $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const i = params.length;
      clauses.push(`(number ILIKE $${i} OR reference ILIKE $${i} OR contact_id IN (SELECT id FROM contacts WHERE name ILIKE $${i}))`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = (await db.one(`SELECT COUNT(*)::int AS c FROM payments ${where}`, params)).c;
    const rows = await db.many(
      `SELECT * FROM payments ${where} ORDER BY date DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const totals = await db.one(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_cents ELSE 0 END), 0)::int AS inflow,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_cents ELSE 0 END), 0)::int AS outflow
         FROM payments ${where}`,
      params,
    );

    // Batch allocations and contacts for the page (2 queries instead of 2N).
    const ids = rows.map((row) => row.id);
    const contactIds = [...new Set(rows.map((row) => row.contact_id))];
    const [allocations, contacts] = await Promise.all([
      ids.length
        ? db.many(
          `SELECT a.*, i.number AS invoice_number, b.number AS bill_number
             FROM allocations a
             LEFT JOIN invoices i ON i.id = a.invoice_id
             LEFT JOIN bills b ON b.id = a.bill_id
            WHERE a.payment_id = ANY($1::int[])`,
          [ids],
        )
        : Promise.resolve([]),
      contactIds.length
        ? db.many('SELECT id, name, company FROM contacts WHERE id = ANY($1::int[])', [contactIds])
        : Promise.resolve([]),
    ]);

    const allocMap = new Map();
    for (const allocation of allocations) {
      const list = allocMap.get(allocation.payment_id) ?? [];
      list.push(allocation);
      allocMap.set(allocation.payment_id, list);
    }
    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    const items = rows.map((row) => shape(row, allocMap.get(row.id) ?? [], contactMap.get(row.contact_id) ?? null));
    res.json({ items, total, limit, offset, inflowCents: totals.inflow, outflowCents: totals.outflow });
  });

  router.get('/:id', async (req, res) => {
    const row = await db.one('SELECT * FROM payments WHERE id = $1', [Number(req.params.id)]);
    if (!row) throw notFound('Payment not found');
    const [allocations, contact] = await Promise.all([
      db.many(
        `SELECT a.*, i.number AS invoice_number, b.number AS bill_number
           FROM allocations a
           LEFT JOIN invoices i ON i.id = a.invoice_id
           LEFT JOIN bills b ON b.id = a.bill_id
          WHERE a.payment_id = $1`,
        [row.id],
      ),
      db.one('SELECT id, name, company FROM contacts WHERE id = $1', [row.contact_id]),
    ]);
    res.json(shape(row, allocations, contact));
  });

  router.post('/', async (req, res) => {
    const body = parse(paymentSchema, req.body);
    const contact = await db.one('SELECT * FROM contacts WHERE id = $1', [body.contactId]);
    if (!contact) throw badRequest('Contact not found');

    const id = await db.tx(async (client) => {
      const settings = (await client.query('SELECT * FROM settings WHERE id = 1')).rows[0];
      const number = await db.nextNumber(client, 'payment', body.date, settings.payment_prefix);
      const inserted = await client.query(
        `INSERT INTO payments (number, direction, contact_id, date, amount_cents, method, reference, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [number, body.direction, body.contactId, body.date, body.amountCents, body.method, body.reference, body.notes],
      );
      const paymentId = inserted.rows[0].id;

      try {
        if (body.allocations?.length) {
          await db.allocatePayment(client, paymentId, body.allocations);
        } else {
          // Auto-apply oldest open documents first, up to the payment amount.
          const table = body.direction === 'in' ? 'invoices' : 'bills';
          const docs = (await client.query(
            `SELECT * FROM ${table}
              WHERE contact_id = $1 AND status IN ('open','partial')
              ORDER BY due_date, id`,
            [body.contactId],
          )).rows;
          let remaining = body.amountCents;
          for (const doc of docs) {
            if (remaining <= 0) break;
            const balance = doc.total_cents - doc.paid_cents;
            if (balance <= 0) continue;
            const amount = Math.min(balance, remaining);
            await client.query(
              `INSERT INTO allocations (payment_id, ${body.direction === 'in' ? 'invoice_id' : 'bill_id'}, amount_cents)
               VALUES ($1,$2,$3)`,
              [paymentId, doc.id, amount],
            );
            await db.recomputeDocumentTotals(client, table, doc.id);
            remaining -= amount;
          }
        }
      } catch (err) {
        throw badRequest(err.message);
      }

      const sum = (await client.query(
        'SELECT COALESCE(SUM(amount_cents), 0)::int AS s FROM allocations WHERE payment_id = $1', [paymentId],
      )).rows[0].s;
      if (sum > body.amountCents) throw badRequest('Allocations exceed the payment amount');
      return paymentId;
    });

    const row = await db.one('SELECT * FROM payments WHERE id = $1', [id]);
    const [paymentAllocations, paymentContact] = await Promise.all([
      db.many(
        `SELECT a.*, i.number AS invoice_number, b.number AS bill_number
           FROM allocations a
           LEFT JOIN invoices i ON i.id = a.invoice_id
           LEFT JOIN bills b ON b.id = a.bill_id
          WHERE a.payment_id = $1`,
        [id],
      ),
      db.one('SELECT id, name, company FROM contacts WHERE id = $1', [row.contact_id]),
    ]);
    res.status(201).json(shape(row, paymentAllocations, paymentContact));
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = await db.one('SELECT * FROM payments WHERE id = $1', [id]);
    if (!row) throw notFound('Payment not found');

    await db.tx(async (client) => {
      const allocations = (await client.query('SELECT * FROM allocations WHERE payment_id = $1', [id])).rows;
      await client.query('DELETE FROM allocations WHERE payment_id = $1', [id]);
      for (const allocation of allocations) {
        if (allocation.invoice_id) await db.recomputeDocumentTotals(client, 'invoices', allocation.invoice_id);
        if (allocation.bill_id) await db.recomputeDocumentTotals(client, 'bills', allocation.bill_id);
      }
      await client.query('DELETE FROM payments WHERE id = $1', [id]);
    });
    res.status(204).end();
  });

  return router;
}
