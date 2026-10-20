// Plan lifecycle: instant first extension, reminders, own domain off at +30d, holding page at +60d, removal at +150d.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

const { buildApp } = await import('../src/server.js');
const { getDb } = await import('../src/db/index.js');
const { reset } = await import('../src/lib/ratelimit.js');
const { lifecycleSweep } = await import('../src/services/lifecycle.js');
const { setResolver } = await import('../src/services/domains.js');

let app;
const H = 'nsd.test';
const u = { cookie: '', id: '', siteId: '' };
before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });

const get = (url, cookie = '', host = H) => app.inject({ method: 'GET', url, headers: { host, cookie } });
async function post(url, cookie, form, pageUrl) {
  const csrf = csrfFrom((await get(pageUrl ?? url, cookie)).body);
  return app.inject({ method: 'POST', url, headers: { host: H, cookie, 'content-type': 'application/x-www-form-urlencoded', origin: `http://${H}` }, body: new URLSearchParams({ _csrf: csrf, ...form }).toString() });
}
const flashOf = (r) => decodeURIComponent([].concat(r.headers['set-cookie'] ?? []).join(';'));
const setExpiry = (daysFromNow) => getDb().prepare('UPDATE users SET plan_expires_at = ? WHERE id = ?').run(new Date(Date.now() + daysFromNow * 86400000).toISOString(), u.id);
const notices = () => { const ref = getDb().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(u.id).plan_expires_at; return getDb().prepare('SELECT kind FROM plan_notices WHERE user_id = ? AND ref = ? ORDER BY rowid').all(u.id, ref).map((r) => r.kind).sort(); };
const DAY = 86400000;

