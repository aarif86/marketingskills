// Evidence holds: when a site is deleted or suspended, or a test page expires, a copy of what was online is kept
// for a while in DATA_DIR/evidence (never inside any document root), so abuse can still be shown after the
// author has cleaned up. Admin downloads a hold, or a whole "evidence pack" for one account, as a ZIP.
//
//   DATA_DIR/evidence/sites/<siteId>/<ts>/meta.json + files/…   kept 90 days
//   DATA_DIR/evidence/try/<previewId>/meta.json + index.html     kept 7 days
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { releaseDir } from '../storage/releases.js';
import { zipBuffer } from '../lib/zipwrite.js';

export const SITE_HOLD_DAYS = 90;
export const TRY_HOLD_DAYS = 7;
const MAX_PACK_BYTES = 200 * 1024 * 1024;
const ID_RE = /^[0-9A-Z]{26}$/;
const TS_RE = /^\d{8}T\d{6}(?:\d{3})?(?:-\d+)?$/;

const root = () => path.join(config.dataDir, 'evidence');
const siteHoldRoot = (siteId) => { if (!ID_RE.test(siteId)) throw new Error('bad site id'); return path.join(root(), 'sites', siteId); };
const stamp = (base) => {
  const t = new Date().toISOString().replace(/[-:.]/g, '').replace(/Z$/, '');
  let ts = t; let n = 1;
  while (base && fs.existsSync(path.join(base, ts))) ts = `${t}-${++n}`;
  return ts;
};

function copyTree(src, dst, budget = { bytes: 0 }) {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name); const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(s, d, budget);
    else if (ent.isFile()) { fs.copyFileSync(s, d); budget.bytes += fs.statSync(s).size; }
  }
  return budget.bytes;
}

/** Keep a copy of the site's current files. Returns the hold folder name, or null when there was nothing online. */
export function holdSite(siteId, { reason = '', actorId = null } = {}) {
  const db = getDb();
  const site = db.prepare('SELECT s.*, u.email AS owner_email FROM sites s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(siteId);
  if (!site?.current_release_id) return null;
  const src = releaseDir(site.id, site.current_release_id);
  if (!fs.existsSync(src)) return null;
  const rel = db.prepare('SELECT version FROM releases WHERE id = ?').get(site.current_release_id);
  const ts = stamp(siteHoldRoot(site.id));
  const dir = path.join(siteHoldRoot(site.id), ts);
  const bytes = copyTree(src, path.join(dir, 'files'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    site_id: site.id, subdomain: site.subdomain, title: site.title, user_id: site.user_id, owner_email: site.owner_email,
    release_id: site.current_release_id, version: rel?.version ?? null, reason, held_by: actorId, held_at: nowIso(), bytes,
    keep_until: new Date(Date.now() + SITE_HOLD_DAYS * 86400000).toISOString(),
  }, null, 2), { mode: 0o600 });
  return ts;
}

/** Move an expired/removed test page's file into the hold folder. */
export function holdPreview(id, row, reason = 'expired') {
  const src = path.join(config.dataDir, 'try', id, 'index.html');
  if (!fs.existsSync(src) || !/^[a-z0-9]{10,16}$/.test(id)) return false;
  const dir = path.join(root(), 'try', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.renameSync(src, path.join(dir, 'index.html'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, ip: row?.ip ?? '', bytes: row?.bytes ?? 0, created_at: row?.created_at ?? null, expires_at: row?.expires_at ?? null, reason, held_at: nowIso(), keep_until: new Date(Date.now() + TRY_HOLD_DAYS * 86400000).toISOString() }, null, 2), { mode: 0o600 });
  return true;
}

function readMeta(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; } }

export function listHoldsForSite(siteId) {
  const base = siteHoldRoot(siteId);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((n) => TS_RE.test(n)).sort().reverse().map((ts) => ({ ts, ...(readMeta(path.join(base, ts)) ?? {}) }));
}

export function listHoldsForUser(userId) {
  const sites = getDb().prepare('SELECT id FROM sites WHERE user_id = ?').all(userId);
  return sites.flatMap((s) => listHoldsForSite(s.id));
}

function filesUnder(dir, prefix = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...filesUnder(p, `${prefix}${ent.name}/`));
    else if (ent.isFile()) out.push({ name: `${prefix}${ent.name}`, data: fs.readFileSync(p) });
  }
  return out;
}

/** ZIP of one hold. */
export function holdZip(siteId, ts) {
  if (!TS_RE.test(ts)) return null;
  const dir = path.join(siteHoldRoot(siteId), ts);
  if (!fs.existsSync(dir)) return null;
  return zipBuffer(filesUnder(dir));
}

