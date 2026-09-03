// Hostinger publisher: the DB → docroot materialiser used on managed hosting (no API token = local mode).
import './helpers/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from './helpers/zipwriter.js';
import { dataDir, multipart, cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

// Enable the publisher before src/config.js is evaluated.
process.env.TENANT_ROOT = path.join(dataDir, 'public_html', 'tenants');
process.env.HOSTINGER_USERNAME = 'u000000000';

const { buildApp } = await import('../src/server.js');
const { syncSite, listOrphanDirs, tenantDir } = await import('../src/publish/hostinger.js');
const { getDb } = await import('../src/db/index.js');

let app;
const user = { cookie: '', siteId: '' };
const admin = { cookie: '' };
const H = 'nsd.test';

before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });

const get = (url, cookie = '') => app.inject({ method: 'GET', url, headers: { host: H, cookie } });
async function post(url, cookie, form, pageUrl) {
  const csrf = csrfFrom((await get(pageUrl ?? url, cookie)).body);
  return app.inject({ method: 'POST', url, headers: { host: H, cookie, 'content-type': 'application/x-www-form-urlencoded', origin: `http://${H}` }, body: new URLSearchParams({ _csrf: csrf, ...form }).toString() });
}
const read = (label, file) => fs.readFileSync(path.join(tenantDir(label), file), 'utf8');
const exists = (label, file) => fs.existsSync(path.join(tenantDir(label), file));

test('signup provisions a docroot with the coming-soon page', async () => {
  const r = await post('/signup', '', { email: 'carol@example.com', name: 'Carol', password: 'correct-horse-battery', subdomain: 'carol', agree: '1' });
  assert.equal(r.statusCode, 302);
  user.cookie = cookiesFrom(r);
  const dash = await get('/dashboard', user.cookie);
  user.siteId = dash.body.match(/href="\/sites\/([A-Z0-9]{26})"/)[1];
  await new Promise((r) => setTimeout(r, 50)); // provisioning is fire-and-forget
  assert.ok(fs.existsSync(tenantDir('carol')), 'tenant dir created');
  assert.match(read('carol', 'index.html'), /Coming soon/);
  assert.match(read('carol', '.htaccess'), /Options -Indexes/);
  const row = getDb().prepare('SELECT hosting_state FROM sites WHERE id = ?').get(user.siteId);
  assert.equal(row.hosting_state, 'pending'); // no API token in tests: stays pending, docroot still built
});

