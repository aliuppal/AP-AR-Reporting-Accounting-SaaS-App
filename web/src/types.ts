export type ContactType = 'customer' | 'vendor' | 'both';
export type DocStatus = 'draft' | 'open' | 'partial' | 'paid' | 'void';
export type Direction = 'in' | 'out';

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface Contact {
  id: number;
  type: ContactType;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  taxId: string;
  termsDays: number;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  openReceivableCents: number;
  openPayableCents: number;
  overdueCents: number;
}

export interface ContactDetail extends Contact {
  invoices: DocSummary[];
  bills: DocSummary[];
}

export interface DocSummary {
  id: number;
  number: string;
  issueDate: string;
  dueDate: string;
  status: DocStatus;
  totalCents: number;
  balanceCents: number;
}

export interface LineItem {
  id?: number;
  description: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  taxRate: number;
  amountCents?: number;
}

export interface DocumentDoc {
  id: number;
  number: string;
  contactId: number;
  contact: { id: number; name: string; company: string; email: string } | null;
  issueDate: string;
  dueDate: string;
  status: DocStatus;
  currency: string;
  notes: string;
  reference: string;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  daysOverdue: number;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  lines: LineItem[];
  payments: { paymentId: number; number: string; date: string; method: string; amountCents: number }[];
}

export interface Payment {
  id: number;
  number: string;
  direction: Direction;
  contactId: number;
  contact: { id: number; name: string; company: string } | null;
  date: string;
  amountCents: number;
  allocatedCents: number;
  unappliedCents: number;
  method: string;
  reference: string;
  notes: string;
  createdAt: string;
  allocations: { id: number; docType: 'invoice' | 'bill'; docId: number; docNumber: string; amountCents: number }[];
}

export interface Settings {
  companyName: string;
  legalName: string;
  currency: string;
  locale: string;
  fiscalYearStartMonth: number;
  defaultTermsDays: number;
  defaultTaxRate: number;
  invoicePrefix: string;
  billPrefix: string;
  paymentPrefix: string;
  revenueCategories: string[];
  expenseCategories: string[];
  paymentMethods: string[];
  updatedAt: string;
}

export interface Summary {
  asOf: string;
  receivableCents: number;
  receivableOverdueCents: number;
  payableCents: number;
  payableOverdueCents: number;
  openInvoiceCount: number;
  openBillCount: number;
  revenueYtdCents: number;
  expenseYtdCents: number;
  netYtdCents: number;
  cashIn30Cents: number;
  cashOut30Cents: number;
  dsoDays: number;
  dpoDays: number;
  workingCapitalCents: number;
}

export interface AgingBucketTotals {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

export interface AgingRow {
  contactId: number;
  contactName: string;
  company: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
  oldestDays: number;
  documentCount: number;
}

export interface AgingReport {
  type: 'ar' | 'ap';
  asOf: string;
  buckets: { key: string; label: string }[];
  rows: AgingRow[];
  totals: AgingBucketTotals;
  overdueCents: number;
  currentCents: number;
  documentCount: number;
}

export interface ProfitLoss {
  from: string;
  to: string;
  series: { period: string; revenueCents: number; expenseCents: number; netCents: number }[];
  revenueByCategory: { category: string; amountCents: number }[];
  expenseByCategory: { category: string; amountCents: number }[];
  totals: { revenueCents: number; expenseCents: number; netCents: number; marginPct: number; discountCents: number };
}

export interface CashFlow {
  from: string;
  to: string;
  series: { period: string; inflowCents: number; outflowCents: number; netCents: number; cumulativeCents: number }[];
  totals: { inflowCents: number; outflowCents: number; netCents: number };
}

export interface Dashboard {
  summary: Summary;
  aging: { ar: AgingBucketTotals; ap: AgingBucketTotals };
  trend: ProfitLoss;
  cash: CashFlow;
  recentInvoices: RecentDoc[];
  recentBills: RecentDoc[];
  topOverdue: RecentDoc[];
}

export interface RecentDoc {
  id: number;
  number: string;
  contactId: number;
  contactName: string;
  issueDate: string;
  dueDate: string;
  status: DocStatus;
  totalCents: number;
  balanceCents: number;
  daysOverdue: number;
  kind: 'invoice' | 'bill';
}
