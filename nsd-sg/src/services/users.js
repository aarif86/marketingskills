// Users, authentication, sessions and one-time tokens.
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { newId, newToken, sha256, nowIso, isoAfterSeconds } from '../lib/ids.js';
import { hashPassword, verifyPassword, needsRehash } from '../lib/password.js';
import { getDefaultPlan } from './plans.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,24}$/i;
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function validateEmail(email) {
  if (!email) return 'Email is required.';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'Enter a valid email address.';
  return null;
}

export function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) ?? null;
}

export function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export async function createUser({ email, password, name = '', role = 'user', planId = null, verified = false }) {
  const db = getDb();
  const plan = planId ? { id: planId, trial_days: null } : getDefaultPlan();
  const id = newId();
  const expires = plan.trial_days ? isoAfterSeconds(plan.trial_days * 86400) : null;
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, status, email_verified_at, plan_id, plan_expires_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(
    id, normalizeEmail(email), String(name ?? '').trim().slice(0, 80), await hashPassword(password), role,
    verified ? nowIso() : null, plan.id, expires,
  );
  return findUserById(id);
}

/**
 * Verify credentials with lockout protection.
 * Returns { ok, user } or { ok:false, reason }.
 */
export async function authenticate(email, password) {
  const db = getDb();
  const user = findUserByEmail(email);
  // Constant-ish time: always run a hash even when the user does not exist.
  if (!user) {
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return { ok: false, reason: 'invalid' };
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return { ok: false, reason: 'locked' };
  }
  const good = await verifyPassword(password, user.password_hash);
  if (!good) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? isoAfterSeconds(LOCK_MINUTES * 60) : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    return { ok: false, reason: lock ? 'locked' : 'invalid' };
  }
  if (user.status === 'disabled') return { ok: false, reason: 'disabled' };
  if (needsRehash(user.password_hash)) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  return { ok: true, user };
}

export async function changePassword(userId, newPassword) {
  const db = getDb();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(newPassword), nowIso(), userId);
  // Any password change invalidates every other session.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function updateProfile(userId, { name }) {
  getDb().prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(String(name ?? '').trim().slice(0, 80), nowIso(), userId);
}

// ---- sessions ---------------------------------------------------------------

export function createSession({ userId, ip = '', userAgent = '' }) {
  const token = newToken(32);
  const id = sha256(token);
  getDb().prepare('INSERT INTO sessions (id, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, ip.slice(0, 64), userAgent.slice(0, 200), isoAfterSeconds(config.sessionTtlSeconds));
  getDb().prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?').run(nowIso(), ip.slice(0, 64), userId);
  return token;
}

let touchStmt;
export function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const db = getDb();
  const id = sha256(token);
  const row = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`).get(id, nowIso());
  if (!row) return null;
  // Throttle last_seen writes to once a minute.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    touchStmt ??= db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?');
    touchStmt.run(nowIso(), id);
  }
  const { session_id, expires_at, last_seen_at, ...user } = row;
  return { user, sessionId: session_id, expiresAt: expires_at };
}

export function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function destroyAllSessions(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function listSessions(userId) {
  return getDb().prepare('SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(userId);
}

export function purgeExpiredSessions() {
  return getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

// ---- one-time tokens ---------------------------------------------------------

export function issueToken(userId, purpose, ttlSeconds) {
  const db = getDb();
  db.prepare('DELETE FROM tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  const raw = newToken(32);
  db.prepare('INSERT INTO tokens (id, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)').run(sha256(raw), userId, purpose, isoAfterSeconds(ttlSeconds));
  return raw;
}

export function consumeToken(raw, purpose) {
  if (!raw || typeof raw !== 'string' || raw.length > 100) return null;
  const db = getDb();
  const id = sha256(raw);
  const row = db.prepare('SELECT * FROM tokens WHERE id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?').get(id, purpose, nowIso());
  if (!row) return null;
  db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(nowIso(), id);
  return findUserById(row.user_id);
}

export function markEmailVerified(userId) {
  getDb().prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(nowIso(), userId);
}

// ---- admin ----------------------------------------------------------------------

export function setUserStatus(userId, status) {
  getDb().prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), userId);
  if (status !== 'active') destroyAllSessions(userId);
}

export function setUserOverrides(userId, overrides) {
  getDb().prepare('UPDATE users SET overrides_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(overrides ?? {}), nowIso(), userId);
}

export function setUserNotes(userId, notes) {
  getDb().prepare('UPDATE users SET notes = ?, updated_at = ? WHERE id = ?').run(String(notes ?? '').slice(0, 4000), nowIso(), userId);
}

export function setUserRole(userId, role) {
  getDb().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), userId);
}

export function countAdmins() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

// Bootstraps the first admin from env on first boot.
export async function ensureBootstrapAdmin(log = console) {
  if (countAdmins() > 0) return false;
  const { email, password, name } = config.admin;
  if (!email || !password) {
    log.warn('No admin exists and ADMIN_EMAIL/ADMIN_PASSWORD are not set. Create one with: node src/cli.js make-admin <email>');
    return false;
  }
  const existing = findUserByEmail(email);
  if (existing) {
    setUserRole(existing.id, 'admin');
    return true;
  }
  await createUser({ email, password, name, role: 'admin', planId: 'plus', verified: true });
  log.info(`Bootstrap admin created: ${email}`);
  return true;
}

export async function verifyPasswordForUser(userId, password) {
  const user = findUserById(userId);
  if (!user) return false;
  return verifyPassword(password, user.password_hash);
}
