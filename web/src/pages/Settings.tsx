import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { Settings } from '../types';
import { Button, Card, CardHead, Field, Icon, Skeleton, useToast } from '../ui';
import { CURRENCIES, CURRENCY_NAMES, isCurrency } from '../lib/format';
import { useViewCurrency } from '../lib/currency';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Chips({ values, onChange, placeholder }: { values: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return setDraft('');
    onChange([...values, value]);
    setDraft('');
  };
  return (
    <div className="stack gap-8" style={{ gap: 8 }}>
      <div className="row wrap gap-8">
        {values.map((value) => (
          <span key={value} className="badge badge-neutral" style={{ height: 26, gap: 6 }}>
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Remove ${value}`}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'grid' }}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="row gap-8">
        <input
          className="input input-sm"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ maxWidth: 260 }}
        />
        <Button size="sm" onClick={add}><Icon name="plus" size={13} /> Add</Button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { settings, refreshSettings, user, logout } = useAuth();
  const toast = useToast();
  const view = useViewCurrency();
  const [form, setForm] = useState<Settings | null>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setForm(settings); }, [settings]);

  if (!form) {
    return (
      <div className="card card-body stack" style={{ gap: 14 }} role="status" aria-label="Loading settings">
        <Skeleton width={200} height={16} /><Skeleton height={38} radius={8} /><Skeleton height={38} radius={8} /><Skeleton width="60%" height={38} radius={8} />
      </div>
    );
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.put<Settings>('/settings', {
        companyName: form.companyName,
        legalName: form.legalName,
        currency: form.currency,
        locale: form.locale,
        fiscalYearStartMonth: form.fiscalYearStartMonth,
        defaultTermsDays: form.defaultTermsDays,
        defaultTaxRate: form.defaultTaxRate,
        invoicePrefix: form.invoicePrefix,
        billPrefix: form.billPrefix,
        paymentPrefix: form.paymentPrefix,
        revenueCategories: form.revenueCategories,
        expenseCategories: form.expenseCategories,
        paymentMethods: form.paymentMethods,
      });
      await refreshSettings();
      if (isCurrency(form.currency)) view.setCurrency(form.currency);
      toast.push('Settings saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h1>Settings</h1>
          <div className="muted small">Company profile, numbering and ledger categories</div>
        </div>
        <Button variant="primary" onClick={save} disabled={busy}><Icon name="check" size={15} /> {busy ? 'Saving…' : 'Save changes'}</Button>
      </div>

      {error ? <div className="banner banner-neg"><Icon name="alert" size={15} />{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <div className="stack gap-16" style={{ gap: 14 }}>
          <Card>
            <CardHead title="Company profile" sub="Appears on invoices, bills and reports" />
            <div className="card-body">
              <div className="form-grid">
                <div className="col-6">
                  <Field label="Trading name">
                    <input className="input" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
                  </Field>
                </div>
                <div className="col-6">
                  <Field label="Legal name">
                    <input className="input" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Entity registered with the tax authority" />
                  </Field>
                </div>
                <div className="col-4">
                  <Field label="Default currency" hint="New invoices, bills and payments start in this currency">
                    <select className="select" value={isCurrency(form.currency) ? form.currency : 'PKR'} onChange={(e) => set('currency', e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c} — {CURRENCY_NAMES[c]}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="col-4">
                  <Field label="Fiscal year starts">
                    <select className="select" value={form.fiscalYearStartMonth} onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="col-2">
                  <Field label="Terms">
                    <input className="input num" type="number" min="0" max="365" value={form.defaultTermsDays} onChange={(e) => set('defaultTermsDays', Number(e.target.value))} />
                  </Field>
                </div>
                <div className="col-2">
                  <Field label="Tax %">
                    <input className="input num" type="number" min="0" max="100" step="0.25" value={form.defaultTaxRate} onChange={(e) => set('defaultTaxRate', Number(e.target.value))} />
                  </Field>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Document numbering" sub="Next numbers continue automatically per year" />
            <div className="card-body">
              <div className="form-grid">
                <div className="col-4">
                  <Field label="Invoice prefix">
                    <input className="input" value={form.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} />
                  </Field>
                </div>
                <div className="col-4">
                  <Field label="Bill prefix">
                    <input className="input" value={form.billPrefix} onChange={(e) => set('billPrefix', e.target.value.toUpperCase())} />
                  </Field>
                </div>
                <div className="col-4">
                  <Field label="Payment prefix">
                    <input className="input" value={form.paymentPrefix} onChange={(e) => set('paymentPrefix', e.target.value.toUpperCase())} />
                  </Field>
                </div>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>Example: {form.invoicePrefix}-{new Date().getFullYear()}-0042</p>
            </div>
          </Card>

          <Card>
            <CardHead title="Ledger categories" sub="Used to classify invoice and bill lines in reports" />
            <div className="card-body stack gap-16" style={{ gap: 16 }}>
              <Field label="Revenue categories">
                <Chips values={form.revenueCategories} onChange={(v) => set('revenueCategories', v)} placeholder="Add revenue category…" />
              </Field>
              <Field label="Expense categories">
                <Chips values={form.expenseCategories} onChange={(v) => set('expenseCategories', v)} placeholder="Add expense category…" />
              </Field>
              <Field label="Payment methods">
                <Chips values={form.paymentMethods} onChange={(v) => set('paymentMethods', v)} placeholder="Add payment method…" />
              </Field>
            </div>
          </Card>
        </div>

        <div className="stack gap-16" style={{ gap: 14 }}>
          <Card>
            <CardHead title="Signed in as" />
            <div className="card-body stack gap-12" style={{ gap: 10 }}>
              <div className="row gap-8">
                <div className="avatar" style={{ width: 34, height: 34 }}>{user?.name?.slice(0, 2).toUpperCase()}</div>
                <div className="stack" style={{ gap: 1 }}>
                  <span style={{ fontWeight: 550 }}>{user?.name}</span>
                  <span className="small muted">{user?.email}</span>
                </div>
              </div>
              <span className="badge badge-neutral" style={{ alignSelf: 'flex-start' }}>{user?.role}</span>
              <Button size="sm" onClick={() => logout().then(() => window.location.reload())}><Icon name="logout" size={14} /> Sign out</Button>
            </div>
          </Card>

          <Card>
            <CardHead title="About this build" />
            <div className="card-body stack gap-8" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">App</span><span className="small">Ledgerly 1.0</span></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Ledger</span><span className="small">SQLite · single tenant</span></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Clients</span><span className="small">Web, PWA, Capacitor</span></div>
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Amounts are stored as integer cents. Reports use accrual accounting for P&amp;L and cash-basis movement for cash flow.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
