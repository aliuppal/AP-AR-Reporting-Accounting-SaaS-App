import { useState } from 'react';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { Button, Field, Icon, Input } from '../ui';

/** Build stamp injected into the HTML by scripts/build.mjs — proves which bundle is running. */
function buildStamp() {
  const meta = document.querySelector('meta[name="ledgerly-build"]');
  return meta?.getAttribute('content') ?? 'dev';
}

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('test@ledgerly.app');
  const [password, setPassword] = useState('test1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in — ' + (err as Error).message + '. If the page looks outdated, hard-refresh (Ctrl/Cmd+Shift+R).');
    } finally {
      setBusy(false);
    }
  };

  const signInWithTestAccount = async () => {
    setEmail('test@ledgerly.app');
    setPassword('test1234');
    setBusy(true);
    setError('');
    try {
      await login('test@ledgerly.app', 'test1234');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in — ' + (err as Error).message + '. If the page looks outdated, hard-refresh (Ctrl/Cmd+Shift+R).');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="row gap-10" style={{ gap: 10 }}>
          <div className="brand-mark" style={{ width: 38, height: 38, fontSize: 17 }}>L</div>
          <div className="stack">
            <span className="brand-name" style={{ fontSize: 18 }}>Ledgerly</span>
            <span className="brand-sub">Receivables · Payables · Reporting</span>
          </div>
        </div>

        <div className="stack gap-16" style={{ marginTop: 30 }}>
          <span className="tiny" style={{ color: '#949494', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Everything in one ledger</span>
          <div className="stack gap-12">
            {[
              ['Invoice customers and track every dollar owed', 'invoice'],
              ['Approve vendor bills and schedule payables', 'bill'],
              ['Age your AR/AP and report P&L in real time', 'reports'],
            ].map(([text, icon]) => (
              <div key={text} className="row gap-10" style={{ gap: 10, color: '#e9e9e9', fontSize: 13.5 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(60,255,208,0.14)', display: 'grid', placeItems: 'center', color: '#3cffd0', flex: 'none' }}>
                  <Icon name={icon} size={14} />
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>

        <div className="auth-quote">
          “Close the books without closing your laptop.”
          <div className="small" style={{ color: '#949494', marginTop: 10 }}>Built for small finance teams — web and mobile.</div>
        </div>
      </aside>

      <div className="auth-main">
        <div className="auth-card stack gap-24" style={{ gap: 24 }}>
          <div className="stack" style={{ gap: 6 }}>
            <h2>Sign in to your workspace</h2>
            <p className="muted small">Use the demo account below, or your own credentials.</p>
          </div>

          <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
            <Field label="Work email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            </Field>
            <Field label="Password">
              <div style={{ position: 'relative' }}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  style={{ position: 'absolute', right: 3, top: 3 }}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'close' : 'check'} size={15} />
                </button>
              </div>
            </Field>

            {error ? <div className="banner banner-neg">{error}</div> : null}

            <Button variant="primary" type="submit" disabled={busy} style={{ height: 40, marginTop: 4 }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="demo-note">
            <strong>Test account</strong><br />
            <span className="num">test@ledgerly.app</span> · <span className="num">test1234</span><br />
            <span className="small">Seeded with 10 months of invoices, bills and payments.</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={signInWithTestAccount}
              disabled={busy}
              style={{ marginTop: 10, width: '100%' }}
            >
              <Icon name="check" size={14} /> {busy ? 'Signing in…' : 'Sign in with the test account'}
            </button>
          </div>

          <a href="/landing.html" className="small muted" style={{ textAlign: 'center' }}>
            Not ready to sign in? Take the animated tour →
          </a>

          <div className="tiny muted" style={{ textAlign: 'center' }} data-build={buildStamp()}>
            build {buildStamp()}
          </div>
        </div>
      </div>
    </div>
  );
}