const scrub = (u) => { if (!u) return u; const { password_hash, ...rest } = u; return rest; };

/** Everything about one account in one ZIP: records, sessions, audit rows, sites, held files, test pages from their IPs. */
export function evidencePack(userId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId);
  const audit = db.prepare('SELECT * FROM audit_log WHERE actor_id = ? OR (target_type = ? AND target_id = ?) ORDER BY at').all(userId, 'user', userId);
  const sites = db.prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY created_at').all(userId);
  const releases = sites.length ? db.prepare(`SELECT * FROM releases WHERE site_id IN (${sites.map(() => '?').join(',')}) ORDER BY created_at`).all(...sites.map((s) => s.id)) : [];
  const events = db.prepare('SELECT * FROM plan_events WHERE user_id = ? ORDER BY created_at').all(userId);
  const ips = [...new Set([user.last_login_ip, ...sessions.map((s) => s.ip), ...audit.map((a) => a.ip)].filter(Boolean))];
  const previews = ips.length ? db.prepare(`SELECT * FROM previews WHERE ip IN (${ips.map(() => '?').join(',')}) ORDER BY created_at`).all(...ips) : [];
  const j = (v) => JSON.stringify(v, null, 2);
  const entries = [
    { name: 'README.txt', data: `Evidence pack for ${user.email} (${user.id})\nGenerated ${nowIso()} by NSD.SG.\nTimes are UTC (Singapore = UTC+8).\n\nuser.json         account record (no password hash)\nsessions.json     every login: IP, browser, times\naudit.jsonl       every logged action by or about this account (one JSON object per line)\nsites.json        every site incl. deleted ones; releases.json = every version published\nplan_events.json  plan/promo/payment history\nips.txt           every IP seen for this account\npreviews.json     anonymous test pages made from those IPs\nholds/            copies of site files kept when a site was suspended or deleted\n` },
    { name: 'user.json', data: j(scrub(user)) },
    { name: 'sessions.json', data: j(sessions) },
    { name: 'audit.jsonl', data: audit.map((a) => JSON.stringify(a)).join('\n') + '\n' },
    { name: 'sites.json', data: j(sites) },
    { name: 'releases.json', data: j(releases) },
    { name: 'plan_events.json', data: j(events) },
    { name: 'ips.txt', data: ips.join('\n') + '\n' },
    { name: 'previews.json', data: j(previews) },
  ];
  let bytes = 0;
  for (const s of sites) {
    for (const h of listHoldsForSite(s.id)) {
      for (const f of filesUnder(path.join(siteHoldRoot(s.id), h.ts))) {
        bytes += f.data.length;
        if (bytes > MAX_PACK_BYTES) { entries.push({ name: 'holds/TRUNCATED.txt', data: 'Held files exceed 200 MB; download individual holds from the admin site page.' }); break; }
        entries.push({ name: `holds/${s.subdomain}/${h.ts}/${f.name}`, data: f.data });
      }
    }
  }
  for (const p of previews) {
    const dir = path.join(root(), 'try', p.id);
    for (const f of filesUnder(dir)) entries.push({ name: `previews/${p.id}/${f.name}`, data: f.data });
  }
  return zipBuffer(entries);
}

/** Drop holds past their keep_until. Returns the count removed. */
export function purgeEvidence() {
  let n = 0;
  const now = Date.now();
  const sweep = (base, fallbackDays) => {
    if (!fs.existsSync(base)) return;
    for (const a of fs.readdirSync(base)) {
      const dirA = path.join(base, a);
      const subs = fs.existsSync(path.join(dirA, 'meta.json')) ? [dirA] : fs.readdirSync(dirA).map((b) => path.join(dirA, b));
      for (const d of subs) {
        const meta = readMeta(d);
        const until = meta?.keep_until ? Date.parse(meta.keep_until) : fs.statSync(d).mtimeMs + fallbackDays * 86400000;
        if (until < now) { fs.rmSync(d, { recursive: true, force: true }); n++; }
      }
      if (fs.existsSync(dirA) && fs.readdirSync(dirA).length === 0) fs.rmdirSync(dirA);
    }
  };
  sweep(path.join(root(), 'sites'), SITE_HOLD_DAYS);
  sweep(path.join(root(), 'try'), TRY_HOLD_DAYS);
  return n;
}

export function evidenceStats() {
  let sites = 0; let previews = 0;
  const s = path.join(root(), 'sites'); const t = path.join(root(), 'try');
  if (fs.existsSync(s)) for (const a of fs.readdirSync(s)) sites += fs.readdirSync(path.join(s, a)).length;
  if (fs.existsSync(t)) previews = fs.readdirSync(t).length;
  return { sites, previews };
}
