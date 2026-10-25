// End-to-end through Fastify's inject(): signup → site → upload → tenant serving → isolation → admin.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from './helpers/zipwriter.js';
import { multipart, cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

const { buildApp } = await import('../src/server.js');
const { reset: resetLimit } = await import('../src/lib/ratelimit.js');
const { listHoldsForSite, purgeEvidence } = await import('../src/services/evidence.js');
const { getDb } = await import('../src/db/index.js');
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './helpers/env.js';

let app;
const P = { host: 'nsd.test' };
const alice = { cookie: '', siteId: '' };
const bob = { cookie: '' };
const admin = { cookie: '' };

before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });

async function get(url, cookie = '', host = 'nsd.test') {
  return app.inject({ method: 'GET', url, headers: { host, cookie } });
}
async function post(url, cookie, form) {
  const page = await get(url.includes('/action') ? url.replace(/\/action$/, '') : url === '/logout' ? '/dashboard' : url.replace(/\/(files\/delete|rollback|delete|upload)$/, ''), cookie);
  const csrf = csrfFrom(page.body) || csrfFrom((await get('/dashboard', cookie)).body) || csrfFrom((await get('/signup', cookie)).body);
  const body = new URLSearchParams({ _csrf: csrf, ...form }).toString();
  return app.inject({ method: 'POST', url, headers: { host: 'nsd.test', cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'http://nsd.test' }, body });
}
async function upload(cookie, siteId, files, mode = 'replace') {
  const csrf = csrfFrom((await get(`/sites/${siteId}`, cookie)).body);
  const mp = multipart({ _csrf: csrf, mode }, files);
  return app.inject({ method: 'POST', url: `/sites/${siteId}/upload`, headers: { host: 'nsd.test', cookie, accept: 'application/json', origin: 'http://nsd.test', ...mp.headers }, body: mp.body });
}

test('marketing pages render', async () => {
  for (const u of ['/', '/pricing', '/faq', '/terms', '/privacy', '/report', '/login', '/signup', '/healthz']) {
    const r = await get(u);
    assert.equal(r.statusCode, 200, u);
  }
  const r = await get('/');
  assert.match(r.body, /Give it a proper address/);
  assert.match(r.body, /Sharing it is the hard part/, 'hero opens with the pain');
  assert.doesNotMatch(r.body, /hero-proof/, 'proof line hidden below the threshold');
  assert.match(r.body, /Who this is for/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  // the connector is marketed on the landing page and discoverable by AI assistants
  assert.match(r.body, /id="connect"/);
  assert.match(r.body, /Claude, ChatGPT, Codex, Gemini, Cursor/);
  assert.match(r.body, /href="\/#connect">Connect your AI/);
  assert.match(r.body, /<details class="nav-more">/, 'secondary pages live under More');
  assert.match(r.body, /nav-more-menu"><a href="\/roadmap"/);
  assert.match(r.body, /application\/ld\+json/);
  assert.match(r.body, /"@type":"FAQPage"/);
  assert.match(r.body, /property="og:title"/);
  assert.match(r.body, /og:image" content="http:\/\/nsd\.test\/assets\/social-home\.png/);
  assert.match(r.body, /og:description" content="Made something with AI\? Sharing it is the hard part/);
  assert.equal((await get('/assets/social-home.png')).statusCode, 200);
  assert.doesNotMatch(r.body, /id="features"/, 'the repetitive feature list is gone');
  assert.match(r.body, /Also included:/);
  assert.match(r.body, /People who build with AI tools/);
  assert.match(r.body, /Built and looked after in Singapore/);
  assert.match((await get('/signup')).body, /Have a code\?/, 'sign-up has a code field');
  assert.match((await get('/signup?code=abc123')).body, /name="code" value="ABC123"/, 'the link pre-fills the code');
  assert.match(r.body, /Connect your AI, now on the front page/, 'hero pill is pinned to the connector release');
  const llms = await get('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.headers['content-type'], /text\/plain/);
  assert.match(llms.body, /nsd_publish/);
  assert.match(llms.body, /## Plans/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.body, /<loc>http:\/\/nsd.test\/pricing<\/loc>/);
  assert.match((await get('/robots.txt')).body, /Sitemap: /);
});

test('unknown host is refused only in production; tenant on unknown subdomain gets 404', async () => {
  const r = await get('/', '', 'nobody.nsd.test');
  assert.equal(r.statusCode, 404);
  assert.match(r.body, /not taken/);
});

test('signup creates user + site and logs in', async () => {
  const page = await get('/signup');
  const csrf = csrfFrom(page.body);
  const r = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, email: 'alice@example.com', name: 'Alice', password: 'correct-horse-battery', subdomain: 'alice', agree: '1' }).toString() });
  assert.equal(r.statusCode, 302);
  alice.cookie = cookiesFrom(r);
  assert.match(alice.cookie, /nsd_session=/);
  const dash = await get('/dashboard', alice.cookie);
  assert.equal(dash.statusCode, 200);
  alice.siteId = dash.body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  assert.match(dash.body, /alice<span class="muted">\.nsd\.test/);
});

test('without the Hostinger publisher a site is ready at once and the page says online', async () => {
  const page = await get('/dashboard', alice.cookie);
  const siteId = page.body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  const st = await get(`/sites/${siteId}/status`, alice.cookie);
  assert.equal(st.json().ready, true);
  assert.match((await get(`/sites/${siteId}`, alice.cookie)).body, /Your address is ready/);
});

test('signup rejects weak password, bad email, reserved name', async () => {
  const csrf = csrfFrom((await get('/signup')).body);
  const r = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, email: 'nope', password: 'short', subdomain: 'admin', agree: '1' }).toString() });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /valid email/);
  assert.match(r.body, /at least 10/);
  assert.match(r.body, /reserved/);
});

