import { createDb } from './db.js';
import { hashPassword } from './auth.js';

/** Deterministic PRNG so demo data and tests are reproducible. */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};
const todayISO = () => iso(new Date());

const CUSTOMERS = [
  ['Harbor Dental Group', 'billing@harbordental.com', 'San Diego', 30],
  ['Brightline Logistics', 'ap@brightlinelogistics.com', 'Chicago', 15],
  ['Cedar & Co. Architects', 'accounts@cedarco.studio', 'Portland', 30],
  ['Lumen Health Systems', 'payables@lumenhealth.org', 'Austin', 45],
  ['Atlas Manufacturing', 'finance@atlasmfg.com', 'Detroit', 30],
  ['Nova Retail Group', 'billing@novaretail.com', 'Miami', 30],
  ['Pinecrest Legal', 'office@pinecrestlegal.com', 'Denver', 15],
  ['Quartz Media Lab', 'accounts@quartzmedia.tv', 'Seattle', 30],
];

const VENDORS = [
  ['Amazon Web Services', 'Cloud infrastructure', 'aws-billing@amazon.com', 'Seattle', 15],
  ['Vantage Properties', 'Office lease', 'billing@vantageprops.com', 'Austin', 5],
  ['Rippling Payroll', 'Payroll & benefits', 'invoices@rippling.com', 'San Francisco', 7],
  ['Northstar Marketing', 'Demand generation', 'finance@northstarmktg.com', 'New York', 30],
  ['Bright CPA Advisors', 'Accounting & tax', 'billing@brightcpa.com', 'Denver', 30],
  ['Metro Utilities', 'Electricity & water', 'billing@metroutilities.com', 'Austin', 21],
  ['Delta Air Lines', 'Business travel', 'corporate@delta.com', 'Atlanta', 30],
];

const SERVICES = [
  ['Brand strategy workshop', 'Services', 480000],
  ['Website design sprint', 'Services', 1250000],
  ['Monthly retainer — design ops', 'Retainers', 350000],
  ['Product photography (half day)', 'Services', 95000],
  ['UX audit & recommendations', 'Services', 275000],
  ['Landing page development', 'Products', 420000],
  ['Design system license', 'Products', 180000],
  ['Motion graphics package', 'Products', 240000],
  ['Quarterly analytics review', 'Services', 150000],
  ['Copywriting — campaign', 'Services', 85000],
];

/** Recurring monthly costs, so the P&L looks like a real services business. */
const RECURRING_BILLS = [
  { vendor: 'Vantage Properties', day: 1, description: 'Office lease — monthly', category: 'Rent', amount: 320000, tax: 0 },
  { vendor: 'Amazon Web Services', day: 4, description: 'AWS production hosting', category: 'Software', amount: 168000, tax: 0 },
  { vendor: 'Northstar Marketing', day: 8, description: 'Paid search & content retainer', category: 'Marketing', amount: 240000, tax: 0 },
  { vendor: 'Rippling Payroll', day: 15, description: 'Payroll — design & ops team', category: 'Payroll', amount: 1520000, tax: 0 },
  { vendor: 'Metro Utilities', day: 20, description: 'Electricity & water', category: 'Utilities', amount: 41000, tax: 8.25 },
  { vendor: 'Bright CPA Advisors', day: 22, description: 'Bookkeeping & controller retainer', category: 'Professional Fees', amount: 145000, tax: 0 },
];

const OCCASIONAL_BILLS = [
  { vendor: 'Delta Air Lines', description: 'Flight — client onsite', category: 'Travel', amount: 64000 },
  { vendor: 'Delta Air Lines', description: 'Flight — conference', category: 'Travel', amount: 48000 },
  { vendor: 'Rippling Payroll', description: 'Contractor — frontend sprint', category: 'Payroll', amount: 420000 },
  { vendor: 'Amazon Web Services', description: 'S3 egress overage', category: 'Software', amount: 22000 },
  { vendor: 'Northstar Marketing', description: 'Conference sponsorship', category: 'Marketing', amount: 250000 },
];

/**
 * Target shape of the open AR book: a handful of current invoices and a thin
 * tail in the older buckets — what a healthy ~$600k/yr studio looks like.
 */
const AGING_QUOTA = { current: 4, d1_30: 3, d31_60: 2, d61_90: 1, d90plus: 1 };