test('deploying a ZIP materialises files with the badge injected; dotfiles dropped; custom 404 wired', async () => {
  const zip = buildZip([
    { name: 'index.html', data: '<!doctype html><html><body><h1>Hi</h1></body></html>' },
    { name: 'about.html', data: '<html><body>About</body></html>' },
    { name: 'style.css', data: 'body{color:red}' },
    { name: '404.html', data: '<html><body>custom 404</body></html>' },
    { name: '.hidden', data: 'x' },
    { name: 'img/pixel.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ]);
  const csrf = csrfFrom((await get(`/sites/${user.siteId}`, user.cookie)).body);
  const mp = multipart({ _csrf: csrf, mode: 'replace' }, [{ name: 'site.zip', data: zip, type: 'application/zip' }]);
  const r = await app.inject({ method: 'POST', url: `/sites/${user.siteId}/upload`, headers: { host: H, cookie: user.cookie, accept: 'application/json', origin: `http://${H}`, ...mp.headers }, body: mp.body });
  assert.equal(r.statusCode, 200, r.body);
  const idx = read('carol', 'index.html');
  assert.match(idx, /data-nsd="badge"/, 'badge injected');
  assert.match(idx, /MutationObserver/, 'guard script present');
  assert.match(read('carol', 'about.html'), /data-nsd="badge"/);
  assert.equal(read('carol', 'style.css'), 'body{color:red}');
  assert.ok(exists('carol', 'img/pixel.png'));
  assert.ok(!exists('carol', '.hidden'), 'dotfile not published');
  assert.match(read('carol', '.htaccess'), /ErrorDocument 404 \/404\.html/);
  assert.ok(!fs.existsSync(tenantDir('carol') + '.new') && !fs.existsSync(tenantDir('carol') + '.old'), 'swap left no temp dirs');
  // the stored release stays pristine
  const rel = getDb().prepare('SELECT current_release_id FROM sites WHERE id = ?').get(user.siteId).current_release_id;
  const pristine = fs.readFileSync(path.join(dataDir, 'sites', user.siteId, 'releases', rel, 'index.html'), 'utf8');
  assert.doesNotMatch(pristine, /data-nsd/);
});

test('admin suspend darkens the docroot; restore republishes; branding removal drops the badge', async () => {
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' });
  admin.cookie = cookiesFrom(login);
  const site = `/admin/sites/${user.siteId}`;
  let r = await post(`${site}/action`, admin.cookie, { action: 'suspend', reason: 'test' }, site);
  assert.ok(r.statusCode < 400);
  assert.match(read('carol', 'index.html'), /unavailable/);
  assert.ok(!exists('carol', 'about.html'));
  r = await post(`${site}/action`, admin.cookie, { action: 'unsuspend' }, site);
  assert.match(read('carol', 'about.html'), /About/);
  r = await post(`${site}/action`, admin.cookie, { action: 'branding', value: 'removed' }, site);
  assert.doesNotMatch(read('carol', 'index.html'), /data-nsd="badge"/);
  r = await post(`${site}/action`, admin.cookie, { action: 'branding', value: 'default' }, site);
  assert.match(read('carol', 'index.html'), /data-nsd="badge"/);
});

test('rollback republishes the older release', async () => {
  const csrf = csrfFrom((await get(`/sites/${user.siteId}`, user.cookie)).body);
  const mp = multipart({ _csrf: csrf, mode: 'replace' }, [{ name: 'index.html', data: '<html><body>v2</body></html>', type: 'text/html' }]);
  await app.inject({ method: 'POST', url: `/sites/${user.siteId}/upload`, headers: { host: H, cookie: user.cookie, accept: 'application/json', origin: `http://${H}`, ...mp.headers }, body: mp.body });
  assert.match(read('carol', 'index.html'), /v2/);
  assert.ok(!exists('carol', 'about.html'));
  const releases = getDb().prepare('SELECT id FROM releases WHERE site_id = ? ORDER BY version ASC').all(user.siteId);
  const r = await post(`/sites/${user.siteId}/rollback`, user.cookie, { release_id: releases[0].id }, `/sites/${user.siteId}`);
  assert.ok(r.statusCode < 400);
  assert.match(read('carol', 'index.html'), /<h1>Hi<\/h1>/);
  assert.ok(exists('carol', 'about.html'));
});

test('syncSite is safe to call repeatedly and reports orphans', async () => {
  assert.equal(syncSite(user.siteId).ok, true);
  fs.mkdirSync(path.join(process.env.TENANT_ROOT, 'ghost'), { recursive: true });
  assert.deepEqual(listOrphanDirs(), ['ghost']);
});

test('deleting the site removes the docroot', async () => {
  const r = await post(`/sites/${user.siteId}/delete`, user.cookie, { confirm: 'carol' }, `/sites/${user.siteId}`);
  assert.ok(r.statusCode < 400, r.body);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(tenantDir('carol')));
});

test('admin health page renders the publisher block with orphan removal forms carrying a CSRF token', async () => {
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' });
  const cookie = cookiesFrom(login);
  const r = await get('/admin/health', cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Hostinger publisher/);
  const form = r.body.match(/<form method="post" action="\/admin\/health\/orphan"[^]*?<\/form>/)[0];
  assert.match(form, /name="_csrf" value="[A-Za-z0-9_-]{20,}"/);
  assert.match(form, /name="name" value="ghost"/);
  const rm = await post('/admin/health/orphan', cookie, { name: 'ghost' }, '/admin/health');
  assert.equal(rm.statusCode, 302);
  assert.deepEqual(listOrphanDirs(), []);
});