test('CSRF: POST without token is rejected', async () => {
  const r = await app.inject({ method: 'POST', url: '/sites', headers: { ...P, cookie: alice.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'subdomain=other' });
  assert.equal(r.statusCode, 403);
  const r2 = await app.inject({ method: 'POST', url: '/sites', headers: { ...P, cookie: alice.cookie, origin: 'http://evil.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'subdomain=other&_csrf=x' });
  assert.equal(r2.statusCode, 403);
});

test('empty site shows coming-soon; ZIP upload publishes; branding injected; unsafe files dropped', async () => {
  let t = await get('/', '', 'alice.nsd.test');
  assert.equal(t.statusCode, 200);
  assert.match(t.body, /Coming soon/);

  const zip = buildZip([
    { name: 'site/index.html', data: '<!doctype html><html><body><h1>Alice</h1></body></html>' },
    { name: 'site/about.html', data: '<p>about</p>' },
    { name: 'site/css/a.css', data: 'h1{color:red}' },
    { name: 'site/blog/index.html', data: '<p>blog</p>' },
    { name: 'site/hack.php', data: '<?php system($_GET[1]);' },
    { name: 'site/.env', data: 'SECRET=1' },
  ]);
  const r = await upload(alice.cookie, alice.siteId, [{ name: 'site.zip', data: zip, type: 'application/zip' }]);
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.ok, true);
  assert.equal(j.version, 1);
  assert.equal(j.files, 4);
  assert.equal(j.rejected.length, 1); // hack.php; .env is dropped silently as junk
  assert.equal((await get('/.env', '', 'alice.nsd.test')).statusCode, 404);

  t = await get('/', '', 'alice.nsd.test');
  assert.equal(t.statusCode, 200);
  assert.match(t.body, /<h1>Alice<\/h1>/);
  assert.match(t.body, /data-nsd="badge"/);
  assert.match(t.body, /og:site_name" content="alice\.nsd\.test"/, 'share tags added to hosted pages');
  assert.match(t.body, /Powered by NasarDigital/);
  assert.equal(t.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(t.headers['x-content-type-options'], 'nosniff');
  assert.equal(t.headers['x-frame-options'], 'SAMEORIGIN');

  assert.equal((await get('/css/a.css', '', 'alice.nsd.test')).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await get('/about', '', 'alice.nsd.test')).statusCode, 200); // clean URL
  assert.equal((await get('/blog', '', 'alice.nsd.test')).statusCode, 301); // dir redirect
  assert.equal((await get('/blog/', '', 'alice.nsd.test')).statusCode, 200);
  assert.equal((await get('/hack.php', '', 'alice.nsd.test')).statusCode, 404);
  assert.equal((await get('/../../escape.html', '', 'alice.nsd.test')).statusCode, 404);
  assert.equal((await get('/%2e%2e/%2e%2e/etc/passwd', '', 'alice.nsd.test')).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/', headers: { host: 'alice.nsd.test' } })).statusCode, 405);
  assert.equal((await app.inject({ method: 'HEAD', url: '/', headers: { host: 'alice.nsd.test' } })).statusCode, 200);
});

test('platform session cookie is not sent/usable from tenant origin', async () => {
  // The tenant server never reads cookies; a request carrying the platform cookie still gets plain static content.
  const t = await get('/', alice.cookie, 'alice.nsd.test');
  assert.equal(t.statusCode, 200);
  assert.ok(!t.headers['set-cookie']);
});

test('merge upload adds a file and creates version 2; delete creates version 3; rollback restores', async () => {
  const r = await upload(alice.cookie, alice.siteId, [{ name: 'pages/new.html', data: '<p>new</p>' }], 'merge');
  assert.equal(r.json().version, 2);
  assert.equal((await get('/pages/new.html', '', 'alice.nsd.test')).statusCode, 200);
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 200); // old files kept

  const del = await post(`/sites/${alice.siteId}/files/delete`, alice.cookie, { path: 'about.html' });
  assert.equal(del.statusCode, 302);
  assert.equal((await get('/about.html', '', 'alice.nsd.test')).statusCode, 404);

  const detail = await get(`/sites/${alice.siteId}`, alice.cookie);
  const v2 = detail.body.match(/name="release_id" value="([A-Z0-9]{26})"/g);
  assert.ok(v2 && v2.length >= 1);
  // Free plan keeps 3 releases: v1..v3 present. Restore the earliest non-current one that still has about.html (v2).
  const ids = [...detail.body.matchAll(/name="release_id" value="([A-Z0-9]{26})"/g)].map((m) => m[1]);
  const rb = await post(`/sites/${alice.siteId}/rollback`, alice.cookie, { release_id: ids[ids.length - 1] });
  assert.equal(rb.statusCode, 302);
  assert.equal((await get('/about.html', '', 'alice.nsd.test')).statusCode, 200);
});

test('paste HTML publishes a named page and the home page; junk is refused', async () => {
  let r = await post(`/sites/${alice.siteId}/paste`, alice.cookie, { page: 'Proposal', html: '<!doctype html><html><body><h1>Pasted proposal</h1></body></html>' });
  assert.equal(r.statusCode, 302);
  let t = await get('/proposal', '', 'alice.nsd.test');
  assert.equal(t.statusCode, 200);
  assert.match(t.body, /Pasted proposal/);
  assert.match(t.body, /data-nsd="badge"/, 'badge injected on pasted pages too');
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 200, 'other pages kept (merge)');
  r = await post(`/sites/${alice.siteId}/paste`, alice.cookie, { page: '', html: '<html><body><h1>Alice</h1><p>New home</p></body></html>' });
  t = await get('/', '', 'alice.nsd.test');
  assert.match(t.body, /New home/);
  r = await post(`/sites/${alice.siteId}/paste`, alice.cookie, { page: 'x', html: 'just some words' });
  assert.equal((await get('/x', '', 'alice.nsd.test')).statusCode, 404, 'non-HTML refused');
  const anon = await app.inject({ method: 'POST', url: `/sites/${alice.siteId}/paste`, headers: { ...P, 'content-type': 'application/x-www-form-urlencoded', origin: 'http://nsd.test' }, body: 'page=evil&html=%3Chtml%3Epwn%3C%2Fhtml%3E' });
  assert.ok(anon.statusCode === 403 || /^\/login/.test(anon.headers.location ?? ''), 'anonymous paste is refused (CSRF or login)');
  assert.equal((await get('/evil', '', 'alice.nsd.test')).statusCode, 404);
});

test('uploads with disallowed types or bad paths are refused', async () => {
  const r = await upload(alice.cookie, alice.siteId, [{ name: 'evil.php', data: '<?php' }], 'merge');
  assert.equal(r.statusCode, 400);
  const r2 = await upload(alice.cookie, alice.siteId, [{ name: '../../x.html', data: 'x' }], 'merge');
  assert.equal(r2.statusCode, 400);
});

test('another user cannot see or change alice\'s site; plan limit blocks second site', async () => {
  const csrf = csrfFrom((await get('/signup')).body);
  const r = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, email: 'bob@example.com', password: 'another-good-password', agree: '1' }).toString() });
  bob.cookie = cookiesFrom(r);
  assert.equal((await get(`/sites/${alice.siteId}`, bob.cookie)).statusCode, 404);
  assert.equal((await get(`/sites/${alice.siteId}/settings`, bob.cookie)).statusCode, 404);
  const up = await upload(bob.cookie, alice.siteId, [{ name: 'index.html', data: 'pwned' }]);
  assert.equal(up.statusCode, 404);
  assert.match((await get('/', '', 'alice.nsd.test')).body, /Alice/);
  const del = await post(`/sites/${alice.siteId}/files/delete`, bob.cookie, { path: 'index.html' });
  assert.equal(del.statusCode, 404);
  // bob creates his one allowed site, then is blocked on the second
  const c1 = await post('/sites', bob.cookie, { subdomain: 'bob', title: 'Bob' });
  assert.equal(c1.statusCode, 302);
  assert.match(c1.headers.location, /\/sites\/[A-Z0-9]{26}/);
  const c2 = await post('/sites', bob.cookie, { subdomain: 'bob2' });
  assert.equal(c2.headers.location, '/sites/new');
  assert.equal((await get('/api/availability?name=alice')).json().available, false);
  assert.equal((await get('/api/availability?name=free-name')).json().available, true);
});

test('regular users cannot reach admin; admin can', async () => {
  assert.equal((await get('/admin', alice.cookie)).statusCode, 404);
  assert.equal((await get('/admin/users', alice.cookie)).statusCode, 404);
  const csrf = csrfFrom((await get('/login')).body);
  const r = await app.inject({ method: 'POST', url: '/login', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, email: 'admin@nsd.test', password: 'admin-password-123' }).toString() });
  assert.equal(r.statusCode, 302);
  admin.cookie = cookiesFrom(r);
  for (const u of ['/admin', '/admin/users', '/admin/sites', '/admin/plans', '/admin/reserved', '/admin/abuse', '/admin/audit', '/admin/health', `/admin/sites/${alice.siteId}`]) {
    assert.equal((await get(u, admin.cookie)).statusCode, 200, u);
  }
});

