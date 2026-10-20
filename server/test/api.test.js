import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { createDb, ROOT } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const TEST_DB = process.env.LEDGERLY_TEST_DB ?? 'ledgerly_test';
let db;
let server;
let base;
let cookie = '';

function url(path) {
  return `${base}${path}`;
}

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(url(path), {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  if (raw) return res;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

/** Point the connection string at the dedicated test database, creating it once. */
async function testDatabaseUrl() {
  try { process.loadEnvFile?.('.env'); } catch { /* optional */ }
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL is required to run the API tests');

  const admin = createDb({ connectionString: adminUrl, max: 1 });
  try {
    const exists = await admin.one('SELECT 1 AS ok FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (!exists) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.close();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

before(async () => {
  const connectionString = await testDatabaseUrl();
  db = createDb({ connectionString, max: 4 });
  await db.migrate();
  await seed(db, { force: true });

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test('health check is public, data routes are not', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  const guarded = await api('/api/invoices');
  assert.equal(guarded.status, 401);
});

test('login rejects bad credentials and accepts the demo user', async () => {
  const bad = await api('/api/auth/login', { method: 'POST', body: { email: 'test@ledgerly.app', password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await api('/api/auth/login', { method: 'POST', body: { email: 'test@ledgerly.app', password: 'test1234' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.email, 'test@ledgerly.app');
  const me = await api('/api/auth/me');
  assert.equal(me.data.name, 'Alex Morgan');
});

test('seeded data supports lists, filters and dashboard', async () => {
  const invoices = await api('/api/invoices?status=overdue&limit=5');
  assert.equal(invoices.status, 200);
  assert.ok(invoices.data.items.length > 0);
  assert.ok(invoices.data.items.every((i) => i.status === 'open' || i.status === 'partial'));

  const contacts = await api('/api/contacts?type=customer');
  assert.ok(contacts.data.total >= 8);

  const dash = await api('/api/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.data.summary.receivableCents > 0);
  assert.ok(dash.data.trend.series.length >= 6);
});

test('invoice lifecycle: create draft, send, part-pay, verify aging', async () => {
  const newContact = await api('/api/contacts', {
    method: 'POST',
    body: { type: 'customer', name: `Lifecycle Test ${Date.now()}`, termsDays: 30 },
  });
  const contact = newContact.data;

  const created = await api('/api/invoices', {
    method: 'POST',
    body: {
      contactId: contact.id,
      issueDate: '2026-01-05',
      dueDate: '2026-02-04',
      status: 'draft',
      notes: 'Test invoice',
      lines: [
        { description: 'Discovery workshop', category: 'Services', quantity: 2, unitPriceCents: 100000, taxRate: 10 },
        { description: 'Report', category: 'Products', quantity: 1, unitPriceCents: 50000, taxRate: 0 },
      ],
    },
  });
  assert.equal(created.status, 201);
  const invoice = created.data;
  assert.equal(invoice.subtotalCents, 250000);
  assert.equal(invoice.taxCents, 20000);
  assert.equal(invoice.totalCents, 270000);
  assert.equal(invoice.status, 'draft');
  assert.match(invoice.number, /^INV-2026-\d{4}$/);

  // A second document on a separate contact must not disturb this contact's aging row.
  const otherContact = await api('/api/contacts', {
    method: 'POST',
    body: { type: 'customer', name: `Second Test ${Date.now()}` },
  });
  await api('/api/invoices', {
    method: 'POST',
    body: {
      contactId: otherContact.data.id,
      issueDate: '2026-01-05',
      lines: [{ description: 'x', quantity: 1, unitPriceCents: 1000 }],
    },
  });

  const sent = await api(`/api/invoices/${invoice.id}/send`, { method: 'POST' });
  assert.equal(sent.data.status, 'open');

  const payment = await api('/api/payments', {
    method: 'POST',
    body: {
      direction: 'in',
      contactId: contact.id,
      date: '2026-01-20',
      amountCents: 100000,
      method: 'Bank transfer',
      allocations: [{ docType: 'invoice', docId: invoice.id, amountCents: 100000 }],
    },
  });
  assert.equal(payment.status, 201);
  assert.equal(payment.data.allocatedCents, 100000);

  const after = await api(`/api/invoices/${invoice.id}`);
  assert.equal(after.data.status, 'partial');
  assert.equal(after.data.balanceCents, 170000);

  const overpay = await api('/api/payments', {
    method: 'POST',
    body: {
      direction: 'in', contactId: contact.id, date: '2026-01-21', amountCents: 500000,
      allocations: [{ docType: 'invoice', docId: invoice.id, amountCents: 500000 }],
    },
  });
  assert.equal(overpay.status, 400);

  const aging = await api('/api/reports/aging?type=ar&asOf=2026-03-31');
  const row = aging.data.rows.find((r) => r.contactId === contact.id);
  assert.ok(row, 'contact appears in AR aging');
  assert.equal(row.total, 170000);
  assert.equal(aging.data.totals.total > 0, true);
});

test('bills and vendor payments flow through AP aging', async () => {
  const vendors = await api('/api/contacts?type=vendor&limit=1');
  const vendor = vendors.data.items[0];
  const bill = await api('/api/bills', {
    method: 'POST',
    body: {
      contactId: vendor.id,
      issueDate: '2026-02-01',
      dueDate: '2026-02-15',
      lines: [{ description: 'Hosting', category: 'Software', quantity: 1, unitPriceCents: 80000, taxRate: 0 }],
    },
  });
  assert.equal(bill.status, 201);

  const payment = await api('/api/payments', {
    method: 'POST',
    body: { direction: 'out', contactId: vendor.id, date: '2026-02-10', amountCents: 30000 },
  });
  assert.equal(payment.status, 201);
  assert.equal(payment.data.allocations.length, 1);
  assert.equal(payment.data.allocations[0].docType, 'bill');

  const updated = await api(`/api/bills/${bill.data.id}`);
  assert.equal(updated.data.status, 'partial');

  const ap = await api('/api/reports/aging?type=ap&asOf=2026-03-31');
  assert.ok(ap.data.rows.some((r) => r.contactId === vendor.id));
});

test('reports produce balanced series and CSV exports', async () => {
  const pl = await api('/api/reports/profit-loss?from=2025-10-01&to=2026-03-31');
  assert.equal(pl.status, 200);
  assert.equal(pl.data.series.length, 6);
  const sumSeries = pl.data.series.reduce((s, r) => s + r.netCents, 0);
  assert.equal(sumSeries, pl.data.totals.netCents);

  const cf = await api('/api/reports/cash-flow?from=2026-01-01&to=2026-03-31');
  assert.equal(cf.data.series.length, 3);
  assert.equal(cf.data.totals.netCents, cf.data.totals.inflowCents - cf.data.totals.outflowCents);

  const csv = await api('/api/reports/export?report=ar-aging&asOf=2026-03-31', { raw: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const body = await csv.text();
  assert.ok(body.startsWith('Contact,Current,1-30 days'));
});

test('PKR and USD documents, payments and reports never mix', async () => {
  const contact = (await api('/api/contacts', {
    method: 'POST',
    body: { type: 'customer', name: `Currency Test ${Date.now()}` },
  })).data;

  const pkr = await api('/api/invoices', {
    method: 'POST',
    body: { contactId: contact.id, issueDate: '2026-03-01', currency: 'pkr', lines: [{ description: 'Retainer', quantity: 1, unitPriceCents: 5_000_000 }] },
  });
  assert.equal(pkr.status, 201);
  assert.equal(pkr.data.currency, 'PKR');
  const usd = await api('/api/invoices', {
    method: 'POST',
    body: { contactId: contact.id, issueDate: '2026-03-01', currency: 'USD', lines: [{ description: 'Hosting', quantity: 1, unitPriceCents: 20_000 }] },
  });
  assert.equal(usd.data.currency, 'USD');

  const rejected = await api('/api/invoices', {
    method: 'POST',
    body: { contactId: contact.id, issueDate: '2026-03-01', currency: 'EUR', lines: [{ description: 'x', quantity: 1, unitPriceCents: 100 }] },
  });
  assert.equal(rejected.status, 400);

  // A USD payment cannot settle a PKR invoice.
  const crossed = await api('/api/payments', {
    method: 'POST',
    body: {
      direction: 'in', contactId: contact.id, date: '2026-03-02', amountCents: 20_000, currency: 'USD',
      allocations: [{ docType: 'invoice', docId: pkr.data.id, amountCents: 20_000 }],
    },
  });
  assert.equal(crossed.status, 400);
  assert.match(crossed.data.error, /PKR/);

  // Without a currency the payment takes the allocated document's currency.
  const paid = await api('/api/payments', {
    method: 'POST',
    body: {
      direction: 'in', contactId: contact.id, date: '2026-03-02', amountCents: 1_000_000,
      allocations: [{ docType: 'invoice', docId: pkr.data.id, amountCents: 1_000_000 }],
    },
  });
  assert.equal(paid.status, 201);
  assert.equal(paid.data.currency, 'PKR');

  // Auto-apply only touches documents in the payment's currency.
  const auto = await api('/api/payments', {
    method: 'POST',
    body: { direction: 'in', contactId: contact.id, date: '2026-03-03', amountCents: 20_000, currency: 'USD' },
  });
  assert.equal(auto.data.allocations.length, 1);
  assert.equal(auto.data.allocations[0].docId, usd.data.id);

  // Lists and aging are scoped to one currency.
  const pkrList = await api(`/api/invoices?contactId=${contact.id}&currency=PKR`);
  assert.deepEqual(pkrList.data.items.map((d) => d.currency), ['PKR']);
  const allList = await api(`/api/invoices?contactId=${contact.id}&currency=all`);
  assert.equal(allList.data.total, 2);
  const aging = await api('/api/reports/aging?type=ar&currency=PKR&asOf=2026-03-31');
  const row = aging.data.rows.find((r) => r.contactId === contact.id);
  assert.equal(aging.data.currency, 'PKR');
  assert.equal(row.total, 4_000_000);

  // Currency cannot change once payments are applied.
  const doc = pkr.data;
  const change = await api(`/api/invoices/${doc.id}`, {
    method: 'PUT',
    body: { contactId: contact.id, issueDate: doc.issueDate, dueDate: doc.dueDate, currency: 'USD', lines: [{ description: 'Retainer', quantity: 1, unitPriceCents: 5_000_000 }] },
  });
  assert.equal(change.status, 409);
});

test('validation and guards return structured errors', async () => {
  const invalid = await api('/api/invoices', { method: 'POST', body: { contactId: 1, issueDate: 'nope', lines: [] } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error, 'Validation failed');
  assert.ok(Array.isArray(invalid.data.details));

  const missing = await api('/api/invoices/999999');
  assert.equal(missing.status, 404);
});

test('landing page greets visitors, the app shell greets signed-in users', async () => {
  const { existsSync } = await import('node:fs');
  if (!existsSync(join(ROOT, 'web', 'dist', 'index.html'))) return; // client not built in this environment

  // Anonymous: the marketing page and its CTA into /app.
  const anon = await fetch(`${base}/`);
  const anonHtml = await anon.text();
  assert.equal(anon.status, 200);
  assert.match(anon.headers.get('content-type'), /text\/html/);
  assert.match(anonHtml, /class="hero"/);
  assert.match(anonHtml, /href="\.\/app"/);

  // `/app` always boots the workspace, signed in or not.
  const entry = await fetch(`${base}/app`);
  assert.match(await entry.text(), /id="root"/);

  // With the session cookie from the login test, `/` is the workspace itself.
  const signedIn = await fetch(`${base}/`, { headers: { cookie } });
  assert.match(await signedIn.text(), /id="root"/);
});
