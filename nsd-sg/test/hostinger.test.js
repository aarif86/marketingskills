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

test('promo code moves a user to the beta plan; showcase lists live sites; badge demo renders', async () => {
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' });
  const admin = cookiesFrom(login);
  let r = await post('/admin/promo', admin, { action: 'create', code: 'beta-test', plan_id: 'beta', max_uses: '2', expires_days: '30', note: 't' }, '/admin/promo');
  assert.equal(r.statusCode, 302);
  const signup = await post('/signup', '', { email: 'dave@example.com', name: 'Dave', password: 'correct-horse-battery', subdomain: 'dave', agree: '1' });
  const dave = cookiesFrom(signup);
  r = await post('/billing/redeem', dave, { code: 'BETA-TEST' }, '/billing');
  assert.equal(r.statusCode, 302);
  const bill = await get('/billing', dave);
  assert.match(bill.body, /Current plan: Beta/);
  r = await post('/billing/redeem', dave, { code: 'BETA-TEST' }, '/billing');
  assert.equal(getDb().prepare("SELECT uses FROM promo_codes WHERE code = 'BETA-TEST'").get().uses, 1, 'second redeem refused');
  assert.match(bill.body, /unlocked Beta/, 'comparison box shows what the code unlocked');
  assert.match(bill.body, /Remove promo code/);
  // extension request -> pending state replaces the form
  r = await post('/billing/extend', dave, { reason: 'Still building my site', note: 'A portfolio for my freelance work, launching next month.' }, '/billing');
  const bill2 = await get('/billing', dave);
  assert.match(bill2.body, /Free extension submitted/);
  assert.doesNotMatch(bill2.body, /Request free extension/);
  // remove the promo -> back to free with the old expiry; the code stays used
  const before = getDb().prepare("SELECT prev_expires_at FROM promo_redemptions WHERE code = 'BETA-TEST'").get().prev_expires_at;
  r = await post('/billing/promo/remove', dave, {}, '/billing');
  assert.equal(r.statusCode, 302);
  const u = getDb().prepare("SELECT plan_id, plan_expires_at FROM users WHERE email = 'dave@example.com'").get();
  assert.equal(u.plan_id, 'free');
  assert.equal(u.plan_expires_at, before);
  r = await post('/billing/redeem', dave, { code: 'BETA-TEST' }, '/billing');
  assert.equal(getDb().prepare("SELECT plan_id FROM users WHERE email = 'dave@example.com'").get().plan_id, 'free', 'removed code cannot be redeemed again');
  // idea with a screenshot attached (multipart)
  const csrf = csrfFrom((await get('/roadmap', dave)).body);
  const B = '----nsdtest';
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const body = Buffer.concat([
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${csrf}\r\n--${B}\r\nContent-Disposition: form-data; name="title"\r\n\r\nUpload progress is hard to see\r\n--${B}\r\nContent-Disposition: form-data; name="files"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`),
    png, Buffer.from(`\r\n--${B}\r\nContent-Disposition: form-data; name="files"; filename="evil.php"\r\nContent-Type: text/plain\r\n\r\n<?php\r\n--${B}--\r\n`)]);
  r = await app.inject({ method: 'POST', url: '/roadmap/suggest', headers: { host: H, cookie: dave, origin: `http://${H}`, 'content-type': `multipart/form-data; boundary=${B}` }, body });
  assert.equal(r.statusCode, 302);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM roadmap_attachments").get().n, 0, 'a rejected file rejects the whole idea');
  const body2 = Buffer.concat([
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${csrf}\r\n--${B}\r\nContent-Disposition: form-data; name="title"\r\n\r\nUpload progress is hard to see\r\n--${B}\r\nContent-Disposition: form-data; name="files"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`),
    png, Buffer.from(`\r\n--${B}--\r\n`)]);
  r = await app.inject({ method: 'POST', url: '/roadmap/suggest', headers: { host: H, cookie: dave, origin: `http://${H}`, 'content-type': `multipart/form-data; boundary=${B}` }, body: body2 });
  const att = getDb().prepare("SELECT * FROM roadmap_attachments").get();
  assert.ok(att && att.ext === 'png' && att.bytes === 8, 'attachment recorded');
  const adminPage = await get('/admin/roadmap', admin);
  assert.match(adminPage.body, /shot\.png/);
  const dl = await get(`/admin/roadmap/attachments/${att.id}`, admin);
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-type'], 'image/png');
  assert.notEqual((await get(`/admin/roadmap/attachments/${att.id}`, dave)).statusCode, 200, 'non-admin cannot fetch attachments');
  // showcase + badge pages are public
  const sc = await get('/showcase');
  assert.equal(sc.statusCode, 200);
  const badge = await get('/badge');
  assert.equal(badge.statusCode, 200);
  assert.match(badge.body, /data-nsd="badge"/);
  assert.doesNotMatch(badge.body, /MutationObserver/);
  // blocked-name watchdog
  const bad = await post('/signup', '', { email: 'eve@example.com', name: 'Eve', password: 'correct-horse-battery', subdomain: 'freeporn', agree: '1' });
  assert.equal(bad.statusCode, 200);
  assert.match(bad.body, /not available/);
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'security.blocked_name'").get());
});

test('HitPay webhook: bad signature rejected; good charge activates a paid plan with no expiry; cancel gives 30-day grace', async () => {
  const crypto = await import('node:crypto');
  const { config } = await import('../src/config.js');
  config.hitpay.webhookSalt = 'test-salt';
  const { getDb: db } = await import('../src/db/index.js');
  const signup = await post('/signup', '', { email: 'fay@example.com', name: 'Fay', password: 'correct-horse-battery', subdomain: 'fay', agree: '1' });
  assert.equal(signup.statusCode, 302);
  const fay = db().prepare("SELECT id FROM users WHERE email = 'fay@example.com'").get();
  db().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('rb_1', ?, 'plus', 'pending', ?)").run(fay.id, `${fay.id}:plus:abc`);
  // an earlier checkout the user abandoned (closed the HitPay tab) and a very old one
  db().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('rb_0', ?, 'plus', 'pending', ?)").run(fay.id, `${fay.id}:plus:old`);
  db().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference, created_at) VALUES ('rb_stale', ?, 'beta', 'pending', ?, '2026-01-01T00:00:00.000Z')").run(fay.id, `${fay.id}:beta:zzz`);
  const { expireStalePending } = await import('../src/services/hitpay.js');
  assert.equal(expireStalePending(fay.id), 1, 'only the stale row times out');
  assert.equal(db().prepare("SELECT status FROM subscriptions WHERE id = 'rb_stale'").get().status, 'abandoned');
  const body = JSON.stringify({ recurring_billing_id: 'rb_1', status: 'succeeded', amount: 9, currency: 'SGD', customer: { email: 'fay@example.com' } });
  const bad = await app.inject({ method: 'POST', url: '/billing/hitpay/webhook', headers: { host: H, 'content-type': 'application/json', 'hitpay-signature': 'nope' }, body });
  assert.equal(bad.statusCode, 401);
  const sig = crypto.createHmac('sha256', 'test-salt').update(body).digest('hex');
  const ok = await app.inject({ method: 'POST', url: '/billing/hitpay/webhook', headers: { host: H, 'content-type': 'application/json', 'hitpay-signature': sig, 'hitpay-event-type': 'charge.created' }, body });
  assert.equal(ok.statusCode, 200, ok.body);
  let u = db().prepare('SELECT plan_id, plan_expires_at FROM users WHERE id = ?').get(fay.id);
  assert.equal(u.plan_id, 'plus');
  assert.equal(u.plan_expires_at, null, 'paid plan never expires');
  assert.equal(db().prepare("SELECT status FROM subscriptions WHERE id = 'rb_1'").get().status, 'active');
  assert.equal(db().prepare("SELECT status FROM subscriptions WHERE id = 'rb_0'").get().status, 'abandoned', 'sibling pending checkout superseded on activation');
  const cancel = JSON.stringify({ recurring_billing_id: 'rb_1', status: 'canceled' });
  const sig2 = crypto.createHmac('sha256', 'test-salt').update(cancel).digest('hex');
  await app.inject({ method: 'POST', url: '/billing/hitpay/webhook', headers: { host: H, 'content-type': 'application/json', 'hitpay-signature': sig2, 'hitpay-event-type': 'recurring_billing.subscription_updated' }, body: cancel });
  u = db().prepare('SELECT plan_id, plan_expires_at FROM users WHERE id = ?').get(fay.id);
  assert.equal(u.plan_id, 'plus');
  assert.ok(u.plan_expires_at && new Date(u.plan_expires_at) > new Date(), 'grace period set');
  // Cancel keeps the plan to the end of the paid month: last_paid_at (set by the charge above) + 1 month, not +30 days from now.
  const paid = db().prepare("SELECT last_paid_at FROM subscriptions WHERE id = 'rb_1'").get().last_paid_at;
  assert.ok(paid, 'last_paid_at recorded on activation');
  const expectEnd = new Date(paid); expectEnd.setUTCMonth(expectEnd.getUTCMonth() + 1);
  assert.equal(u.plan_expires_at, expectEnd.toISOString(), 'expiry = last charge + 1 month');
  // A cancel must never pull an admin-extended expiry closer.
  db().prepare("UPDATE subscriptions SET status = 'active' WHERE id = 'rb_1'").run();
  db().prepare("UPDATE users SET plan_expires_at = '2027-04-01T00:00:00.000Z' WHERE id = ?").run(fay.id);
  await app.inject({ method: 'POST', url: '/billing/hitpay/webhook', headers: { host: H, 'content-type': 'application/json', 'hitpay-signature': sig2, 'hitpay-event-type': 'recurring_billing.subscription_updated' }, body: cancel });
  assert.equal(db().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(fay.id).plan_expires_at, '2027-04-01T00:00:00.000Z', 'later expiry kept');
});

test('roadmap and changelog: public pages render seed content; logged-in user can vote and suggest', async () => {
  let r = await get('/roadmap');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Card payments through HitPay/);
  r = await get('/changelog');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /NSD.SG goes live/);
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' });
  const c = cookiesFrom(login);
  r = await post('/roadmap/vote/rm-google-login', c, {}, '/roadmap');
  assert.equal(r.statusCode, 302);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM roadmap_votes WHERE item_id = 'rm-google-login'").get().n, 1);
  r = await post('/roadmap/suggest', c, { title: 'Scheduled publishing', body: 'Publish at 9am' }, '/roadmap');
  assert.equal(r.statusCode, 302);
  const item = getDb().prepare("SELECT * FROM roadmap_items WHERE title = 'Scheduled publishing'").get();
  assert.equal(item.status, 'under_review');
  assert.equal(item.is_public, 0);
  const pub = await get('/roadmap');
  assert.doesNotMatch(pub.body, /Scheduled publishing/, 'hidden until admin approves');
});

test('HitPay charge webhooks (no reference) link by customer email; refund is recorded, payment id stored', async () => {
  const crypto = await import('node:crypto');
  const { config } = await import('../src/config.js');
  config.hitpay.webhookSalt = 'test-salt';
  const { getDb: db } = await import('../src/db/index.js');
  const signup = await post('/signup', '', { email: 'gus@example.com', name: 'Gus', password: 'correct-horse-battery', subdomain: 'gus', agree: '1' });
  assert.equal(signup.statusCode, 302);
  const gus = db().prepare("SELECT id FROM users WHERE email = 'gus@example.com'").get();
  db().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('rb_g', ?, 'beta', 'pending', ?)").run(gus.id, `${gus.id}:beta:g1`);
  const send = async (payload, type) => {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 'test-salt').update(body).digest('hex');
    return app.inject({ method: 'POST', url: '/billing/hitpay/webhook', headers: { host: H, 'content-type': 'application/json', 'hitpay-signature': sig, 'hitpay-event-type': type }, body });
  };
  // Real shape seen in production: payment "created" event, no reference, no recurring_billing_id, customer email only.
  const charge = { id: 'pay_123', business_id: 'b', channel: 'card', status: 'succeeded', customer: { email: 'gus@example.com' }, currency: 'SGD', amount: 6, refunded_amount: 0, order_id: null, payment_request_id: 'pr_1' };
  let r = await send(charge, 'created');
  assert.equal(r.statusCode, 200);
  let s = db().prepare("SELECT status, last_payment_id FROM subscriptions WHERE id = 'rb_g'").get();
  assert.equal(s.status, 'active');
  assert.equal(s.last_payment_id, 'pr_1');
  assert.equal(db().prepare('SELECT plan_id FROM users WHERE id = ?').get(gus.id).plan_id, 'beta');
  // Refund of that charge: same shape with refunded_amount > 0. Must not re-activate anything, must be recorded.
  r = await send({ ...charge, refunded_amount: 6, refunded_at: '2026-09-20T01:00:00Z' }, 'updated');
  assert.equal(r.statusCode, 200);
  s = db().prepare("SELECT status, last_event FROM subscriptions WHERE id = 'rb_g'").get();
  assert.equal(s.last_event, 'refunded');
  const ev = db().prepare("SELECT type, details FROM plan_events WHERE user_id = ? AND type = 'refund'").get(gus.id);
  assert.ok(ev, 'refund plan event recorded');
  assert.equal(JSON.parse(ev.details).amount, 6);
  // The real production payload: subscription id + reference nested under relatable.business_charge, email of a
  // different account. Must match by the nested reference, not the email.
  db().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('a2a7d144', ?, 'beta', 'pending', ?)").run(gus.id, `${gus.id}:beta:5G25MJ`);
  const prod = { id: 'a2a7d1be', business_id: 'b', channel: 'recurrent', status: 'succeeded', customer: { name: 'Other', email: 'other@example.com' }, currency: 'sgd', amount: 6,
    refunded_amount: 0, refunded_at: null, order: null, order_id: null, remark: 'NSD.SG Beta', payment_intents: [], payment_request_id: null,
    relatable: { type: 'business_charge', business_charge: { id: 'a2a7d144', name: 'NSD.SG Beta', reference: `${gus.id}:beta:5G25MJ`, status: 'active', price: 6 } } };
  r = await send(prod, 'created');
  assert.equal(r.statusCode, 200);
  s = db().prepare("SELECT status, last_payment_id FROM subscriptions WHERE id = 'a2a7d144'").get();
  assert.equal(s.status, 'active');
  assert.equal(s.last_payment_id, 'a2a7d1be', 'charge id stored so admin refund works');
  // Unknown customer still lands as unknown subscription (no crash, no side effects).
  r = await send({ ...charge, customer: { email: 'nobody@example.com' } }, 'created');
  assert.equal(r.statusCode, 200);
  const last = db().prepare("SELECT details FROM audit_log WHERE action = 'hitpay.webhook' ORDER BY id DESC LIMIT 1").get();
  assert.match(last.details, /unknown subscription/);
});


