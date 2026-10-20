import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { DocStatus } from './types';

/* ------------------------------- Icons ------------------------------- */

const PATHS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  invoice: 'M6 2h9l4 4v16l-3-2-3 2-3-2-3 2V4a2 2 0 0 1 2-2zM15 2v4h4M9 9h6M9 13h6M9 17h3',
  bill: 'M4 3h16v18l-4-2-4 2-4-2-4 2zM8 8h8M8 12h8',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  payments: 'M2 8h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 8l3-4h14l3 4M2 12h20',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  bank: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3',
  menu: 'M3 12h18M3 6h18M3 18h18',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
};

export function Icon({ name, size = 16, className, style }: { name: keyof typeof PATHS | string; size?: number; className?: string; style?: React.CSSProperties }) {
  const d = PATHS[name] ?? PATHS.dashboard;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/* ------------------------------- Badges ------------------------------- */

const STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  partial: 'Part paid',
  paid: 'Paid',
  void: 'Void',
};

export function StatusBadge({ status, overdue = false }: { status: DocStatus; overdue?: boolean }) {
  if (overdue && (status === 'open' || status === 'partial')) {
    return <span className="badge badge-overdue">Overdue</span>;
  }
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/* ------------------------------- Layout bits ------------------------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function CardHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-head">
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <h3>{title}</h3>
        {sub ? <div className="small muted">{sub}</div> : null}
      </div>
      {actions ? <div className="row gap-8" style={{ marginLeft: 'auto' }}>{actions}</div> : null}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1>{title}</h1>
        {sub ? <div className="muted small">{sub}</div> : null}
      </div>
      {actions ? <div className="row gap-8 wrap">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon = 'invoice', title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={18} /></div>
      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      {body ? <div className="small" style={{ marginTop: 4 }}>{body}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Button({ variant = 'default', size, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' }) {
  const cls = ['btn', variant !== 'default' ? `btn-${variant}` : '', size === 'sm' ? 'btn-sm' : ''].filter(Boolean).join(' ');
  return <button type="button" {...rest} className={`${cls} ${rest.className ?? ''}`}>{children}</button>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((opt) => (
        <button key={opt.value} type="button" role="tab" aria-selected={value === opt.value} className={value === opt.value ? 'active' : ''} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="row gap-8 muted small" style={{ padding: 24, justifyContent: 'center' }}>
      <span
        style={{
          width: 15, height: 15, borderRadius: '50%', border: '2px solid var(--line-strong)',
          borderTopColor: 'var(--brand)', display: 'inline-block', animation: 'spin 700ms linear infinite',
        }}
      />
      Loading…
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  title, sub, onClose, children, footer, width = 'md',
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Rendered into <body>: a transformed ancestor (the route transition) would otherwise
  // become the containing block for position:fixed and the dialog could not scroll.
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${width === 'sm' ? 'modal-sm' : width === 'lg' ? '' : 'modal-md'}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="stack grow" style={{ gap: 2 }}>
            <h2>{title}</h2>
            {sub ? <div className="small muted">{sub}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------- Toasts ------------------------------- */

interface ToastItem { id: number; message: string; tone: 'ok' | 'err' }
interface ToastApi { push: (message: string, tone?: 'ok' | 'err') => void }

const ToastContext = createContext<ToastApi>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'err' ? 'err' : ''}`} role="status">
            <Icon name={t.tone === 'err' ? 'alert' : 'check'} size={15} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ------------------------------- Charts ------------------------------- */

export function BarPairChart({
  data, height = 180, currency = 'USD',
}: {
  data: { label: string; a: number; b: number }[];
  height?: number;
  currency?: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const fmt = (v: number) => {
    const n = v / 100;
    if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
    return `$${Math.round(n)}`;
  };
  return (
    <div>
      <div className="bars" style={{ height }} role="img" aria-label="Revenue and expenses by month">
        <div className="bars-grid" aria-hidden="true">
          {[0, 0.5].map((t) => <span key={t} style={{ bottom: `${t * 100}%` }} />)}
        </div>
        {data.map((d, i) => (
          <div
            key={d.label}
            className="bar-group"
            title={`${d.label} · revenue ${fmt(d.a)} · expenses ${fmt(d.b)}`}
          >
            <div className="bar bar-a" style={{ height: `${Math.max((d.a / max) * 100, 0.8)}%`, animationDelay: `${i * 50}ms` }} />
            <div className="bar bar-b" style={{ height: `${Math.max((d.b / max) * 100, 0.8)}%`, animationDelay: `${i * 50 + 70}ms` }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, marginTop: 4 }}>
        {data.map((d) => (
          <div key={d.label} className="tiny muted center">{d.label}</div>
        ))}
      </div>
      <div className="chart-legend" style={{ marginTop: 8 }}>
        <span><i className="legend-dot" style={{ background: '#3cffd0' }} />Revenue</span>
        <span><i className="legend-dot" style={{ background: '#5200ff' }} />Expenses</span>
        <span style={{ marginLeft: 'auto' }} className="num">peak {fmt(max)}</span>
      </div>
    </div>
  );
}

export function AgingBar({ totals }: { totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number } }) {
  const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const segs: { key: keyof typeof totals; label: string }[] = [
    { key: 'current', label: 'Current' },
    { key: 'd1_30', label: '1–30' },
    { key: 'd31_60', label: '31–60' },
    { key: 'd61_90', label: '61–90' },
    { key: 'd90plus', label: '90+' },
  ];
  return (
    <div>
      <div className="aging-bar">
        {segs.map((s, i) => {
          const pct = (totals[s.key] / total) * 100;
          return pct > 0
            ? (
              <div
                key={s.key}
                className={`aging-seg ${s.key}`}
                style={{ width: `${pct}%`, animationDelay: `${i * 70}ms` }}
                title={`${s.label}: ${moneyShort(totals[s.key])}`}
              />
            )
            : null;
        })}
      </div>
      <div className="row wrap gap-12" style={{ marginTop: 10 }}>
        {segs.map((s) => (
          <span key={s.key} className="tiny muted row gap-4">
            <i className="legend-dot" style={{ background: AGING_COLORS[s.key], marginRight: 0 }} />
            <span>{s.label}</span>
            <strong className="num" style={{ color: 'var(--ink-3)' }}>{moneyShort(totals[s.key])}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

const AGING_COLORS = {
  current: '#3cffd0',
  d1_30: '#ffd400',
  d31_60: '#ff8a3d',
  d61_90: '#ff5ca8',
  d90plus: '#5200ff',
};

function moneyShort(cents: number) {
  const value = cents / 100;
  if (Math.abs(value) >= 1000) {
    return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: value >= 100000 ? 0 : 1, notation: 'compact' }).format(value)}`;
  }
  return `$${Math.round(value)}`;
}

export function Money({ cents, currency = 'USD', className = '', compact = false, tone }: { cents: number; currency?: string; className?: string; compact?: boolean; tone?: 'pos' | 'neg' }) {
  const value = (cents ?? 0) / 100;
  const text = new Intl.NumberFormat('en-US', {
    style: 'currency', currency,
    ...(compact && Math.abs(value) >= 10000
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }).format(value);
  return <span className={`num ${tone ? tone : ''} ${className}`}>{text}</span>;
}
