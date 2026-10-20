import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const DATA_DIR = process.env.LEDGERLY_DATA_DIR ?? join(ROOT, 'data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  company_name           TEXT NOT NULL DEFAULT 'Acme Studio',
  legal_name             TEXT NOT NULL DEFAULT '',
  currency               TEXT NOT NULL DEFAULT 'USD',
  locale                 TEXT NOT NULL DEFAULT 'en-US',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  default_terms_days     INTEGER NOT NULL DEFAULT 30,
  default_tax_rate       REAL NOT NULL DEFAULT 0,
  invoice_prefix         TEXT NOT NULL DEFAULT 'INV',
  bill_prefix            TEXT NOT NULL DEFAULT 'BILL',
  payment_prefix         TEXT NOT NULL DEFAULT 'PMT',
  revenue_categories     TEXT NOT NULL DEFAULT '["Services","Products","Retainers","Other"]',
  expense_categories     TEXT NOT NULL DEFAULT '["Software","Rent","Payroll","Marketing","Travel","Utilities","Professional Fees","Other"]',
  payment_methods        TEXT NOT NULL DEFAULT '["Bank transfer","Credit card","Cash","Cheque","Other"]',
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('customer','vendor','both')),
  name        TEXT NOT NULL,
  company     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  tax_id      TEXT NOT NULL DEFAULT '',
  terms_days  INTEGER NOT NULL DEFAULT 30,
  notes       TEXT NOT NULL DEFAULT '',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type, archived);

CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  contact_id     INTEGER NOT NULL REFERENCES contacts(id),
  issue_date     TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','partial','paid','void')),
  currency       TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  paid_cents     INTEGER NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  reference      TEXT NOT NULL DEFAULT '',
  sent_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'Services',
  quantity         REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate         REAL NOT NULL DEFAULT 0,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_doc ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS bills (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  contact_id     INTEGER NOT NULL REFERENCES contacts(id),
  issue_date     TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','partial','paid','void')),
  currency       TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  paid_cents     INTEGER NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  reference      TEXT NOT NULL DEFAULT '',
  approved_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_contact ON bills(contact_id);
CREATE INDEX IF NOT EXISTS idx_bills_due ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);

CREATE TABLE IF NOT EXISTS bill_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id          INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'Other',
  quantity         REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate         REAL NOT NULL DEFAULT 0,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bill_lines_doc ON bill_lines(bill_id);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  contact_id   INTEGER NOT NULL REFERENCES contacts(id),
  date         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL DEFAULT 'Bank transfer',
  reference    TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_contact ON payments(contact_id);

CREATE TABLE IF NOT EXISTS allocations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id   INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id   INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  bill_id      INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  CHECK ((invoice_id IS NOT NULL) <> (bill_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_alloc_bill ON allocations(bill_id);

CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

export function openDb(file = process.env.LEDGERLY_DB ?? join(DATA_DIR, 'ledgerly.db')) {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  ensureSettings(db);
  return db;
}

function ensureSettings(db) {
  const row = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!row) db.prepare('INSERT INTO settings (id) VALUES (1)').run();
}

let singleton = null;
export function getDb() {
  if (!singleton) singleton = openDb();
  return singleton;
}

/** Run fn inside a transaction, rolling back on any throw. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

export function nextNumber(db, kind, date, prefix) {
  const year = String(date).slice(0, 4);
  const key = `${kind}:${year}`;
  const row = db.prepare('SELECT value FROM counters WHERE key = ?').get(key);
  const value = (row?.value ?? 0) + 1;
  db.prepare('INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
}

export function recomputeDocumentTotals(db, table, id) {
  const lineTable = table === 'invoices' ? 'invoice_lines' : 'bill_lines';
  const fk = table === 'invoices' ? 'invoice_id' : 'bill_id';
  const doc = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!doc) return null;
  const lines = db.prepare(`SELECT * FROM ${lineTable} WHERE ${fk} = ? ORDER BY position, id`).all(id);
  const subtotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  const tax = lines.reduce((sum, l) => sum + Math.round((l.amount_cents * l.tax_rate) / 100), 0);
  const total = subtotal - doc.discount_cents + tax;
  const allocated = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM allocations WHERE ${table === 'invoices' ? 'invoice_id' : 'bill_id'} = ?`
  ).get(id).paid;
  let status = doc.status;
  if (status !== 'draft' && status !== 'void') {
    status = allocated >= total && total > 0 ? 'paid' : allocated > 0 ? 'partial' : 'open';
  }
  db.prepare(`UPDATE ${table} SET subtotal_cents = ?, tax_cents = ?, total_cents = ?, paid_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(subtotal, tax, total, allocated, status, id);
  return { subtotal, tax, total, paid: allocated, status };
}

export function allocatePayment(db, paymentId, allocations) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw new Error('Payment not found');
  for (const a of allocations) {
    const isInvoice = a.docType === 'invoice';
    const table = isInvoice ? 'invoices' : 'bills';
    const doc = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(a.docId);
    if (!doc) throw new Error(`Document ${a.docId} not found`);
    if (doc.contact_id !== payment.contact_id) throw new Error('Allocation contact does not match payment contact');
    if (doc.status === 'void' || doc.status === 'draft') throw new Error(`Cannot allocate to a ${doc.status} document`);
    const balance = doc.total_cents - doc.paid_cents;
    if (a.amountCents <= 0) throw new Error('Allocation amount must be positive');
    if (a.amountCents > balance) throw new Error(`Allocation exceeds open balance of ${doc.number}`);
    db.prepare(`INSERT INTO allocations (payment_id, ${isInvoice ? 'invoice_id' : 'bill_id'}, amount_cents) VALUES (?, ?, ?)`)
      .run(paymentId, a.docId, a.amountCents);
    recomputeDocumentTotals(db, table, a.docId);
  }
  const allocated = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM allocations WHERE payment_id = ?').get(paymentId).s;
  if (allocated > payment.amount_cents) throw new Error('Allocations exceed payment amount');
  return allocated;
}