test('admin removes branding, suspends and restores a site, reserves a name', async () => {
  let r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'branding', value: 'removed' });
  assert.equal(r.statusCode, 302);
  { const b = (await get('/', '', 'alice.nsd.test')).body; assert.doesNotMatch(b, /data-nsd="badge"/); assert.doesNotMatch(b, /social-site\.png/, 'no NSD.SG card once the badge is removed'); }
  r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'branding', value: 'shown' });
  assert.match((await get('/', '', 'alice.nsd.test')).body, /data-nsd="badge"/);

  r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'suspend', reason: 'test' });
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 451);
  r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'unsuspend' });
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 200);

  r = await post('/admin/reserved', admin.cookie, { action: 'add', names: 'brandx brandy', reason: 'trademark' });
  assert.equal((await get('/api/availability?name=brandx')).json().reason, 'That name is reserved by NSD.SG (platform or well-known names). Pick another.');
  // Blocked words match inside any name; system words cannot be removed; admin words can.
  assert.match((await get('/api/availability?name=hamas-relief')).json().reason, /not available/);
  assert.equal((await get('/api/availability?name=israel')).json().reason, 'That name is reserved by NSD.SG (platform or well-known names). Pick another.');
  assert.equal((await get('/api/availability?name=israeli-food')).json().available, true, 'country names are exact-match only');
  assert.equal((await get('/api/availability?name=badwordshop')).json().available, true);
  r = await post('/admin/reserved', admin.cookie, { action: 'add-word', words: 'badword', reason: 'test' });
  assert.equal(r.statusCode, 302);
  assert.match((await get('/api/availability?name=badwordshop')).json().reason, /not available/);
  assert.match((await get('/admin/reserved', admin.cookie)).body, /Blocked words/);
  r = await post('/admin/reserved', admin.cookie, { action: 'remove-word', word: 'badword' });
  assert.equal((await get('/api/availability?name=badwordshop')).json().available, true);
  r = await post('/admin/reserved', admin.cookie, { action: 'remove-word', word: 'terror' });
  assert.match((await get('/api/availability?name=terrorsg')).json().reason, /not available/, 'system word stays');
});

test('admin plan override removes branding for the user; suspending the user takes the site offline', async () => {
  const users = await get('/admin/users?q=alice', admin.cookie);
  const aliceId = users.body.match(/\/admin\/users\/([A-Z0-9]{26})/)[1];
  await post(`/admin/users/${aliceId}/action`, admin.cookie, { action: 'plan', plan_id: 'plus' });
  assert.doesNotMatch((await get('/', '', 'alice.nsd.test')).body, /data-nsd="badge"/);
  await post(`/admin/users/${aliceId}/action`, admin.cookie, { action: 'plan', plan_id: 'community' });
  assert.match((await get('/', '', 'alice.nsd.test')).body, /data-nsd="badge"/);
  await post(`/admin/users/${aliceId}/action`, admin.cookie, { action: 'overrides', branding_removed: 'true', max_sites: '5' });
  assert.doesNotMatch((await get('/', '', 'alice.nsd.test')).body, /data-nsd="badge"/);

  await post(`/admin/users/${aliceId}/action`, admin.cookie, { action: 'suspend' });
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 451);
  assert.equal((await get('/dashboard', alice.cookie)).statusCode, 302); // session invalidated
  await post(`/admin/users/${aliceId}/action`, admin.cookie, { action: 'activate' });
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 200);
});

test('abuse report is recorded and visible to admin', async () => {
  const csrf = csrfFrom((await get('/report')).body);
  const r = await app.inject({ method: 'POST', url: '/report', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, site: 'alice', category: 'phishing', details: 'This site pretends to be a bank login page.' }).toString() });
  assert.equal(r.statusCode, 302);
  const list = await get('/admin/abuse', admin.cookie);
  assert.match(list.body, /pretends to be a bank/);
});

test('site deletion frees the name', async () => {
  const dash = await get('/dashboard', bob.cookie);
  const id = dash.body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  const r = await post(`/sites/${id}/delete`, bob.cookie, { confirm: 'bob' });
  assert.equal(r.headers.location, '/dashboard');
  assert.equal((await get('/api/availability?name=bob')).json().available, true);
  assert.equal((await get('/', '', 'bob.nsd.test')).statusCode, 404);
});

test('suspending a site keeps a copy of its files; admin can download the hold and an evidence pack; audit rows carry the browser', async () => {
  const before = listHoldsForSite(alice.siteId).length;
  let r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'suspend', reason: 'test hold' });
  assert.equal(r.statusCode, 302);
  const holds = listHoldsForSite(alice.siteId);
  assert.equal(holds.length, before + 1);
  assert.match(holds[0].reason, /test hold/);
  assert.ok(fs.existsSync(path.join(dataDir, 'evidence', 'sites', alice.siteId, holds[0].ts, 'files', 'index.html')));
  const zip = await get(`/admin/evidence/${alice.siteId}/${holds[0].ts}.zip`, admin.cookie);
  assert.equal(zip.statusCode, 200);
  assert.match(zip.headers['content-type'], /application\/zip/);
  assert.ok(zip.rawPayload.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip signature');
  assert.match(zip.rawPayload.toString('latin1'), /files\/index\.html/);
  const aliceRow = getDb().prepare('SELECT id FROM users WHERE email = ?').get('alice@example.com');
  const pack = await get(`/admin/users/${aliceRow.id}/evidence.zip`, admin.cookie);
  assert.equal(pack.statusCode, 200);
  const text = pack.rawPayload.toString('latin1');
  for (const name of ['README.txt', 'user.json', 'sessions.json', 'audit.jsonl', 'sites.json', 'ips.txt', 'holds/alice/']) assert.match(text, new RegExp(name.replace(/[/.]/g, '\\$&')), name);
  assert.doesNotMatch(text, /password_hash/);
  assert.ok([302, 404].includes((await get(`/admin/users/${aliceRow.id}/evidence.zip`, alice.cookie)).statusCode), 'non-admin cannot');
  const ua = getDb().prepare("SELECT user_agent FROM audit_log WHERE action = 'admin.evidence.pack' ORDER BY id DESC LIMIT 1").get();
  assert.equal(typeof ua.user_agent, 'string');
  await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'unsuspend' });
  // Past keep_until, the hold is purged.
  const meta = path.join(dataDir, 'evidence', 'sites', alice.siteId, holds[0].ts, 'meta.json');
  fs.writeFileSync(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta, 'utf8')), keep_until: '2000-01-01T00:00:00.000Z' }));
  assert.ok(purgeEvidence() >= 1);
  assert.equal(listHoldsForSite(alice.siteId).length, before);
});

