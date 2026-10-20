const base = process.argv[2] ?? 'https://ledgerly-six-topaz.vercel.app';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function get(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual', ...opts });
  const body = await res.text();
  return { res, body, type: res.headers.get('content-type') ?? '' };
}

const root = await get('/');
check('GET / is the landing page', root.res.status === 200 && root.body.includes('class="wordmark"'), `${root.res.status}`);

const app = await get('/app');
check('/app is the app shell', app.res.status === 200 && app.body.includes('id="root"') && app.body.includes('theme-verge.css'), `${app.res.status}`);

const deep = await get('/invoices');
check('/invoices rewrites to the shell', deep.res.status === 200 && deep.body.includes('id="root"'), `${deep.res.status}`);

const js = await get('/app.js');
check('/app.js served', js.res.status === 200 && js.type.includes('javascript'), `${js.res.status} ${(js.body.length / 1024).toFixed(0)}kB`);

const fonts = await get('/fonts/fonts.css');
check('fonts served', fonts.res.status === 200 && fonts.body.includes('Anton'), `${fonts.res.status}`);

const theme = await get('/theme-verge.css');
check('theme served', theme.res.status === 200 && theme.body.includes('#3cffd0'), `${theme.res.status}`);

const health = await get('/api/health');
check('/api/health responds', health.res.status === 200 && health.body.includes('ledgerly'), `${health.res.status} ${health.body.slice(0, 60)}`);

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'test@ledgerly.app', password: 'test1234' }),
});
const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie') ?? '';
const cookie = setCookie.split(';')[0];
check('login works against Neon', login.status === 200 && cookie.startsWith('ledgerly_session='), `${login.status}`);

const headers = { cookie };
const dashRes = await fetch(`${base}/api/dashboard`, { headers });
const dash = await dashRes.json();
check('dashboard returns seeded data', dashRes.ok && dash.summary?.receivableCents > 0, `AR $${((dash.summary?.receivableCents ?? 0) / 100).toLocaleString()}, ${dash.summary?.openInvoiceCount} open`);

const inv = await (await fetch(`${base}/api/invoices?limit=3`, { headers })).json();
check('invoice list works', inv.total > 0, `${inv.total} invoices, first ${inv.items?.[0]?.number}`);

const aging = await (await fetch(`${base}/api/reports/aging?type=ar`, { headers })).json();
check('aging report works', aging.rows?.length > 0, `${aging.rows?.length} contacts, $${((aging.totals?.total ?? 0) / 100).toLocaleString()}`);

const anon = await fetch(`${base}/api/invoices`);
check('API rejects anonymous requests', anon.status === 401, `${anon.status}`);

console.log(failures ? `\n${failures} check(s) failed` : `\nAll production checks passed on ${base}`);
process.exit(failures ? 1 : 0);
