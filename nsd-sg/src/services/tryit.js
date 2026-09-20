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
import { holdPreview } from './evidence.js';
import { pageTitle, socialTags } from '../serve/social.js';
import { probeUrl, setProbe } from '../lib/probe.js';

export const TRY_TTL_MS = 3 * 60 * 60_000;
export const TRY_MAX_BYTES = 1024 * 1024;
export const TRY_MAX_LIVE = 2000; // hard cap on stored previews (2 GB worst case)
export const TRY_FREE_PER_PERSON = 3;   // signed cookie: after this many, ask for a free account
export const TRY_FREE_PER_IP_DAY = 10;  // shared offices/schools sit behind one IP, so the IP cap is looser
export const TRY_COOKIE = 'nsd_try';
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

// ---- what visitors get -----------------------------------------------------------------------------
// Two files per preview: page.html is the pasted page (noindex + badge, nothing else touched) and index.html is a
// thin shell that shows the preview bar ABOVE the page in a frame, so the page's own header is never covered.
// The shell carries the share-preview tags, so WhatsApp/Telegram cards describe the test page, not whatever
// logo the pasted page happened to reference.

/** The pasted page as served inside the frame. */
export function renderPreviewPage(rawHtml) {
  let out = String(rawHtml);
  const meta = '<meta name="robots" content="noindex,nofollow">';
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + meta);
  else out = meta + out;
  return injectBranding(Buffer.from(out, 'utf8'));
}

