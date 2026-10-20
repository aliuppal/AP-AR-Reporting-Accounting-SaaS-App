/**
 * Headless render smoke test.
 *
 * Boots the real bundle in jsdom against a running server, so a broken page
 * (bad import, render crash, missing route) fails here instead of in a browser.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */
import { JSDOM, CookieJar, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const base = (process.argv[2] ?? process.env.LEDGERLY_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
const failures = [];
const consoleErrors = [];

function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function waitFor(fn, { timeout = 12000, interval = 120 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      if (fn()) return true;
    } catch { /* keep polling */ }
    if (Date.now() - started > timeout) return false;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'demo@ledgerly.app', password: 'demo1234' }),
});
const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
if (!login.ok || !setCookie) {
  console.error('Could not sign in to the running server:', login.status);
  process.exit(1);
}
const sessionCookie = setCookie.split(';')[0];

const jar = new CookieJar();
await jar.setCookie(sessionCookie, base);

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (err) => consoleErrors.push(err.message));
virtualConsole.on('error', (msg) => consoleErrors.push(String(msg)));

// jsdom does not execute <script type="module">, so load the HTML and evaluate
// the built bundle ourselves. The bundle is a single self-contained chunk.
const page = await fetch(`${base}/`, { headers: { cookie: sessionCookie } });
const html = await page.text();
const bundle = readFileSync(join(root, 'web', 'dist', 'app.js'), 'utf8');

const dom = new JSDOM(html, {
  url: `${base}/`,
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  cookieJar: jar,
  virtualConsole,
  beforeParse(window) {
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, base);
      const headers = { ...(init.headers ?? {}), cookie: jar.getCookieStringSync(url.href) };
      return fetch(url, { ...init, headers });
    };
    window.matchMedia = () => ({
      matches: false, media: '', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
    window.scrollTo = () => {};
  },
});

const { window } = dom;
window.eval(bundle);
const text = () => window.document.body.textContent.replace(/\s+/g, ' ').trim();

console.log(`Smoke testing ${base}`);
await new Promise((resolve) => {
  if (window.document.readyState === 'complete') resolve();
  else window.addEventListener('load', resolve, { once: true });
});

const rendered = await waitFor(() => text().length > 80);
check('bundle renders content', rendered, `${text().length} chars`);
check('signed-in dashboard is shown', await waitFor(() => /Receivables outstanding/i.test(text())));
check('dashboard KPIs render', /Working capital/i.test(text()) && /Net cash/i.test(text()));
check('no fatal render errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

// Client-side navigation to a document list and a report.
window.history.pushState({}, '', '/invoices');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('invoices route loads', await waitFor(() => /Receivables/i.test(text()) && /Open balance/i.test(text())), text().slice(0, 120));
check('invoice rows arrive from the API', await waitFor(() => /INV-\d{4}-\d{4}/.test(text())));

window.history.pushState({}, '', '/reports?tab=pl');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('reports route loads', await waitFor(() => /Profit & loss/i.test(text()) && /Revenue vs expenses/i.test(text())));

window.history.pushState({}, '', '/contacts');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('contacts route loads', await waitFor(() => /Contacts/i.test(text()) && /Harbor Dental Group/i.test(text())));

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('\nAll render smoke checks passed.\n');
window.close();
