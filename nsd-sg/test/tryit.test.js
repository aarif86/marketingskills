// "Try it": paste HTML with no account -> try.<domain>/<id>/ for 3 hours -> keep it at signup or on an existing site.
import './helpers/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dataDir, cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

process.env.TENANT_ROOT = path.join(dataDir, 'public_html', 'tenants'); // exercise the Hostinger docroot too
process.env.HOSTINGER_USERNAME = 'u000000000';

const { buildApp } = await import('../src/server.js');
const { getDb } = await import('../src/db/index.js');
const { expirePreviews, getPreview, TRY_MAX_BYTES } = await import('../src/services/tryit.js');
const { tenantDir } = await import('../src/publish/hostinger.js');
const { reset } = await import('../src/lib/ratelimit.js');

let app;
const H = 'nsd.test';
const PAGE = '<!doctype html><html><head><title>Quiz</title></head><body><h1>Ramadan quiz</h1><p>Q1</p></body></html>';

before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });

const flashOf = (res) => decodeURIComponent([].concat(res.headers['set-cookie'] ?? []).join(';'));
const get = (url, cookie = '', host = H) => app.inject({ method: 'GET', url, headers: { host, cookie } });
async function post(url, cookie, form, pageUrl = '/') {
  const csrf = csrfFrom((await get(pageUrl, cookie)).body);
  return app.inject({ method: 'POST', url, headers: { host: H, cookie, 'content-type': 'application/x-www-form-urlencoded', origin: `http://${H}` }, body: new URLSearchParams({ _csrf: csrf, ...form }).toString() });
}

let id = '';

test('home page has the try box; a paste creates a preview and shows the link page', async () => {
  const home = await get('/');
  assert.match(home.body, /action="\/try"/);
  assert.match(home.body, /Show me my page/);
  const r = await post('/try', '', { html: PAGE });
  assert.equal(r.statusCode, 302);
  id = r.headers.location.match(/^\/try\/([a-z0-9]{12})$/)[1];
  const page = await get(`/try/${id}`);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /It works\. Here is your link\./);
  assert.match(page.body, new RegExp(`try\\.nsd\\.test/${id}/`));
  assert.match(page.body, new RegExp(`/signup\\?preview=${id}`));
  assert.match(page.body, /3 hours/);
  const row = getPreview(id);
  assert.ok(row && Date.parse(row.expires_at) - Date.now() > 2.9 * 3600_000, 'expires in ~3 hours');
});

test('the preview is served on try.<domain> with the bar, the badge and noindex; nothing else on that host', async () => {
  const r = await get(`/${id}/`, '', 'try.nsd.test');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Ramadan quiz/);
  assert.match(r.body, /data-nsd="try-bar"/);
  assert.match(r.body, /Keep it at my own address/);
  assert.match(r.body, /data-nsd="badge"/);
  assert.match(r.body, /name="robots" content="noindex/);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(r.headers['cache-control'], 'no-store');
  const noSlash = await get(`/${id}`, '', 'try.nsd.test');
  assert.equal(noSlash.statusCode, 301);
  assert.equal(noSlash.headers.location, `/${id}/`);
  assert.equal((await get('/', '', 'try.nsd.test')).statusCode, 200);
  assert.equal((await get('/nope12345678/', '', 'try.nsd.test')).statusCode, 404);
  assert.match((await get(`/${id}/other.html`, '', 'try.nsd.test')).body, /gone/);
  assert.equal((await app.inject({ method: 'POST', url: `/${id}/`, headers: { host: 'try.nsd.test' } })).statusCode, 405);
  // Hostinger docroot: rendered copy under tenants/try/<id>/ plus the shared root files.
  assert.match(fs.readFileSync(path.join(tenantDir('try'), id, 'index.html'), 'utf8'), /data-nsd="try-bar"/);
  assert.match(fs.readFileSync(path.join(tenantDir('try'), '.htaccess'), 'utf8'), /X-Robots-Tag[\s\S]*ErrorDocument 404 \/_nsd-expired\.html/);
  assert.ok(fs.existsSync(path.join(tenantDir('try'), '_nsd-expired.html')));
});

