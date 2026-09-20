// "Try it" previews: paste HTML on the home page without an account and get try.<baseDomain>/<id>/ for 3 hours.
//
//   DATA_DIR/try/<id>/index.html            <- the pasted file, untouched (source for "keep it" at signup)
//   TENANT_ROOT/try/<id>/index.html         <- Hostinger only: rendered copy (preview bar + badge + noindex)
//
// One extra subdomain, `try`, is provisioned once and hosts every preview under its own folder. Previews are
// public but unlisted (random id, noindex), capped per IP and in total, and deleted by the maintenance timer
// and the hourly `sync-all` cron once they expire. Claiming moves the file into a real site as its home page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, platformUrl } from '../config.js';
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { esc } from '../lib/html.js';
import { injectBranding } from '../serve/branding.js';
import { deployFiles, tempFile, StorageError } from '../storage/releases.js';
import { isEnabled as hostingEnabled, provisionSubdomain, tenantDir, htaccess, TRY_LABEL } from '../publish/hostinger.js';

export const TRY_TTL_MS = 3 * 60 * 60_000;
export const TRY_MAX_BYTES = 1024 * 1024;
export const TRY_MAX_LIVE = 2000; // hard cap on stored previews (2 GB worst case)
const ID_RE = /^[a-z0-9]{10,16}$/;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i: ids get read out loud and typed

export class TryError extends Error {}

const tryRoot = () => path.join(config.dataDir, 'try');
const previewDir = (id) => { if (!ID_RE.test(id)) throw new TryError('bad id'); return path.join(tryRoot(), id); };
const hostedDir = (id) => { if (!ID_RE.test(id)) throw new TryError('bad id'); return path.join(tenantDir(TRY_LABEL), id); };

function newPreviewId() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export function previewUrl(id) {
  return `${config.publicScheme}://${TRY_LABEL}.${config.baseDomain}/${id}/`;
}

export function expiresLabel(expiresAt) {
  const d = new Date(expiresAt);
  return d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' }).replace(/\s*(am|pm)$/i, (m) => m.trim().toLowerCase());
}

/** Quick sanity check that a paste is a web page. Returns a plain-words problem or null. */
export function validatePaste(text) {
  const s = String(text ?? '');
  if (s.trim().length < 20 || !/<[a-z!][^>]*>/i.test(s)) return 'That does not look like a web page. Copy the whole code, from the first line to the last, and paste it again.';
  if (Buffer.byteLength(s, 'utf8') > TRY_MAX_BYTES) return 'That page is bigger than 1 MB. Test pages are for a single page; sign up to publish something bigger.';
  return null;
}

// ---- the preview bar -----------------------------------------------------------------------------

function previewBar({ id, expiresAt }) {
  const keep = platformUrl(`/signup?preview=${encodeURIComponent(id)}`);
  const report = platformUrl(`/report?site=${TRY_LABEL}`);
  const style = (s) => s.split(';').filter(Boolean).map((x) => x + ' !important').join(';');
  const bar = `<div data-nsd="try-bar" style="${style('position:fixed;top:0;left:0;right:0;z-index:2147483646;height:44px;display:flex;align-items:center;justify-content:center;gap:12px;padding:0 12px;box-sizing:border-box;background:#111114;color:#fff;font:500 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3);flex-wrap:nowrap;overflow:hidden;white-space:nowrap')}">` +
    `<span style="${style('color:#c9c9d4')}">Test page · gone at ${esc(expiresLabel(expiresAt))}</span>` +
    `<a href="${esc(keep)}" style="${style('color:#fff;background:#7c5cff;text-decoration:none;padding:7px 12px;border-radius:999px;font-weight:600')}">Keep it at my own address →</a>` +
    `<a href="${esc(report)}" style="${style('color:#8a8a99;text-decoration:none;font-size:11px')}">Report</a>` +
    `</div><style>html{margin-top:44px !important}</style>`;
  return bar;
}

/** Full HTML served to visitors: noindex + bar + the normal badge. */
export function renderPreview(rawHtml, { id, expiresAt }) {
  let out = String(rawHtml);
  const meta = '<meta name="robots" content="noindex,nofollow">';
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + meta);
  else out = meta + out;
  const bar = previewBar({ id, expiresAt });
  if (/<\/body\s*>/i.test(out)) out = out.replace(/<\/body\s*>/i, (m) => bar + m);
  else out += bar;
  return injectBranding(Buffer.from(out, 'utf8'));
}

// ---- Hostinger: the shared `try` docroot ------------------------------------------------------------

