// Evidence holds: when a site is deleted or suspended, or a test page expires, a copy of what was online is kept
// for a while in DATA_DIR/evidence (never inside any document root), so abuse can still be shown after the
// author has cleaned up. Admin downloads a hold, or a whole "evidence pack" for one account, as a ZIP.
//
//   DATA_DIR/evidence/sites/<siteId>/<ts>/meta.json + files/…   kept 90 days
//   DATA_DIR/evidence/try/<previewId>/meta.json + index.html     kept 7 days
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { releaseDir } from '../storage/releases.js';
import { zipBuffer } from '../lib/zipwrite.js';
import { visitsForSite, visitsCsv, sgt } from './visits.js';

export const SITE_HOLD_DAYS = 90;
export const TRY_HOLD_DAYS = 7;
const MAX_PACK_BYTES = 200 * 1024 * 1024;
export const PACK_KEEP_DAYS = 90;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const packRoot = (userId) => { if (!ID_RE.test(userId)) throw new Error('bad user id'); return path.join(root(), 'packs', userId); };
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
    legal_hold: !!db.prepare('SELECT legal_hold FROM users WHERE id = ?').get(site.user_id)?.legal_hold,
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

/** Everything about one account in one ZIP: records, sessions, audit rows, sites, every version, held files,
 *  visitor logs of flagged sites, test pages from their IPs, a SHA-256 manifest and a plain-words summary. */
