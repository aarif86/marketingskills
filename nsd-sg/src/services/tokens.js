// API tokens: one per client the user connects (Claude Desktop, Claude Code, ...). Shown once, stored hashed,
// scoped to that user's sites only, revocable, with last-used time so a leaked token is noticeable.
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { newId, nowIso, sha256 } from '../lib/ids.js';

export const TOKEN_RE = /^nsd_[A-Za-z0-9_-]{43}$/;

export function listTokens(userId) {
  return getDb().prepare('SELECT id, name, last_used_at, last_ip, calls, revoked_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

/** Returns { id, token } — the only time the raw token exists. */
export function createToken({ userId, name = '' }) {
  const live = getDb().prepare('SELECT COUNT(*) n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL').get(userId).n;
  if (live >= 10) return { ok: false, reason: 'You already have 10 tokens. Revoke one you no longer use first.' };
  const token = 'nsd_' + crypto.randomBytes(32).toString('base64url');
  const id = newId();
  getDb().prepare('INSERT INTO api_tokens (id, user_id, name, token_hash) VALUES (?, ?, ?, ?)').run(id, userId, String(name ?? '').trim().slice(0, 60) || 'Claude', sha256(token));
  return { ok: true, id, token };
}

export function revokeToken(id, userId) {
  return getDb().prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(nowIso(), id, userId).changes > 0;
}

/** Resolve a raw token to its active user, recording the use. Null when unknown, revoked, or the user is not active. */
export function authenticateToken(raw, ip = '') {
  if (!TOKEN_RE.test(String(raw ?? ''))) return null;
  const db = getDb();
  const row = db.prepare('SELECT t.id AS token_id, t.name AS token_name, u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL').get(sha256(raw));
  if (!row || row.status !== 'active') return null;
  db.prepare('UPDATE api_tokens SET last_used_at = ?, last_ip = ?, calls = calls + 1 WHERE id = ?').run(nowIso(), String(ip).slice(0, 64), row.token_id);
  const { token_id, token_name, ...user } = row;
  return { user, tokenId: token_id, tokenName: token_name };
}
