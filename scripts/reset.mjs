import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, openDb } from '../server/src/db.js';
import { seed } from '../server/src/seed.js';

for (const file of readdirSync(DATA_DIR).filter((f) => f.startsWith('ledgerly.db'))) {
  rmSync(join(DATA_DIR, file), { force: true });
  console.log(`[reset] removed ${file}`);
}

const db = openDb();
seed(db);
console.log('[reset] database recreated with demo data — demo@ledgerly.app / demo1234');
db.close();
