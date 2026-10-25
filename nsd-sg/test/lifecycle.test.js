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
  // admin says no: the request leaves the queue, the user is told on the Plan page (and by email) with the paid options
  const { pendingExtensionRequests } = await import('../src/services/plans.js');
  assert.ok(pendingExtensionRequests().some((e) => e.user_id === u.id), 'request is in the admin queue');
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' }, '/login');
  const adminCookie = cookiesFrom(login);
  const d = await post(`/admin/users/${u.id}/action`, adminCookie, { action: 'decline', reason: 'free period already extended once' }, '/admin');
  assert.equal(d.statusCode, 302, d.body);
  assert.match(flashOf(d), /Declined\. noor@example\.com has been emailed/);
  assert.ok(!pendingExtensionRequests().some((e) => e.user_id === u.id), 'request left the queue');
  const bill = (await get('/billing', u.cookie)).body;
  assert.match(bill, /Your extension request was not approved/);
  assert.doesNotMatch(bill, /Free extension submitted/);
  assert.match(bill, /Need more time\?/, 'they may ask again later');
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
  assert.match(page, /Keep Plus \(gift\) after your free period/);
  assert.match(page, /usual price <s>S\$9<\/s>/, 'public Plus used as the price anchor');
  assert.doesNotMatch(page, /Choose Plus — pay by card/, 'the dearer public Plus is not offered alongside the gift');
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
  assert.match(p.body, /mybusiness\.nsd\.test/);
  assert.doesNotMatch(p.body, /like mybusiness\.sg/, 'addresses are on nsd.sg, not a .sg domain');
  assert.match(p.body, /Off the public showcase unless you want to be on it/);
  assert.doesNotMatch(p.body, /1024 MB/);
});

test('keeping the plan before it ends: card saved, first charge on the expiry date, no reminders, charge activates', async () => {
  const hitpay = await import('../src/services/hitpay.js');
  const { config } = await import('../src/config.js');
  config.hitpay.apiKey = 'test-key'; config.hitpay.plans['plus-gift'] = 'uuid-gift';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ url: String(url), method: opts?.method, body });
    if (opts?.method === 'POST') return new Response(JSON.stringify({ id: 'rb_sched', url: 'https://securecheckout.hit-pay.com/x', status: 'scheduled' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'rb_sched', status: 'scheduled', reference: body?.reference }), { status: 200 });
  };
  try {
    const id = getDb().prepare('SELECT id FROM users WHERE email = ?').get('gift@example.com').id;
    const login = await post('/login', '', { email: 'gift@example.com', password: 'correct-horse-battery' }, '/login');
    const cookie = cookiesFrom(login);
    const expiresAt = getDb().prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(id).plan_expires_at;
    const page = (await get('/billing', cookie)).body;
    assert.match(page, /card is saved now and first charged on/);
    const r = await post('/billing/upgrade', cookie, { plan: 'plus-gift' }, '/billing');
    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, 'https://securecheckout.hit-pay.com/x');
    const sgtDay = new Date(Date.parse(expiresAt) + 8 * 3600_000).toISOString().slice(0, 10);
    assert.equal(calls[0].body.start_date, sgtDay, 'HitPay start date = expiry day in SGT');
    let sub = getDb().prepare("SELECT * FROM subscriptions WHERE id = 'rb_sched'").get();
    assert.equal(sub.starts_at, expiresAt);
    // HitPay confirms it as scheduled (return-check or webhook)
    await hitpay.checkSubscription('rb_sched'); // page-load reconcile: not enough on its own
    assert.equal(getDb().prepare("SELECT status FROM subscriptions WHERE id = 'rb_sched'").get().status, 'pending');
    await hitpay.checkSubscription('rb_sched', { confirmed: true }); // customer came back from HitPay
    sub = getDb().prepare("SELECT * FROM subscriptions WHERE id = 'rb_sched'").get();
    assert.equal(sub.status, 'scheduled');
    const billing = (await get('/billing', cookie)).body;
    assert.match(billing, /card saved, first charge on/);
    assert.doesNotMatch(billing, /Keep Plus \(gift\) after your free period/);
    // 3 days before expiry the sweep stays quiet for this user
    getDb().prepare('UPDATE users SET plan_expires_at = ? WHERE id = ?').run(new Date(Date.now() + 3 * DAY).toISOString(), id);
    await lifecycleSweep();
    assert.equal(getDb().prepare('SELECT COUNT(*) n FROM plan_notices WHERE user_id = ?').get(id).n, 0, 'no reminder while a charge is scheduled');
    // the charge lands on the day: plan becomes paid, no expiry
    hitpay.applyEvent({ subscriptionId: 'rb_sched', reference: sub.reference, status: 'active', eventType: 'charge.created', paymentId: 'pay_1' });
    const u = getDb().prepare('SELECT plan_id, plan_expires_at FROM users WHERE id = ?').get(id);
    assert.equal(u.plan_id, 'plus-gift'); assert.equal(u.plan_expires_at, null);
  } finally { globalThis.fetch = realFetch; config.hitpay.apiKey = ''; delete config.hitpay.plans['plus-gift']; }
});