test('junk, oversized pastes and too many pastes are refused in plain words', async () => {
  const junk = await post('/try', '', { html: 'hello there this is not a page at all' });
  assert.equal(junk.statusCode, 302);
  assert.equal(junk.headers.location, '/#try');
  assert.match(flashOf(junk), /does not look like a web page/);
  const big = await post('/try', '', { html: '<html>' + 'x'.repeat(TRY_MAX_BYTES) + '</html>' });
  assert.match(flashOf(big), /bigger than 1 MB/);
  for (let i = 0; i < 5; i++) await post('/try', '', { html: PAGE }); // 3 so far this hour + 5 = over the limit of 5
  const limited = await post('/try', '', { html: PAGE });
  assert.equal(limited.statusCode, 429);
  reset('tryIt:127.0.0.1');
});

test('"try" is reserved and cannot be claimed as a site name', async () => {
  const r = await get('/api/availability?name=try');
  assert.equal(r.json().available, false);
});

test('signing up with ?preview= moves the page to the new site as its home page', async () => {
  const signup = await get(`/signup?preview=${id}`);
  assert.match(signup.body, /Keep your page/);
  assert.match(signup.body, new RegExp(`name="preview" value="${id}"`));
  reset('signup:127.0.0.1');
  const noName = await post('/signup', '', { email: 'dina@example.com', name: 'Dina', password: 'correct-horse-battery', subdomain: '', agree: '1', preview: id }, '/signup');
  assert.match(noName.body, /Pick a web address/);
  const r = await post('/signup', '', { email: 'dina@example.com', name: 'Dina', password: 'correct-horse-battery', subdomain: 'dina', agree: '1', preview: id }, '/signup');
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.location, /^\/sites\/[A-Z0-9]{26}$/);
  assert.match(flashOf(r), /now live at dina\.nsd\.test/);
  const site = await get('/', '', 'dina.nsd.test');
  assert.equal(site.statusCode, 200);
  assert.match(site.body, /Ramadan quiz/);
  assert.doesNotMatch(site.body, /try-bar/);
  assert.match(site.body, /data-nsd="badge"/);
  // The preview is spent: gone from the try host and from the result page.
  assert.equal(getPreview(id), null);
  assert.equal((await get(`/${id}/`, '', 'try.nsd.test')).statusCode, 404);
  assert.match((await get(`/try/${id}`)).body, /This test page is gone/);
  assert.ok(!fs.existsSync(path.join(tenantDir('try'), id)), 'hosted copy removed');
});

test('a signed-in user can put a preview onto an existing site from the result page', async () => {
  const login = await post('/login', '', { email: 'dina@example.com', password: 'correct-horse-battery' }, '/login');
  assert.equal(login.statusCode, 302, login.body.slice(0, 300));
  const cookie = cookiesFrom(login);
  const made = await post('/try', cookie, { html: '<html><body><h1>Second draft</h1></body></html>' });
  const id2 = made.headers.location.split('/').pop();
  const page = await get(`/try/${id2}`, cookie);
  assert.match(page.body, /Put it on this site/);
  const siteId = page.body.match(/<option value="([A-Z0-9]{26})"/)[1];
  const r = await post(`/try/${id2}/claim`, cookie, { site_id: siteId }, `/try/${id2}`);
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, `/sites/${siteId}`);
  assert.match((await get('/', '', 'dina.nsd.test')).body, /Second draft/);
  const detail = await get(`/sites/${siteId}`, cookie);
  assert.match(detail.body, /Kept from a test page/);
});

test('expired previews are removed from the table and disk; unknown folders are swept', async () => {
  const made = await post('/try', '', { html: PAGE });
  const id3 = made.headers.location.split('/').pop();
  getDb().prepare("UPDATE previews SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id3);
  fs.mkdirSync(path.join(dataDir, 'try', 'zzzzzzzzzzzz'), { recursive: true });
  const n = expirePreviews();
  assert.ok(n >= 1);
  assert.equal(getPreview(id3), null);
  assert.ok(!fs.existsSync(path.join(dataDir, 'try', id3)));
  assert.ok(!fs.existsSync(path.join(dataDir, 'try', 'zzzzzzzzzzzz')));
  assert.ok(!fs.existsSync(path.join(tenantDir('try'), id3)));
  assert.equal((await get(`/${id3}/`, '', 'try.nsd.test')).statusCode, 404);
});
