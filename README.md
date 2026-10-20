# Ledgerly

Accounts receivable, accounts payable and reporting for small finance teams — one ledger, served to
the browser, installable as a mobile app, and wrapped for native iOS/Android with Capacitor.

![stack](https://img.shields.io/badge/server-Node%2024%20%2B%20Express%205-0f6f61)
![db](https://img.shields.io/badge/storage-SQLite%20(node%3Asqlite)-0b1220)
![client](https://img.shields.io/badge/client-React%2019%20%2B%20Rollup-0f6f61)

---

## What is included

| Area | Capability |
| --- | --- |
| **Receivables** | Customers, invoices with line items, tax and discounts, draft → sent → part paid → paid lifecycle, voiding, printing |
| **Payables** | Vendors, bills, approval flow, payment scheduling, part payments |
| **Payments** | Customer receipts and vendor payments, automatic oldest-first application, manual allocations, unapplied credit, delete with reversal |
| **Reporting** | AR/AP aging (current, 1–30, 31–60, 61–90, 90+), profit & loss by month and category, cash flow with cumulative balance, DSO/DPO, CSV export, print layouts |
| **Dashboard** | Outstanding AR/AP, overdue, working capital, 30-day cash movement, revenue vs expense trend, aging summary, largest overdue items |
| **Platform** | Responsive web UI (sidebar on desktop, bottom tabs on mobile), installable PWA with offline shell, Capacitor config for native shells, cookie sessions |

Money is stored as **integer cents** end to end; dates are ISO `YYYY-MM-DD` strings. No floating point
touches a balance.

---

## Quick start

```bash
npm install
npm run build      # bundles the React client into web/dist
npm start          # API + static client on http://127.0.0.1:4100
```

Open <http://127.0.0.1:4100> and sign in with:

```
demo@ledgerly.app
demo1234
```

The database is created on first boot and seeded with ten months of a design studio's ledger
(≈80 invoices, ≈65 bills, ≈100 payments) so every screen has realistic data.

### Other commands

| Command | What it does |
| --- | --- |
| `npm start` | Production server: API + built client on one port |
| `npm run build` | Rollup + Babel build of `web/src` → `web/dist` |
| `npm run watch` | Rebuild the client on change |
| `npm run dev` | API with `--watch` plus the client watcher |
| `npm test` | 13 domain + HTTP API tests (node:test, in-process) |
| `npm run smoke` | Boots the real bundle in jsdom against the running server and asserts the dashboard, invoices, reports and contacts screens render |
| `npm run seed` | Seed an empty database (`-- --force` to reset) |
| `npm run reset` | Delete and recreate the database with fresh demo data |
| `npm run typecheck` | TypeScript check of the client (no emit) |

Environment variables: `PORT` (default `4100`), `HOST` (`127.0.0.1`), `LEDGERLY_DB` (database path),
`LEDGERLY_DATA_DIR`, `LEDGERLY_SEED=0` (skip seeding).

---

## Architecture

```
ledgerly/
├─ server/
│  ├─ src/
│  │  ├─ app.js            Express app: auth gate, API routers, static client, SPA fallback
│  │  ├─ index.js          boot: migrate → seed → listen → graceful shutdown
│  │  ├─ db.js             schema, transactions, numbering, document totals, payment allocation
│  │  ├─ domain.js         cents math, date helpers, aging buckets, CSV
│  │  ├─ auth.js           scrypt passwords + HMAC-signed session cookies
│  │  ├─ http.js           ApiError, zod validation bridge, pagination, error handler
│  │  ├─ routes/           auth, contacts, documents (invoices|bills), payments, reports, settings, dashboard
│  │  └─ seed.js           deterministic 10-month demo ledger
│  └─ test/                domain.test.js + api.test.js (node:test)
├─ web/
│  ├─ index.html           app shell, PWA metadata, boot splash
│  ├─ styles.css           design system (tokens, layout, tables, mobile, print)
│  ├─ public/              manifest.webmanifest, service worker
│  └─ src/
│     ├─ app.tsx           shell, navigation, routing table
│     ├─ auth.tsx          session context
│     ├─ api.ts            typed fetch client
│     ├─ ui.tsx            icons, buttons, modals, toasts, charts, badges
│     ├─ lib/              formatting (money, dates, relative due) and a ~90-line router
│     ├─ components/       document editor, payment modal, contact modal
│     └─ pages/            dashboard, documents, document detail, contacts, payments, reports, settings, login
├─ scripts/                build.mjs (Rollup+Babel), icons.mjs (PNG generator), smoke.mjs, reset.mjs, dev.mjs
└─ capacitor.config.ts     native shell configuration
```

### Why this stack

- **`node:sqlite`** — real SQL transactions, foreign keys and constraints with zero native builds.
- **Rollup + Babel** — the client is JSX/TypeScript with no dev server dependency; the bundle is one
  310 kB file (~90 kB gzipped) and the build runs anywhere Node runs.
- **Hand-written design system** — CSS variables + a handful of primitives instead of a framework, so
  the accounting tables, print layout and mobile breakpoints behave exactly as intended.
- **No ORM** — the schema, numbering and allocation rules are visible in `db.js`, which makes the
  accounting behaviour auditable.

---

## Accounting rules implemented

- **Document totals**: `subtotal = Σ round(qty × rate)`, tax per line, `total = subtotal − discount + tax`.
  The server always recomputes; client-submitted totals are never trusted.
- **Status**: `draft` and `void` are manual; everything else is derived from allocations —
  `paid ≥ total → paid`, `paid > 0 → partial`, otherwise `open`. "Overdue" is derived from the due date.
- **Payments** are applied to documents through `allocations`, which keep invoices and bills consistent
  (foreign keys both ways, one target per row). Deleting a payment reverses every allocation and
  recomputes the affected documents.
- **Aging** buckets by days past due as of the report date: current, 1–30, 31–60, 61–90, 90+.
- **P&L** is accrual: invoice lines (excluding drafts/void) less bill lines, grouped by month and category,
  with discounts subtracted from revenue.
- **Cash flow** is cash basis: payments in/out by month with a cumulative balance.
- **DSO / DPO**: open AR (or AP) ÷ trailing-90-day revenue (or expenses) per day.

---

## Web and mobile

**Web** — responsive down to 360 px: the sidebar becomes a bottom tab bar, tables convert to stacked
cards, editors become bottom sheets, and the print stylesheet strips chrome for PDF-ready documents.

**PWA** — `manifest.webmanifest` + service worker. On a phone, open the URL and use *Add to Home Screen*
(or the browser's install prompt). The shell is cached; API responses are never cached, because
accounting data must always be fresh.

**Native** — the Capacitor config points at `web/dist`:

```bash
npm run build
npx cap add ios        # or: npx cap add android
npx cap sync
npx cap open ios
```

While developing against a local API from a device, uncomment `server.url` in `capacitor.config.ts`
(`http://10.0.2.2:4100` for the Android emulator).

---

## API

JSON over `/api`, cookie session, `zod`-validated input, structured errors
(`{ error, details: [{ path, message }] }`). Full reference with examples: [docs/API.md](docs/API.md).

```
POST   /api/auth/login | /logout | /register        GET /api/auth/me
GET    /api/contacts        POST /api/contacts      PUT/DELETE /api/contacts/:id
GET    /api/invoices        POST /api/invoices      GET/PUT/DELETE /api/invoices/:id
POST   /api/invoices/:id/send | /void
GET    /api/bills           POST /api/bills         GET/PUT/DELETE /api/bills/:id
POST   /api/bills/:id/send | /void
GET    /api/payments        POST /api/payments      GET/DELETE /api/payments/:id
GET    /api/reports/summary | aging | profit-loss | cash-flow | contact-balances | export
GET    /api/dashboard       GET/PUT /api/settings
```

---

## Tests

```
$ npm test
# tests 13  pass 13  fail 0

$ npm run smoke
Smoke testing http://127.0.0.1:4100
  ok   bundle renders content
  ok   signed-in dashboard is shown
  ok   dashboard KPIs render
  ok   no fatal render errors
  ok   invoices route loads
  ok   reports route loads
  ok   contacts route loads
All render smoke checks passed.
```

The API tests cover the full invoice lifecycle (draft → send → partial payment → aging), bill payments,
over-payment rejection, report series arithmetic, CSV export and validation errors.

---

## Limitations / next steps

- Single tenant, single currency (amounts are not converted); users table is ready for multi-user,
  but roles are not enforced beyond authentication.
- No general-ledger double entry, bank reconciliation, attachments or email delivery of invoices —
  these are the natural next layer on top of `allocations` and `journal`-ready documents.
- Session cookies are `HttpOnly`/`SameSite=Lax` but not `Secure` (local HTTP); enable TLS in production
  and flip that flag.