test('an unpaid checkout that HitPay reports as scheduled stays pending; a confirmed future-start one is scheduled', async () => {
  const hitpay = await import('../src/services/hitpay.js');
  const id = getDb().prepare('SELECT id FROM users WHERE email = ?').get('gift@example.com').id;
  getDb().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('rb_unpaid', ?, 'plus', 'pending', ?)").run(id, `${id}:plus:zz1`);
  let r = hitpay.applyEvent({ subscriptionId: 'rb_unpaid', reference: `${id}:plus:zz1`, status: 'scheduled', confirmed: true });
  assert.equal(r.noop, true);
  assert.equal(getDb().prepare("SELECT status FROM subscriptions WHERE id = 'rb_unpaid'").get().status, 'pending', 'no start date -> not a subscription');
  const future = new Date(Date.now() + 90 * DAY).toISOString();
  getDb().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference, starts_at) VALUES ('rb_future', ?, 'plus-gift', 'pending', ?, ?)").run(id, `${id}:plus-gift:zz2`, future);
  r = hitpay.applyEvent({ subscriptionId: 'rb_future', reference: `${id}:plus-gift:zz2`, status: 'scheduled' });
  assert.equal(r.noop, true, 'page-load reconcile alone does not confirm it');
  r = hitpay.applyEvent({ subscriptionId: 'rb_future', reference: `${id}:plus-gift:zz2`, status: 'scheduled', confirmed: true });
  assert.equal(r.scheduled, true);
  assert.equal(getDb().prepare("SELECT status FROM subscriptions WHERE id = 'rb_future'").get().status, 'scheduled');
});

test('deleting your own account really deletes it (pack stored first) and frees the email; admin Delete permanently still works', async () => {
  reset('signup:127.0.0.1');
  let r = await post('/signup', '', { email: 'gone@example.com', name: 'Gone', password: 'correct-horse-battery', subdomain: 'gonesite', agree: '1' }, '/signup');
  const cookie = cookiesFrom(r);
  const id = getDb().prepare('SELECT id FROM users WHERE email = ?').get('gone@example.com').id;
  // self-delete is a real delete: a pack is stored first, the row goes, the email and site name are free again
  const { listStoredPacks } = await import('../src/services/evidence.js');
  r = await post('/account/delete', cookie, { password: 'correct-horse-battery', confirm: 'DELETE' }, '/account');
  assert.equal(r.statusCode, 302);
  assert.match(flashOf(r), /sign up again any time/);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(id).n, 0, 'row gone');
  assert.equal(listStoredPacks(id).length, 1, 'evidence pack stored before the delete');
  assert.match(listStoredPacks(id)[0].reason, /deleted by its owner/);
  reset('signup:127.0.0.1');
  r = await post('/signup', '', { email: 'gone@example.com', name: 'Gone again', password: 'correct-horse-battery', subdomain: 'gonesite', agree: '1' }, '/signup');
  assert.equal(r.statusCode, 302);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get('gone@example.com').n, 1, 'fresh signup with the same email and site name');
  // admin "Delete permanently" still exists for accounts admin disabled
  const id2 = getDb().prepare('SELECT id FROM users WHERE email = ?').get('gone@example.com').id;
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' }, '/login');
  const acookie = cookiesFrom(login);
  await post(`/admin/users/${id2}/action`, acookie, { action: 'disable' }, `/admin/users/${id2}`);
  r = await post(`/admin/users/${id2}/action`, acookie, { action: 'delete_forever' }, `/admin/users/${id2}`);
  assert.equal(r.statusCode, 302);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(id2).n, 0, 'row gone');
});

