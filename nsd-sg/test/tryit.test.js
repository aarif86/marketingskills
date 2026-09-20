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
const { expirePreviews, getPreview, setReadyProbe, removePreview, TRY_MAX_BYTES } = await import('../src/services/tryit.js');
const { multipart } = await import('./helpers/env.js');
let probeAnswers = true;
setReadyProbe(async () => probeAnswers);
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
const forgetIp = () => getDb().prepare("UPDATE previews SET ip = 'x'").run();

test('home page has the try box; a paste creates a preview and shows the link page', async () => {
  const home = await get('/');
  assert.match(home.body, /action="\/try"/);
  assert.match(home.body, /Put my page online/);
  assert.match(home.body, /name="file"/);
  const r = await post('/try', '', { html: PAGE });
  assert.equal(r.statusCode, 302);
  id = r.headers.location.match(/^\/try\/([a-z0-9]{12})$/)[1];
  const page = await get(`/try/${id}`);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /It works\. Here is your link\./);
  assert.match(page.body, new RegExp(`<iframe class="try-frame" src="http://try\\.nsd\\.test/${id}/"`));
  assert.match(page.headers['content-security-policy'], /frame-src http:\/\/try\.nsd\.test/);
  assert.match(String(r.headers['set-cookie']), /nsd_try=1\./);
  assert.match(page.body, new RegExp(`try\\.nsd\\.test/${id}/`));
  assert.match(page.body, new RegExp(`/signup\\?preview=${id}`));
  assert.match(page.body, /3 hours/);
  const row = getPreview(id);
  assert.ok(row && Date.parse(row.expires_at) - Date.now() > 2.9 * 3600_000, 'expires in ~3 hours');
});

test('the preview is served on try.<domain> with the bar, the badge and noindex; nothing else on that host', async () => {
  const r = await get(`/${id}/`, '', 'try.nsd.test');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /data-nsd="try-bar"/, 'shell has the bar');
  assert.match(r.body, /<iframe src="\.\/page\.html"/, 'page sits in a frame below the bar');
  assert.match(r.body, /Keep it at my own address/);
  assert.match(r.body, /aria-label="Hide this bar"/);
  assert.match(r.body, /property="og:title" content="Quiz · test page on NSD\.SG"/);
  assert.match(r.body, /og:image" content="http:\/\/nsd\.test\/assets\/social-try\.png"/);
  assert.match(r.body, /name="robots" content="noindex/);
  const pg = await get(`/${id}/page.html`, '', 'try.nsd.test');
  assert.match(pg.body, /Ramadan quiz/);
  assert.match(pg.body, /data-nsd="badge"/);
  assert.doesNotMatch(pg.body, /try-bar/);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'self' http:\/\/nsd\.test/);
  const noSlash = await get(`/${id}`, '', 'try.nsd.test');
  assert.equal(noSlash.statusCode, 301);
  assert.equal(noSlash.headers.location, `/${id}/`);
  assert.equal((await get('/', '', 'try.nsd.test')).statusCode, 200);
  assert.equal((await get('/nope12345678/', '', 'try.nsd.test')).statusCode, 404);
  assert.match((await get(`/${id}/other.html`, '', 'try.nsd.test')).body, /gone/);
  assert.equal((await app.inject({ method: 'POST', url: `/${id}/`, headers: { host: 'try.nsd.test' } })).statusCode, 405);
  // Hostinger docroot: rendered copy under tenants/try/<id>/ plus the shared root files.
  assert.match(fs.readFileSync(path.join(tenantDir('try'), id, 'index.html'), 'utf8'), /data-nsd="try-bar"/);
  assert.match(fs.readFileSync(path.join(tenantDir('try'), id, 'page.html'), 'utf8'), /Ramadan quiz[\s\S]*data-nsd="badge"/);
  assert.match(fs.readFileSync(path.join(tenantDir('try'), '.htaccess'), 'utf8'), /X-Robots-Tag[\s\S]*ErrorDocument 404 \/_nsd-expired\.html/);
  assert.ok(fs.existsSync(path.join(tenantDir('try'), '_nsd-expired.html')));
});

test('the result page waits until the link really answers, then shows it; the status endpoint drives the wait', async () => {
  probeAnswers = false;
  const made = await post('/try', '', { html: PAGE });
  const idw = made.headers.location.split('/').pop();
  const waiting = await get(`/try/${idw}`);
  assert.match(waiting.body, /Putting your page online/);
  assert.match(waiting.body, new RegExp(`data-try-status="/try/${idw}/status"`));
  assert.doesNotMatch(waiting.body, /Here is your link/);
  assert.equal((await get(`/try/${idw}/status`)).json().ready, false);
  probeAnswers = true;
  const st = (await get(`/try/${idw}/status`)).json();
  assert.equal(st.ready, true);
  assert.match(st.url, new RegExp(`try\\.nsd\\.test/${idw}/`));
  assert.match((await get(`/try/${idw}`)).body, /Here is your link/);
  probeAnswers = false; // once confirmed it stays ready
  assert.equal((await get(`/try/${idw}/status`)).json().ready, true);
  probeAnswers = true;
});

