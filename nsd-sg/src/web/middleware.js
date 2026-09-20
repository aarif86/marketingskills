// Session loading, CSRF protection, security headers and auth guards for the platform app.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { resolveSession } from '../services/users.js';

export function sessionCookieOptions(maxAge = config.sessionTtlSeconds) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.isProd, // __Host- prefix requires Secure + Path=/ + no Domain
    maxAge,
  };
}

export function setSessionCookie(reply, token) {
  reply.setCookie(config.sessionCookieName, token, sessionCookieOptions());
}

export function clearSessionCookie(reply) {
  reply.clearCookie(config.sessionCookieName, sessionCookieOptions(0));
}

/** onRequest hook: attaches req.user (or null). */
export async function loadSession(req) {
  req.user = null;
  req.sessionToken = null;
  const token = req.cookies?.[config.sessionCookieName];
  if (!token) return;
  const s = resolveSession(token);
  if (!s) return;
  if (s.user.status !== 'active') return; // suspended/disabled users are logged out everywhere
  req.user = s.user;
  req.sessionToken = token;
}

/**
 * CSRF: for state-changing requests, the request must carry a token bound to the session
 * (HMAC of the session token) either as a form field `_csrf` or the `x-csrf-token` header.
 * Combined with SameSite=Lax cookies and an Origin check this is robust without server storage.
 */
export function csrfTokenFor(req) {
  const base = req.sessionToken ?? req.cookies?.nsd_anon ?? '';
  return crypto.createHmac('sha256', config.sessionSecret).update(`csrf:${base}`).digest('base64url');
}

export async function csrfGuard(req, reply) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.routeOptions?.config?.skipCsrf) return;
  const origin = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : null);
  const expectedHost = req.headers.host;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { originHost = null; }
    if (originHost !== expectedHost) return reply.code(403).send('Cross-site request blocked.');
  }
  const provided = req.headers['x-csrf-token'] ?? req.body?._csrf ?? req.csrfFromMultipart ?? '';
  const expected = csrfTokenFor(req);
  if (typeof provided !== 'string' || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return reply.code(403).send('Your session token was missing or invalid. Please go back, refresh and try again.');
  }
}

function safeOrigin(referer) {
  try { return new URL(referer).origin; } catch { return null; }
}

export function platformSecurityHeaders(reply) {
  reply.header('Cache-Control', 'private, no-store'); // the platform is per-user; never let a proxy cache it
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src ${config.publicScheme}://try.${config.baseDomain}; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'`,
  );
  if (config.isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
}

export async function requireUser(req, reply) {
  if (!req.user) {
    const next = encodeURIComponent(req.url);
    return reply.redirect(`/login?next=${next}`);
  }
}

export async function requireAdmin(req, reply) {
  if (!req.user) return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
  if (req.user.role !== 'admin') return reply.code(404).type('text/html; charset=utf-8').send('<h1>Not found</h1>');
}

/** Flash messages via a short-lived cookie (no server state). */
export function flash(reply, type, message) {
  reply.setCookie('nsd_flash', JSON.stringify({ type, message }).slice(0, 1500), { path: '/', httpOnly: true, sameSite: 'Lax', secure: config.isProd, maxAge: 60 });
}

export function readFlash(req, reply) {
  const raw = req.cookies?.nsd_flash;
  if (!raw) return null;
  reply.clearCookie('nsd_flash', { path: '/' });
  try { return JSON.parse(raw); } catch { return null; }
}