test('a site without index.html shows a branded file list; folders too', async () => {
  resetLimit('signup:127.0.0.1');
  const su = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/signup')).body), email: 'listy@example.com', name: 'Listy', password: 'correct-horse-battery', subdomain: 'listy', agree: '1' }).toString() });
  assert.equal(su.statusCode, 302);
  const cookie = cookiesFrom(su);
  const siteId = (await get('/dashboard', cookie)).body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  const r = await upload(cookie, siteId, [{ name: 'Book 1.pdf', data: '%PDF-1.4 fake', type: 'application/pdf' }, { name: 'notes/readme.txt', data: 'hello world notes' }], 'replace');
  assert.equal(r.statusCode, 200, r.body);
  const home = await get('/', '', 'listy.nsd.test');
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Book 1\.pdf/);
  assert.match(home.body, /href="Book%201\.pdf"/);
  assert.match(home.body, /notes\//);
  assert.match(home.body, /data-nsd="badge"/, 'badge still applies');
  assert.match(home.body, /og:site_name" content="listy\.nsd\.test"/);
  const folder = await get('/notes/', '', 'listy.nsd.test');
  assert.match(folder.body, /readme\.txt/);
  assert.match(folder.body, /Back/);
  assert.equal((await get('/notes', '', 'listy.nsd.test')).statusCode, 301);
  const detail = await get(`/sites/${siteId}`, cookie);
  assert.match(detail.body, /simple list of these files/);
});

test('showcase: free sites listed, paid sites hidden until the owner opts in', async () => {
  const { listShowcaseSites } = await import('../src/services/sites.js');
  const names = () => listShowcaseSites().map((s) => s.subdomain);
  // listy is on the free plan with a live site
  assert.ok(names().includes('listy'), 'free plan listed');
  const listyRow = getDb().prepare('SELECT id FROM users WHERE email = ?').get('listy@example.com');
  const siteId = getDb().prepare("SELECT id FROM sites WHERE user_id = ? AND status != 'deleted'").get(listyRow.id).id;
  const login = await app.inject({ method: 'POST', url: '/login', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfFrom((await get('/login')).body), email: 'listy@example.com', password: 'correct-horse-battery' }).toString() });
  const cookie = cookiesFrom(login);
  // admin moves listy to Plus -> off the showcase
  await post(`/admin/users/${listyRow.id}/action`, admin.cookie, { action: 'plan', plan_id: 'plus' });
  assert.ok(!names().includes('listy'), 'paid plan hidden by default');
  let settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /Show this site on the public/);
  assert.doesNotMatch(settings.body, /name="listed" value="1" checked/);
  // opt in
  let r = await post(`/sites/${siteId}/settings`, cookie, { title: 'Listy', listed: '1' });
  assert.equal(r.statusCode, 302);
  assert.ok(names().includes('listy'), 'opted in');
  settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /name="listed" value="1" checked/);
  // opt out again
  r = await post(`/sites/${siteId}/settings`, cookie, { title: 'Listy' });
  assert.ok(!names().includes('listy'), 'opted out');
  // admin makes a free gift plan: badge removed but "can hide from showcase" left off -> always listed, no opt-out
  r = await post('/admin/plans', admin.cookie, { id: 'plus-gift', name: 'Plus (gift)', description: 'gift', price_sgd: '9', trial_days: '120', max_sites: '5', max_storage_mb: '1024', max_file_mb: '50', max_releases: '10', max_bandwidth_gb: '50', branding_removable: '1', custom_domains: '1' });
  assert.equal(r.statusCode, 302);
  const plansPage = await get('/admin/plans?edit=plus-gift', admin.cookie);
  assert.match(plansPage.body, /<option value="always" selected>/);
  await post(`/sites/${siteId}/settings`, cookie, { title: 'Listy', listed: '1' }); // a fresh gift user is listed by default; undo the opt-out above
  await post(`/admin/users/${listyRow.id}/action`, admin.cookie, { action: 'plan', plan_id: 'plus-gift' });
  assert.ok(names().includes('listy'), 'gift plan listed even though the badge is removed');
  settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.doesNotMatch(settings.body, /Show this site on the public/, 'no opt-out on a gift plan');
  // and the real Plus plan keeps the opt-out
  await post(`/admin/users/${listyRow.id}/action`, admin.cookie, { action: 'plan', plan_id: 'plus' });
  settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /Show this site on the public/, 'opt-out back on Plus');
});

test('custom domain: Plus user adds a domain, sees the two records, check flips it to connected, the site answers on it', async () => {
  const { setResolver, listDomainsForSite } = await import('../src/services/domains.js');
  const listyRow = getDb().prepare('SELECT id FROM users WHERE email = ?').get('listy@example.com');
  const siteId = getDb().prepare("SELECT id FROM sites WHERE user_id = ? AND status != 'deleted'").get(listyRow.id).id;
  const login = await app.inject({ method: 'POST', url: '/login', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfFrom((await get('/login')).body), email: 'listy@example.com', password: 'correct-horse-battery' }).toString() });
  const cookie = cookiesFrom(login);
  // refused: our own domain, junk
  let r = await post(`/sites/${siteId}/domains`, cookie, { hostname: 'foo.nsd.test' }, `/sites/${siteId}/settings`);
  assert.match(decodeURIComponent(String(r.headers['set-cookie'])), /already yours/);
  r = await post(`/sites/${siteId}/domains`, cookie, { hostname: 'not a domain' }, `/sites/${siteId}/settings`);
  assert.match(decodeURIComponent(String(r.headers['set-cookie'])), /does not look like a domain/);
  // accepted, normalised
  r = await post(`/sites/${siteId}/domains`, cookie, { hostname: 'https://WWW.Shop.sg/page' }, `/sites/${siteId}/settings`);
  assert.equal(r.statusCode, 302);
  const d = listDomainsForSite(siteId)[0];
  assert.equal(d.hostname, 'shop.sg');
  let settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /_nsd-verify/);
  assert.match(settings.body, new RegExp(`nsd-verify=${d.verify_token}`));
  assert.match(settings.body, /<code>www<\/code><\/td><td><code>listy\.nsd\.test<\/code>/);
  assert.match(settings.body, /waiting for records/);
  // nothing in DNS yet
  setResolver({ txt: async () => { throw new Error('ENOTFOUND'); }, cname: async () => { throw new Error('ENOTFOUND'); }, a: async () => { throw new Error('ENOTFOUND'); } });
  r = await post(`/sites/${siteId}/domains/${d.id}/check`, cookie, {}, `/sites/${siteId}/settings`);
  assert.match(decodeURIComponent(String(r.headers['set-cookie'])), /Not yet\. No TXT record found/);
  // records in place
  setResolver({ txt: async (n) => (n === `_nsd-verify.shop.sg` ? [[`nsd-verify=${d.verify_token}`]] : []), cname: async (n) => (n === 'www.shop.sg' ? ['listy.nsd.test.'] : []), a: async () => [] });
  r = await post(`/sites/${siteId}/domains/${d.id}/check`, cookie, {}, `/sites/${siteId}/settings`);
  assert.match(decodeURIComponent(String(r.headers['set-cookie'])), /shop\.sg is connected/);
  settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /connected/);
  // the site answers on the custom hostname, www and bare
  for (const host of ['www.shop.sg', 'shop.sg']) {
    const t = await get('/', '', host);
    assert.equal(t.statusCode, 200, host);
    assert.match(t.body, /Book 1\.pdf/);
  }
  assert.equal((await get('/', '', 'nobody.example')).statusCode, 200, 'unknown host still gets the platform in non-prod');
  // tls-ask knows it
  assert.equal((await get('/internal/tls-ask?domain=shop.sg')).statusCode, 200);
  // second domain ok, third refused
  await post(`/sites/${siteId}/domains`, cookie, { hostname: 'shop.com' }, `/sites/${siteId}/settings`);
  r = await post(`/sites/${siteId}/domains`, cookie, { hostname: 'shop.net' }, `/sites/${siteId}/settings`);
  assert.match(decodeURIComponent(String(r.headers['set-cookie'])), /two domains at most/);
  // remove
  r = await post(`/sites/${siteId}/domains/${d.id}/delete`, cookie, {}, `/sites/${siteId}/settings`);
  assert.equal(listDomainsForSite(siteId).some((x) => x.hostname === 'shop.sg'), false);
  assert.equal((await get('/', '', 'shop.sg')).statusCode, 200);
  assert.doesNotMatch((await get('/', '', 'shop.sg')).body, /Book 1\.pdf/, 'no longer served');
  // free users see the upsell, not the form
  const sup = await get(`/sites/${alice.siteId}/settings`, alice.cookie);
  assert.ok(sup.statusCode === 200 ? /See plans/.test(sup.body) : true);
  // admin overview shows recurring revenue
  assert.match((await get('/admin', admin.cookie)).body, /Monthly recurring/);
});