function simplePage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1014;color:#e8e8ec;display:grid;place-items:center;min-height:100vh}
main{max-width:520px;padding:2.5rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#a6a7b2;line-height:1.55}a{color:#a78bfa}
.mark{display:inline-block;font-weight:700;letter-spacing:.06em;color:#fff;margin-bottom:1.5rem}.mark b{color:#a78bfa}</style></head>
<body><main><div class="mark">NSD<b>.SG</b></div>${body}</main></body></html>`;
}

export const PAGES = {
  gone: () => simplePage('This test page is gone', `<h1>This test page is gone.</h1><p>Test pages last 3 hours, then they are deleted. <a href="${esc(platformUrl('/#try'))}">Make a new one</a> or <a href="${esc(platformUrl('/signup'))}">sign up</a> to keep a page online for good.</p>`),
  root: () => simplePage('Test pages', `<h1>Test pages live here.</h1><p>Paste the code your AI gave you at <a href="${esc(platformUrl('/#try'))}">${esc(config.platformHosts[0])}</a> and you get a link here that works for 3 hours.</p>`),
};

let tryHostReady = null;
/** Provision try.<baseDomain> once (Hostinger only) and write its root files. Safe to call often. */
export function ensureTryHost() {
  if (!hostingEnabled()) return Promise.resolve({ skipped: true });
  tryHostReady ??= (async () => {
    const r = await provisionSubdomain(TRY_LABEL);
    const root = tenantDir(TRY_LABEL);
    fs.writeFileSync(path.join(root, '.htaccess'), htaccess({ has404: false, errorDoc: '/_nsd-expired.html', extra: ['<IfModule mod_headers.c>', '  Header always set X-Robots-Tag "noindex, nofollow"', '  Header always set Cache-Control "no-store"', '</IfModule>'] }));
    fs.writeFileSync(path.join(root, '_nsd-expired.html'), PAGES.gone());
    fs.writeFileSync(path.join(root, 'index.html'), PAGES.root());
    return r;
  })().catch((e) => { tryHostReady = null; throw e; });
  return tryHostReady;
}

// ---- lifecycle -------------------------------------------------------------------------------------

export function countLive() {
  return getDb().prepare('SELECT COUNT(*) n FROM previews WHERE claimed_at IS NULL AND expires_at > ?').get(nowIso()).n;
}

/** Store a paste and return { id, url, expiresAt }. Throws TryError with a plain-words message. */
export async function createPreview({ html, ip = '' }) {
  const problem = validatePaste(html);
  if (problem) throw new TryError(problem);
  if (countLive() >= TRY_MAX_LIVE) throw new TryError('Too many test pages are open right now. Please try again in an hour, or sign up to publish straight away.');
  const id = newPreviewId();
  const bytes = Buffer.byteLength(html, 'utf8');
  const expiresAt = new Date(Date.now() + TRY_TTL_MS).toISOString();
  const dir = previewDir(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(path.join(dir, 'index.html'), html, { mode: 0o640 });
  getDb().prepare('INSERT INTO previews (id, ip, bytes, expires_at) VALUES (?, ?, ?, ?)').run(id, String(ip).slice(0, 64), bytes, expiresAt);
  if (hostingEnabled()) {
    try {
      await ensureTryHost();
      const hdir = hostedDir(id);
      fs.mkdirSync(hdir, { recursive: true, mode: 0o755 });
      fs.writeFileSync(path.join(hdir, 'index.html'), renderPreview(html, { id, expiresAt }), { mode: 0o644 });
    } catch (e) {
      // Recorded, not fatal: the platform page still shows the link; sync-all retries provisioning.
      getDb().prepare('UPDATE previews SET error = ? WHERE id = ?').run(String(e.message).slice(0, 300), id);
    }
  }
  return { id, url: previewUrl(id), expiresAt };
}

/** Live preview row (not expired, not claimed) or null. */
export function getPreview(id) {
  if (!ID_RE.test(String(id ?? ''))) return null;
  const row = getDb().prepare('SELECT * FROM previews WHERE id = ?').get(id);
  if (!row || row.claimed_at || row.expires_at <= nowIso()) return null;
  return row;
}

export function readPreviewHtml(id) {
  const file = path.join(previewDir(id), 'index.html');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function removeFiles(id) {
  fs.rmSync(previewDir(id), { recursive: true, force: true });
  if (hostingEnabled()) fs.rmSync(hostedDir(id), { recursive: true, force: true });
}

/** Move a preview into `site` as its home page. Returns the deploy result. */
export async function claimPreview({ id, site, user, limits }) {
  const row = getPreview(id);
  if (!row) throw new TryError('That test page has expired or was already used.');
  const html = readPreviewHtml(id);
  if (html === null) throw new TryError('That test page is no longer on disk.');
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > limits.max_file_bytes) throw new TryError('That page is bigger than your plan allows for one file.');
  const tmp = tempFile('claim');
  try {
    fs.writeFileSync(tmp, html, { mode: 0o600 });
    const result = await deployFiles({ site, files: [{ relPath: 'index.html', tmpPath: tmp, size: bytes }], user, limits, replaceAll: false, note: 'Kept from a test page' });
    getDb().prepare('UPDATE previews SET claimed_site_id = ?, claimed_at = ? WHERE id = ?').run(site.id, nowIso(), id);
    removeFiles(id);
    return result;
  } catch (e) {
    if (e instanceof StorageError) throw new TryError(e.message);
    throw e;
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

/** Delete expired / claimed previews from disk and the table. Returns the count removed. */
export function expirePreviews() {
  const db = getDb();
  const doomed = db.prepare('SELECT id FROM previews WHERE expires_at <= ? OR claimed_at IS NOT NULL').all(nowIso());
  for (const r of doomed) {
    try { removeFiles(r.id); } catch { /* best effort */ }
    db.prepare('DELETE FROM previews WHERE id = ?').run(r.id);
  }
  // Safety net: folders on disk that the table no longer knows about (crash between write and insert).
  for (const root of [tryRoot(), hostingEnabled() ? tenantDir(TRY_LABEL) : null]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (!ID_RE.test(name)) continue;
      if (!db.prepare('SELECT 1 FROM previews WHERE id = ?').get(name)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }
  return doomed.length;
}

export const __test = { ID_RE, previewDir, hostedDir, previewBar };