test('uploading the .html file works like pasting; other files are refused', async () => {
  const csrf = csrfFrom((await get('/')).body);
  let mp = multipart({ _csrf: csrf }, [{ name: 'quiz.html', data: PAGE.replace('Ramadan quiz', 'Uploaded quiz'), type: 'text/html' }]);
  let r = await app.inject({ method: 'POST', url: '/try', headers: { host: H, origin: `http://${H}`, ...mp.headers }, body: mp.body });
  assert.equal(r.statusCode, 302, r.body);
  const idu = r.headers.location.split('/').pop();
  assert.match((await get(`/${idu}/page.html`, '', 'try.nsd.test')).body, /Uploaded quiz/);
  mp = multipart({ _csrf: csrf }, [{ name: 'photo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), type: 'image/png' }]);
  r = await app.inject({ method: 'POST', url: '/try', headers: { host: H, origin: `http://${H}`, ...mp.headers }, body: mp.body });
  assert.equal(r.headers.location, '/#try');
  assert.match(flashOf(r), /Choose the \.html file/);
  mp = multipart({ _csrf: csrf }, []);
  r = await app.inject({ method: 'POST', url: '/try', headers: { host: H, origin: `http://${H}`, ...mp.headers }, body: mp.body });
  assert.match(flashOf(r), /Choose the file or paste the code first/);
  reset('tryIt:127.0.0.1');
});

test('junk, oversized pastes and too many pastes are refused in plain words', async () => {
  const junk = await post('/try', '', { html: 'hello there this is not a page at all' });
  assert.equal(junk.statusCode, 302);
  assert.equal(junk.headers.location, '/#try');
  assert.match(flashOf(junk), /does not look like a web page/);
  const big = await post('/try', '', { html: '<html>' + 'x'.repeat(TRY_MAX_BYTES) + '</html>' });
  assert.match(flashOf(big), /bigger than 1 MB/);
  reset('tryIt:127.0.0.1'); forgetIp();
  for (let i = 0; i < 5; i++) { await post('/try', '', { html: PAGE }); reset('tryIt:127.0.0.1'); }
  reset('tryIt:127.0.0.1'); forgetIp();
});

test('three free tries per person (signed cookie), then a friendly sign-up page; ten per IP per day', async () => {
  forgetIp();
  let cookie = '';
  for (let i = 1; i <= 3; i++) {
    const r = await post('/try', cookie, { html: PAGE });
    assert.equal(r.statusCode, 302, `try ${i}`);
    const c = String(r.headers['set-cookie']).match(/nsd_try=([^;]+)/)[1];
    assert.match(c, new RegExp(`^${i}\\.`));
    cookie = `nsd_try=${c}`;
    reset('tryIt:127.0.0.1');
  }
  const fourth = await post('/try', cookie, { html: PAGE });
  assert.equal(fourth.statusCode, 200);
  assert.match(fourth.body, /Make a free account to keep going/);
  // A forged cookie counts as zero, not as a free pass past the IP cap.
  const forged = await post('/try', 'nsd_try=0.aaaaaaaaaaaaaaaaaaaaaaaa', { html: PAGE });
  assert.equal(forged.statusCode, 302);
  reset('tryIt:127.0.0.1');
  for (let i = 0; i < 7; i++) { await post('/try', '', { html: PAGE }); reset('tryIt:127.0.0.1'); }
  const ipCapped = await post('/try', '', { html: PAGE });
  assert.equal(ipCapped.statusCode, 200);
  assert.match(ipCapped.body, /from your network today/);
  forgetIp(); reset('tryIt:127.0.0.1');
});

test('live test pages show on the showcase as temporary; admin can remove one', async () => {
  const made = await post('/try', '', { html: PAGE });
  const ids = made.headers.location.split('/').pop();
  await get(`/try/${ids}/status`); // marks it reachable
  const sc = await get('/showcase');
  assert.match(sc.body, /Test pages right now/);
  assert.match(sc.body, new RegExp(`try\\.nsd\\.test/<i>${ids}</i>`));
  assert.match(sc.body, /pill-temp/);
  assert.ok(removePreview(ids));
  assert.equal(getPreview(ids), null);
  assert.doesNotMatch((await get('/showcase')).body, new RegExp(ids));
  forgetIp(); reset('tryIt:127.0.0.1');
});

test('"try" is reserved and cannot be claimed as a site name', async () => {
  const r = await get('/api/availability?name=try');
  assert.equal(r.json().available, false);
});

test('signing up with ?preview= moves the page to the new site as its home page', async () => {
  forgetIp(); reset('tryIt:127.0.0.1');
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
  forgetIp(); reset('tryIt:127.0.0.1');
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
  forgetIp(); reset('tryIt:127.0.0.1');
  const made = await post('/try', '', { html: PAGE });
  const id3 = made.headers.location.split('/').pop();
  getDb().prepare("UPDATE previews SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id3);
  fs.mkdirSync(path.join(dataDir, 'try', 'zzzzzzzzzzzz'), { recursive: true });
  const n = expirePreviews();
  assert.ok(n >= 1);
  assert.equal(getPreview(id3), null);
  assert.ok(!fs.existsSync(path.join(dataDir, 'try', id3)));
  assert.ok(fs.existsSync(path.join(dataDir, 'evidence', 'try', id3, 'index.html')), 'expired test page held for 7 days');
  assert.match(fs.readFileSync(path.join(dataDir, 'evidence', 'try', id3, 'meta.json'), 'utf8'), /"reason": "expired"/);
  assert.ok(!fs.existsSync(path.join(dataDir, 'try', 'zzzzzzzzzzzz')));
  assert.ok(!fs.existsSync(path.join(tenantDir('try'), id3)));
  assert.equal((await get(`/${id3}/`, '', 'try.nsd.test')).statusCode, 404);
});