// Read a zip made by src/lib/zipwrite.js (deflate, data descriptor flag set): walk the central directory.
function unzipEntries(buf) {
  const zlib = requireZlib();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cdOff = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  const out = {}; let p = cdOff;
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30); const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const ln = buf.readUInt16LE(localOff + 26); const le = buf.readUInt16LE(localOff + 28);
    const data = buf.subarray(localOff + 30 + ln + le, localOff + 30 + ln + le + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const requireZlib = () => zlibMod;
const zlibMod = await import('node:zlib');
const cryptoMod = await import('node:crypto');

test('evidence grade: upload IP per version, visitor log on flagged sites, manifest + summary, legal hold, stored packs survive a permanent delete', async () => {
  const { setLegalHold, listStoredPacks, buildPack } = await import('../src/services/evidence.js');
  const { purgeVisits } = await import('../src/services/visits.js');
  const aliceRow = getDb().prepare('SELECT id FROM users WHERE email = ?').get('alice@example.com');
  await post(`/admin/users/${aliceRow.id}/action`, admin.cookie, { action: 'activate' }); // earlier tests suspended her and dropped her sessions
  const login = await app.inject({ method: 'POST', url: '/login', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/login')).body), email: 'alice@example.com', password: 'correct-horse-battery' }).toString() });
  alice.cookie = cookiesFrom(login);
  // 1. a fresh upload records who sent it
  let r = await upload(alice.cookie, alice.siteId, [{ name: 'index.html', data: '<h1>v-next</h1>' }], 'replace');
  assert.equal(r.statusCode, 200, r.body);
  const latest = getDb().prepare('SELECT ip, user_agent FROM releases WHERE site_id = ? ORDER BY version DESC LIMIT 1').get(alice.siteId);
  assert.equal(latest.ip, '127.0.0.1');
  // 2. a live site is not logged; a suspended one is; the admin switch turns it on for a live site; an abuse report too
  const cnt = () => getDb().prepare('SELECT COUNT(*) n FROM site_visits WHERE site_id = ?').get(alice.siteId).n;
  getDb().prepare('UPDATE sites SET log_visitors = 0 WHERE id = ?').run(alice.siteId); // an earlier test reported this site, which switches logging on
  const base = cnt(); // earlier tests suspended this site and opened it, which logs by design
  await get('/', '', 'alice.nsd.test');
  assert.equal(cnt(), base, 'live, unflagged: nothing logged');
  await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'suspend', reason: 'evidence test' });
  r = await app.inject({ method: 'GET', url: '/secret.html?x=1', headers: { host: 'alice.nsd.test', 'user-agent': 'EvidenceBot/1.0', referer: 'https://t.me/x' } });
  assert.equal(r.statusCode, 451);
  let v = getDb().prepare('SELECT * FROM site_visits WHERE site_id = ? ORDER BY id DESC LIMIT 1').get(alice.siteId);
  assert.equal(v.state, 'suspended'); assert.equal(v.path, '/secret.html?x=1'); assert.equal(v.user_agent, 'EvidenceBot/1.0'); assert.equal(v.referer, 'https://t.me/x');
  await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'unsuspend' });
  await get('/', '', 'alice.nsd.test');
  assert.equal(cnt(), base + 1, 'back to live: not logged');
  await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'log_visitors', value: 'on' });
  await get('/', '', 'alice.nsd.test');
  v = getDb().prepare('SELECT * FROM site_visits WHERE site_id = ? ORDER BY id DESC LIMIT 1').get(alice.siteId);
  assert.equal(v.state, 'live');
  await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'log_visitors', value: 'off' });
  assert.equal(getDb().prepare('SELECT log_visitors FROM sites WHERE id = ?').get(alice.siteId).log_visitors, 0);
  const rep = await app.inject({ method: 'POST', url: '/report', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/report')).body), site: 'alice', category: 'spam', details: 'this is a scam page, please look', email: 'r@example.com' }).toString() });
  assert.equal(rep.statusCode, 302);
  assert.equal(getDb().prepare('SELECT log_visitors FROM sites WHERE id = ?').get(alice.siteId).log_visitors, 1, 'a report switches logging on');
  const adminSite = await get(`/admin/sites/${alice.siteId}`, admin.cookie);
  assert.match(adminSite.body, /Visitor log/); assert.match(adminSite.body, /EvidenceBot/); assert.match(adminSite.body, /Stop logging visitors/);
  const csv = await get(`/admin/sites/${alice.siteId}/visits.csv`, admin.cookie);
  assert.equal(csv.statusCode, 200); assert.match(csv.body, /^at_utc,at_sgt,ip,method,path/); assert.match(csv.body, /EvidenceBot/); assert.match(csv.body, / SGT,127\.0\.0\.1,GET,\/secret\.html\?x=1,https:\/\/t\.me\/x/);
  // 3. the pack: summary, manifest that verifies, custody note, every version, visits csv, SGT fields
  const pack = await get(`/admin/users/${aliceRow.id}/evidence.zip`, admin.cookie);
  assert.equal(pack.statusCode, 200);
  const files = unzipEntries(pack.rawPayload);
  for (const name of ['SUMMARY.txt', 'README.txt', 'MANIFEST.sha256', 'CHAIN_OF_CUSTODY.txt', 'versions.json', 'abuse_reports.json', 'visits/alice.csv']) assert.ok(files[name], `has ${name}`);
  assert.ok(Object.keys(files).some((n) => /^versions\/alice\/v\d+\/index\.html$/.test(n)), 'every version on disk is included');
  const manifest = files['MANIFEST.sha256'].toString();
  for (const line of manifest.trim().split('\n')) {
    const [hash, name] = line.split(/\s{2}/);
    assert.ok(files[name], `manifest names ${name}`);
    assert.equal(cryptoMod.createHash('sha256').update(files[name]).digest('hex'), hash, `hash matches for ${name}`);
  }
  const custody = files['CHAIN_OF_CUSTODY.txt'].toString();
  assert.match(custody, new RegExp(`Manifest hash ${cryptoMod.createHash('sha256').update(manifest).digest('hex')}`));
  assert.match(custody, /Generated by  admin@nsd\.test/);
  const summary = files['SUMMARY.txt'].toString();
  assert.match(summary, /EVIDENCE PACK — alice@example\.com/); assert.match(summary, /alice\.nsd\.test/); assert.match(summary, /127\.0\.0\.1/); assert.match(summary, /SGT/); assert.match(summary, /ABUSE REPORTS \([1-9]\d*\)/);
  assert.match(files['audit.jsonl'].toString().split('\n')[0], /"at_sgt":"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d SGT"/);
  assert.match(files['versions.json'].toString(), /"ip": "127\.0\.0\.1"/);
  const auditRow = getDb().prepare("SELECT details FROM audit_log WHERE action = 'admin.evidence.pack' ORDER BY id DESC LIMIT 1").get();
  assert.match(auditRow.details, /"sha256":"[0-9a-f]{64}"/, 'pack hash recorded in the audit log');
  // 4. legal hold stops purging of holds and visit rows until lifted
  const holds = listHoldsForSite(alice.siteId);
  const meta = path.join(dataDir, 'evidence', 'sites', alice.siteId, holds[0].ts, 'meta.json');
  fs.writeFileSync(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta, 'utf8')), keep_until: '2000-01-01T00:00:00.000Z' }));
  getDb().prepare("UPDATE site_visits SET at = '2000-01-01T00:00:00.000Z' WHERE site_id = ?").run(alice.siteId);
  r = await post(`/admin/users/${aliceRow.id}/action`, admin.cookie, { action: 'legal_hold', value: 'on' });
  assert.equal(getDb().prepare('SELECT legal_hold FROM users WHERE id = ?').get(aliceRow.id).legal_hold, 1);
  assert.equal(JSON.parse(fs.readFileSync(meta, 'utf8')).legal_hold, true, 'hold meta carries the legal hold');
  purgeEvidence(); assert.equal(purgeVisits(), 0);
  assert.ok(fs.existsSync(meta), 'held files survive under legal hold');
  assert.ok(getDb().prepare('SELECT COUNT(*) n FROM site_visits WHERE site_id = ?').get(alice.siteId).n > 0, 'old visit rows survive under legal hold');
  assert.match((await get(`/admin/users/${aliceRow.id}`, admin.cookie)).body, /Lift legal hold/);
  await post(`/admin/users/${aliceRow.id}/action`, admin.cookie, { action: 'legal_hold', value: 'off' });
  assert.ok(purgeEvidence() >= 1); assert.ok(purgeVisits() >= 1);
  assert.ok(!fs.existsSync(meta), 'lifted: purged');
  // 5. a stored pack: on demand, and automatically before a permanent delete; survives the account row; listed on health
  r = await post(`/admin/users/${aliceRow.id}/evidence/store`, admin.cookie, { reason: 'police report A/123' });
  assert.equal(r.statusCode, 302);
  let stored = listStoredPacks(aliceRow.id);
  assert.equal(stored.length, 1); assert.equal(stored[0].reason, 'police report A/123'); assert.match(stored[0].sha256, /^[0-9a-f]{64}$/);
  assert.match((await get(`/admin/users/${aliceRow.id}`, admin.cookie)).body, /police report A\/123/);
  resetLimit('signup:127.0.0.1');
  const su = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/signup')).body), email: 'bye@example.com', name: 'Bye', password: 'correct-horse-battery', subdomain: 'byesite', agree: '1' }).toString() });
  const byeCookie = cookiesFrom(su);
  const bye = getDb().prepare('SELECT id FROM users WHERE email = ?').get('bye@example.com');
  await upload(byeCookie, (await get('/dashboard', byeCookie)).body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1], [{ name: 'index.html', data: '<p>bye</p>' }], 'replace');
  await post(`/admin/users/${bye.id}/action`, admin.cookie, { action: 'disable' });
  r = await post(`/admin/users/${bye.id}/action`, admin.cookie, { action: 'delete_forever' });
  assert.equal(r.statusCode, 302);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(bye.id).n, 0);
  stored = listStoredPacks(bye.id);
  assert.equal(stored.length, 1); assert.equal(stored[0].email, 'bye@example.com'); assert.match(stored[0].reason, /deleted permanently/);
  const dl = await get(`/admin/evidence/packs/${bye.id}/${stored[0].ts}.zip`, admin.cookie);
  assert.equal(dl.statusCode, 200);
  const byeFiles = unzipEntries(dl.rawPayload);
  assert.match(byeFiles['SUMMARY.txt'].toString(), /bye@example\.com/);
  assert.ok(Object.keys(byeFiles).some((n) => n.startsWith('holds/byesite/')), 'files of the deleted site are in the stored pack');
  assert.equal(cryptoMod.createHash('sha256').update(dl.rawPayload).digest('hex'), stored[0].sha256, 'stored hash matches the file');
  const health = await get('/admin/health', admin.cookie);
  assert.match(health.body, /Stored evidence packs/); assert.match(health.body, /bye@example\.com/);
  assert.equal(buildPack('01AAAAAAAAAAAAAAAAAAAAAAAA'), null);
});

