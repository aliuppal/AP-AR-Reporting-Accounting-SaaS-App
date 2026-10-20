# Ledgerly API

Base URL: `http://127.0.0.1:4100/api` · JSON in / JSON out · cookie session (`ledgerly_session`, HttpOnly).

Errors:

```json
{ "error": "Validation failed", "details": [{ "path": "lines.0.quantity", "message": "Expected number" }] }
```

Status codes: `400` validation / business rule, `401` no session, `404` missing, `409` conflict
(e.g. voiding a document that has payments), `500` unexpected.

Amounts are **integer cents**. Dates are `YYYY-MM-DD`.

---

## Auth

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` | Sets the session cookie, returns the user. Seeded test account: `test@ledgerly.app` / `test1234` |
| POST | `/auth/register` | `{ email, name, password }` | Creates a user and signs in |
| POST | `/auth/logout` | — | Clears the cookie (`204`) |
| GET | `/auth/me` | — | Current user |

```bash
curl -c jar.txt -X POST http://127.0.0.1:4100/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"test@ledgerly.app","password":"test1234"}'
```

---

## Contacts

`GET /contacts?type=all|customer|vendor&q=&archived=true&limit=&offset=`

```json
{
  "items": [{
    "id": 1, "type": "customer", "name": "Harbor Dental Group", "company": "Harbor Dental Group",
    "email": "billing@harbordental.com", "phone": "", "address": "", "city": "San Diego",
    "country": "United States", "taxId": "", "termsDays": 30, "notes": "", "archived": false,
    "openReceivableCents": 420000, "openPayableCents": 0, "overdueCents": 420000
  }],
  "total": 15, "limit": 50, "offset": 0
}
```

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/contacts/:id` | Includes the last 20 invoices and bills |
| POST | `/contacts` | `{ type, name, company?, email?, phone?, address?, city?, country?, taxId?, termsDays?, notes? }` |
| PUT | `/contacts/:id` | Same body plus optional `archived` |
| DELETE | `/contacts/:id` | Deletes when the contact has no documents, otherwise archives it |

---

## Invoices (AR) and bills (AP)

Identical shape: `/invoices` (contact must be a customer) and `/bills` (vendor).

`GET /invoices?status=all|open|overdue|paid|draft|void&contactId=&from=&to=&q=&limit=&offset=`

```json
{
  "items": [{
    "id": 12, "number": "INV-2026-0042", "contactId": 3,
    "contact": { "id": 3, "name": "Cedar & Co. Architects", "company": "…", "email": "…" },
    "issueDate": "2026-09-12", "dueDate": "2026-10-12", "status": "partial",
    "currency": "USD", "subtotalCents": 420000, "taxCents": 34650, "discountCents": 0,
    "totalCents": 454650, "paidCents": 200000, "balanceCents": 254650,
    "daysOverdue": 8, "isOverdue": true,
    "lines": [{ "id": 1, "description": "UX audit", "category": "Services", "quantity": 1,
                "unitPriceCents": 420000, "taxRate": 8.25, "amountCents": 420000 }],
    "payments": [{ "paymentId": 8, "number": "PMT-2026-0008", "date": "2026-09-30",
                   "method": "Bank transfer", "amountCents": 200000 }]
  }],
  "total": 38, "limit": 50, "offset": 0,
  "openBalanceCents": 13474400, "overdueBalanceCents": 4384100
}
```

### Create

```bash
curl -b jar.txt -X POST http://127.0.0.1:4100/api/invoices \
  -H 'content-type: application/json' \
  -d '{
    "contactId": 3,
    "issueDate": "2026-10-01",
    "dueDate": "2026-10-31",
    "status": "open",
    "reference": "PO-2231",
    "notes": "Thanks for the workshop.",
    "discountCents": 0,
    "lines": [
      { "description": "Website design sprint", "category": "Services",
        "quantity": 1, "unitPriceCents": 1250000, "taxRate": 8.25 }
    ]
  }'
```

