// MCP endpoint: tokens, JSON-RPC shape, the five tools, plan enforcement wording, name watchdog, auth failures.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

const { buildApp } = await import('../src/server.js');
const { getDb } = await import('../src/db/index.js');
const { reset } = await import('../src/lib/ratelimit.js');

let app;
const H = 'nsd.test';
const u = { cookie: '', token: '', tokenId: '' };
before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });

const get = (url, cookie = '', host = H) => app.inject({ method: 'GET', url, headers: { host, cookie } });
async function post(url, cookie, form, pageUrl) {
  const csrf = csrfFrom((await get(pageUrl ?? url, cookie)).body);
  return app.inject({ method: 'POST', url, headers: { host: H, cookie, 'content-type': 'application/x-www-form-urlencoded', origin: `http://${H}` }, body: new URLSearchParams({ _csrf: csrf, ...form }).toString() });
}
let n = 0;
const rpc = (method, params, { token = u.token, header = false } = {}) => app.inject({ method: 'POST', url: header ? '/mcp' : `/mcp/${token}`, headers: { host: H, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(header ? { authorization: `Bearer ${token}` } : {}) }, payload: { jsonrpc: '2.0', id: ++n, method, params } });
const call = async (name, args, o) => { const r = await rpc('tools/call', { name, arguments: args }, o); assert.equal(r.statusCode, 200, r.body); const j = r.json(); return { text: j.result.content[0].text, isError: !!j.result.isError, out: j.result.structuredContent }; };

test('new sign-ups get 30 days; the Connect page issues a token once', async () => {
  reset('signup:127.0.0.1');
  const r = await post('/signup', '', { email: 'mia@example.com', name: 'Mia', password: 'correct-horse-battery', subdomain: '', agree: '1' }, '/signup');
  assert.equal(r.statusCode, 302);
  u.cookie = cookiesFrom(r);
  const row = getDb().prepare('SELECT plan_expires_at FROM users WHERE email = ?').get('mia@example.com');
  const days = (Date.parse(row.plan_expires_at) - Date.now()) / 86400000;
  assert.ok(days > 29 && days <= 30.01, `30-day trial, got ${days}`);
  let page = await get('/connect', u.cookie);
  assert.match(page.body, /Make a token/);
  assert.match(page.body, /Add custom connector/);
  const made = await post('/connect/tokens', u.cookie, { name: 'Claude Desktop' }, '/connect');
  assert.equal(made.statusCode, 302);
  const c = String(made.headers['set-cookie']).match(/nsd_newtoken=([^;]+)/)[1];
  page = await get('/connect', `${u.cookie}; nsd_newtoken=${c}`);
  u.token = page.body.match(/(nsd_[A-Za-z0-9_-]{43})/)[1];
  assert.match(page.body, new RegExp(`/mcp/${u.token}`));
  assert.doesNotMatch((await get('/connect', u.cookie)).body, /nsd_[A-Za-z0-9_-]{43}/, 'shown once only');
  assert.match((await get('/connect', u.cookie)).body, /Claude Desktop/);
});

