import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { authRequired } from './auth.js';
import { ROOT } from './db.js';
import { errorHandler, notFound } from './http.js';
import { authRouter } from './routes/auth.js';
import { contactsRouter } from './routes/contacts.js';
import { dashboardRouter } from './routes/dashboard.js';
import { documentRouter } from './routes/documents.js';
import { paymentsRouter } from './routes/payments.js';
import { reportsRouter } from './routes/reports.js';
import { settingsRouter } from './routes/settings.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true, service: 'ledgerly', time: new Date().toISOString() }));

  // Session-aware auth endpoints: /me needs req.user, which authRequired attaches.
  api.use('/auth', (req, res, next) => {
    if (req.path === '/me') return authRequired(db)(req, res, next);
    next();
  }, authRouter(db));

  api.use(authRequired(db));

  api.use('/contacts', contactsRouter(db));
  api.use('/invoices', documentRouter(db, {
    table: 'invoices', lineTable: 'invoice_lines', fk: 'invoice_id',
    kind: 'invoice', contactType: 'customer', prefixKey: 'invoice_prefix',
  }));
  api.use('/bills', documentRouter(db, {
    table: 'bills', lineTable: 'bill_lines', fk: 'bill_id',
    kind: 'bill', contactType: 'vendor', prefixKey: 'bill_prefix',
  }));
  api.use('/payments', paymentsRouter(db));
  api.use('/reports', reportsRouter(db));
  api.use('/settings', settingsRouter(db));
  api.use('/dashboard', dashboardRouter(db));

  api.use((req, res, next) => next(notFound(`No API route for ${req.method} ${req.originalUrl}`)));

  app.use('/api', api);

  const dist = join(ROOT, 'web', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h', etag: true }));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
  } else {
    app.get('/', (req, res) => res.status(503).type('html').send(
      '<h1>Ledgerly API is running</h1><p>The web client has not been built yet. Run <code>npm run build</code>.</p>',
    ));
  }

  app.use(errorHandler);
  return app;
}
