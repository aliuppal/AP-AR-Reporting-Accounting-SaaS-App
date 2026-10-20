import { createApp } from './app.js';
import { openDb } from './db.js';
import { seed } from './seed.js';

const db = openDb();

if (process.env.LEDGERLY_SEED !== '0') {
  const result = seed(db);
  if (!result.skipped) console.log('[ledgerly] seeded demo data (demo@ledgerly.app / demo1234)');
}

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp(db);

const server = app.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`[ledgerly] listening on ${url}`);
  console.log(`[ledgerly] sign in with demo@ledgerly.app / demo1234`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[ledgerly] ${signal} received, shutting down`);
    server.close(() => {
      try { db.close(); } catch { /* ignore */ }
      process.exit(0);
    });
  });
}
