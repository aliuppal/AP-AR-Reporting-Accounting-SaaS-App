import http from 'node:http';
import pg from 'pg';

try { process.loadEnvFile?.('.env'); } catch { /* optional */ }

// Point the serverless entrypoint at a throwaway database so this test never
// touches the demo ledger.
const url = new URL(process.env.DATABASE_URL);
const TEST_DB = 'ledgerly_vercel_test';

const admin = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
if (!exists.rowCount) await admin.query(`CREATE DATABASE ${TEST_DB}`);
await admin.end();

url.pathname = `/${TEST_DB}`;
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = 'vercel-test-secret-0123456789abcdef';
process.env.LEDGERLY_SEED = '0';

const { default: handler } = await import('../api/index.js');
const { createDb } = await import('../server/src/db.js');
const { seed } = await import('../server/src/seed.js');

// Seed the throwaway database directly (the function itself must not seed).
const seedDb = createDb({ connectionString: process.env.DATABASE_URL, max: 2 });
await seedDb.migrate();
await seed(seedDb, { force: true });
await seedDb.close();

const server = http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error('[handler]', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'handler failed' }));
  });
});
await new Promise((resolve) => server.listen(4300, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:4300';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  const health = await fetch(`${base}/api/health`);
  check('health via serverless handler', health.ok, `${health.status}`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'test@ledgerly.app', password: 'test1234' }),
  });
  const cookie = (login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie') ?? '').split(';')[0];
  check('login sets a session cookie', login.ok && cookie.startsWith('ledgerly_session='), `${login.status}`);

  const headers = { cookie };
  const dash = await (await fetch(`${base}/api/dashboard`, { headers })).json();
  check('dashboard returns the ledger', dash.summary?.receivableCents > 0, `AR ${(dash.summary?.receivableCents ?? 0) / 100}`);
  const inv = await (await fetch(`${base}/api/invoices?limit=5`, { headers })).json();
  check('invoice list works', inv.total > 0, `${inv.total} invoices`);
  const rep = await (await fetch(`${base}/api/reports/aging?type=ar`, { headers })).json();
  check('aging report works', rep.rows?.length > 0, `${rep.rows?.length} rows`);
  const csv = await fetch(`${base}/api/reports/export?report=ar-aging`, { headers });
  check('CSV export works', csv.headers.get('content-type')?.includes('text/csv'), 'text/csv');
  const anon = await fetch(`${base}/api/invoices`);
  check('unauthenticated request is rejected', anon.status === 401, `${anon.status}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nServerless entrypoint is healthy.');
process.exit(failures ? 1 : 0);