export function buildPack(userId, { actor = null } = {}) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId);
  const audit = db.prepare('SELECT * FROM audit_log WHERE actor_id = ? OR (target_type = ? AND target_id = ?) ORDER BY at').all(userId, 'user', userId);
  const sites = db.prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY created_at').all(userId);
  const releases = sites.length ? db.prepare(`SELECT * FROM releases WHERE site_id IN (${sites.map(() => '?').join(',')}) ORDER BY site_id, version`).all(...sites.map((s) => s.id)) : [];
  const events = db.prepare('SELECT * FROM plan_events WHERE user_id = ? ORDER BY created_at').all(userId);
  const reports = sites.length ? db.prepare(`SELECT * FROM abuse_reports WHERE site_id IN (${sites.map(() => '?').join(',')}) ORDER BY created_at`).all(...sites.map((s) => s.id)) : [];
  const ips = [...new Set([user.last_login_ip, ...sessions.map((x) => x.ip), ...audit.map((a) => a.ip), ...releases.map((r) => r.ip)].filter(Boolean))];
  const previews = ips.length ? db.prepare(`SELECT * FROM previews WHERE ip IN (${ips.map(() => '?').join(',')}) ORDER BY created_at`).all(...ips) : [];
  const withSgt = (row, ...keys) => { const o = { ...row }; for (const k of keys) if (o[k]) o[`${k}_sgt`] = sgt(o[k]); return o; };
  const j = (v) => JSON.stringify(v, null, 2);
  const generatedAt = nowIso();
  const bySite = Object.fromEntries(sites.map((x) => [x.id, x]));
  const label = (x) => (x?.subdomain ?? '?').replace(/\.deleted\.[0-9A-Z]+$/, ''); // a deleted site's name is suffixed in the db; show the name people knew
  const entries = [
    { name: 'user.json', data: j(withSgt(scrub(user), 'created_at', 'last_login_at', 'plan_started_at', 'plan_expires_at')) },
    { name: 'sessions.json', data: j(sessions.map((x) => withSgt(x, 'created_at', 'last_seen_at', 'expires_at'))) },
    { name: 'audit.jsonl', data: audit.map((a) => JSON.stringify(withSgt(a, 'at'))).join('\n') + '\n' },
    { name: 'sites.json', data: j(sites.map((x) => withSgt(x, 'created_at', 'updated_at', 'last_deployed_at'))) },
    { name: 'versions.json', data: j(releases.map((r) => withSgt({ ...r, subdomain: label(bySite[r.site_id]) }, 'created_at'))) },
    { name: 'plan_events.json', data: j(events.map((x) => withSgt(x, 'created_at'))) },
    { name: 'abuse_reports.json', data: j(reports.map((x) => withSgt(x, 'created_at'))) },
    { name: 'ips.txt', data: ips.join('\n') + '\n' },
    { name: 'previews.json', data: j(previews.map((x) => withSgt(x, 'created_at', 'expires_at'))) },
  ];
  let bytes = 0; let truncated = false;
  const add = (name, data) => {
    if (truncated) return;
    bytes += data.length;
    if (bytes > MAX_PACK_BYTES) { truncated = true; entries.push({ name: 'TRUNCATED.txt', data: 'Site files exceed 200 MB; download individual holds and versions from the admin site page.\n' }); return; }
    entries.push({ name, data });
  };
  // Every version still on disk, not only the last one: an upload that was later overwritten is still here.
  const versionsOnDisk = [];
  for (const r of releases) {
    const dir = releaseDir(r.site_id, r.id);
    if (!fs.existsSync(dir)) continue;
    versionsOnDisk.push(r);
    for (const f of filesUnder(dir)) add(`versions/${label(bySite[r.site_id])}/v${r.version}/${f.name}`, f.data);
  }
  const holds = [];
  for (const x of sites) {
    for (const h of listHoldsForSite(x.id)) {
      holds.push({ ...h, subdomain: label(x) });
      for (const f of filesUnder(path.join(siteHoldRoot(x.id), h.ts))) add(`holds/${label(x)}/${h.ts}/${f.name}`, f.data);
    }
    const visits = visitsForSite(x.id, 100000);
    if (visits.length) entries.push({ name: `visits/${label(x)}.csv`, data: visitsCsv(visits.reverse()) });
  }
  for (const pv of previews) {
    const dir = path.join(root(), 'try', pv.id);
    for (const f of filesUnder(dir)) add(`previews/${pv.id}/${f.name}`, f.data);
  }
  // Plain-words summary first, for whoever reads the pack before opening any JSON.
  const line = (k, v) => `${k.padEnd(18)} ${v}`;
  const summary = [
    `EVIDENCE PACK — ${user.email}`,
    `Generated ${sgt(generatedAt)} (${generatedAt} UTC) by ${actor?.email ?? 'NSD.SG system'} on nsd.sg, app version ${config.version}.`,
    '',
    'ACCOUNT',
    line('Email', user.email), line('Name', user.name || '(none)'), line('Account id', user.id),
    line('Joined', sgt(user.created_at)), line('Status', user.status + (user.legal_hold ? ' · LEGAL HOLD' : '')),
    line('Google account', user.google_sub ? `linked (Google id ${user.google_sub})` : 'no'),
    line('Email verified', user.email_verified_at ? sgt(user.email_verified_at) : 'no'),
    line('Plan', `${user.plan_id}${user.plan_expires_at ? ` until ${sgt(user.plan_expires_at)}` : ''}`),
    line('Last login', user.last_login_at ? `${sgt(user.last_login_at)} from ${user.last_login_ip || '?'}` : 'never'),
    '',
    `IP ADDRESSES SEEN (${ips.length})`,
    ...ips.map((ip) => {
      const first = [...sessions, ...audit, ...releases].filter((x) => x.ip === ip).map((x) => x.created_at ?? x.at).sort()[0];
      const n = sessions.filter((x) => x.ip === ip).length;
      return `  ${ip.padEnd(40)} first seen ${first ? sgt(first) : '?'} · ${n} login${n === 1 ? '' : 's'}`;
    }),
    '',
    `SITES (${sites.length})`,
    ...(sites.length ? sites.flatMap((x) => [
      `  ${label(x)}.${config.baseDomain} — ${x.status}${x.suspended_reason ? ` (${x.suspended_reason})` : ''} · created ${sgt(x.created_at)}`,
      ...releases.filter((r) => r.site_id === x.id).map((r) => `      v${r.version} ${sgt(r.created_at)} ${r.source.padEnd(8)} ${String(r.file_count).padStart(3)} files  ${r.ip || 'ip ?'}  ${versionsOnDisk.includes(r) ? 'files in versions/' : 'files no longer on disk'}`),
      ...holds.filter((h) => h.site_id === x.id).map((h) => `      hold ${h.ts}: ${h.reason || 'no reason'} · kept until ${sgt(h.keep_until)}${h.legal_hold ? ' · LEGAL HOLD' : ''}`),
      ...(visitsForSite(x.id, 1).length ? [`      visitor log: visits/${label(x)}.csv`] : []),
    ]) : ['  none']),
    '',
    `ABUSE REPORTS (${reports.length})`,
    ...(reports.length ? reports.map((r) => `  ${sgt(r.created_at)} ${r.subdomain} ${r.category} — ${r.status}${r.details ? `: ${r.details.slice(0, 120)}` : ''}`) : ['  none']),
    '',
    `TEST PAGES FROM THESE IPS (${previews.length})`,
    ...(previews.length ? previews.map((pv) => `  ${sgt(pv.created_at)} ${pv.id} from ${pv.ip} — ${pv.status}`) : ['  none']),
    '',
    'FILES IN THIS PACK',
    '  SUMMARY.txt        this page',
    '  README.txt         what each file is',
    '  MANIFEST.sha256    SHA-256 of every file here; verify with: sha256sum -c MANIFEST.sha256',
    '  CHAIN_OF_CUSTODY.txt who generated this pack, when, and the hash of the manifest',
    '  user.json, sessions.json, audit.jsonl, sites.json, versions.json, plan_events.json, abuse_reports.json, ips.txt, previews.json',
    '  versions/          every version of every site still on disk, as uploaded',
    '  holds/             copies kept when a site was suspended or deleted',
    '  visits/            raw visitor logs for flagged sites (IP, browser, path, time)',
    '  previews/          anonymous test pages made from the same IPs',
    '',
    'Times marked SGT are Singapore time (UTC+8). All JSON files carry both UTC and *_sgt fields.',
    'IP addresses are as seen by the server; behind Cloudflare they are the visitor addresses forwarded by Cloudflare.',
    '',
  ].join('\n');
  entries.unshift({ name: 'SUMMARY.txt', data: summary });
  entries.push({ name: 'README.txt', data: `Evidence pack for ${user.email} (${user.id})\nGenerated ${generatedAt} UTC (${sgt(generatedAt)}) by NSD.SG${actor?.email ? `, requested by ${actor.email}` : ''}.\n\nSUMMARY.txt        plain-words overview\nuser.json          account record (no password hash)\nsessions.json      every login: IP, browser, times\naudit.jsonl        every logged action by or about this account (one JSON object per line)\nsites.json         every site incl. deleted ones\nversions.json      every version ever published: time, source, uploader IP and browser\nplan_events.json   plan/promo/payment history\nabuse_reports.json reports filed against this account's sites\nips.txt            every IP seen for this account\nprevews.json       anonymous test pages made from those IPs\nversions/          the files of each version still on disk\nholds/             copies of site files kept when a site was suspended or deleted\nvisits/            raw visitor logs for flagged sites (CSV)\nMANIFEST.sha256    hashes of every file above\n`.replace('prevews', 'previews') });
  // Integrity: hash every entry, then hash the manifest itself in the custody note.
  const manifest = entries.map((e) => `${sha256(Buffer.from(e.data))}  ${e.name}`).join('\n') + '\n';
  const custody = [
    'CHAIN OF CUSTODY',
    `Pack for      ${user.email} (${user.id})`,
    `Generated     ${generatedAt} UTC = ${sgt(generatedAt)}`,
    `Generated by  ${actor?.email ?? 'NSD.SG system (automatic)'}${actor?.id ? ` (admin id ${actor.id})` : ''}`,
    `System        nsd.sg app ${config.version}, data directory on the NSD.SG server`,
    `Files         ${entries.length} (+ this note and MANIFEST.sha256)${truncated ? ' — TRUNCATED, see TRUNCATED.txt' : ''}`,
    `Manifest hash ${sha256(Buffer.from(manifest))}  (SHA-256 of MANIFEST.sha256)`,
    '',
    'To verify: unzip, then run  sha256sum -c MANIFEST.sha256  (or certutil -hashfile on Windows) and compare the',
    'manifest hash above with the value NSD.SG recorded in its audit log when this pack was generated.',
    '',
  ].join('\n');
  entries.push({ name: 'MANIFEST.sha256', data: manifest }, { name: 'CHAIN_OF_CUSTODY.txt', data: custody });
  const zip = zipBuffer(entries);
  return { zip, sha256: sha256(zip), manifestSha256: sha256(Buffer.from(manifest)), files: entries.length, truncated, user };
}

