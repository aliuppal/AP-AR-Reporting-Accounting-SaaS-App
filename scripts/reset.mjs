import { createDb } from '../server/src/db.js';
import { seed } from '../server/src/seed.js';

try { process.loadEnvFile?.('.env'); } catch { /* optional */ }

const db = createDb();
await db.migrate();
const result = await seed(db, { force: true });
console.log(`[reset] database reseeded — ${result.invoices} invoices, ${result.bills} bills, ${result.payments} payments`);
console.log('[reset] sign in with test@ledgerly.app / test1234');
await db.close();
