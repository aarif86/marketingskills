// "Continue with Google": OpenID Connect authorization-code flow with PKCE, zero dependencies.
// Enabled only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. Accounts are matched by Google `sub`
// first, then by verified email (which links an existing password account), else created verified.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { newToken, nowIso } from '../lib/ids.js';
import { createUser, findUserByEmail, findUserById, normalizeEmail } from './users.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let fetchImpl = (...a) => fetch(...a);
/** Test hook: swap the HTTP client used for the token exchange. */
export function setFetch(fn) { fetchImpl = fn ?? ((...a) => fetch(...a)); }

export function enabled() {
  return !!(config.google.clientId && config.google.clientSecret);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Fresh state + PKCE verifier for one login attempt. Stored in a signed, short-lived cookie by the route. */
export function beginFlow() {
  const state = newToken(16);
  const verifier = newToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { state, verifier, url: url.toString() };
}

/** Sign/verify the flow cookie so the callback can trust state, verifier and where to go next. */
export function sealFlow(data) {
  const body = b64url(JSON.stringify(data));
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(`gflow:${body}`).digest('base64url');
  return `${body}.${mac}`;
}
export function openFlow(sealed) {
  if (typeof sealed !== 'string' || sealed.length > 2000) return null;
  const [body, mac] = sealed.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', config.sessionSecret).update(`gflow:${body}`).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object' || Date.now() - Number(data.t) > 10 * 60_000) return null;
    return data;
  } catch { return null; }
}

/** Decode + sanity-check the id_token from Google's token endpoint (obtained over TLS, so no signature check needed). */
export function parseIdToken(idToken) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) throw new Error('malformed id_token');
  const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(p.iss)) throw new Error('bad issuer');
  if (p.aud !== config.google.clientId) throw new Error('token not for this app');
  if (!(Number(p.exp) * 1000 > Date.now())) throw new Error('token expired');
  if (!p.sub || !p.email) throw new Error('token missing subject/email');
  if (p.email_verified !== true && p.email_verified !== 'true') throw new Error('Google has not verified this email address');
  return { sub: String(p.sub), email: normalizeEmail(p.email), name: String(p.name ?? '').slice(0, 80), picture: p.picture ?? '' };
}

/** Exchange the authorization code for an identity. */
export async function exchangeCode(code, verifier) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: config.google.clientId, client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) throw new Error(`Google token exchange failed (${res.status}): ${json.error_description ?? json.error ?? 'no id_token'}`);
  return parseIdToken(json.id_token);
}

/**
 * Find or create the NSD.SG user for a Google identity.
 * @returns {{ user, created: boolean, linked: boolean }}
 */
export async function resolveUser(identity) {
  const db = getDb();
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(identity.sub) ?? null;
  if (user) return { user, created: false, linked: false };
  user = findUserByEmail(identity.email);
  if (user) {
    db.prepare('UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
      .run(identity.sub, nowIso(), nowIso(), user.id);
    return { user: findUserById(user.id), created: false, linked: true };
  }
  // No password chosen: a random one is stored; "Forgot password" lets them set one later if they want email login too.
  user = await createUser({ email: identity.email, password: newToken(24), name: identity.name, verified: true });
  db.prepare('UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?').run(identity.sub, nowIso(), user.id);
  return { user: findUserById(user.id), created: true, linked: false };
}
