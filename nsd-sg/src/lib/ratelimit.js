// In-memory sliding-window rate limiter. Single-process platform => in-memory is correct and fast.
// If the app is ever run on several nodes, swap the store for Redis; the interface stays the same.

const buckets = new Map();
let lastSweep = Date.now();

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @param {string} key   e.g. `login:${ip}`
 * @param {number} limit max hits per window
 * @param {number} windowMs
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number }}
 */
export function hit(key, limit, windowMs) {
  sweep();
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  const ok = b.count <= limit;
  return { ok, remaining: Math.max(0, limit - b.count), retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

export function reset(key) {
  buckets.delete(key);
}

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  upload: { limit: 60, windowMs: 60 * 60_000 },
  siteCreate: { limit: 10, windowMs: 60 * 60_000 },
  abuseReport: { limit: 5, windowMs: 60 * 60_000 },
  suggest: { limit: 10, windowMs: 60 * 60_000 },
  tryIt: { limit: 5, windowMs: 60 * 60_000 },
  platformGeneral: { limit: 600, windowMs: 60_000 },
  tenantGeneral: { limit: 1200, windowMs: 60_000 },
};

// Fastify preHandler factory.
export function limiter(name, keyFn = (req) => req.ip) {
  const { limit, windowMs } = LIMITS[name];
  return async function rateLimitHook(req, reply) {
    const r = hit(`${name}:${keyFn(req)}`, limit, windowMs);
    reply.header('X-RateLimit-Remaining', String(r.remaining));
    if (!r.ok) {
      reply.header('Retry-After', String(r.retryAfterSec));
      req.log.warn({ ip: req.ip, limiter: name }, 'rate limited');
      return reply.code(429).type('text/html; charset=utf-8').send(
        '<!doctype html><title>Too many requests</title><p style="font-family:system-ui;padding:2rem">Too many requests. Please wait a few minutes and try again.</p>',
      );
    }
  };
}
