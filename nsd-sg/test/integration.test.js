// End-to-end through Fastify's inject(): signup → site → upload → tenant serving → isolation → admin.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from './helpers/zipwriter.js';
import { multipart, cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

const { buildApp } = await import('../src/server.js');

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
  assert.match(r.body, /Who this is for/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
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
  assert.doesNotMatch((await get('/', '', 'alice.nsd.test')).body, /data-nsd="badge"/);
  r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'branding', value: 'shown' });
  assert.match((await get('/', '', 'alice.nsd.test')).body, /data-nsd="badge"/);

  r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'suspend', reason: 'test' });
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 451);
  r = await post(`/admin/sites/${alice.siteId}/action`, admin.cookie, { action: 'unsuspend' });
  assert.equal((await get('/', '', 'alice.nsd.test')).statusCode, 200);

  r = await post('/admin/reserved', admin.cookie, { action: 'add', names: 'brandx brandy', reason: 'trademark' });
  assert.equal((await get('/api/availability?name=brandx')).json().reason, 'That name is reserved.');
  // Blocked words match inside any name; system words cannot be removed; admin words can.
  assert.equal((await get('/api/availability?name=hamas-relief')).json().reason, 'That name is not available.');
  assert.equal((await get('/api/availability?name=israel')).json().reason, 'That name is reserved.');
  assert.equal((await get('/api/availability?name=israeli-food')).json().available, true, 'country names are exact-match only');
  assert.equal((await get('/api/availability?name=badwordshop')).json().available, true);
  r = await post('/admin/reserved', admin.cookie, { action: 'add-word', words: 'badword', reason: 'test' });
  assert.equal(r.statusCode, 302);
  assert.equal((await get('/api/availability?name=badwordshop')).json().reason, 'That name is not available.');
  assert.match((await get('/admin/reserved', admin.cookie)).body, /Blocked words/);
  r = await post('/admin/reserved', admin.cookie, { action: 'remove-word', word: 'badword' });
  assert.equal((await get('/api/availability?name=badwordshop')).json().available, true);
  r = await post('/admin/reserved', admin.cookie, { action: 'remove-word', word: 'terror' });
  assert.equal((await get('/api/availability?name=terrorsg')).json().reason, 'That name is not available.', 'system word stays');
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
