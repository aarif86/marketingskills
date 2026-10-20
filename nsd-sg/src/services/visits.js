// Raw visitor log for flagged sites only. Normal sites keep daily counts (site_traffic_daily); a site that is
// reported, suspended, or switched on by admin records every request (IP, browser, path, referer) for 90 days,
// longer while the owner is under legal hold. Rows carry the subdomain so they still read after the site is gone.
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/ids.js';

export const VISIT_KEEP_DAYS = 90;
let ins = null;

export const shouldLog = (site) => !!(site?.log_visitors || site?.status === 'suspended');

export function logVisit(site, req, state = 'live') {
  ins ??= getDb().prepare('INSERT INTO site_visits (site_id, subdomain, at, ip, user_agent, method, path, referer, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run(site.id, site.subdomain ?? '', nowIso(), String(req.ip ?? '').slice(0, 64), String(req.headers?.['user-agent'] ?? '').slice(0, 300),
    String(req.method ?? ''), String(req.raw?.url ?? req.url ?? '').slice(0, 500), String(req.headers?.referer ?? '').slice(0, 300), state);
}

export function setLogVisitors(siteId, on) {
  getDb().prepare('UPDATE sites SET log_visitors = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, nowIso(), siteId);
}

export function visitsForSite(siteId, limit = 200) {
  return getDb().prepare('SELECT * FROM site_visits WHERE site_id = ? ORDER BY at DESC LIMIT ?').all(siteId, limit);
}

export function visitCount(siteId) {
  return getDb().prepare('SELECT COUNT(*) n FROM site_visits WHERE site_id = ?').get(siteId).n;
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function visitsCsv(rows) {
  const head = 'at_utc,at_sgt,ip,method,path,referer,user_agent,state';
  return [head, ...rows.map((r) => [r.at, sgt(r.at), r.ip, r.method, r.path, r.referer, r.user_agent, r.state].map(csvCell).join(','))].join('\n') + '\n';
}

/** Singapore wall-clock for a UTC ISO string: "2026-10-20 18:46:05 SGT". */
export function sgt(iso) {
  const t = Date.parse(iso); if (Number.isNaN(t)) return '';
  return new Date(t + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) + ' SGT';
}

/** Drop visit rows older than the keep window, except for sites whose owner is under legal hold. */
export function purgeVisits() {
  const db = getDb();
  const cutoff = new Date(Date.now() - VISIT_KEEP_DAYS * 86400000).toISOString();
  return db.prepare(`DELETE FROM site_visits WHERE at < ? AND site_id NOT IN (SELECT s.id FROM sites s JOIN users u ON u.id = s.user_id WHERE u.legal_hold = 1)`).run(cutoff).changes;
}