export const evidencePack = (userId, opts) => buildPack(userId, opts)?.zip ?? null;

/** Generate a pack and keep it on disk (before a permanent delete, or on demand). Survives the account row. */
export function storePack(userId, { actor = null, reason = '' } = {}) {
  const built = buildPack(userId, { actor });
  if (!built) return null;
  const base = packRoot(userId);
  const ts = stamp(base);
  const dir = path.join(base, ts);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'pack.zip'), built.zip, { mode: 0o600 });
  const meta = {
    user_id: userId, email: built.user.email, reason, generated_by: actor?.id ?? null, generated_by_email: actor?.email ?? null, generated_at: nowIso(),
    bytes: built.zip.length, sha256: built.sha256, manifest_sha256: built.manifestSha256, files: built.files,
    keep_until: new Date(Date.now() + PACK_KEEP_DAYS * 86400000).toISOString(), legal_hold: !!built.user.legal_hold,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o600 });
  return { ts, ...meta };
}

export function listStoredPacks(userId = null) {
  const base = path.join(root(), 'packs');
  if (!fs.existsSync(base)) return [];
  const users = userId ? [userId] : fs.readdirSync(base);
  const out = [];
  for (const u of users) {
    const d = path.join(base, u);
    if (!fs.existsSync(d)) continue;
    for (const ts of fs.readdirSync(d).filter((n) => TS_RE.test(n))) out.push({ ts, ...(readMeta(path.join(d, ts)) ?? { user_id: u }) });
  }
  return out.sort((a, b) => (b.generated_at ?? '').localeCompare(a.generated_at ?? ''));
}

