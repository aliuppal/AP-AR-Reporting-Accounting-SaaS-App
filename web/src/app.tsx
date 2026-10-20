import { useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './auth';
import { Icon, Spinner, ToastProvider, useToast } from './ui';
import { Link, matchRoute, RouterProvider, useRouter } from './lib/router';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Documents } from './pages/Documents';
import { DocumentDetail } from './pages/DocumentDetail';
import { Contacts } from './pages/Contacts';
import { Payments } from './pages/Payments';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/invoices', label: 'Receivables', icon: 'invoice' },
  { to: '/bills', label: 'Payables', icon: 'bill' },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/payments', label: 'Payments', icon: 'payments' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
];

const MOBILE_NAV = [
  { to: '/', label: 'Home', icon: 'dashboard' },
  { to: '/invoices', label: 'Sales', icon: 'invoice' },
  { to: '/bills', label: 'Bills', icon: 'bill' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
];

function isActive(path: string, to: string) {
  if (to === '/') return path === '/' || path === '/app';
  return path === to || path.startsWith(`${to}/`);
}

function Routes() {
  const { path } = useRouter();

  // `/app` is the explicit entry point used by the landing page CTAs.
  if (path === '/' || path === '' || path === '/app') return <Dashboard />;
  if (path === '/invoices') return <Documents kind="invoice" />;
  if (path === '/bills') return <Documents kind="bill" />;
  if (path === '/contacts') return <Contacts />;
  if (path === '/payments') return <Payments />;
  if (path === '/reports') return <Reports />;
  if (path === '/settings') return <SettingsPage />;

  const invoice = matchRoute('/invoices/:id', path);
  if (invoice) return <DocumentDetail kind="invoice" id={Number(invoice.id)} />;
  const bill = matchRoute('/bills/:id', path);
  if (bill) return <DocumentDetail kind="bill" id={Number(bill.id)} />;

  return (
    <div className="empty">
      <div style={{ fontSize: 28, fontWeight: 700 }}>404</div>
      <div className="muted">That page does not exist.</div>
      <div style={{ marginTop: 12 }}><Link to="/" className="btn">Back to dashboard</Link></div>
    </div>
  );
}

function Shell() {
  const { path, navigate } = useRouter();
  const { user, settings, logout } = useAuth();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
  }, []);

  useEffect(() => { setMenuOpen(false); }, [path]);

  const title = useMemo(() => {
    if (path === '/' || path === '/app') return 'Dashboard';
    if (path.startsWith('/invoices')) return 'Receivables';
    if (path.startsWith('/bills')) return 'Payables';
    if (path.startsWith('/contacts')) return 'Contacts';
    if (path.startsWith('/payments')) return 'Payments';
    if (path.startsWith('/reports')) return 'Reports';
    if (path.startsWith('/settings')) return 'Settings';
    return 'Ledgerly';
  }, [path]);

  const doLogout = async () => {
    await logout();
    navigate('/');
    toast.push('Signed out');
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div className="stack">
            <div className="brand-name">Ledgerly</div>
            <div className="brand-sub">{settings?.companyName ?? 'Workspace'}</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <div className="nav-label">Workspace</div>
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${isActive(path, item.to) ? 'active' : ''}`}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
          <div className="nav-label">Admin</div>
          <Link to="/settings" className={`nav-item ${isActive(path, '/settings') ? 'active' : ''}`}>
            <Icon name="settings" />
            <span>Settings</span>
          </Link>
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{user?.name?.slice(0, 2).toUpperCase()}</div>
            <div className="stack grow" style={{ minWidth: 0 }}>
              <span className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</span>
              <span className="user-role">{user?.role}</span>
            </div>
            <button type="button" className="icon-btn" onClick={doLogout} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="stack" style={{ minWidth: 0 }}>
            <div className="row gap-8">
              <span className="tiny muted" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>{settings?.companyName}</span>
              <span className="tiny muted">·</span>
              <span className="tiny muted">{today}</span>
            </div>
            <h1 style={{ lineHeight: 1.2 }}>{title}</h1>
          </div>

          <div className="topbar-actions">
            <Link to="/invoices?new=1" className="btn btn-primary btn-sm hide-sm">
              <Icon name="plus" size={15} /> New invoice
            </Link>
            <Link to="/bills?new=1" className="btn btn-sm">
              <Icon name="plus" size={15} /> New bill
            </Link>
            <button type="button" className="icon-btn" style={{ display: 'none' }} aria-hidden="true" />
          </div>
        </header>

        <div className="mobile-top">
          <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={20} />
          </button>
          <div className="brand" style={{ padding: 0, gap: 8 }}>
            <div className="brand-mark" style={{ width: 26, height: 26, fontSize: 13 }}>L</div>
            <span className="brand-name" style={{ color: 'var(--ink)', fontSize: 15 }}>Ledgerly</span>
          </div>
          <div style={{ marginLeft: 'auto' }} className="avatar">{user?.name?.slice(0, 2).toUpperCase()}</div>
        </div>

        <main className="content">
          {/* Keyed by route so each screen animates in once, on the compositor. */}
          <div className="route" key={path}>
            <Routes />
          </div>
        </main>

        <nav className="mobile-nav" aria-label="Mobile">
          {MOBILE_NAV.map((item) => (
            <a key={item.to} href={item.to} className={isActive(path, item.to) ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigate(item.to); }}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </a>
          ))}
          <a href="/settings" className={isActive(path, '/settings') || isActive(path, '/contacts') ? 'active' : ''} onClick={(e) => { e.preventDefault(); setMenuOpen(true); }}>
            <Icon name="menu" size={20} />
            <span>More</span>
          </a>
        </nav>
      </div>

      {menuOpen ? (
        <div className="overlay" style={{ alignItems: 'flex-end', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }}>
          <div className="card sheet" style={{ width: '100%', borderRadius: '16px 16px 0 0', padding: 14, paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{settings?.companyName}</strong>
              <button type="button" className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close"><Icon name="close" size={17} /></button>
            </div>
            {[{ to: '/contacts', label: 'Contacts', icon: 'contacts' }, { to: '/payments', label: 'Payments', icon: 'payments' }, { to: '/settings', label: 'Settings', icon: 'settings' }].map((item) => (
              <Link key={item.to} to={item.to} className="nav-item" style={{ color: 'var(--ink)', padding: '12px 10px' }}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                <Icon name="chevronRight" className="grow" />
              </Link>
            ))}
            <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 6, justifyContent: 'flex-start' }} onClick={doLogout}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><Spinner /></div>;
  }
  if (!user) return <Login />;
  return <Shell />;
}

export function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
