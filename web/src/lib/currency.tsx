import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CURRENCIES, CURRENCY_NAMES, DEFAULT_CURRENCY, isCurrency, type Currency } from './format';

/**
 * The currency the workspace is being *viewed* in. Documents each carry their own
 * currency; dashboards, reports, balances and lists show one currency at a time so
 * rupees and dollars are never added together.
 */
interface ViewCurrency {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
}

const STORAGE_KEY = 'ledgerly:view-currency';

const CurrencyContext = createContext<ViewCurrency>({ currency: DEFAULT_CURRENCY, setCurrency: () => {} });

function readStored(): Currency | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isCurrency(value) ? value : null;
  } catch {
    return null;
  }
}

export function CurrencyProvider({ initial, children }: { initial?: string | null; children: ReactNode }) {
  const [currency, setState] = useState<Currency>(() => readStored() ?? (isCurrency(initial) ? initial : DEFAULT_CURRENCY));

  const setCurrency = useCallback((next: Currency) => {
    setState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode: keep in memory */ }
  }, []);

  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export const useViewCurrency = () => useContext(CurrencyContext);

/** PKR | USD toggle shown in the top bar. */
export function CurrencySwitch({ className = '' }: { className?: string }) {
  const { currency, setCurrency } = useViewCurrency();
  return (
    <div className={`segmented currency-switch ${className}`} role="radiogroup" aria-label="Currency shown">
      {CURRENCIES.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={currency === code}
          title={`Show ${CURRENCY_NAMES[code]} figures`}
          className={currency === code ? 'active' : ''}
          onClick={() => setCurrency(code)}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
