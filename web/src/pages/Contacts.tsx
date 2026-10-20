import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Contact } from '../types';
import { initials } from '../lib/format';
import { Button, Card, EmptyState, Icon, Money, Segmented, Spinner } from '../ui';
import { ContactModal } from '../components/ContactModal';

type Filter = 'all' | 'customer' | 'vendor';

export function Contacts() {
  const { settings } = useAuth();
  const currency = settings?.currency ?? 'USD';
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<{ items: Contact[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<{ items: Contact[]; total: number }>(`/contacts?type=${filter}&q=${encodeURIComponent(debounced)}&limit=200`));
    } finally {
      setLoading(false);
    }
  }, [filter, debounced]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 220);
    return () => window.clearTimeout(t);
  }, [search]);

  const items = data?.items ?? [];

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h1>Contacts</h1>
          <div className="muted small">Customers, vendors and their open balances</div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New contact</Button>
      </div>

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'customer', label: 'Customers' }, { value: 'vendor', label: 'Vendors' }]}
        />
        <div className="search">
          <Icon name="search" />
          <input className="input" placeholder="Search contacts…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
        </div>
        <span className="small muted" style={{ marginLeft: 'auto' }}>{data?.total ?? 0} contacts</span>
      </div>

      <Card>
        {loading && !data ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon="contacts" title="No contacts found" body="Add a customer or vendor to start invoicing." action={<Button onClick={() => setCreating(true)}>Add contact</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th className="num">Receivable</th>
                  <th className="num">Payable</th>
                  <th className="num">Overdue</th>
                  <th style={{ width: 28 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((c, index) => (
                  <tr
                    key={c.id}
                    className="clickable enter"
                    style={{ '--enter-delay': `${Math.min(index, 14) * 22}ms` } as React.CSSProperties}
                    onClick={() => setEditing(c)}
                  >
                    <td>
                      <div className="row gap-8">
                        <span className="avatar" style={{ background: 'var(--brand-50)', color: 'var(--brand)', width: 26, height: 26, fontSize: 10.5 }}>
                          {initials(c.name)}
                        </span>
                        <div className="stack" style={{ gap: 1 }}>
                          <span style={{ fontWeight: 550 }}>{c.name}</span>
                          {c.company && c.company !== c.name ? <span className="sub-line">{c.company}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${c.type === 'vendor' ? 'badge-out' : c.type === 'both' ? 'badge-neutral' : 'badge-in'}`}>
                        {c.type === 'both' ? 'Both' : c.type === 'vendor' ? 'Vendor' : 'Customer'}
                      </span>
                    </td>
                    <td>
                      <div className="small">{c.email || '—'}</div>
                      <div className="sub-line">Net {c.termsDays} days</div>
                    </td>
                    <td className="num">{c.openReceivableCents ? <Money cents={c.openReceivableCents} currency={currency} /> : <span className="muted">—</span>}</td>
                    <td className="num">{c.openPayableCents ? <Money cents={c.openPayableCents} currency={currency} /> : <span className="muted">—</span>}</td>
                    <td className="num">{c.overdueCents ? <Money cents={c.overdueCents} currency={currency} className="neg" /> : <span className="muted">—</span>}</td>
                    <td className="cell-actions"><Icon name="chevronRight" size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating ? (
        <ContactModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      ) : null}
      {editing ? (
        <ContactModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onArchived={() => { setEditing(null); load(); }}
        />
      ) : null}
    </div>
  );
}
