# Ledgerly

Accounts receivable, accounts payable and reporting for small finance teams — one ledger, served to
the browser, installable as a mobile app, and wrapped for native iOS/Android with Capacitor.

![stack](https://img.shields.io/badge/server-Node%2024%20%2B%20Express%205-0f6f61)
![db](https://img.shields.io/badge/storage-Postgres%20(Neon)-0b1220)
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
| **Landing page** | Animated marketing page at `/` for visitors, with product tour, reporting visuals and a test-login hint; the workspace lives at `/app` |

Money is stored as **integer cents** end to end; dates are ISO `YYYY-MM-DD` strings. No floating point
touches a balance.

---

## Quick start

Ledgerly stores its ledger in **Postgres** (developed against Neon). Create `.env` from the template and
paste your connection string:

```bash
npm install
cp .env.example .env       # then set DATABASE_URL
npm run reset              # migrate + seed the demo ledger (first run only)
npm run build              # bundles the React client into web/dist
npm start                  # API + static client on http://127.0.0.1:4100
```

Open <http://127.0.0.1:4100> for the **landing page**, then **Open the app** (or go straight to
<http://127.0.0.1:4100/app>) and sign in with the seeded test account:

```
test@ledgerly.app
test1234
```

The login screen is prefilled with these details, and **Sign in with the test account** logs you in in
one click. `/` serves the landing page to visitors and the workspace to anyone already signed in; `/app`
always boots the app. Exactly one user is seeded — create more with `POST /api/auth/register`.

The schema is created on boot and seeded with ten months of a design studio's ledger
(≈80 invoices, ≈65 bills, ≈100 payments) so every screen has realistic data. Migrations are idempotent
`CREATE TABLE IF NOT EXISTS` statements in `server/src/db.js`; the seed is skipped once a user exists.

### Other commands

| Command | What it does |
| --- | --- |
| `npm start` | Production server: API + built client on one port |
| `npm run build` | Rollup + Babel build of `web/src` → `web/dist` |
| `npm run watch` | Rebuild the client on change |
| `npm run dev` | API with `--watch` plus the client watcher |
| `npm test` | 14 domain + HTTP API tests against a dedicated `ledgerly_test` database |
| `npm run smoke` | Boots the real bundle in jsdom against the running server and asserts the dashboard, invoices, reports and contacts screens render |
| `npm run seed` | Seed an empty database (`-- --force` to reset) |
| `npm run reset` | Truncate and reseed the schema with fresh demo data |
| `npm run typecheck` | TypeScript check of the client (no emit) |
| `npm run audit:motion` | Fails the build if any animation touches a layout/paint property |

Environment variables: `DATABASE_URL` (**required** — Postgres connection string), `PORT` (default
`4100`), `HOST` (`127.0.0.1`), `SESSION_SECRET` (optional; otherwise a key is generated in `data/`),
`LEDGERLY_SEED=0` (skip seeding), `LEDGERLY_TEST_DB` (test database name, default `ledgerly_test`).
`.env` is loaded automatically and is gitignored.

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
│  │  ├─ db.js             Postgres pool, schema, transactions, numbering, totals, allocations
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

- **Postgres (Neon-ready)** — real transactions, foreign keys, `ON CONFLICT` numbering and index-backed
  aging queries, with SSL and a pooled connection out of the box.
- **`pg` + no ORM** — every query is visible in the route or in `db.js`, so the accounting behaviour is
  auditable; amounts are integer cents and `DATE` columns come back as `YYYY-MM-DD` strings.
- **Rollup + Babel** — the client is JSX/TypeScript with no dev server dependency; the bundle is one
  311 kB file (~90 kB gzipped) and the build runs anywhere Node runs.
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

## Design

The interface follows an editorial system inspired by **The Verge**: a near-black canvas with hazard
accents, heavy display type, pill geometry, hairline borders and no elevation.

- **Canvas** `#131313` everywhere — there is no light mode. Secondary surface `#2d2d2d`, body text
  `#ffffff`, metadata `#949494`.
- **Hazards** — Jelly Mint `#3cffd0` for primary actions, paid states and active nav; Ultraviolet
  `#5200ff` for payables/open states and error accents; yellow/pink/orange for aging buckets and tags.
  They are accents, never background washes, and there are **no gradients**.
- **Type** — Anton (display, uppercase, 0.95 line-height as the substitute's metric correction),
  Space Grotesk (UI, 300/400/500/700), JetBrains Mono for every uppercase label, timestamp, table
  header and button. All three are self-hosted under `web/public/fonts/` (latin WOFF2), so the app
  installs and runs offline without a font CDN.
- **Geometry** — 20px cards, 24px feature/modal, 24–40px pills, 2px inputs, 50% circles. No square
  corners, no box-shadows: hierarchy is carried by 1px borders and saturated fills.
- **Interaction** — every link hovers to `#3860be` with no underline; tiles respond with a text-colour
  change and a mint border, never a lift.
- **Landing page** — a 107px masthead wordmark, a StoryStream timeline with mono timestamps on a
  `#3d00bf` rail, and colour-block tiles (mint, ultraviolet, yellow) carrying the product story.

The system is split across three files so the editorial layer can be reviewed on its own:
`web/styles.css` (structure and components), `web/theme-verge.css` (tokens, colour, type, geometry
overrides) and `web/motion.css` (animation only).

---

## Motion & animation

Motion is layered on top of the UI as a separate stylesheet (`web/motion.css`) so the performance
contract is visible in one place, built to the *60fps-animation* rules:

- **Only `transform` and `opacity` animate.** Route changes, staggered rows/KPIs, charts, aging
  segments, the mobile sheet and toasts are all compositor-only. Bars set their height once as data,
  then grow with `scaleY`; aging segments grow with `scaleX` — no `height`/`width` is interpolated.
- **Shadows are gone, so nothing paints one.** The editorial theme removed elevation entirely; the
  previous shadow-fade hover was retired and `.lift` is now a no-op, so hover states only change colour.
- **`will-change` is scoped** to the modal (short-lived, single instance) rather than applied broadly.
- **Reduced motion is honoured twice**: a `prefers-reduced-motion: reduce` block collapses every
  duration, and the landing page also skips its observer/parallax when motion is reduced.
- **No layout thrashing**: the only JS-driven motion is the hero parallax on the landing page, which
  batches a single rect read per pointer event and writes one `transform` inside `requestAnimationFrame`.

`npm run audit:motion` enforces this mechanically — it parses every `transition` and `@keyframes` block
in `web/styles.css`, `web/motion.css` and the landing page, and exits non-zero if a layout or paint
property is animated:

```
Motion audit — 3 files, 15 transitions, 9 keyframe blocks
No layout-thrashing properties animate. Compositor-only contract holds.
```

**Landing page** — <http://127.0.0.1:4100/landing.html> (also linked from the sign-in screen). One
self-contained HTML file: scroll-reveal via `IntersectionObserver`, animated bars/aging, hero parallax,
and an inline freeze harness for deterministic frames:

```
/landing.html?t=0.6      # pin every CSS animation/transition at 0.6s
/landing.html?t=1.4      # settled state
/landing.html?motion=off # final-state render, no motion (screenshot-friendly)
```

The harness reveals all content, then pauses each `getAnimations()` timeline and sets `currentTime`,
so `?t=` frames are reproducible for screenshots. Verification in this environment was structural
(jsdom render + freeze state + the CSS audit); a real browser is needed for pixel screenshots, since
the sandbox blocks launching Chrome/Edge.

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

## Database

The ledger lives in Postgres (developed against Neon, `us-east-2`). Configuration is a single
`DATABASE_URL` in `.env`; the app loads `.env` automatically at boot.

- **Schema** — created by `db.migrate()` on every boot with idempotent `CREATE TABLE IF NOT EXISTS`
  statements (see `SCHEMA` in `server/src/db.js`). No migration files to run.
- **Seeding** — `npm run reset` truncates and rebuilds the demo ledger. It is written as a handful of
  bulk `INSERT … SELECT * FROM unnest(...)` statements, so it takes seconds even over a high-latency link.
- **Numbering** — `INSERT … ON CONFLICT DO UPDATE … RETURNING` on a `counters` row, so concurrent invoice
  creation cannot produce duplicate numbers.
- **Invariants** — foreign keys on `allocations`, `CHECK` constraints for statuses and direction, and a
  `CHECK ((invoice_id IS NOT NULL) <> (bill_id IS NOT NULL))` guard so an allocation points at exactly one document.
- **Types** — money is `integer` cents, dates are `date` (parsed back as `YYYY-MM-DD` strings), timestamps
  are `timestamptz` returned as ISO strings.
- **Tests** — `npm test` needs `DATABASE_URL`; it creates (once) a separate `ledgerly_test` database and
  truncates it per run, so it never touches your ledger.

Because the database is remote, page loads here run 0.6–2 s depending on round-trip time. The pool is
pre-warmed at boot and list endpoints batch their reads, so a page costs a handful of queries rather
than one per row.

---

## Tests

```
$ npm test
# tests 14  pass 14  fail 0        (≈70 s over a remote Neon branch)

$ npm run smoke
Smoke testing http://127.0.0.1:4100
  ok   bundle renders content
  ok   signed-in dashboard is shown
  ok   dashboard KPIs render
  ok   no fatal render errors
  ok   invoices route loads
  ok   invoice rows arrive from the API
  ok   reports route loads
  ok   contacts route loads
  ok   landing page serves
  ok   landing reveals without IntersectionObserver
  ok   landing chart bars carry real heights
  ok   freeze harness pins animations at ?t=
All render smoke checks passed.
```

The API tests cover the full invoice lifecycle (draft → send → partial payment → aging), bill payments,
over-payment rejection, report series arithmetic, CSV export, page routing and validation errors.

---

## Limitations / next steps

- Single tenant, single currency (amounts are not converted); users table is ready for multi-user,
  but roles are not enforced beyond authentication.
- No general-ledger double entry, bank reconciliation, attachments or email delivery of invoices —
  these are the natural next layer on top of `allocations` and `journal`-ready documents.
- Session cookies are `HttpOnly`/`SameSite=Lax` but not `Secure` (local HTTP); enable TLS in production
  and flip that flag.
- The Neon role password used during development was shared in screenshots — rotate it in
  Neon → Roles before this goes anywhere public, then update `.env`.