function rngInt(rand, min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function lineTotals(lines) {
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const tax = lines.reduce((sum, line) => sum + Math.round((line.amount * line.tax) / 100), 0);
  return { subtotal, tax, total: subtotal + tax };
}

export async function seed(db, { force = false } = {}) {
  const existing = await db.one('SELECT COUNT(*)::int AS c FROM users');
  if (existing.c > 0 && !force) return { skipped: true };

  const rand = mulberry32(20261020);
  const pick = (arr) => arr[rngInt(rand, 0, arr.length - 1)];

  // ----- plan the whole ledger in memory, then write it in bulk -----
  const contacts = [
    ...CUSTOMERS.map(([name, email, city, terms]) => ({ type: 'customer', name, email, city, terms, note: '' })),
    ...VENDORS.map(([name, note, email, city, terms]) => ({ type: 'vendor', name, email, city, terms, note })),
  ];

  const blocks = new Map();
  const takeNumber = (kind, prefix, date) => {
    const year = String(date).slice(0, 4);
    const key = `${kind}:${year}`;
    let block = blocks.get(key);
    if (!block) {
      block = { next: 1, consumed: 0 };
      blocks.set(key, block);
    }
    const value = block.next;
    block.next += 1;
    block.consumed += 1;
    return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
  };

  const invoices = [];
  const bills = [];
  const payments = [];
  const agingUsed = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const methods = ['Bank transfer', 'Credit card', 'Cheque'];

  const queuePayment = (doc, { direction, amount, issueDate }) => {
    const payDate = addDays(issueDate, rngInt(rand, 4, 34));
    if (payDate > todayISO()) return;
    doc.paid = amount;
    doc.payStatus = amount >= doc.total ? 'paid' : 'partial';
    payments.push({
      number: takeNumber('payment', 'PMT', payDate),
      direction,
      contactName: doc.contactName,
      date: payDate,
      amountCents: amount,
      method: pick(methods),
      reference: direction === 'in' ? `REF-${rngInt(rand, 1000, 9999)}` : `ACH-${rngInt(rand, 1000, 9999)}`,
      docType: doc.type,
      docNumber: doc.number,
      docAmount: amount,
    });
  };

  const now = new Date();

  // ---------------- Revenue side: ten months of invoices ----------------
  for (let back = 9; back >= 0; back -= 1) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const invoiceCount = rngInt(rand, 7, 9);
    let dayCursor = 2;
    for (let i = 0; i < invoiceCount; i += 1) {
      dayCursor += rngInt(rand, 1, 3);
      const issueDate = iso(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(dayCursor, 27))));
      if (issueDate > todayISO()) continue;

      const customer = pick(CUSTOMERS);
      const ageDays = Math.round((Date.now() - new Date(`${issueDate}T00:00:00Z`).getTime()) / 86400000);
      const dueDate = addDays(issueDate, customer[3]);
      const daysPastDue = ageDays - customer[3];
      const bucket = daysPastDue <= 0 ? 'current'
        : daysPastDue <= 30 ? 'd1_30'
          : daysPastDue <= 60 ? 'd31_60'
            : daysPastDue <= 90 ? 'd61_90' : 'd90plus';

      const roll = rand();
      let plan;
      if (roll < 0.05) plan = 'draft';
      else if (agingUsed[bucket] < AGING_QUOTA[bucket]) {
        plan = roll < 0.22 ? 'partial' : 'open';
        agingUsed[bucket] += 1;
      } else plan = 'paid';

      const lines = [];
      const lineCount = rngInt(rand, 1, 3);
      const used = new Set();
      for (let l = 0; l < lineCount; l += 1) {
        let item = pick(SERVICES);
        let guard = 0;
        while (used.has(item[0]) && guard < 12) { item = pick(SERVICES); guard += 1; }
        used.add(item[0]);
        const qty = pick([1, 1, 1, 2]);
        lines.push({ description: item[0], category: item[1], qty, unit: item[2], amount: Math.round(item[2] * qty), tax: 8.25 });
      }
      const totals = lineTotals(lines);

      const doc = {
        type: 'invoice',
        number: takeNumber('invoice', 'INV', issueDate),
        contactName: customer[0],
        issueDate,
        dueDate,
        status: plan === 'draft' ? 'draft' : 'open',
        reference: `PO-${rngInt(rand, 1000, 9999)}`,
        ...totals,
        lines,
        paid: 0,
        payStatus: null,
      };
      invoices.push(doc);

      if (plan === 'paid') queuePayment(doc, { direction: 'in', amount: totals.total, issueDate });
      else if (plan === 'partial') queuePayment(doc, { direction: 'in', amount: Math.round(totals.total * 0.45), issueDate });
    }
  }

  // ---------------- Expense side: recurring + occasional bills ----------------
  for (let back = 9; back >= 0; back -= 1) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    for (const recurring of RECURRING_BILLS) {
      const issueDate = iso(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(recurring.day, 27))));
      if (issueDate > todayISO()) continue;
      const terms = VENDORS.find((v) => v[0] === recurring.vendor)?.[4] ?? 15;
      const ageDays = Math.round((Date.now() - new Date(`${issueDate}T00:00:00Z`).getTime()) / 86400000);
      // Recurring costs are paid on time; the newest run stays open until payment day.
      const plan = ageDays < 12 ? 'open' : ageDays < 40 && rand() < 0.15 ? 'partial' : 'paid';

      const tax = Math.round((recurring.amount * recurring.tax) / 100);
      const total = recurring.amount + tax;
      const doc = {
        type: 'bill',
        number: takeNumber('bill', 'BILL', issueDate),
        contactName: recurring.vendor,
        issueDate,
        dueDate: addDays(issueDate, terms),
        status: 'open',
        reference: `FY${issueDate.slice(0, 4)}`,
        subtotal: recurring.amount,
        tax,
        total,
        lines: [{ description: recurring.description, category: recurring.category, qty: 1, unit: recurring.amount, amount: recurring.amount, tax: recurring.tax }],
        paid: 0,
        payStatus: null,
      };
      bills.push(doc);
      if (plan === 'paid') queuePayment(doc, { direction: 'out', amount: total, issueDate });
      else if (plan === 'partial') queuePayment(doc, { direction: 'out', amount: Math.round(total * 0.5), issueDate });
    }

    if (back % 2 === 0) {
      const occasional = pick(OCCASIONAL_BILLS);
      const day = rngInt(rand, 3, 26);
      const issueDate = iso(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day)));
      if (issueDate <= todayISO()) {
        bills.push({
          type: 'bill',
          number: takeNumber('bill', 'BILL', issueDate),
          contactName: occasional.vendor,
          issueDate,
          dueDate: addDays(issueDate, 21),
          status: 'open',
          reference: '',
          subtotal: occasional.amount,
          tax: 0,
          total: occasional.amount,
          lines: [{ description: occasional.description, category: occasional.category, qty: 1, unit: occasional.amount, amount: occasional.amount, tax: 0 }],
          paid: 0,
          payStatus: null,
        });
      }
    }
  }

  // ----- bulk write -----
  const result = await db.tx(async (client) => {
    if (force) {
      await client.query(
        'TRUNCATE allocations, payments, invoice_lines, bill_lines, invoices, bills, contacts, users, counters RESTART IDENTITY CASCADE',
      );
    }

    const { salt, hash } = hashPassword('test1234');
    await client.query(
      'INSERT INTO users (email, name, password_hash, salt, role) VALUES ($1,$2,$3,$4,$5)',
      ['test@ledgerly.app', 'Alex Morgan', hash, salt, 'owner'],
    );
    await client.query(
      `UPDATE settings SET company_name = $1, legal_name = $2, currency = 'USD', default_terms_days = 30,
              default_tax_rate = 8.25, invoice_prefix = 'INV', bill_prefix = 'BILL', payment_prefix = 'PMT'
        WHERE id = 1`,
      ['Northwind Studio', 'Northwind Studio LLC'],
    );

    await client.query(
      `INSERT INTO contacts (type, name, company, email, city, country, terms_days, notes)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[])`,
      [
        contacts.map((c) => c.type), contacts.map((c) => c.name), contacts.map((c) => c.name),
        contacts.map((c) => c.email), contacts.map((c) => c.city), contacts.map(() => 'United States'),
        contacts.map((c) => c.terms), contacts.map((c) => c.note),
      ],
    );
    const contactRows = await client.query('SELECT id, name FROM contacts');
    const contactId = new Map(contactRows.rows.map((row) => [row.name, row.id]));

    for (const [key, block] of blocks) {
      await client.query(
        `INSERT INTO counters (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = GREATEST(counters.value, $2)`,
        [key, block.consumed],
      );
    }

    const insertDocs = async (table, docs, stampColumn) => {
      if (docs.length === 0) return new Map();
      const { rows } = await client.query(
        `INSERT INTO ${table} (number, contact_id, issue_date, due_date, status, currency,
                               subtotal_cents, tax_cents, total_cents, discount_cents, notes, reference, ${stampColumn})
         SELECT * FROM unnest($1::text[], $2::int[], $3::date[], $4::date[], $5::text[], $6::text[],
                              $7::int[], $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::timestamptz[])
         RETURNING id, number`,
        [
          docs.map((d) => d.number), docs.map((d) => contactId.get(d.contactName)), docs.map((d) => d.issueDate),
          docs.map((d) => d.dueDate), docs.map((d) => d.status), docs.map(() => 'USD'),
          docs.map((d) => d.subtotal), docs.map((d) => d.tax), docs.map((d) => d.total), docs.map(() => 0),
          docs.map(() => ''), docs.map((d) => d.reference),
          docs.map((d) => (d.status === 'draft' ? null : new Date().toISOString())),
        ],
      );
      return new Map(rows.map((row) => [row.number, row.id]));
    };

    const invoiceIds = await insertDocs('invoices', invoices, 'sent_at');
    const billIds = await insertDocs('bills', bills, 'approved_at');

    const insertLines = async (table, fk, docs, idMap) => {
      const rows = [];
      for (const doc of docs) {
        const id = idMap.get(doc.number);
        doc.lines.forEach((line, position) => rows.push({ id, line, position }));
      }
      if (rows.length === 0) return;
      await client.query(
        `INSERT INTO ${table} (${fk}, description, category, quantity, unit_price_cents, tax_rate, amount_cents, position)
         SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::float8[], $5::int[], $6::float8[], $7::int[], $8::int[])`,
        [
          rows.map((r) => r.id), rows.map((r) => r.line.description), rows.map((r) => r.line.category),
          rows.map((r) => r.line.qty), rows.map((r) => r.line.unit), rows.map((r) => r.line.tax),
          rows.map((r) => r.line.amount), rows.map((r) => r.position),
        ],
      );
    };

    await insertLines('invoice_lines', 'invoice_id', invoices, invoiceIds);
    await insertLines('bill_lines', 'bill_id', bills, billIds);

    if (payments.length > 0) {
      const { rows } = await client.query(
        `INSERT INTO payments (number, direction, contact_id, date, amount_cents, method, reference, notes)
         SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::date[], $5::int[], $6::text[], $7::text[], $8::text[])
         RETURNING id, number`,
        [
          payments.map((p) => p.number), payments.map((p) => p.direction),
          payments.map((p) => contactId.get(p.contactName)), payments.map((p) => p.date),
          payments.map((p) => p.amountCents), payments.map((p) => p.method),
          payments.map((p) => p.reference), payments.map(() => ''),
        ],
      );
      const paymentIds = new Map(rows.map((row) => [row.number, row.id]));

      await client.query(
        `INSERT INTO allocations (payment_id, invoice_id, bill_id, amount_cents)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[])`,
        [
          payments.map((p) => paymentIds.get(p.number)),
          payments.map((p) => (p.docType === 'invoice' ? invoiceIds.get(p.docNumber) : null)),
          payments.map((p) => (p.docType === 'bill' ? billIds.get(p.docNumber) : null)),
          payments.map((p) => p.docAmount),
        ],
      );
    }

    const applyPaymentStatus = async (table, docs, idMap) => {
      const paid = docs.filter((d) => d.payStatus);
      if (paid.length === 0) return;
      await client.query(
        `UPDATE ${table} SET paid_cents = u.paid, status = u.status, updated_at = now()
           FROM unnest($1::int[], $2::int[], $3::text[]) AS u(id, paid, status)
          WHERE ${table}.id = u.id`,
        [paid.map((d) => idMap.get(d.number)), paid.map((d) => d.paid), paid.map((d) => d.payStatus)],
      );
    };

    await applyPaymentStatus('invoices', invoices, invoiceIds);
    await applyPaymentStatus('bills', bills, billIds);

    return { invoices: invoices.length, bills: bills.length, payments: payments.length };
  });

  return { skipped: false, ...result };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  try { process.loadEnvFile?.('.env'); } catch { /* optional */ }
  const db = createDb();
  await db.migrate();
  const result = await seed(db, { force: process.argv.includes('--force') });
  console.log(result.skipped ? 'Database already has users — seed skipped (use --force to reset).' : 'Seed complete: test@ledgerly.app / test1234');
  await db.close();
}