test('handshake: initialize, ping, tools/list; unauthorized and wrong methods answer properly', async () => {
  let r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().result.serverInfo.name, 'NSD.SG');
  assert.match(r.json().result.instructions, /mia@example.com/);
  r = await app.inject({ method: 'POST', url: `/mcp/${u.token}`, headers: { host: H, 'content-type': 'application/json' }, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(r.statusCode, 202);
  r = await rpc('ping', {});
  assert.deepEqual(r.json().result, {});
  r = await rpc('tools/list', {});
  assert.deepEqual(r.json().result.tools.map((t) => t.name), ['nsd_publish', 'nsd_update', 'nsd_list_sites', 'nsd_get_site', 'nsd_delete_site']);
  r = await rpc('tools/list', {}, { header: true });
  assert.equal(r.statusCode, 200, 'bearer header works too');
  r = await rpc('tools/list', {}, { token: 'nsd_' + 'x'.repeat(43) });
  assert.equal(r.statusCode, 401);
  assert.match(r.json().error.message, /\/connect/);
  r = await rpc('nope', {});
  assert.equal(r.json().error.code, -32601);
  r = await app.inject({ method: 'GET', url: `/mcp/${u.token}`, headers: { host: H } });
  assert.equal(r.statusCode, 405);
});

test('nsd_publish creates the site and serves it with the badge; list and get describe it', async () => {
  let r = await call('nsd_publish', { name: 'Mia Quiz', html: '<!doctype html><html><head><title>Quiz</title></head><body><h1>Mia quiz</h1></body></html>' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.out.created, true);
  assert.equal(r.out.url, 'http://mia-quiz.nsd.test');
  assert.match(r.out.badge, /Powered by NasarDigital/);
  const t = await get('/', '', 'mia-quiz.nsd.test');
  assert.match(t.body, /Mia quiz/);
  assert.match(t.body, /data-nsd="badge"/);
  r = await call('nsd_list_sites', {});
  assert.equal(r.out.sites.length, 1);
  assert.equal(r.out.plan, 'Free');
  assert.ok(r.out.days_left <= 30);
  u.siteId = r.out.sites[0].id;
  r = await call('nsd_get_site', { site_id: u.siteId });
  assert.equal(r.out.files.length, 1); assert.match(r.out.files[0], /^index\.html \(\d+ B\)$/);
  // publish again to the same name adds a file and keeps index
  r = await call('nsd_publish', { name: 'mia-quiz', files: [{ path: 'style.css', content: 'body{color:red}' }] });
  assert.equal(r.out.created, false);
  assert.equal(r.out.version, 2);
  assert.match((await get('/style.css', '', 'mia-quiz.nsd.test')).body, /color:red/);
  assert.match((await get('/', '', 'mia-quiz.nsd.test')).body, /Mia quiz/);
});

test('plan limits and name checks come back as readable errors with the upgrade link; nothing bypasses the watchdog', async () => {
  let r = await call('nsd_publish', { name: 'second-site', html: '<html><body>x</body></html>' });
  assert.equal(r.isError, true);
  assert.match(r.text, /allows 1 site/);
  assert.match(r.text, /mia-quiz\.nsd\.test/);
  assert.match(r.text, /http:\/\/nsd\.test\/billing/);
  r = await call('nsd_publish', { name: 'mia-quiz' });
  assert.match(r.text, /Nothing to publish/);
  r = await call('nsd_publish', { name: 'mia-quiz', files: [{ path: '../evil.html', content: '<html></html>' }] });
  assert.equal(r.isError, true);
  r = await call('nsd_publish', { name: 'mia-quiz', files: [{ path: 'app.php', content: '<?php' }] });
  assert.match(r.text, /No web page|not a supported|allowed/i);
  // a blocked word is refused and logged, even though the account has no free slot anyway
  r = await call('nsd_publish', { name: 'hamas-page', html: '<html><body>x</body></html>' });
  assert.equal(r.isError, true);
  const w = getDb().prepare("SELECT target_id FROM audit_log WHERE action = 'security.blocked_name' ORDER BY id DESC LIMIT 1").get();
  assert.equal(w.target_id, 'hamas-page');
});

test('nsd_update replaces everything; nsd_delete_site needs confirm; revoked token stops working', async () => {
  let r = await call('nsd_update', { site_id: u.siteId, html: '<html><body><h1>Fresh</h1></body></html>' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.out.version, 3);
  assert.equal((await get('/style.css', '', 'mia-quiz.nsd.test')).statusCode, 404, 'replace-all dropped the css');
  r = await call('nsd_update', { site_id: 'NOPE', html: '<html></html>' });
  assert.match(r.text, /No site with that id/);
  r = await call('nsd_delete_site', { site_id: u.siteId });
  assert.match(r.text, /confirm: true/);
  r = await call('nsd_delete_site', { site_id: u.siteId, confirm: true });
  assert.equal(r.out.deleted, 'mia-quiz.nsd.test');
  assert.equal((await get('/', '', 'mia-quiz.nsd.test')).statusCode, 404);
  const page = await get('/connect', u.cookie);
  const id = page.body.match(/\/connect\/tokens\/([A-Z0-9]{26})\/revoke/)[1];
  await post(`/connect/tokens/${id}/revoke`, u.cookie, {}, '/connect');
  assert.equal((await rpc('ping', {})).statusCode, 401);
});