test('a looked-at-but-unpaid checkout: note shows for 20 minutes, the clear button abandons it at once', async () => {
  const id = getDb().prepare('SELECT id FROM users WHERE email = ?').get('gift@example.com').id;
  const login = await post('/login', '', { email: 'gift@example.com', password: 'correct-horse-battery' }, '/login');
  const cookie = cookiesFrom(login);
  getDb().prepare("UPDATE subscriptions SET status = 'abandoned' WHERE user_id = ?").run(id);
  getDb().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference) VALUES ('rb_look', ?, 'plus-gift', 'pending', ?)").run(id, `${id}:plus-gift:look`);
  let page = (await get('/billing', cookie)).body;
  assert.match(page, /nothing was charged/);
  assert.match(page, /pay, clear this/);
  const r = await post('/billing/hitpay/dismiss', cookie, { id: 'rb_look' }, '/billing');
  assert.equal(r.statusCode, 302);
  assert.equal(getDb().prepare("SELECT status FROM subscriptions WHERE id = 'rb_look'").get().status, 'abandoned');
  page = (await get('/billing', cookie)).body;
  assert.doesNotMatch(page, /Payment page opened/);
  // an old attempt is not shown at all
  getDb().prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, reference, created_at) VALUES ('rb_old', ?, 'plus-gift', 'pending', ?, ?)").run(id, `${id}:plus-gift:old`, new Date(Date.now() - 30 * 60_000).toISOString());
  page = (await get('/billing', cookie)).body;
  assert.doesNotMatch(page, /Payment page opened/);
});

test('day-after nudge: a silent sign-up gets one email 24-72 h in; published or older accounts get none; admin sees the activation rate', async () => {
  const { nudgeSweep } = await import('../src/services/lifecycle.js');
  reset('signup:127.0.0.1');
  const mk = async (email, sub) => { const r = await post('/signup', '', { email, name: 'T', password: 'correct-horse-battery', subdomain: sub, agree: '1' }, '/signup'); reset('signup:127.0.0.1'); return getDb().prepare('SELECT id FROM users WHERE email = ?').get(email).id; };
  const silent = await mk('silent@example.com', 'silentsite');
  const old = await mk('old@example.com', 'oldsite');
  const fresh = await mk('fresh@example.com', 'freshsite');
  const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run(ago(30), silent);
  getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run(ago(30 * 24), old);
  const sent1 = await nudgeSweep();
  const nudged = getDb().prepare("SELECT user_id FROM plan_notices WHERE kind = 'nudge_day0'").all().map((r) => r.user_id);
  assert.ok(nudged.includes(silent), 'silent 30 h account nudged');
  assert.ok(!nudged.includes(old), 'month-old account left alone');
  assert.ok(!nudged.includes(fresh), 'too fresh, not yet');
  assert.equal(sent1, 1);
  assert.equal(await nudgeSweep(), 0, 'never twice');
  const login = await post('/login', '', { email: 'admin@nsd.test', password: 'admin-password-123' }, '/login');
  const ov = await get('/admin', cookiesFrom(login));
  assert.match(ov.body, /Published within 24 h/);
  assert.match(ov.body, /day-after nudges sent/);
});
