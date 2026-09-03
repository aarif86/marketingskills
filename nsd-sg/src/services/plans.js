// Plan resolution. Effective limits = plan limits + per-user admin overrides.
// Nothing here is hardcoded per customer: community/founding accounts are just rows in `plans`.
import { getDb } from '../db/index.js';
import { syncUserSites as resyncUser } from '../publish/hostinger.js';
import { newId, isoAfterDays, nowIso } from '../lib/ids.js';

export const HARD_LIMITS = {
  max_sites: 1,
  max_storage_bytes: 50 * 1024 * 1024,
  max_file_bytes: 10 * 1024 * 1024,
  max_releases: 2,
  max_bandwidth_bytes_month: 1024 ** 3,
};

export function listPlans({ publicOnly = false } = {}) {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM plans ${publicOnly ? 'WHERE is_public = 1' : ''} ORDER BY sort_order, id`)
    .all();
  return rows.map(parsePlan);
}

export function getPlan(id) {
  const row = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id);
  return row ? parsePlan(row) : null;
}

export function getDefaultPlan() {
  const row = getDb().prepare('SELECT * FROM plans WHERE is_default = 1 ORDER BY sort_order LIMIT 1').get();
  return row ? parsePlan(row) : parsePlan(getDb().prepare("SELECT * FROM plans WHERE id = 'free'").get());
}

export function parsePlan(row) {
  return {
    ...row,
    limits: safeJson(row.limits_json),
    features: safeJson(row.features_json),
    is_public: !!row.is_public,
    is_default: !!row.is_default,
  };
}

export function upsertPlan(plan) {
  const db = getDb();
  db.prepare(`
    INSERT INTO plans (id, name, description, price_cents_month, trial_days, is_public, is_default, limits_json, features_json, sort_order, updated_at)
    VALUES (@id, @name, @description, @price_cents_month, @trial_days, @is_public, @is_default, @limits_json, @features_json, @sort_order, @now)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, price_cents_month=excluded.price_cents_month,
      trial_days=excluded.trial_days, is_public=excluded.is_public, is_default=excluded.is_default, limits_json=excluded.limits_json,
      features_json=excluded.features_json, sort_order=excluded.sort_order, updated_at=excluded.updated_at`).run({
    id: plan.id,
    name: plan.name,
    description: plan.description ?? '',
    price_cents_month: plan.price_cents_month ?? 0,
    trial_days: plan.trial_days ?? null,
    is_public: plan.is_public ? 1 : 0,
    is_default: plan.is_default ? 1 : 0,
    limits_json: JSON.stringify(plan.limits ?? {}),
    features_json: JSON.stringify(plan.features ?? {}),
    sort_order: plan.sort_order ?? 0,
    now: nowIso(),
  });
  if (plan.is_default) db.prepare('UPDATE plans SET is_default = 0 WHERE id != ?').run(plan.id);
}

/**
 * Effective entitlements for a user: plan limits, admin overrides, expiry state.
 * @returns {{ plan, limits, features, brandingRemoved, expired, expiresAt, daysLeft }}
 */
export function entitlementsFor(user) {
  const plan = getPlan(user.plan_id) ?? getDefaultPlan();
  const overrides = safeJson(user.overrides_json);
  const limits = { ...HARD_LIMITS, ...plan.limits };
  const features = { ...plan.features };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in limits && typeof v === 'number') limits[k] = v;
    if (k in features && typeof v === 'boolean') features[k] = v;
  }
  const expiresAt = user.plan_expires_at ? new Date(user.plan_expires_at) : null;
  const expired = !!expiresAt && expiresAt.getTime() < Date.now();
  const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000) : null;
  // Branding is removed when the plan allows it, or when admin explicitly removed it for this user.
  const brandingRemoved = overrides.branding_removed === true || (features.branding_removable === true && overrides.branding_removed !== false);
  return { plan, limits, features, overrides, brandingRemoved, expired, expiresAt, daysLeft };
}

export function assignPlan({ userId, planId, actorId = null, reason = '' }) {
  const db = getDb();
  const plan = getPlan(planId);
  if (!plan) throw new Error('unknown plan');
  const user = db.prepare('SELECT plan_id FROM users WHERE id = ?').get(userId);
  const expires = plan.trial_days ? isoAfterDays(plan.trial_days) : null;
  db.transaction(() => {
    db.prepare('UPDATE users SET plan_id = ?, plan_started_at = ?, plan_expires_at = ?, updated_at = ? WHERE id = ?')
      .run(plan.id, nowIso(), expires, nowIso(), userId);
    db.prepare('INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), userId, 'plan_changed', user?.plan_id ?? null, plan.id, JSON.stringify({ reason }), actorId);
  })();
  resyncUser(userId);
  return expires;
}

export function extendPlan({ userId, days, actorId = null, type = 'extension_granted', reason = '' }) {
  const db = getDb();
  const user = db.prepare('SELECT plan_id, plan_expires_at FROM users WHERE id = ?').get(userId);
  const base = user.plan_expires_at && new Date(user.plan_expires_at).getTime() > Date.now() ? new Date(user.plan_expires_at) : new Date();
  const next = new Date(base.getTime() + days * 86400000).toISOString();
  db.transaction(() => {
    db.prepare('UPDATE users SET plan_expires_at = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), userId);
    db.prepare('INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), userId, type, user.plan_id, user.plan_id, JSON.stringify({ days, reason }), actorId);
  })();
  resyncUser(userId);
  return next;
}

// ---- promo codes ------------------------------------------------------------------

export function listPromoCodes() {
  return getDb().prepare('SELECT p.*, (SELECT COUNT(*) FROM promo_redemptions r WHERE r.code = p.code) AS redeemed FROM promo_codes p ORDER BY created_at DESC').all();
}

export function createPromoCode({ code, planId, maxUses = 10, expiresAt = null, note = '', actorId = null }) {
  const c = String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (c.length < 4 || c.length > 32) return { ok: false, reason: 'Code must be 4–32 letters/numbers.' };
  if (!getPlan(planId)) return { ok: false, reason: 'Unknown plan.' };
  try {
    getDb().prepare('INSERT INTO promo_codes (code, plan_id, max_uses, expires_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c, planId, Math.max(1, Number(maxUses) || 1), expiresAt, String(note ?? '').slice(0, 200), actorId);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { ok: false, reason: 'That code already exists.' };
    throw e;
  }
  return { ok: true, code: c };
}

export function deletePromoCode(code) {
  getDb().prepare('DELETE FROM promo_codes WHERE code = ?').run(String(code).toUpperCase());
}

/** Redeem a code for a user: assigns the code's plan (fresh trial) and records the redemption. */
export function redeemPromoCode({ userId, code }) {
  const db = getDb();
  const c = String(code ?? '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(c);
  if (!row) return { ok: false, reason: 'That code is not valid.' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'That code has expired.' };
  if (row.uses >= row.max_uses) return { ok: false, reason: 'That code has already been used up.' };
  if (db.prepare('SELECT 1 FROM promo_redemptions WHERE code = ? AND user_id = ?').get(c, userId)) return { ok: false, reason: 'You have already used this code.' };
  const user = db.prepare('SELECT plan_id FROM users WHERE id = ?').get(userId);
  if (user?.plan_id === row.plan_id) return { ok: false, reason: 'You are already on that plan.' };
  db.transaction(() => {
    db.prepare('INSERT INTO promo_redemptions (code, user_id) VALUES (?, ?)').run(c, userId);
    db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE code = ?').run(c);
  })();
  const expires = assignPlan({ userId, planId: row.plan_id, actorId: userId, reason: `promo:${c}` });
  return { ok: true, plan: getPlan(row.plan_id), expires };
}

export function requestExtension({ userId, note = '' }) {
  const db = getDb();
  const recent = db
    .prepare("SELECT id FROM plan_events WHERE user_id = ? AND type = 'extension_requested' AND created_at > datetime('now', '-7 days')")
    .get(userId);
  if (recent) return { ok: false, reason: 'You already requested an extension this week.' };
  db.prepare('INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (?, ?, ?, NULL, NULL, ?, ?)')
    .run(newId(), userId, 'extension_requested', JSON.stringify({ note }), userId);
  return { ok: true };
}

export function listPlanEvents(userId, limit = 20) {
  return getDb().prepare('SELECT * FROM plan_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}

export function pendingExtensionRequests() {
  return getDb().prepare(`
    SELECT e.*, u.email, u.name, u.plan_id, u.plan_expires_at FROM plan_events e JOIN users u ON u.id = e.user_id
    WHERE e.type = 'extension_requested'
      AND NOT EXISTS (SELECT 1 FROM plan_events g WHERE g.user_id = e.user_id AND g.type = 'extension_granted' AND g.created_at > e.created_at)
    ORDER BY e.created_at ASC`).all();
}

function safeJson(s) {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
