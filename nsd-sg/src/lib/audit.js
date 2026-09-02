// Audit log writer. Every security-relevant action calls this; nothing ever deletes rows.
import { getDb } from '../db/index.js';

let stmt;

export function audit({ req, actor, action, targetType = '', targetId = '', details = {}, severity = 'info' }) {
  const db = getDb();
  stmt ??= db.prepare(`
    INSERT INTO audit_log (actor_id, actor_role, ip, action, target_type, target_id, details, severity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const user = actor ?? req?.user ?? null;
  stmt.run(
    user?.id ?? null,
    user?.role ?? '',
    req?.ip ?? '',
    action,
    targetType,
    String(targetId ?? ''),
    JSON.stringify(details ?? {}),
    severity,
  );
  if (req?.log) {
    const logFn = severity === 'alert' ? 'warn' : 'info';
    req.log[logFn]({ audit: action, actor: user?.id, targetType, targetId, ...details }, 'audit');
  }
}