test('email gate: with REQUIRE_VERIFIED_EMAIL on, an unconfirmed account cannot put a site online (upload, paste, rollback); confirmed accounts can', async () => {
  const { config } = await import('../src/config.js');
  const { publishGate } = await import('../src/web/gate.js');
  resetLimit('signup:127.0.0.1');
  const su = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/signup')).body), email: 'unconfirmed@example.com', name: 'Unc', password: 'correct-horse-battery', subdomain: 'uncsite', agree: '1' }).toString() });
  const cookie = cookiesFrom(su);
  const siteId = (await get('/dashboard', cookie)).body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get('unconfirmed@example.com');
  assert.equal(publishGate(row), null, 'gate off by default in tests (no SMTP)');
  const saved = config.publish.requireVerifiedEmail; config.publish.requireVerifiedEmail = true;
  try {
    assert.match(publishGate(row), /Confirm your email before your site goes online/);
    let r = await upload(cookie, siteId, [{ name: 'index.html', data: '<h1>no</h1>' }], 'replace');
    assert.equal(r.statusCode, 403); assert.match(r.body, /Confirm your email/);
    r = await post(`/sites/${siteId}/paste`, cookie, { html: '<!doctype html><html><body><h1>no</h1></body></html>', page: '' }, `/sites/${siteId}`);
    assert.equal(r.statusCode, 302); assert.match(decodeURIComponent(String(r.headers['set-cookie'])), /Confirm your email/);
    assert.match((await get('/dashboard', cookie)).body, /cannot go online until you confirm your email/);
    assert.equal((await get('/', '', 'uncsite.nsd.test')).statusCode, 200, 'site answers with the empty page');
    assert.doesNotMatch((await get('/', '', 'uncsite.nsd.test')).body, /<h1>no<\/h1>/);
    getDb().prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?").run(row.id);
    r = await upload(cookie, siteId, [{ name: 'index.html', data: '<h1>yes</h1>' }], 'replace');
    assert.equal(r.statusCode, 200, r.body);
    assert.match((await get('/', '', 'uncsite.nsd.test')).body, /<h1>yes<\/h1>/);
  } finally { config.publish.requireVerifiedEmail = saved; }
});

test('guard rails: a site over its monthly transfer is paused at the edge; test pages refuse password forms; promo placeholders are made up', async () => {
  const { resetBandwidthCache } = await import('../src/services/bandwidth.js');
  const { flushTraffic } = await import('../src/services/sites.js');
  flushTraffic();
  const before = (await get('/', '', 'alice.nsd.test')).statusCode;
  assert.equal(before, 200);
  // pretend alice served far more than any plan allows this month
  getDb().prepare("INSERT INTO site_traffic_daily (site_id, day, requests, bytes) VALUES (?, strftime('%Y-%m-%d','now'), 1, ?) ON CONFLICT(site_id, day) DO UPDATE SET bytes = excluded.bytes").run(alice.siteId, 2 * 1024 ** 4); // 2 TB: above every plan
  resetBandwidthCache();
  const paused = await get('/', '', 'alice.nsd.test');
  assert.equal(paused.statusCode, 429); assert.match(paused.body, /used its monthly allowance/);
  getDb().prepare("DELETE FROM site_traffic_daily WHERE site_id = ? AND day = strftime('%Y-%m-%d','now')").run(alice.siteId);
  resetBandwidthCache();
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 200, 'back once the month resets');
  // try page with a login form
  const { validatePaste } = await import('../src/services/tryit.js');
  assert.match(validatePaste('<!doctype html><html><body><form><input type="password" name="p"><button>Log in</button></form></body></html>'), /password or login form/);
  assert.equal(validatePaste('<!doctype html><html><body><form><input type="email"><button>Subscribe</button></form><p>hello world page</p></body></html>'), null);
  const c = cookiesFrom(await app.inject({ method: 'POST', url: '/login', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfFrom((await get('/login')).body), email: 'alice@example.com', password: 'correct-horse-battery' }).toString() }));
  assert.match((await get('/billing', c)).body, /placeholder="e.g\. YOURCODE"/);
  assert.match((await get('/admin/promo', admin.cookie)).body, /placeholder="e.g\. WELCOME2026"/);
});