`status` may be `draft` or `open` on create. Totals, numbering and due date (from the contact's terms)
are derived server-side.

### Other operations

| Method | Path | Effect |
| --- | --- | --- |
| PUT | `/invoices/:id` | Replaces header + lines; rejected if the new total is below payments already applied |
| POST | `/invoices/:id/send` | `draft → open`, stamps `sent_at` (bills: `approved_at`) |
| POST | `/invoices/:id/void` | `→ void`; rejects if any payment is applied |
| DELETE | `/invoices/:id` | Only drafts or voided documents without payments |

---

## Payments

`GET /payments?direction=all|in|out&contactId=&from=&to=&q=&limit=&offset=`

```json
{
  "items": [{
    "id": 8, "number": "PMT-2026-0008", "direction": "in", "contactId": 3,
    "contact": { "id": 3, "name": "Cedar & Co. Architects", "company": "…" },
    "date": "2026-09-30", "amountCents": 200000, "allocatedCents": 200000, "unappliedCents": 0,
    "method": "Bank transfer", "reference": "REF-8821", "notes": "",
    "allocations": [{ "id": 11, "docType": "invoice", "docId": 12,
                      "docNumber": "INV-2026-0042", "amountCents": 200000 }]
  }],
  "total": 101, "inflowCents": 52317200, "outflowCents": 21384000
}
```

### Record a payment

```bash
curl -b jar.txt -X POST http://127.0.0.1:4100/api/payments \
  -H 'content-type: application/json' \
  -d '{
    "direction": "in",
    "contactId": 3,
    "date": "2026-10-05",
    "amountCents": 250000,
    "method": "Bank transfer",
    "reference": "ACH-4471",
    "allocations": [{ "docType": "invoice", "docId": 12, "amountCents": 250000 }]
  }'
```

Omit `allocations` to auto-apply **oldest due date first** across the contact's open documents;
anything left over stays as unapplied credit.

`DELETE /payments/:id` removes the payment, reverses every allocation and recomputes the documents.

---

## Reports

### `GET /reports/summary?asOf=`

```json
{
  "asOf": "2026-10-20",
  "receivableCents": 13474400, "receivableOverdueCents": 4384100,
  "payableCents": 3174400, "payableOverdueCents": 1200000,
  "openInvoiceCount": 16, "openBillCount": 9,
  "revenueYtdCents": 56090000, "expenseYtdCents": 25397000, "netYtdCents": 30693000,
  "cashIn30Cents": 6100000, "cashOut30Cents": 2200000,
  "dsoDays": 76.9, "dpoDays": 37.4, "workingCapitalCents": 10300000
}
```

### `GET /reports/aging?type=ar|ap&asOf=`

```json
{
  "type": "ar", "asOf": "2026-10-20",
  "buckets": [{ "key": "current", "label": "Current" }, { "key": "d1_30", "label": "1–30 days" }],
  "rows": [{
    "contactId": 3, "contactName": "Cedar & Co. Architects", "company": "Cedar & Co. Architects",
    "current": 0, "d1_30": 420000, "d31_60": 0, "d61_90": 254650, "d90plus": 0,
    "total": 674650, "oldestDays": 68, "documentCount": 2
  }],
  "totals": { "current": 9000000, "d1_30": 1400000, "d31_60": 950000, "d61_90": 950000, "d90plus": 1174400, "total": 13474400 },
  "overdueCents": 4474400, "currentCents": 9000000, "documentCount": 16
}
```

### `GET /reports/profit-loss?from=&to=`

Monthly series plus category breakdown; totals include `marginPct` and `discountCents`.

### `GET /reports/cash-flow?from=&to=`

Monthly `inflowCents`, `outflowCents`, `netCents`, `cumulativeCents`, plus period totals.

### `GET /reports/contact-balances?type=ar|ap&asOf=`

Same payload as aging, for balance-per-contact tables.

### `GET /reports/export?report=ar-aging|ap-aging|profit-loss|cash-flow&…`

Returns `text/csv` with a `Content-Disposition` filename. Amounts are formatted as decimals
(e.g. `1250.00`) so spreadsheets parse them as numbers.

---

## Settings

`GET /settings` · `PUT /settings`

```json
{
  "companyName": "Northwind Studio", "legalName": "Northwind Studio LLC",
  "currency": "USD", "locale": "en-US",
  "fiscalYearStartMonth": 1, "defaultTermsDays": 30, "defaultTaxRate": 8.25,
  "invoicePrefix": "INV", "billPrefix": "BILL", "paymentPrefix": "PMT",
  "revenueCategories": ["Services", "Products", "Retainers", "Other"],
  "expenseCategories": ["Software", "Rent", "Payroll", "Marketing", "Travel", "Utilities", "Professional Fees", "Other"],
  "paymentMethods": ["Bank transfer", "Credit card", "Cash", "Cheque", "Other"]
}
```

Prefixes drive document numbering: `INV-2026-0042`, continuing per year per document type.

---

## Dashboard

`GET /dashboard` returns everything the home screen needs in one round trip: `summary`, `aging.ar`,
`aging.ap`, six months of `trend` (P&L shape) and `cash` (cash-flow shape), plus `recentInvoices`,
`recentBills` and the six largest `topOverdue` documents.
