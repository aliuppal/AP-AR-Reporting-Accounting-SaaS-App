import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, agingBucket, computeTotals, deriveStatus, monthsBetween, toCsv } from '../src/domain.js';

test('computeTotals totals lines, tax and discount in cents', () => {
  const result = computeTotals(
    [
      { description: 'Design', quantity: 2, unitPriceCents: 150000, taxRate: 10 },
      { description: 'Hosting', quantity: 1, unitPriceCents: 50000, taxRate: 0 },
    ],
    25000,
  );
  assert.equal(result.subtotalCents, 350000);
  assert.equal(result.taxCents, 30000);
  assert.equal(result.discountCents, 25000);
  assert.equal(result.totalCents, 355000);
});

test('discount cannot exceed subtotal', () => {
  const result = computeTotals([{ description: 'x', quantity: 1, unitPriceCents: 1000, taxRate: 0 }], 5000);
  assert.equal(result.discountCents, 1000);
  assert.equal(result.totalCents, 0);
});

test('aging buckets follow the 30/60/90 convention', () => {
  assert.equal(agingBucket(-5), 'current');
  assert.equal(agingBucket(0), 'current');
  assert.equal(agingBucket(1), 'd1_30');
  assert.equal(agingBucket(30), 'd1_30');
  assert.equal(agingBucket(31), 'd31_60');
  assert.equal(agingBucket(60), 'd31_60');
  assert.equal(agingBucket(61), 'd61_90');
  assert.equal(agingBucket(91), 'd90plus');
});

test('deriveStatus moves open -> partial -> paid', () => {
  assert.equal(deriveStatus({ currentStatus: 'open', totalCents: 100, paidCents: 0 }), 'open');
  assert.equal(deriveStatus({ currentStatus: 'open', totalCents: 100, paidCents: 40 }), 'partial');
  assert.equal(deriveStatus({ currentStatus: 'partial', totalCents: 100, paidCents: 100 }), 'paid');
  assert.equal(deriveStatus({ currentStatus: 'draft', totalCents: 100, paidCents: 0 }), 'draft');
  assert.equal(deriveStatus({ currentStatus: 'void', totalCents: 100, paidCents: 0 }), 'void');
});

test('date helpers and month ranges', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.deepEqual(monthsBetween('2026-01-15', '2026-04-02'), ['2026-01', '2026-02', '2026-03', '2026-04']);
});

test('csv escaping quotes commas and newlines', () => {
  const csv = toCsv(
    [{ key: 'name', label: 'Name' }, { key: 'amount', label: 'Amount' }],
    [{ name: 'Acme, Inc.', amount: 12 }, { name: 'Line\nBreak', amount: 3 }],
  );
  assert.equal(csv, 'Name,Amount\r\n"Acme, Inc.",12\r\n"Line\nBreak",3');
});
