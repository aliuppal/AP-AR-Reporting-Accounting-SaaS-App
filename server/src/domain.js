/** Shared domain rules: money in integer cents, dates as YYYY-MM-DD strings. */

export const DAY_MS = 86400000;

export function today() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error(`Invalid date: ${value}`);
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmtDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtDate(d);
}

export function diffDays(a, b) {
  return Math.round((parseDate(a) - parseDate(b)) / DAY_MS);
}

export function monthKey(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function startOfMonth(dateStr) {
  return `${String(dateStr).slice(0, 7)}-01`;
}

export function endOfMonth(dateStr) {
  const d = parseDate(startOfMonth(dateStr));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fmtDate(d);
}

/** Inclusive list of YYYY-MM keys between two dates. */
export function monthsBetween(from, to) {
  const out = [];
  const cur = parseDate(startOfMonth(from));
  const end = parseDate(startOfMonth(to));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

export function agingBucket(daysPastDue) {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'd90plus';
}

export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90plus', label: '90+ days' },
];

/**
 * Compute document totals from line items. Mirrors the SQL recompute in db.js.
 * @param {{quantity:number, unitPriceCents:number, taxRate:number}[]} lines
 */
export function computeTotals(lines, discountCents = 0) {
  const normalized = lines.map((l) => {
    const amount = Math.round(Number(l.quantity) * Number(l.unitPriceCents));
    return { ...l, amountCents: amount, taxCents: Math.round((amount * Number(l.taxRate || 0)) / 100) };
  });
  const subtotal = normalized.reduce((s, l) => s + l.amountCents, 0);
  const tax = normalized.reduce((s, l) => s + l.taxCents, 0);
  const discount = Math.min(Math.max(0, Math.round(discountCents)), subtotal);
  return { lines: normalized, subtotalCents: subtotal, taxCents: tax, discountCents: discount, totalCents: subtotal - discount + tax };
}

export function deriveStatus({ currentStatus, totalCents, paidCents }) {
  if (currentStatus === 'draft' || currentStatus === 'void') return currentStatus;
  if (totalCents > 0 && paidCents >= totalCents) return 'paid';
  if (paidCents > 0) return 'partial';
  return 'open';
}

export function isOverdue(doc, asOf = today()) {
  return ['open', 'partial'].includes(doc.status) && doc.balanceCents > 0 && diffDays(doc.dueDate, asOf) > 0;
}

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const head = headers.map((h) => csvEscape(h.label)).join(',');
  const body = rows.map((row) => headers.map((h) => csvEscape(row[h.key])).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

export function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}
