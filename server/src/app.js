import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_COOKIE, authRequired, parseCookies, readSession } from './auth.js';
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
    kind: 'invoice', contactType: 'customer', prefixKey: 'invoice_prefix', stampColumn: 'sent_at',
  }));
  api.use('/bills', documentRouter(db, {
    table: 'bills', lineTable: 'bill_lines', fk: 'bill_id',
    kind: 'bill', contactType: 'vendor', prefixKey: 'bill_prefix', stampColumn: 'approved_at',
  }));
  api.use('/payments', paymentsRouter(db));
  api.use('/reports', reportsRouter(db));
  api.use('/settings', settingsRouter(db));
  api.use('/dashboard', dashboardRouter(db));

  api.use((req, res, next) => next(notFound(`No API route for ${req.method} ${req.originalUrl}`)));

  app.use('/api', api);

  const dist = join(ROOT, 'web', 'dist');
  if (existsSync(dist)) {
    const indexFile = join(dist, 'index.html');
    const landingFile = join(dist, 'landing.html');
    app.use(express.static(dist, { index: false, maxAge: '1h', etag: true }));

    // Marketing entry point for visitors; the signed-in workspace for everyone else.
    app.get('/', (req, res) => {
      const session = readSession(parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE]);
      res.set('Cache-Control', 'no-cache');
      res.sendFile(session && existsSync(indexFile) ? indexFile : landingFile);
    });

    // Explicit app entry so links from the landing page never depend on session state.
    app.get(/^\/app(\/.*)?$/, (req, res) => res.sendFile(indexFile));

    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(indexFile));
  } else {
    app.get('/', (req, res) => res.status(503).type('html').send(
      '<h1>Ledgerly API is running</h1><p>The web client has not been built yet. Run <code>npm run build</code>.</p>',
    ));
  }

  app.use(errorHandler);
  return app;
}