test('showcase modes: a beta (promo) site is listed by default and can be hidden; Free has no choice; Plus stays opt-in', async () => {
  const { listShowcaseSites } = await import('../src/services/sites.js');
  const { showcaseMode, getPlan } = await import('../src/services/plans.js');
  assert.equal(showcaseMode(getPlan('free').features), 'always');
  assert.equal(showcaseMode(getPlan('beta').features), 'opt_out');
  assert.equal(showcaseMode(getPlan('plus').features), 'opt_in');
  const names = () => listShowcaseSites().map((s) => s.subdomain);
  resetLimit('signup:127.0.0.1');
  const su = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/signup')).body), email: 'betty@example.com', name: 'Betty', password: 'correct-horse-battery', subdomain: 'bettysite', agree: '1' }).toString() });
  const cookie = cookiesFrom(su);
  const siteId = (await get('/dashboard', cookie)).body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  const betty = getDb().prepare('SELECT id FROM users WHERE email = ?').get('betty@example.com');
  getDb().prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?").run(betty.id);
  await upload(cookie, siteId, [{ name: 'index.html', data: '<h1>betty</h1>' }], 'replace');
  // the live strip on the home page shows real sites and links to the full showcase
  const homeLive = await get('/');
  assert.match(homeLive.body, /id="live"/);
  assert.match(homeLive.body, /bettysite\.nsd\.test/);
  assert.match(homeLive.body, /See all \d+ →/);
  // Free cannot download the site as a ZIP; the page says so
  assert.equal((await get(`/sites/${siteId}/download.zip`, cookie)).statusCode, 302, 'free: ZIP refused');
  assert.match((await get(`/sites/${siteId}`, cookie)).body, /ZIP download on Plus/);
  assert.ok(names().includes('bettysite'), 'free: listed');
  assert.doesNotMatch((await get(`/sites/${siteId}/settings`, cookie)).body, /name="listed"/, 'free: no choice');
  await post(`/admin/users/${betty.id}/action`, admin.cookie, { action: 'plan', plan_id: 'beta' });
  assert.ok(names().includes('bettysite'), 'beta: listed by default');
  // paid and code plans can pull the whole site down as a ZIP; Free cannot
  const zipR = await get(`/sites/${siteId}/download.zip`, cookie);
  assert.equal(zipR.statusCode, 200, zipR.body);
  assert.match(zipR.headers['content-type'], /application\/zip/);
  assert.match(zipR.headers['content-disposition'], /bettysite-v1\.zip/);
  assert.equal(zipR.rawPayload.subarray(0, 2).toString(), 'PK');
  assert.match((await get(`/sites/${siteId}`, cookie)).body, /Download all as ZIP/);
  // pricing copy: addresses are on nsd.sg, Plus lists its extra value
  const pricing = await get('/pricing');
  assert.match(pricing.body, /mybusiness\.nsd\.test/);
  assert.doesNotMatch(pricing.body, /like mybusiness\.sg/);
  assert.match(pricing.body, /20 versions kept/);
  assert.match(pricing.body, /Download your whole site as a ZIP/);
  assert.match(pricing.body, /first in line/);
  let settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /name="listed" value="1" checked/); assert.match(settings.body, /untick to hide it/);
  await post(`/sites/${siteId}/settings`, cookie, { title: 'Betty' }); // untick
  assert.ok(!names().includes('bettysite'), 'beta: hidden after untick');
  await post(`/sites/${siteId}/settings`, cookie, { title: 'Betty', listed: '1' });
  assert.ok(names().includes('bettysite'), 'beta: shown again');
  await post(`/admin/users/${betty.id}/action`, admin.cookie, { action: 'plan', plan_id: 'plus' });
  settings = await get(`/sites/${siteId}/settings`, cookie);
  assert.match(settings.body, /tick to be listed/);
  assert.ok(names().includes('bettysite'), 'plus: her earlier explicit choice (shown) is kept');
  const health = await get('/admin/plans?edit=beta', admin.cookie);
  assert.match(health.body, /<option value="opt_out" selected>/);
});

test('builder files: _redirects gives same-site redirects, a single-page-app fallback and gone pages; external targets are refused; hashed assets are immutable', async () => {
  resetLimit('signup:127.0.0.1');
  const su = await app.inject({ method: 'POST', url: '/signup', headers: { ...P, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfFrom((await get('/signup')).body), email: 'spa@example.com', name: 'Spa', password: 'correct-horse-battery', subdomain: 'spaapp', agree: '1' }).toString() });
  const cookie = cookiesFrom(su);
  const siteId = (await get('/dashboard', cookie)).body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  const H = 'spaapp.nsd.test';
  // an external redirect is refused before anything is published, with the line number
  let r = await upload(cookie, siteId, [{ name: 'index.html', data: '<h1>app</h1>' }, { name: '_redirects', data: '/out https://evil.example 301\n' }], 'replace');
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.body, /line 1: redirects to other websites are not allowed/);
  r = await upload(cookie, siteId, [
    { name: 'index.html', data: '<!doctype html><html><body><h1>app</h1></body></html>' },
    { name: 'about.html', data: '<p>about</p>' },
    { name: 'assets/index-BxK3f9aQ.js', data: 'console.log(1)' },
    { name: 'assets/app.js', data: 'console.log(2)' },
    { name: '_redirects', data: '/old-page /about 301\n/blog/* /about 302\n/gone / 404\n/* /index.html 200\n' },
  ], 'replace');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await get('/', '', H)).statusCode, 200);
  assert.equal((await get('/about', '', H)).statusCode, 200, 'clean URL still wins over the /* rule');
  assert.match((await get('/about', '', H)).body, /about/);
  const spa = await get('/app/settings/123', '', H);
  assert.equal(spa.statusCode, 200);
  assert.match(spa.body, /<h1>app<\/h1>/, 'unknown route serves index.html (single-page app)');
  assert.match(spa.body, /data-nsd="badge"/, 'badge still injected on the fallback');
  const red = await get('/old-page', '', H);
  assert.equal(red.statusCode, 301);
  assert.equal(red.headers.location, '/about');
  assert.equal((await get('/blog/2024/x', '', H)).statusCode, 302);
  assert.equal((await get('/gone', '', H)).statusCode, 404, 'a 404 rule marks the address gone even with an SPA fallback below it');
  assert.equal((await get('/_redirects', '', H)).statusCode, 404, 'the rules file itself is never served');
  assert.match((await get('/assets/index-BxK3f9aQ.js', '', H)).headers['cache-control'], /immutable/);
  assert.match((await get('/assets/app.js', '', H)).headers['cache-control'], /max-age=3600/);
  // availability messages say why
  assert.match((await get('/api/availability?name=mylogin')).json().reason, /word we block/);
});

