import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { DocumentDoc } from '../types';
import { useAuth } from '../auth';
import { formatDate, relativeDue } from '../lib/format';
import { Link, useQueryParam, useRouter } from '../lib/router';
import { Button, Card, EmptyState, Icon, Money, Segmented, Spinner, StatusBadge } from '../ui';
import { DocumentEditor } from '../components/DocumentEditor';

type StatusFilter = 'all' | 'open' | 'overdue' | 'draft' | 'paid';

interface ListResponse {
  items: DocumentDoc[];
  total: number;
  openBalanceCents: number;
  overdueBalanceCents: number;
}

export function Documents({ kind }: { kind: 'invoice' | 'bill' }) {
  const isInvoice = kind === 'invoice';
  const base = isInvoice ? '/invoices' : '/bills';
  const { settings } = useAuth();
  const currency = settings?.currency ?? 'USD';
  const { navigate } = useRouter();
  const newParam = useQueryParam('new');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DocumentDoc | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListResponse>(
        `${base}?status=${status}&q=${encodeURIComponent(debounced)}&limit=${limit}&offset=${page * limit}`,
      );
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [base, status, debounced, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(search); setPage(0); }, 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (newParam === '1') {
      setEditing(null);
      setEditorOpen(true);
      navigate(base, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam, base]);

  const totals = useMemo(() => data ?? { openBalanceCents: 0, overdueBalanceCents: 0, items: [], total: 0 }, [data]);
  const pages = Math.max(1, Math.ceil(totals.total / limit));

  return (
    <div className="stack gap-16" style={{ gap: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h1>{isInvoice ? 'Receivables' : 'Payables'}</h1>
          <div className="muted small">
            {isInvoice ? 'Invoices you have issued to customers' : 'Vendor bills awaiting approval and payment'}
          </div>
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setEditorOpen(true); }}>
          <Icon name="plus" size={15} /> {isInvoice ? 'New invoice' : 'New bill'}
        </Button>
      </div>

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Segmented
          value={status}
          onChange={(v) => { setStatus(v); setPage(0); }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'draft', label: 'Drafts' },
            { value: 'paid', label: 'Paid' },
          ]}
        />
        <div className="search">
          <Icon name="search" />
          <input className="input" placeholder={`Search ${isInvoice ? 'invoices' : 'bills'}…`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        </div>
        <div className="row gap-16" style={{ marginLeft: 'auto' }}>
          <div className="stack" style={{ alignItems: 'flex-end', gap: 0 }}>
            <span className="tiny muted">Open balance</span>
            <Money cents={totals.openBalanceCents} currency={currency} />
          </div>
          <div className="stack" style={{ alignItems: 'flex-end', gap: 0 }}>
            <span className="tiny muted">Overdue</span>
            <Money cents={totals.overdueBalanceCents} currency={currency} className="neg" />
          </div>
        </div>
      </div>

      <Card>
        {loading && !data ? <Spinner /> : totals.items.length === 0 ? (
          <EmptyState
            icon={isInvoice ? 'invoice' : 'bill'}
            title={`No ${isInvoice ? 'invoices' : 'bills'} found`}
            body={search ? 'Try a different search term.' : `Create your first ${isInvoice ? 'invoice' : 'bill'} to get started.`}
            action={<Button variant="primary" onClick={() => { setEditing(null); setEditorOpen(true); }}><Icon name="plus" size={15} /> New {isInvoice ? 'invoice' : 'bill'}</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>{isInvoice ? 'Customer' : 'Vendor'}</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th style={{ width: 28 }} />
                </tr>
              </thead>
              <tbody>
                {totals.items.map((doc, index) => {
                  const due = relativeDue(doc.dueDate, doc.status);
                  return (
                    <tr
                      key={doc.id}
                      className="clickable enter"
                      style={{ '--enter-delay': `${Math.min(index, 14) * 22}ms` } as React.CSSProperties}
                      onClick={() => navigate(`${base}/${doc.id}`)}
                    >
                      <td>
                        <div className="doc-no">{doc.number}</div>
                        {doc.reference ? <div className="sub-line">{doc.reference}</div> : null}
                      </td>
                      <td>
                        <div style={{ fontWeight: 550 }}>{doc.contact?.name ?? '—'}</div>
                        {doc.contact?.company && doc.contact.company !== doc.contact.name ? <div className="sub-line">{doc.contact.company}</div> : null}
                      </td>
                      <td className="muted small nowrap">{formatDate(doc.issueDate)}</td>
                      <td className={due.tone === 'neg' ? 'neg small nowrap' : 'muted small nowrap'}>{formatDate(doc.dueDate)}<div className="tiny">{due.label}</div></td>
                      <td><StatusBadge status={doc.status} overdue={doc.isOverdue} /></td>
                      <td className="num"><Money cents={doc.totalCents} currency={currency} /></td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        <Money cents={doc.balanceCents} currency={currency} />
                      </td>
                      <td className="cell-actions"><Icon name="chevronRight" size={15} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totals.items.length > 0 ? (
          <div className="card-foot row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">
              {page * limit + 1}–{Math.min((page + 1) * limit, totals.total)} of {totals.total}
            </span>
            <div className="row gap-8">
              <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
              <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        ) : null}
      </Card>

      {editorOpen ? (
        <DocumentEditor
          kind={kind}
          doc={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={(saved) => {
            setEditorOpen(false);
            navigate(`${base}/${saved.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
