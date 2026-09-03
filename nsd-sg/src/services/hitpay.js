// HitPay recurring billing. Flow: user clicks Upgrade -> we create a subscription against the plan via the API
// (customer_email = account email, reference = "<userId>:<planId>") -> redirect to HitPay's hosted page -> HitPay
// calls our webhook on every charge / status change (HMAC-SHA256 of the raw body with the webhook salt) and
// redirects the user back to /billing/hitpay/return, where we also verify the status by API in case the webhook
// is slow. Activation = assignPlan(paid: true) which never expires; cancellation = 30-day grace then free.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { assignPlan, getPlan } from './plans.js';

export const enabled = () => !!config.hitpay.apiKey;
export const planConfigured = (planId) => !!config.hitpay.plans[planId];

async function api(method, path, body) {
  const res = await fetch(`${config.hitpay.apiBase}${path}`, {
    method,
    headers: { 'X-BUSINESS-API-KEY': config.hitpay.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`HitPay ${method} ${path} -> ${res.status}: ${(json.message ?? text).slice(0, 300)}`);
  return json;
}

/** Start a subscription for a user. Returns the HitPay URL to send the customer to. */
export async function startSubscription({ user, planId, returnUrl }) {
  const planUuid = config.hitpay.plans[planId];
  if (!planUuid) throw new Error('This plan has no HitPay plan id configured.');
  const reference = `${user.id}:${planId}:${newId().slice(-6)}`;
  const r = await api('POST', '/v1/recurring-billing', {
    plan_id: planUuid,
    customer_email: user.email,
    customer_name: user.name || undefined,
    reference,
    redirect_url: returnUrl,
    payment_methods: ['card'],
    start_date: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), // today in SGT; plan-based billing needs a start date (save_card is not allowed with plan_id)
    send_email: 'true',
  });
  const id = String(r.id ?? r.recurring_billing_id ?? '');
  if (!id) throw new Error('HitPay did not return a subscription id.');
  getDb().prepare('INSERT OR REPLACE INTO subscriptions (id, user_id, plan_id, status, reference, last_event) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, user.id, planId, 'pending', reference, 'created');
  const url = r.url ?? r.checkout_url ?? r.payment_url;
  if (!url) throw new Error('HitPay did not return a checkout URL.');
  return { id, url, reference };
}

export function verifySignature(rawBody, signature) {
  if (!config.hitpay.webhookSalt || !signature) return false;
  const expected = crypto.createHmac('sha256', config.hitpay.webhookSalt).update(rawBody).digest('hex');
  const a = Buffer.from(String(signature).trim().toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ACTIVE = new Set(['succeeded', 'completed', 'active', 'paid']);
const DEAD = new Set(['canceled', 'cancelled', 'failed', 'expired']);

/** Pull the identifiers we care about out of any HitPay payload shape (top-level or nested). */
export function identify(payload) {
  const p = payload ?? {};
  const rb = p.recurring_billing ?? p.subscription ?? {};
  return {
    subscriptionId: String(p.recurring_billing_id ?? rb.id ?? (p.object === 'recurring_billing' ? p.id : '') ?? ''),
    reference: String(p.reference ?? rb.reference ?? p.order?.reference ?? ''),
    status: String(p.status ?? rb.status ?? '').toLowerCase(),
    email: String(p.customer?.email ?? p.customer_email ?? rb.customer_email ?? '').toLowerCase(),
  };
}

/** Apply a HitPay event (webhook or return-check) to our records. Idempotent. */
export function applyEvent({ subscriptionId, reference, status, email, eventType = '' }, log = console) {
  const db = getDb();
  let sub = subscriptionId ? db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) : null;
  if (!sub && reference) sub = db.prepare('SELECT * FROM subscriptions WHERE reference = ?').get(reference);
  if (!sub && reference.includes(':')) {
    const [userId, planId] = reference.split(':');
    if (getPlan(planId) && db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
      sub = { id: subscriptionId || reference, user_id: userId, plan_id: planId, status: 'pending', reference };
      db.prepare('INSERT OR IGNORE INTO subscriptions (id, user_id, plan_id, status, reference) VALUES (?, ?, ?, ?, ?)').run(sub.id, userId, planId, 'pending', reference);
    }
  }
  if (!sub) { log.warn?.({ subscriptionId, reference, email }, 'hitpay: event for unknown subscription'); return { ok: false, reason: 'unknown subscription' }; }

  const now = nowIso();
  if (ACTIVE.has(status) || eventType === 'charge.created') {
    if (sub.status !== 'active') {
      assignPlan({ userId: sub.user_id, planId: sub.plan_id, actorId: null, reason: `hitpay:${sub.id}`, paid: true });
      db.prepare('INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL)')
        .run(newId(), sub.user_id, 'payment_received', null, sub.plan_id, JSON.stringify({ subscription: sub.id, status, eventType }));
    }
    db.prepare("UPDATE subscriptions SET status = 'active', last_event = ?, updated_at = ? WHERE id = ?").run(eventType || status, now, sub.id);
    return { ok: true, activated: sub.status !== 'active' };
  }
  if (DEAD.has(status)) {
    if (sub.status === 'active') {
      // Keep the paid plan for 30 more days, then the hourly sync + expiry logic drops them to free.
      const grace = new Date(Date.now() + 30 * 86400000).toISOString();
      db.prepare('UPDATE users SET plan_expires_at = ?, updated_at = ? WHERE id = ?').run(grace, now, sub.user_id);
      db.prepare('INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL)')
        .run(newId(), sub.user_id, 'subscription_canceled', sub.plan_id, sub.plan_id, JSON.stringify({ subscription: sub.id, status, graceUntil: grace }));
    }
    db.prepare("UPDATE subscriptions SET status = ?, last_event = ?, updated_at = ? WHERE id = ?").run(status === 'failed' ? 'failed' : 'canceled', eventType || status, now, sub.id);
    return { ok: true, canceled: true };
  }
  db.prepare('UPDATE subscriptions SET last_event = ?, updated_at = ? WHERE id = ?').run(eventType || status, now, sub.id);
  return { ok: true, noop: true };
}

/** After the customer returns from HitPay: ask the API for the subscription state (webhook may be slower). */
export async function checkSubscription(id) {
  const r = await api('GET', `/v1/recurring-billing/${encodeURIComponent(id)}`);
  return applyEvent({ ...identify({ ...r, object: 'recurring_billing' }), subscriptionId: String(r.id ?? id) });
}

export function listSubscriptionsForUser(userId) {
  return getDb().prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

/** Admin diagnostic: can we reach HitPay with this key, and do the configured plan ids exist? */
export async function diagnose() {
  const out = { apiBase: config.hitpay.apiBase, plans: {} };
  for (const [planId, uuid] of Object.entries(config.hitpay.plans)) {
    try {
      const r = await api('GET', `/v1/subscription-plan/${encodeURIComponent(uuid)}`);
      out.plans[planId] = { ok: true, name: r.name, amount: r.amount, currency: r.currency, cycle: r.cycle };
    } catch (e) {
      out.plans[planId] = { ok: false, error: e.message };
    }
  }
  return out;
}
