// Continue with Google: flow cookie, state/PKCE checks, token exchange (mocked), account create/link.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesFrom, csrfFrom, cleanup } from './helpers/env.js';

process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
const { buildApp } = await import('../src/server.js');
const google = await import('../src/services/google.js');
const { config } = await import('../src/config.js');

let app;
const H = 'nsd.test';
before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeIdToken(claims) {
  return `${b64u({ alg: 'RS256' })}.${b64u({ iss: 'https://accounts.google.com', aud: config.google.clientId, exp: Math.floor(Date.now() / 1000) + 3600, email_verified: true, ...claims })}.sig`;
}
let lastTokenReq = null;
function mockExchange(claims) {
  google.setFetch(async (url, init) => {
    lastTokenReq = { url, body: new URLSearchParams(init.body) };
    return { ok: true, status: 200, json: async () => ({ id_token: fakeIdToken(claims) }) };
  });
}
async function start(query = '') {
  const r = await app.inject({ method: 'GET', url: `/auth/google${query}`, headers: { host: H } });
  assert.equal(r.statusCode, 302);
  const loc = new URL(r.headers.location);
  return { cookie: cookiesFrom(r), state: loc.searchParams.get('state'), loc };
}

test('login/signup pages show the Google button when configured; start sets a flow cookie and redirects to Google with PKCE', async () => {
  assert.ok(google.enabled());
  const login = await app.inject({ method: 'GET', url: '/login', headers: { host: H } });
  assert.match(login.body, /Continue with Google/);
  assert.match(login.body, /href="\/auth\/google\?next=%2Fdashboard"/);
  const { cookie, state, loc } = await start('?name=gary');
  assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(loc.searchParams.get('client_id'), config.google.clientId);
  assert.equal(loc.searchParams.get('redirect_uri'), 'http://nsd.test/auth/google/callback');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('scope'), 'openid email profile');
  assert.ok(state && state.length > 10);
  assert.match(cookie, /nsd_gflow=/);
});

test('callback: wrong state is refused; correct state creates a verified user, claims the site, logs in', async () => {
  mockExchange({ sub: 'g-111', email: 'gary@example.com', name: 'Gary Google' });
  const { cookie, state } = await start('?name=gary');
  const bad = await app.inject({ method: 'GET', url: `/auth/google/callback?code=abc&state=WRONG`, headers: { host: H, cookie } });
  assert.equal(bad.statusCode, 302);
  assert.equal(bad.headers.location, '/login');

  const flow2 = await start('?name=gary');
  const ok = await app.inject({ method: 'GET', url: `/auth/google/callback?code=abc&state=${flow2.state}`, headers: { host: H, cookie: flow2.cookie } });
  assert.equal(ok.statusCode, 302, ok.body);
  assert.equal(ok.headers.location, '/dashboard');
  assert.match(cookiesFrom(ok), /nsd_session=/);
  assert.equal(lastTokenReq.body.get('grant_type'), 'authorization_code');
  assert.equal(lastTokenReq.body.get('code'), 'abc');
  assert.ok(lastTokenReq.body.get('code_verifier')?.length > 40, 'PKCE verifier sent');
  const { getDb } = await import('../src/db/index.js');
  const u = getDb().prepare("SELECT * FROM users WHERE email = 'gary@example.com'").get();
  assert.ok(u && u.google_sub === 'g-111' && u.email_verified_at, 'created, linked, verified');
  assert.equal(u.name, 'Gary Google');
  const site = getDb().prepare("SELECT subdomain FROM sites WHERE user_id = ?").get(u.id);
  assert.equal(site?.subdomain, 'gary');
  // Second sign-in with the same Google account -> same user, no duplicate, goes to `next`.
  const flow3 = await start('?next=%2Faccount');
  const again = await app.inject({ method: 'GET', url: `/auth/google/callback?code=def&state=${flow3.state}`, headers: { host: H, cookie: flow3.cookie } });
  assert.equal(again.headers.location, '/account');
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM users WHERE email = 'gary@example.com'").get().n, 1);
});

test('callback links an existing password account by verified email; unverified Google email is refused', async () => {
  const csrf = csrfFrom((await app.inject({ method: 'GET', url: '/signup', headers: { host: H } })).body);
  await app.inject({ method: 'POST', url: '/signup', headers: { host: H, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, email: 'hana@example.com', password: 'correct-horse-battery', agree: '1' }).toString() });
  mockExchange({ sub: 'g-222', email: 'Hana@Example.com', name: 'Hana' });
  const f = await start();
  const r = await app.inject({ method: 'GET', url: `/auth/google/callback?code=x&state=${f.state}`, headers: { host: H, cookie: f.cookie } });
  assert.equal(r.headers.location, '/dashboard');
  const { getDb } = await import('../src/db/index.js');
  const u = getDb().prepare("SELECT google_sub, email_verified_at FROM users WHERE email = 'hana@example.com'").get();
  assert.equal(u.google_sub, 'g-222');
  assert.ok(u.email_verified_at, 'linking marks the email verified');

  mockExchange({ sub: 'g-333', email: 'nope@example.com', email_verified: false });
  const f2 = await start();
  const r2 = await app.inject({ method: 'GET', url: `/auth/google/callback?code=x&state=${f2.state}`, headers: { host: H, cookie: f2.cookie } });
  assert.equal(r2.headers.location, '/login');
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM users WHERE email = 'nope@example.com'").get().n, 0);
});

test('parseIdToken rejects wrong audience, expired and malformed tokens', () => {
  assert.throws(() => google.parseIdToken(fakeIdToken({ sub: '1', email: 'a@b.co', aud: 'other' })), /not for this app/);
  assert.throws(() => google.parseIdToken(fakeIdToken({ sub: '1', email: 'a@b.co', exp: 1 })), /expired/);
  assert.throws(() => google.parseIdToken('garbage'), /malformed/);
  assert.equal(google.openFlow('nonsense.mac'), null);
});
