import { openDb, recomputeDocumentTotals, tx } from './db.js';
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

export function seed(db, { force = false } = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0 && !force) return { skipped: true };

  const rand = mulberry32(20261020);
  const pick = (arr) => arr[rngInt(rand, 0, arr.length - 1)];

  tx(db, () => {
    if (force) {
      for (const t of ['allocations', 'payments', 'invoice_lines', 'bill_lines', 'invoices', 'bills', 'contacts', 'users', 'counters']) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
    }

    const { salt, hash } = hashPassword('demo1234');
    db.prepare('INSERT INTO users (email, name, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)')
      .run('demo@ledgerly.app', 'Alex Morgan', hash, salt, 'owner');

    db.prepare(
      `UPDATE settings SET company_name = ?, legal_name = ?, currency = 'USD', default_terms_days = 30,
       default_tax_rate = 8.25, invoice_prefix = 'INV', bill_prefix = 'BILL', payment_prefix = 'PMT' WHERE id = 1`,
    ).run('Northwind Studio', 'Northwind Studio LLC');

    const contactIds = new Map();
    const insertContact = db.prepare(
      `INSERT INTO contacts (type, name, company, email, phone, address, city, country, terms_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [name, email, city, terms] of CUSTOMERS) {
      const res = insertContact.run('customer', name, name, email, '', '', city, 'United States', terms, '');
      contactIds.set(name, Number(res.lastInsertRowid));
    }
    for (const [name, note, email, city, terms] of VENDORS) {
      const res = insertContact.run('vendor', name, name, email, '', '', city, 'United States', terms, note);
      contactIds.set(name, Number(res.lastInsertRowid));
    }

    const counters = new Map();
    const nextNumber = (kind, prefix, date) => {
      const year = date.slice(0, 4);
      const key = `${kind}:${year}`;
      const value = (counters.get(key) ?? 0) + 1;
      counters.set(key, value);
      db.prepare('INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value);
      return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
    };

    const insertInvoice = db.prepare(
      `INSERT INTO invoices (number, contact_id, issue_date, due_date, status, currency, discount_cents, notes, reference, sent_at)
       VALUES (?, ?, ?, ?, 'open', 'USD', 0, '', ?, datetime('now'))`,
    );
    const insertInvoiceLine = db.prepare(
      `INSERT INTO invoice_lines (invoice_id, description, category, quantity, unit_price_cents, tax_rate, amount_cents, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertBill = db.prepare(
      `INSERT INTO bills (number, contact_id, issue_date, due_date, status, currency, discount_cents, notes, reference, approved_at)
       VALUES (?, ?, ?, ?, 'open', 'USD', 0, '', ?, datetime('now'))`,
    );
    const insertBillLine = db.prepare(
      `INSERT INTO bill_lines (bill_id, description, category, quantity, unit_price_cents, tax_rate, amount_cents, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPayment = db.prepare(
      `INSERT INTO payments (number, direction, contact_id, date, amount_cents, method, reference, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, '')`,
    );
    const insertAlloc = db.prepare('INSERT INTO allocations (payment_id, invoice_id, bill_id, amount_cents) VALUES (?, ?, ?, ?)');

    const countersUsed = { invoices: 0, bills: 0, payments: 0 };
    const agingUsed = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    const methods = ['Bank transfer', 'Credit card', 'Cheque'];

    const payDoc = ({ direction, contactId, amount, issueDate, docId, docType }) => {
      const payDate = addDays(issueDate, rngInt(rand, 4, 34));
      if (payDate > todayISO()) return null;
      const number = nextNumber('payment', 'PMT', payDate);
      const res = insertPayment.run(number, direction, contactId, payDate, amount, pick(methods), direction === 'in' ? `REF-${rngInt(rand, 1000, 9999)}` : `ACH-${rngInt(rand, 1000, 9999)}`);
      insertAlloc.run(Number(res.lastInsertRowid), docType === 'invoice' ? docId : null, docType === 'bill' ? docId : null, amount);
      recomputeDocumentTotals(db, docType === 'invoice' ? 'invoices' : 'bills', docId);
      countersUsed.payments += 1;
      return number;
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
        const contactId = contactIds.get(customer[0]);
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

        const number = nextNumber('invoice', 'INV', issueDate);
        const res = insertInvoice.run(number, contactId, issueDate, dueDate, `PO-${rngInt(rand, 1000, 9999)}`);
        const id = Number(res.lastInsertRowid);
        const lineCount = rngInt(rand, 1, 3);
        const used = new Set();
        for (let l = 0; l < lineCount; l += 1) {
          let item = pick(SERVICES);
          let guard = 0;
          while (used.has(item[0]) && guard < 12) { item = pick(SERVICES); guard += 1; }
          used.add(item[0]);
          const qty = pick([1, 1, 1, 2]);
          insertInvoiceLine.run(id, item[0], item[1], qty, item[2], 8.25, Math.round(item[2] * qty), l);
        }
        recomputeDocumentTotals(db, 'invoices', id);
        countersUsed.invoices += 1;

        if (plan === 'draft') {
          db.prepare(`UPDATE invoices SET status = 'draft', sent_at = NULL WHERE id = ?`).run(id);
          continue;
        }

        const doc = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
        if (plan === 'paid') {
          payDoc({ direction: 'in', contactId, amount: doc.total_cents, issueDate, docId: id, docType: 'invoice' });
        } else if (plan === 'partial') {
          payDoc({ direction: 'in', contactId, amount: Math.round(doc.total_cents * 0.45), issueDate, docId: id, docType: 'invoice' });
        }
      }
    }

    // ---------------- Expense side: recurring + occasional bills ----------------
    for (let back = 9; back >= 0; back -= 1) {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      for (const recurring of RECURRING_BILLS) {
        const issueDate = iso(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(recurring.day, 27))));
        if (issueDate > todayISO()) continue;
        const contactId = contactIds.get(recurring.vendor);
        const terms = VENDORS.find((v) => v[0] === recurring.vendor)?.[4] ?? 15;
        const ageDays = Math.round((Date.now() - new Date(`${issueDate}T00:00:00Z`).getTime()) / 86400000);
        // Recurring costs are paid on time; the newest run stays open until payment day.
        const plan = ageDays < 12 ? 'open' : ageDays < 40 && rand() < 0.15 ? 'partial' : 'paid';

        const number = nextNumber('bill', 'BILL', issueDate);
        const res = insertBill.run(number, contactId, issueDate, addDays(issueDate, terms), `FY${issueDate.slice(0, 4)}`);
        const id = Number(res.lastInsertRowid);
        insertBillLine.run(id, recurring.description, recurring.category, 1, recurring.amount, recurring.tax, recurring.amount, 0);
        recomputeDocumentTotals(db, 'bills', id);
        countersUsed.bills += 1;

        if (plan === 'paid') {
          const total = db.prepare('SELECT total_cents AS t FROM bills WHERE id = ?').get(id).t;
          payDoc({ direction: 'out', contactId, amount: total, issueDate, docId: id, docType: 'bill' });
        }
      }

      if (back % 2 === 0) {
        const occasional = pick(OCCASIONAL_BILLS);
        const day = rngInt(rand, 3, 26);
        const issueDate = iso(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day)));
        if (issueDate <= todayISO()) {
          const contactId = contactIds.get(occasional.vendor);
          const number = nextNumber('bill', 'BILL', issueDate);
          const res = insertBill.run(number, contactId, issueDate, addDays(issueDate, 21), '');
          const id = Number(res.lastInsertRowid);
          insertBillLine.run(id, occasional.description, occasional.category, 1, occasional.amount, 0, occasional.amount, 0);
          recomputeDocumentTotals(db, 'bills', id);
          countersUsed.bills += 1;
        }
      }
    }

    return countersUsed;
  });

  return { skipped: false };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const db = openDb();
  const result = seed(db, { force: process.argv.includes('--force') });
  console.log(result.skipped ? 'Database already has users — seed skipped (use --force to reset).' : 'Seed complete: demo@ledgerly.app / demo1234');
  db.close();
}

