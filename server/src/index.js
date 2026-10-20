import { createApp } from './app.js';
import { createDb } from './db.js';
import { seed } from './seed.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* .env is optional when the environment already provides DATABASE_URL */
}

const db = createDb();
await db.migrate();

// Open connections up front: the first request should not pay for a dozen TLS handshakes.
await Promise.all(Array.from({ length: 12 }, () => db.query('SELECT 1')));

if (process.env.LEDGERLY_SEED !== '0') {
  const result = await seed(db);
  if (!result.skipped) console.log('[ledgerly] seeded demo data (test@ledgerly.app / test1234)');
}

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp(db);

const server = app.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`[ledgerly] landing page  ${url}/`);
  console.log(`[ledgerly] workspace     ${url}/app`);
  console.log('[ledgerly] sign in with  test@ledgerly.app / test1234');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[ledgerly] ${signal} received, shutting down`);
    server.close(async () => {
      try { await db.close(); } catch { /* ignore */ }
      process.exit(0);
    });
  });
}
