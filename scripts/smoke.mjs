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
  body: JSON.stringify({ email: 'test@ledgerly.app', password: 'test1234' }),
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

// The editor dialog must live at <body> level (not inside the transformed route wrapper)
// and its body must be the scroll container — the "unable to scroll" regression.
window.history.pushState({}, '', '/invoices?new=1');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('invoice editor opens', await waitFor(() => !!window.document.querySelector('.overlay')));
check('dialog is portalled to <body>', window.document.querySelector('.overlay')?.parentElement === window.document.body);
{
  const dialogBody = window.document.querySelector('.modal-body');
  const overflow = dialogBody ? window.getComputedStyle(dialogBody).overflowY : '';
  check('dialog body is the scroll container', overflow === 'auto', `overflow-y: ${overflow || 'unset'}`);
}

window.history.pushState({}, '', '/reports?tab=pl');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('reports route loads', await waitFor(() => /Profit & loss/i.test(text()) && /Revenue vs expenses/i.test(text())));

window.history.pushState({}, '', '/contacts');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('contacts route loads', await waitFor(() => /Contacts/i.test(text()) && /Harbor Dental Group/i.test(text())));

// ---------------------------------------------------------------------------
// Landing page: reveal behaviour and the ?t= freeze harness.
// ---------------------------------------------------------------------------
const landingHtml = await (await fetch(`${base}/landing.html`)).text();
const landing = new JSDOM(landingHtml, {
  url: `${base}/landing.html`,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
});
const landingText = landing.window.document.body.textContent.replace(/\s+/g, ' ');
check('landing page serves', /editorial ledger/i.test(landingText) && /Profit & loss/.test(landingText));
check('landing uses the Verge masthead', /LEDGERLY/.test(landingText) && !!landing.window.document.querySelector('.wordmark h1'));
check('landing reveals without IntersectionObserver', await waitFor(() => {
  const reveals = [...landing.window.document.querySelectorAll('.reveal')];
  return reveals.length > 8 && reveals.every((el) => el.classList.contains('in'));
}));
check('landing chart bars carry real heights', (() => {
  const bars = [...landing.window.document.querySelectorAll('[data-chart] .bar')];
  return bars.length === 16 && bars.every((el) => /%$/.test(el.style.height));
})());

const frozen = new JSDOM(landingHtml, {
  url: `${base}/landing.html?t=1.2`,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
});
check('freeze harness pins animations at ?t=', await waitFor(() => frozen.window.__landingFrozen === 1.2));
frozen.window.close();
landing.window.close();

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('\nAll render smoke checks passed.\n');
window.close();
