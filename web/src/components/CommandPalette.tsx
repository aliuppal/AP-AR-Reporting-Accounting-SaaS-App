import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import type { DocumentDoc } from '../types';
import { CURRENCIES, money } from '../lib/format';
import { useViewCurrency } from '../lib/currency';
import { useRouter } from '../lib/router';
import { Icon, StatusBadge } from '../ui';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: 'Go to' | 'Create' | 'Reports' | 'View' | 'Documents';
  keywords?: string;
  run: () => void;
  doc?: DocumentDoc & { kind: 'invoice' | 'bill' };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl K';

/** Opens on Ctrl/⌘+K anywhere in the app. Exposes `setOpen` so a button can trigger it too. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { navigate } = useRouter();
  const { currency, setCurrency } = useViewCurrency();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<(DocumentDoc & { kind: 'invoice' | 'bill' })[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const go = (to: string) => () => { navigate(to); onClose(); };

  const base: Command[] = useMemo(() => [
    { id: 'nav-dash', group: 'Go to', label: 'Dashboard', icon: 'dashboard', keywords: 'home overview', run: go('/') },
    { id: 'nav-ar', group: 'Go to', label: 'Receivables', hint: 'Invoices', icon: 'invoice', keywords: 'invoices sales ar customers', run: go('/invoices') },
    { id: 'nav-ap', group: 'Go to', label: 'Payables', hint: 'Bills', icon: 'bill', keywords: 'bills ap vendors expenses', run: go('/bills') },
    { id: 'nav-contacts', group: 'Go to', label: 'Contacts', icon: 'contacts', keywords: 'customers vendors people', run: go('/contacts') },
    { id: 'nav-pay', group: 'Go to', label: 'Payments', icon: 'payments', keywords: 'cash receipts', run: go('/payments') },
    { id: 'nav-settings', group: 'Go to', label: 'Settings', icon: 'settings', keywords: 'preferences company currency', run: go('/settings') },
    { id: 'new-inv', group: 'Create', label: 'New invoice', icon: 'plus', keywords: 'create bill customer sale', run: go('/invoices?new=1') },
    { id: 'new-bill', group: 'Create', label: 'New bill', icon: 'plus', keywords: 'create vendor expense', run: go('/bills?new=1') },
    { id: 'new-pay', group: 'Create', label: 'Record payment', icon: 'bank', keywords: 'receive pay cash', run: go('/payments?new=1') },
    { id: 'rep-ar', group: 'Reports', label: 'AR aging report', icon: 'reports', keywords: 'receivables aging overdue', run: go('/reports?tab=ar-aging') },
    { id: 'rep-ap', group: 'Reports', label: 'AP aging report', icon: 'reports', keywords: 'payables aging overdue', run: go('/reports?tab=ap-aging') },
    { id: 'rep-pl', group: 'Reports', label: 'Profit & loss', icon: 'reports', keywords: 'p&l pnl income revenue expenses', run: go('/reports?tab=pl') },
    { id: 'rep-cash', group: 'Reports', label: 'Cash flow', icon: 'reports', keywords: 'cash movement in out', run: go('/reports?tab=cash') },
    ...CURRENCIES.filter((c) => c !== currency).map<Command>((c) => ({
      id: `cur-${c}`, group: 'View', label: `Show figures in ${c}`, icon: 'payments', keywords: 'currency switch rupee dollar pkr usd',
      run: () => { setCurrency(c); onClose(); },
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [currency]);

  // Document search by number, reference or contact name, across both currencies.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setDocs([]); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const enc = encodeURIComponent(q);
        const [inv, bills] = await Promise.all([
          api.get<{ items: DocumentDoc[] }>(`/invoices?q=${enc}&limit=5&currency=all`),
          api.get<{ items: DocumentDoc[] }>(`/bills?q=${enc}&limit=5&currency=all`),
        ]);
        if (!cancelled) {
          setDocs([
            ...inv.items.map((d) => ({ ...d, kind: 'invoice' as const })),
            ...bills.items.map((d) => ({ ...d, kind: 'bill' as const })),
          ]);
        }
      } catch {
        if (!cancelled) setDocs([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? base.filter((c) => `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(q))
      : base;
    const docCommands: Command[] = docs.map((d) => ({
      id: `${d.kind}-${d.id}`,
      group: 'Documents',
      label: d.number,
      hint: d.contact?.name ?? '',
      icon: d.kind === 'invoice' ? 'invoice' : 'bill',
      run: go(`/${d.kind === 'invoice' ? 'invoices' : 'bills'}/${d.id}`),
      doc: d,
    }));
    return [...docCommands, ...matched];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, docs, query]);

  useEffect(() => { setActive(0); }, [query, docs.length]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); results[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = '';
  return createPortal(
    <div className="overlay palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, run an action, or search INV-2026-0061…"
            aria-label="Command"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">{searching ? 'Searching…' : `No matches for “${query}”`}</div>
          ) : results.map((cmd, index) => {
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id}>
                {header ? <div className="palette-group">{header}</div> : null}
                <div
                  id={`cmd-${cmd.id}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  className={`palette-item ${index === active ? 'active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={cmd.run}
                >
                  <Icon name={cmd.icon} size={15} />
                  <span className="palette-label">{cmd.label}</span>
                  {cmd.hint ? <span className="palette-hint">{cmd.hint}</span> : null}
                  {cmd.doc ? (
                    <span className="palette-meta">
                      <StatusBadge status={cmd.doc.status} overdue={cmd.doc.isOverdue} />
                      <span className="num">{money(cmd.doc.balanceCents || cmd.doc.totalCents, cmd.doc.currency)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span style={{ marginLeft: 'auto' }}><kbd>{PALETTE_SHORTCUT}</kbd> toggle</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