test('first extension is instant; the second waits for a person', async () => {
  reset('signup:127.0.0.1');
  const r = await post('/signup', '', { email: 'noor@example.com', name: 'Noor', password: 'correct-horse-battery', subdomain: 'noor', agree: '1' }, '/signup');
  u.cookie = cookiesFrom(r);
  u.id = getDb().prepare('SELECT id FROM users WHERE email = ?').get('noor@example.com').id;
  u.siteId = getDb().prepare('SELECT id FROM sites WHERE user_id = ?').get(u.id).id;
  const csrf = csrfFrom((await get(`/sites/${u.siteId}`, u.cookie)).body);
  await app.inject({ method: 'POST', url: `/sites/${u.siteId}/paste`, headers: { host: H, cookie: u.cookie, origin: `http://${H}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, html: '<!doctype html><html><body><h1>Noor</h1></body></html>' }).toString() });
  const before = getDb().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(u.id).plan_expires_at;
  let x = await post('/billing/extend', u.cookie, { reason: 'Still building my site', note: 'Need a few more weeks to finish the pages please.' }, '/billing');
  assert.match(flashOf(x), /Done\. You have 30 more days/);
  const after1 = getDb().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(u.id).plan_expires_at;
  assert.ok(Date.parse(after1) - Date.parse(before) > 29 * DAY, 'extended by 30 days');
  x = await post('/billing/extend', u.cookie, { reason: 'Still building my site', note: 'One more month would really help me finish this.' }, '/billing');
  assert.match(flashOf(x), /Second extension request sent/);
  assert.match((await get('/billing', u.cookie)).body, /Free extension submitted/);
});

test('a 120-day gift plan still gets only 30 instant days; Keep-my-plan is listed first', async () => {
  const { upsertPlan, assignPlan } = await import('../src/services/plans.js');
  const { autoExtendOrQueue } = await import('../src/services/lifecycle.js');
  upsertPlan({ id: 'plus-gift', name: 'Plus (gift)', description: 'gift', price_cents_month: 600, trial_days: 120, is_public: 0, is_default: 0, sort_order: 50,
    limits: { max_sites: 5, max_storage_bytes: 1024 ** 3, max_file_bytes: 50 * 1024 ** 2, max_releases: 10, max_bandwidth_bytes_month: 50 * 1024 ** 3 },
    features: { branding_removable: true, custom_domains: true, version_history: true, analytics: false, priority_support: false, hide_from_showcase: false } });
  reset('signup:127.0.0.1');
  const r = await post('/signup', '', { email: 'gift@example.com', name: 'Gift', password: 'correct-horse-battery', subdomain: 'giftsite', agree: '1' }, '/signup');
  const cookie = cookiesFrom(r);
  const id = getDb().prepare('SELECT id FROM users WHERE email = ?').get('gift@example.com').id;
  assignPlan({ userId: id, planId: 'plus-gift', reason: 'test' });
  const page = (await get('/billing', cookie)).body;
  assert.match(page, /Your first extension is instant: 30 more days/);
  assert.ok(page.indexOf('Keep Plus (gift)') < page.indexOf('>Plus</strong>'), 'own plan listed before public Plus');
  const before = Date.parse(getDb().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(id).plan_expires_at);
  const x = autoExtendOrQueue({ user: getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) });
  assert.equal(x.days, 30);
  const after = Date.parse(getDb().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(id).plan_expires_at);
  assert.ok(after - before < 31 * DAY && after - before > 29 * DAY, 'capped at 30 days');
});

test('reminders go out once per expiry date; site stays online at day 0', async () => {
  setExpiry(6);
  await lifecycleSweep();
  assert.deepEqual(notices(), ['expiring_7']);
  await lifecycleSweep();
  assert.deepEqual(notices(), ['expiring_7'], 'not twice');
  setExpiry(0.5);
  await lifecycleSweep();
  assert.deepEqual(notices(), ['expiring_1', 'expiring_7'], 'a new date starts a fresh set; both fire at half a day');
  setExpiry(-1);
  await lifecycleSweep();
  assert.ok(notices().includes('expired'));
  assert.match((await get('/', '', 'noor.nsd.test')).body, /<h1>Noor<\/h1>/, 'still online');
  assert.equal((await get(`/sites/${u.siteId}`, u.cookie)).body.includes('plan ended'), true);
});

test('own domain stops answering 30 days after expiry; holding page at 60; removal at 150 with a warning first', async () => {
  // give the user a connected domain (Plus features via override, then expire)
  getDb().prepare("UPDATE users SET plan_id = 'plus', plan_expires_at = ? WHERE id = ?").run(new Date(Date.now() + DAY).toISOString(), u.id);
  let r = await post(`/sites/${u.siteId}/domains`, u.cookie, { hostname: 'noor.sg' }, `/sites/${u.siteId}/settings`);
  const d = getDb().prepare('SELECT * FROM custom_domains WHERE hostname = ?').get('noor.sg');
  setResolver({ txt: async () => [[`nsd-verify=${d.verify_token}`]], cname: async () => ['noor.nsd.test'], a: async () => [] });
  await post(`/sites/${u.siteId}/domains/${d.id}/check`, u.cookie, {}, `/sites/${u.siteId}/settings`);
  assert.match((await get('/', '', 'noor.sg')).body, /<h1>Noor<\/h1>/, 'domain serves while active');
  setExpiry(-31);
  r = await get('/', '', 'www.noor.sg');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, 'http://noor.nsd.test/');
  assert.match((await get('/', '', 'noor.nsd.test')).body, /<h1>Noor<\/h1>/, 'nsd.sg address still fine at +31');
  setExpiry(-61);
  const hold = await get('/', '', 'noor.nsd.test');
  assert.equal(hold.statusCode, 200);
  assert.match(hold.body, /This page has moved on/);
  await lifecycleSweep();
  assert.ok(notices().includes('dormant'));
  setExpiry(-144);
  await lifecycleSweep();
  assert.ok(notices().includes('delete_warning'));
  assert.equal(getDb().prepare('SELECT status FROM sites WHERE id = ?').get(u.siteId).status, 'live', 'not yet');
  setExpiry(-151);
  const out = await lifecycleSweep();
  assert.equal(out.deleted, 1);
  assert.equal(getDb().prepare('SELECT status FROM sites WHERE id = ?').get(u.siteId).status, 'deleted');
  assert.ok(notices().includes('deleted'));
  assert.equal((await get('/', '', 'noor.nsd.test')).statusCode, 404);
  assert.equal(getDb().prepare('SELECT status FROM users WHERE id = ?').get(u.id).status, 'active', 'account stays');
  assert.equal((await lifecycleSweep()).deleted, 0, 'idempotent');
});

test('pricing page matches the plans', async () => {
  const p = await get('/pricing');
  assert.match(p.body, /1 GB of space/);
  assert.match(p.body, /Your own domain name, like mybusiness\.sg/);
  assert.match(p.body, /Off the showcase unless you opt in/);
  assert.doesNotMatch(p.body, /1024 MB/);
});
