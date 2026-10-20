export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function money(cents: number | null | undefined, currency = 'USD', opts: { compact?: boolean; sign?: boolean } = {}) {
  const value = (cents ?? 0) / 100;
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts.compact && abs >= 10000) {
    const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 1, notation: 'compact' });
    return compact.format(value);
  }
  const out = formatter.format(value);
  return opts.sign && value > 0 ? `+${out}` : out;
}

export function moneyShort(cents: number, currency = 'USD') {
  const value = (cents ?? 0) / 100;
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: value >= 100000 ? 0 : 1, notation: 'compact' }).format(value);
  }
  return money(cents, currency);
}

export function parseMoneyInput(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  return Math.round(Number.parseFloat(cleaned) * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatDate(date: string | null | undefined, style: 'short' | 'medium' | 'long' = 'medium') {
  if (!date) return '—';
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(date);
  if (style === 'short') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (style === 'long') return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function relativeDue(dueDate: string, status: string): { label: string; tone: 'neg' | 'warn' | 'muted' | 'pos' } {
  if (status === 'paid' || status === 'void') return { label: '—', tone: 'muted' };
  const days = Math.round((new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'neg' };
  if (days === 0) return { label: 'Due today', tone: 'warn' };
  if (days <= 7) return { label: `Due in ${days}d`, tone: 'warn' };
  return { label: `Due ${formatDate(dueDate, 'short')}`, tone: 'muted' };
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function addDaysISO(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfYearISO(date = todayISO()) {
  return `${date.slice(0, 4)}-01-01`;
}

export function startOfMonthISO(date = todayISO()) {
  return `${date.slice(0, 7)}-01`;
}

export function sum(values: number[]) {
  return values.reduce((acc, v) => acc + v, 0);
}