test('testimonials: admin adds a quote and it shows on the home page; hide removes it; yearly Plus is offered only when a free period is ending', async () => {
  assert.doesNotMatch((await get('/')).body, /id="voices"/, 'nothing renders without quotes');
  let r = await post('/admin/health/testimonials', admin.cookie, { quote: 'Pasted my proposal and sent the link in two minutes. Client thought I hired someone.', name: 'Siti', role: 'tuition teacher', url: 'siti.nsd.test' });
  assert.equal(r.statusCode, 302, r.body);
  const home = (await get('/')).body;
  assert.match(home, /id="voices"/);
  assert.match(home, /Client thought I hired someone/);
  assert.match(home, /href="https:\/\/siti\.nsd\.test"/, 'bare site names get https');
  const id = getDb().prepare("SELECT id FROM testimonials WHERE name = 'Siti'").get().id;
  await post(`/admin/health/testimonials/${id}`, admin.cookie, { action: 'toggle' });
  assert.doesNotMatch((await get('/')).body, /id="voices"/, 'hidden quote, section gone');
  assert.match((await get('/admin/health', admin.cookie)).body, /What people say/);
  // yearly Plus: hidden from the pricing cards, named on the Plus card, offered on the Plan page near expiry
  const pricing = (await get('/pricing')).body;
  assert.doesNotMatch(pricing, /<h3>Plus yearly<\/h3>/);
  assert.match(pricing, /Or pay yearly: S\$90, two months free/);
  assert.doesNotMatch((await get('/billing', bob.cookie)).body, /Plus yearly/, 'fresh free account: no yearly offer yet');
  getDb().prepare("UPDATE users SET plan_expires_at = datetime('now', '+5 days') WHERE email = 'bob@example.com'").run();
  const bill = (await get('/billing', bob.cookie)).body;
  assert.match(bill, /Plus yearly/);
  assert.match(bill, /S\$90\/year/);
  assert.match(bill, /two months free/);
  assert.doesNotMatch(bill, /Beta yearly/, 'a Free account is not on the S$6 rate');
  // a member on the S$6 rate (Beta, or a gift plan priced like Beta) gets the S$60 yearly too
  getDb().prepare("UPDATE users SET plan_id = 'beta', plan_expires_at = datetime('now', '+5 days') WHERE email = 'bob@example.com'").run();
  const beta = (await get('/billing', bob.cookie)).body;
  assert.match(beta, /Beta yearly/);
  assert.match(beta, /S\$60\/year/);
  assert.match(beta, /Keep Beta after your free period/);
  const { upsertPlan } = await import('../src/services/plans.js');
  upsertPlan({ id: 'plus-gift6', name: 'Plus (gift)', description: 'gift', price_cents_month: 600, trial_days: 120, is_public: 0, is_default: 0, sort_order: 90, limits: { max_sites: 5, max_storage_bytes: 1024 ** 3, max_file_bytes: 50 * 1024 * 1024, max_releases: 10, max_bandwidth_bytes_month: 50 * 1024 ** 3 }, features: { branding_removable: true, custom_domains: true, showcase: 'opt_out' } });
  getDb().prepare("UPDATE users SET plan_id = 'plus-gift6', plan_expires_at = datetime('now', '+5 days') WHERE email = 'bob@example.com'").run();
  const gift = (await get('/billing', bob.cookie)).body;
  assert.match(gift, /Beta yearly/, 'gift plan at the S$6 rate sees the S$60 yearly');
  assert.match(gift, /Plus yearly/, 'and the public yearly');
  getDb().prepare("UPDATE users SET plan_id = 'free', plan_expires_at = datetime('now', '+20 days') WHERE email = 'bob@example.com'").run();
});

test('admin funnel: a user can be marked as a lead for NasarDigital and shows on the Overview funnel', async () => {
  const bobId = getDb().prepare("SELECT id FROM users WHERE email = 'bob@example.com'").get().id;
  let ov = (await get('/admin', admin.cookie)).body;
  assert.match(ov, /The Sunday funnel/);
  assert.match(ov, /Talked to you \(30 d\)/);
  assert.match(ov, /No leads marked yet/);
  const r = await post(`/admin/users/${bobId}/action`, admin.cookie, { action: 'agency_lead', value: 'on', note: 'wants a proper site for his stall' });
  assert.equal(r.statusCode, 302, r.body);
  assert.match((await get(`/admin/users/${bobId}`, admin.cookie)).body, /Not a lead after all/);
  ov = (await get('/admin', admin.cookie)).body;
  assert.match(ov, /wants a proper site for his stall/);
  assert.doesNotMatch(ov, /No leads marked yet/);
  await post(`/admin/users/${bobId}/action`, admin.cookie, { action: 'agency_lead', value: 'off' });
  assert.match((await get(`/admin/users/${bobId}`, admin.cookie)).body, /Lead for NasarDigital/);
});

test('page views: public pages are counted without cookies, bots and link previews are not, and the Overview shows the week', async () => {
  const { flushPageViews, pageViewStats } = await import('../src/services/pageviews.js');
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  flushPageViews();
  const homeBefore = getDb().prepare("SELECT COALESCE(SUM(n),0) n FROM page_views WHERE path = '/'").get().n;
  await app.inject({ method: 'GET', url: '/', headers: { host: 'nsd.test', 'user-agent': ua, referer: 'https://chat.whatsapp.com/abc' } });
  await app.inject({ method: 'GET', url: '/pricing', headers: { host: 'nsd.test', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', referer: 'https://nsd.test/' } });
  await app.inject({ method: 'GET', url: '/', headers: { host: 'nsd.test', 'user-agent': 'WhatsApp/2.23.20 A' } });
  await app.inject({ method: 'GET', url: '/', headers: { host: 'nsd.test', 'user-agent': 'facebookexternalhit/1.1' } });
  await app.inject({ method: 'GET', url: '/dashboard', headers: { host: 'nsd.test', cookie: alice.cookie, 'user-agent': ua } });
  flushPageViews();
  const v = pageViewStats({ days: 14 });
  assert.ok(v.week >= 2, `counted real visits: ${v.week}`);
  assert.ok(v.referrers.some((r) => r.host === 'chat.whatsapp.com'), 'referrer kept');
  assert.ok(!v.referrers.some((r) => r.host === 'nsd.test'), 'own host is not a referrer');
  assert.ok(v.pages.some((p) => p.path === '/pricing'));
  assert.ok(!v.pages.some((p) => p.path === '/dashboard'), 'logged-in pages are never counted');
  const homeAfter = getDb().prepare("SELECT COALESCE(SUM(n),0) n FROM page_views WHERE path = '/'").get().n;
  assert.equal(homeAfter - homeBefore, 1, 'one real visit counted; the WhatsApp preview and the Facebook crawler left out');
  const ov = (await get('/admin', admin.cookie)).body;
  assert.match(ov, /This week on nsd\.sg/);
  assert.match(ov, /chat\.whatsapp\.com/);
  assert.match(ov, /Chain, last 7 days/);
  // the per-site visit beacon counts a view for a live site and always answers a pixel
  const { flushTraffic } = await import('../src/services/sites.js');
  const before = getDb().prepare("SELECT COALESCE(SUM(requests),0) n FROM site_traffic_daily WHERE site_id = ?").get(alice.siteId).n;
  const b = await app.inject({ method: 'GET', url: '/_v/alice?p=%2F&r=', headers: { host: 'nsd.test', 'user-agent': ua } });
  assert.equal(b.statusCode, 200); assert.match(b.headers['content-type'], /image\/gif/);
  await app.inject({ method: 'GET', url: '/_v/alice', headers: { host: 'nsd.test', 'user-agent': 'Googlebot/2.1' } });
  await app.inject({ method: 'GET', url: '/_v/nobody-here', headers: { host: 'nsd.test', 'user-agent': ua } });
  flushTraffic();
  const after = getDb().prepare("SELECT COALESCE(SUM(requests),0) n FROM site_traffic_daily WHERE site_id = ?").get(alice.siteId).n;
  assert.equal(after - before, 1, 'one real view counted, the bot and the unknown site not');
});