export function storedPackZip(userId, ts) {
  if (!TS_RE.test(ts)) return null;
  const f = path.join(packRoot(userId), ts, 'pack.zip');
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
}

/** Legal hold: nothing about this account is purged until it is lifted. Written into every hold/pack meta so it
 *  survives the account row itself. */
export function setLegalHold(userId, on) {
  const db = getDb();
  db.prepare('UPDATE users SET legal_hold = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, nowIso(), userId);
  const touch = (dir) => { const m = readMeta(dir); if (m) fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...m, legal_hold: !!on }, null, 2), { mode: 0o600 }); };
  for (const x of db.prepare('SELECT id FROM sites WHERE user_id = ?').all(userId)) {
    const base = siteHoldRoot(x.id);
    if (fs.existsSync(base)) for (const ts of fs.readdirSync(base).filter((n) => TS_RE.test(n))) touch(path.join(base, ts));
  }
  const pb = path.join(root(), 'packs', userId);
  if (ID_RE.test(userId) && fs.existsSync(pb)) for (const ts of fs.readdirSync(pb).filter((n) => TS_RE.test(n))) touch(path.join(pb, ts));
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
        if (meta?.legal_hold) continue; // under legal hold: kept until an admin lifts it
        const until = meta?.keep_until ? Date.parse(meta.keep_until) : fs.statSync(d).mtimeMs + fallbackDays * 86400000;
        if (until < now) { fs.rmSync(d, { recursive: true, force: true }); n++; }
      }
      if (fs.existsSync(dirA) && fs.readdirSync(dirA).length === 0) fs.rmdirSync(dirA);
    }
  };
  sweep(path.join(root(), 'sites'), SITE_HOLD_DAYS);
  sweep(path.join(root(), 'try'), TRY_HOLD_DAYS);
  sweep(path.join(root(), 'packs'), PACK_KEEP_DAYS);
  return n;
}

export function evidenceStats() {
  let sites = 0; let previews = 0; let packs = 0;
  const s = path.join(root(), 'sites'); const t = path.join(root(), 'try'); const pk = path.join(root(), 'packs');
  if (fs.existsSync(s)) for (const a of fs.readdirSync(s)) sites += fs.readdirSync(path.join(s, a)).length;
  if (fs.existsSync(t)) previews = fs.readdirSync(t).length;
  if (fs.existsSync(pk)) for (const a of fs.readdirSync(pk)) packs += fs.readdirSync(path.join(pk, a)).length;
  return { sites, previews, packs };
}