test('paidUntil: end of paid month, with a floor for failed renewals and unknown dates', async () => {
  const { paidUntil } = await import('../src/services/hitpay.js');
  const d25 = new Date(Date.now() - 25 * 86400000);
  const end = new Date(d25); end.setUTCMonth(end.getUTCMonth() + 1);
  assert.equal(paidUntil(d25.toISOString()), end.toISOString());
  const stale = new Date(Date.now() - 60 * 86400000).toISOString();
  const floorCancel = new Date(paidUntil(stale)).getTime();
  assert.ok(floorCancel > Date.now() + 0.9 * 86400000 && floorCancel < Date.now() + 1.1 * 86400000, 'stale paid date -> ~1 day floor');
  const floorFailed = new Date(paidUntil(stale, 'failed')).getTime();
  assert.ok(floorFailed > Date.now() + 2.9 * 86400000 && floorFailed < Date.now() + 3.1 * 86400000, 'failed renewal -> ~3 day floor');
  assert.ok(new Date(paidUntil(null)).getTime() > Date.now(), 'unknown date still gives a floor');
});

test('promo: a redeemed code is retired not deleted; an unused code is deleted; paying subscribers cannot remove their promo', async () => {
  const { getDb: db } = await import('../src/db/index.js');
  const { createPromoCode, deletePromoCode, redeemPromoCode, removePromo } = await import('../src/services/plans.js');
  const { reset } = await import('../src/lib/ratelimit.js');
  reset('signup:127.0.0.1'); // this file has already signed up several users from the same test IP
  const signup = await post('/signup', '', { email: 'ivy@example.com', password: 'correct-horse-battery', agree: '1' });
  assert.equal(signup.statusCode, 302);
  const ivy = db().prepare("SELECT id FROM users WHERE email = 'ivy@example.com'").get();
  assert.equal(createPromoCode({ code: 'USED1', planId: 'beta', maxUses: 5 }).ok, true);
  assert.equal(createPromoCode({ code: 'FRESH1', planId: 'beta', maxUses: 5 }).ok, true);
  assert.equal(redeemPromoCode({ userId: ivy.id, code: 'USED1' }).ok, true);
  const r1 = deletePromoCode('USED1');
  assert.deepEqual({ ok: r1.ok, retired: r1.retired, used: r1.used }, { ok: true, retired: true, used: 1 });
  const row = db().prepare("SELECT * FROM promo_codes WHERE code = 'USED1'").get();
  assert.ok(row, 'kept for the records');
  assert.ok(new Date(row.expires_at) <= new Date(), 'expired now');
  assert.equal(deletePromoCode('FRESH1').deleted, true);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM promo_codes WHERE code = 'FRESH1'").get().n, 0);
  // Paying subscriber: promo removal refused, billing page hides the promo box.
  db().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('rb_ivy', ?, 'beta', 'active', 'x')").run(ivy.id);
  const rem = removePromo({ userId: ivy.id });
  assert.equal(rem.ok, false);
  assert.match(rem.reason, /active paid subscription/);
  const cookie = cookiesFrom(signup);
  const page = await app.inject({ method: 'GET', url: '/billing', headers: { host: H, cookie } });
  assert.doesNotMatch(page.body, /unlocked Beta/);
  assert.match(page.body, /Subscription/);
});
