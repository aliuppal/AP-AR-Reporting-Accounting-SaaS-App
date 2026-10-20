import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../http.js';

const settingsSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(160).optional().default(''),
  currency: z.string().trim().length(3),
  locale: z.string().trim().max(20).optional().default('en-US'),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  defaultTermsDays: z.coerce.number().int().min(0).max(365),
  defaultTaxRate: z.coerce.number().min(0).max(100),
  invoicePrefix: z.string().trim().min(1).max(12),
  billPrefix: z.string().trim().min(1).max(12),
  paymentPrefix: z.string().trim().min(1).max(12),
  revenueCategories: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  expenseCategories: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  paymentMethods: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
});

const json = (value, fallback = []) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export function serializeSettings(row) {
  return {
    companyName: row.company_name,
    legalName: row.legal_name,
    currency: row.currency,
    locale: row.locale,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    defaultTermsDays: row.default_terms_days,
    defaultTaxRate: row.default_tax_rate,
    invoicePrefix: row.invoice_prefix,
    billPrefix: row.bill_prefix,
    paymentPrefix: row.payment_prefix,
    revenueCategories: json(row.revenue_categories),
    expenseCategories: json(row.expense_categories),
    paymentMethods: json(row.payment_methods),
    updatedAt: row.updated_at,
  };
}

export function settingsRouter(db) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(serializeSettings(await db.one('SELECT * FROM settings WHERE id = 1')));
  });

  router.put('/', async (req, res) => {
    const body = parse(settingsSchema, req.body);
    await db.query(
      `UPDATE settings SET company_name = $1, legal_name = $2, currency = $3, locale = $4,
              fiscal_year_start_month = $5, default_terms_days = $6, default_tax_rate = $7,
              invoice_prefix = $8, bill_prefix = $9, payment_prefix = $10,
              revenue_categories = $11, expense_categories = $12, payment_methods = $13,
              updated_at = now()
        WHERE id = 1`,
      [
        body.companyName, body.legalName, body.currency.toUpperCase(), body.locale, body.fiscalYearStartMonth,
        body.defaultTermsDays, body.defaultTaxRate, body.invoicePrefix, body.billPrefix, body.paymentPrefix,
        JSON.stringify(body.revenueCategories), JSON.stringify(body.expenseCategories), JSON.stringify(body.paymentMethods),
      ],
    );
    res.json(serializeSettings(await db.one('SELECT * FROM settings WHERE id = 1')));
  });

  return router;
}