/** The shell at try.<domain>/<id>/: bar on top, the page below in a frame, × hides the bar until the next load. */
export function renderPreviewShell(rawHtml, { id, expiresAt }) {
  const keep = platformUrl(`/signup?preview=${encodeURIComponent(id)}`);
  const report = platformUrl(`/report?site=${TRY_LABEL}`);
  const when = expiresLabel(expiresAt);
  const title = pageTitle(rawHtml) || 'Test page';
  const url = previewUrl(id);
  const social = socialTags('', { url, siteName: `try.${config.baseDomain}`, image: platformUrl('/assets/social-try.png'), title: `${title} · test page on NSD.SG`, description: `Put online in one click with NSD.SG, no account needed. This test link works until ${when} Singapore time. Make yours free at ${config.platformHosts[0]}.` });
  return Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · test page on NSD.SG</title>${social}
<style>html,body{margin:0;height:100%;background:#fff}body{display:flex;flex-direction:column}
.nsd-bar{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:10px 14px;flex-wrap:wrap;min-height:44px;padding:8px 48px 8px 12px;padding-top:max(8px,env(safe-area-inset-top));box-sizing:border-box;background:#111114;color:#fff;font:500 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3)}
.nsd-bar .t{color:#c9c9d4;text-align:center}.nsd-bar .keep{color:#fff;background:#7c5cff;text-decoration:none;padding:7px 12px;border-radius:999px;font-weight:600;white-space:nowrap}.nsd-bar .rep{color:#8a8a99;text-decoration:none;font-size:11px}
.nsd-bar button{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:18px;line-height:1;cursor:pointer}
.wrap{flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}.wrap iframe{display:block;width:100%;height:100%;border:0;background:#fff}
body.bare .nsd-bar{display:none}
.nsd-bar .short{display:none}@media(max-width:600px){.nsd-bar{font-size:12px;gap:8px 10px;padding-right:44px}.nsd-bar .rep{display:none}.nsd-bar .long{display:none}.nsd-bar .short{display:inline}.nsd-bar .keep{padding:6px 10px}}</style></head>
<body><div class="nsd-bar" data-nsd="try-bar"><span class="t"><span class="long">Test page · gone at ${esc(when)} Singapore time</span><span class="short">Test page · gone ${esc(when)} SGT</span></span><a class="keep" href="${esc(keep)}"><span class="long">Keep it at my own address →</span><span class="short">Keep it →</span></a><a class="rep" href="${esc(report)}">Report</a><button type="button" aria-label="Hide this bar" title="Hide until next load" onclick="document.body.classList.add('bare')">×</button></div>
<div class="wrap"><iframe src="./page.html" title="${esc(title)}"></iframe></div></body></html>`, 'utf8');
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
    rerenderPreviews();
    return r;
  })().catch((e) => { tryHostReady = null; throw e; });
  return tryHostReady;
}

/** Rewrite the hosted copy of every live preview with the current shell/page rendering. Runs once per boot. */
export function rerenderPreviews() {
  if (!hostingEnabled()) return 0;
  let n = 0;
  for (const row of getDb().prepare('SELECT * FROM previews WHERE claimed_at IS NULL AND expires_at > ?').all(nowIso())) {
    const html = readPreviewHtml(row.id);
    if (html === null) continue;
    try {
      const hdir = hostedDir(row.id);
      fs.mkdirSync(hdir, { recursive: true, mode: 0o755 });
      fs.writeFileSync(path.join(hdir, 'page.html'), renderPreviewPage(html), { mode: 0o644 });
      fs.writeFileSync(path.join(hdir, 'index.html'), renderPreviewShell(html, { id: row.id, expiresAt: row.expires_at }), { mode: 0o644 });
      n++;
    } catch { /* next */ }
  }
  return n;
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
  // Same-process serving (VPS/local) answers the moment the file exists; on Hostinger the probe below decides.
  getDb().prepare('INSERT INTO previews (id, ip, bytes, expires_at, ready_at) VALUES (?, ?, ?, ?, ?)').run(id, String(ip).slice(0, 64), bytes, expiresAt, hostingEnabled() ? null : nowIso());
  if (hostingEnabled()) {
    try {
      await ensureTryHost();
      const hdir = hostedDir(id);
      fs.mkdirSync(hdir, { recursive: true, mode: 0o755 });
      fs.writeFileSync(path.join(hdir, 'page.html'), renderPreviewPage(html), { mode: 0o644 });
      fs.writeFileSync(path.join(hdir, 'index.html'), renderPreviewShell(html, { id, expiresAt }), { mode: 0o644 });
    } catch (e) {
      // Recorded, not fatal: the platform page still shows the link; sync-all retries provisioning.
      getDb().prepare('UPDATE previews SET error = ? WHERE id = ?').run(String(e.message).slice(0, 300), id);
    }
  }
  return { id, url: previewUrl(id), expiresAt };
}

// ---- readiness -------------------------------------------------------------------------------------
// On Hostinger the app never serves try.<baseDomain> itself, so "it is online" is only true once LiteSpeed answers
// over HTTPS. The result page shows the link only after this probe succeeds (a brand-new `try` host waits on its
// certificate for up to ~15 minutes the first time; after that every preview is ready in seconds).
export const setReadyProbe = setProbe; // kept for older tests

/** { ready, reason, url } for a live preview. Marks ready_at the first time the probe succeeds. */
export async function checkReady(id) {
  const row = getPreview(id);
  if (!row) return { ready: false, reason: 'gone' };
  const url = previewUrl(id);
  if (row.ready_at) return { ready: true, url };
  if (row.error) return { ready: false, reason: 'error', detail: row.error, url };
  if (!hostingEnabled()) return { ready: true, url };
  const { ok, detail } = await probeUrl(url);
  if (ok) {
    getDb().prepare('UPDATE previews SET ready_at = ? WHERE id = ? AND ready_at IS NULL').run(nowIso(), id);
    return { ready: true, url };
  }
  return { ready: false, reason: 'waiting', detail, url, waitedMs: Date.now() - Date.parse(row.created_at + (row.created_at.endsWith('Z') ? '' : 'Z')) };
}

// ---- anonymous cap: 3 per person (signed cookie), 10 per IP per day ----------------------------------
function signCount(n) { return crypto.createHmac('sha256', config.sessionSecret).update(`try:${n}`).digest('base64url').slice(0, 24); }
export function readTryCookie(raw) {
  const m = /^(\d{1,3})\.([A-Za-z0-9_-]{24})$/.exec(String(raw ?? ''));
  if (!m) return 0;
  const n = Number(m[1]);
  const expected = signCount(n);
  return m[2].length === expected.length && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected)) ? n : 0;
}
export function writeTryCookie(n) { return `${n}.${signCount(n)}`; }
export function ipTriesToday(ip) {
  return getDb().prepare("SELECT COUNT(*) n FROM previews WHERE ip = ? AND created_at > datetime('now', '-1 day')").get(String(ip)).n;
}
/** Why an anonymous visitor may not make another test page right now, or null. */
export function anonBlockReason({ cookieCount, ip }) {
  if (cookieCount >= TRY_FREE_PER_PERSON) return 'person';
  if (ipTriesToday(ip) >= TRY_FREE_PER_IP_DAY) return 'ip';
  return null;
}

/** Live, confirmed-reachable previews for the public showcase (newest first). */
export function listShowcasePreviews(limit = 12) {
  const rows = getDb().prepare(`SELECT id, expires_at, created_at FROM previews WHERE claimed_at IS NULL AND expires_at > ? AND (ready_at IS NOT NULL OR ?) ORDER BY created_at DESC LIMIT ?`)
    .all(nowIso(), hostingEnabled() ? 0 : 1, limit);
  return rows.map((r) => ({ ...r, url: previewUrl(r.id), gone: expiresLabel(r.expires_at) }));
}

/** Admin: take a test page down now (abuse). */
export function removePreview(id) {
  if (!ID_RE.test(String(id ?? ''))) return false;
  const row = getDb().prepare('SELECT * FROM previews WHERE id = ?').get(id);
  if (!row) return false;
  try { holdPreview(id, row, 'removed by admin'); } catch { /* best effort */ }
  try { removeFiles(id); } catch { /* best effort */ }
  getDb().prepare('DELETE FROM previews WHERE id = ?').run(id);
  return true;
}

/** Admin view of the shared try host. */
export async function tryHostStatus() {
  const db = getDb();
  const out = {
    enabled: hostingEnabled(),
    live: countLive(),
    ready: db.prepare('SELECT COUNT(*) n FROM previews WHERE ready_at IS NOT NULL AND claimed_at IS NULL AND expires_at > ?').get(nowIso()).n,
    lastError: db.prepare("SELECT error, created_at FROM previews WHERE error != '' ORDER BY created_at DESC LIMIT 1").get() ?? null,
    pages: db.prepare('SELECT id, ip, bytes, created_at, expires_at, ready_at FROM previews WHERE claimed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 50').all(nowIso()).map((r) => ({ ...r, url: previewUrl(r.id) })),
    dir: hostingEnabled() ? fs.existsSync(path.join(tenantDir(TRY_LABEL), '.htaccess')) : null,
    url: `${config.publicScheme}://${TRY_LABEL}.${config.baseDomain}/`,
    answers: null,
    detail: '',
  };
  if (hostingEnabled()) {
    const r = await probeUrl(out.url); out.answers = r.ok; out.detail = r.detail;
  }
  return out;
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
  const doomed = db.prepare('SELECT * FROM previews WHERE expires_at <= ? OR claimed_at IS NOT NULL').all(nowIso());
  for (const r of doomed) {
    if (!r.claimed_at) { try { holdPreview(r.id, r, 'expired'); } catch { /* best effort */ } } // kept pages live on as a site; no hold needed
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

export const __test = { ID_RE, previewDir, hostedDir };
