// Site (tenant) lifecycle: naming, ownership, status. File contents live in storage/releases.js.
import { getDb, loadBlockedWords } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { normalizeSubdomain, validateSubdomainSyntax } from '../lib/subdomain.js';
import { entitlementsFor } from './plans.js';
import { deleteSiteStorage } from '../storage/releases.js';
import { holdSite } from './evidence.js';
import { probeUrl } from '../lib/probe.js';
import { publicUrlForSubdomain } from '../config.js';
import { syncSite as resync, provisionSubdomain, deprovisionSubdomain, isEnabled as hostingEnabled, repairSite } from '../publish/hostinger.js';
import { sendMail } from '../lib/mailer.js';
import { config } from '../config.js';

export function isReserved(name) {
  return !!getDb().prepare('SELECT 1 FROM reserved_subdomains WHERE name = ?').get(name);
}

/** Full availability check: syntax + reserved + taken. Returns null when available. */
export function subdomainUnavailableReason(name) {
  const syntax = validateSubdomainSyntax(name);
  if (syntax) return syntax;
  if (isReserved(name)) return 'That name is reserved.';
  if (getDb().prepare("SELECT 1 FROM sites WHERE subdomain = ? AND status != 'deleted'").get(name)) return 'That name is already taken.';
  return null;
}

export function listSitesForUser(userId) {
  return getDb().prepare("SELECT * FROM sites WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC").all(userId);
}

export function countSitesForUser(userId) {
  return getDb().prepare("SELECT COUNT(*) AS n FROM sites WHERE user_id = ? AND status != 'deleted'").get(userId).n;
}

export function getSiteById(id) {
  return getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id) ?? null;
}

/** Owner-scoped lookup: the only way route handlers should load a site for a user. */
export function getSiteForUser(id, userId) {
  return getDb().prepare("SELECT * FROM sites WHERE id = ? AND user_id = ? AND status != 'deleted'").get(id, userId) ?? null;
}

// Used by the tenant server on every request; joined with owner state so a suspended user goes dark instantly.
let serveStmt;
export function getSiteForServing(subdomain) {
  serveStmt ??= getDb().prepare(`
    SELECT s.id, s.subdomain, s.status, s.current_release_id, s.branding_removed AS site_branding_removed, s.allow_framing,
           u.status AS owner_status, u.plan_id, u.plan_expires_at, u.overrides_json, u.id AS user_id
    FROM sites s JOIN users u ON u.id = s.user_id
    WHERE s.subdomain = ? AND s.status != 'deleted'`);
  return serveStmt.get(subdomain) ?? null;
}

export function createSite({ user, subdomain, title = '' }) {
  const db = getDb();
  const name = normalizeSubdomain(subdomain);
  const ent = entitlementsFor(user);
  if (ent.expired) return { ok: false, reason: 'Your plan has expired. Request an extension or upgrade to create sites.' };
  if (countSitesForUser(user.id) >= ent.limits.max_sites) {
    return { ok: false, reason: `Your plan allows ${ent.limits.max_sites} site${ent.limits.max_sites === 1 ? '' : 's'}.` };
  }
  const reason = subdomainUnavailableReason(name);
  if (reason) return { ok: false, reason };
  const id = newId();
  try {
    db.prepare('INSERT INTO sites (id, user_id, subdomain, title) VALUES (?, ?, ?, ?)')
      .run(id, user.id, name, String(title ?? '').trim().slice(0, 100) || name);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { ok: false, reason: 'That name is already taken.' };
    throw e;
  }
  const site = getSiteById(id);
  // Managed hosting: ask Hostinger for the subdomain now, then publish the "coming soon" page.
  // Failures are recorded on the row (hosting_state='error') and retried by `cli sync-all` / the cron.
  if (hostingEnabled()) {
    provisionSubdomain(name)
      .then((r) => { if (r.provisioned) db.prepare("UPDATE sites SET hosting_state = 'ready' WHERE id = ? AND hosting_state = 'pending'").run(id); else db.prepare("UPDATE sites SET hosting_error = ? WHERE id = ?").run(r.reason ?? 'not provisioned', id); resync(id); })
      .catch((e) => db.prepare("UPDATE sites SET hosting_state = 'error', hosting_error = ? WHERE id = ?").run(String(e.message).slice(0, 500), id));
  }
  return { ok: true, site };
}

// ---- "is it really online?" ------------------------------------------------------------------------
// Same-process serving (VPS/local) answers as soon as the row exists. On Hostinger the address is only real once
// LiteSpeed answers 200 over HTTPS, which for a new subdomain waits on its certificate (5-15 min). The site page
// shows "setting up" until this says ready, then remembers it (hosting_ready_at) so it is never asked again.
export async function checkSiteReady(site) {
  const url = publicUrlForSubdomain(site.subdomain);
  if (!hostingEnabled()) return { ready: true, url };
  if (site.hosting_ready_at) return { ready: true, url };
  const { ok, detail } = await probeUrl(url);
  if (ok) {
    getDb().prepare('UPDATE sites SET hosting_ready_at = ? WHERE id = ? AND hosting_ready_at IS NULL').run(nowIso(), site.id);
    return { ready: true, url };
  }
  // Not answering: while the owner is watching, quietly re-ask Hostinger (throttled to once a minute).
  let repair = null;
  try { repair = await repairSite(site.id); } catch { /* recorded on the row */ }
  const fresh = getDb().prepare('SELECT hosting_state, hosting_error, hosting_attempts FROM sites WHERE id = ?').get(site.id) ?? site;
  await maybeAlertAdmin({ ...site, ...fresh });
  return { ready: false, reason: fresh.hosting_state === 'error' ? 'error' : 'waiting', detail: fresh.hosting_error || detail, url, waitedMs: Date.now() - Date.parse(site.created_at), attempts: fresh.hosting_attempts, repair };
}

/** One email to the admin when an address is still not reachable 30 minutes after the site was made. */
export async function maybeAlertAdmin(site) {
  if (!config.admin.email || site.hosting_alerted_at) return false;
  if (Date.now() - Date.parse(site.created_at) < 30 * 60_000) return false;
  const db = getDb();
  const r = db.prepare('UPDATE sites SET hosting_alerted_at = ? WHERE id = ? AND hosting_alerted_at IS NULL').run(nowIso(), site.id);
  if (!r.changes) return false;
  await sendMail({
    to: config.admin.email,
    subject: `[NSD.SG] ${site.subdomain}.${config.baseDomain} still not reachable after 30 min`,
    text: `The site ${site.subdomain}.${config.baseDomain} (owner id ${site.user_id}) was created at ${site.created_at} and its address still does not answer over HTTPS.\n\nHosting state: ${site.hosting_state}\nLast error: ${site.hosting_error || '-'}\nRetries so far: ${site.hosting_attempts}\n\nThe app keeps retrying on its own. To look: ${config.publicScheme}://${config.platformHosts[0]}/admin/sites/${site.id}\nIf the subdomain is missing in hPanel > Domains > Subdomains, press "Repair now" there, or check the API token under Admin > System health > "Test Hostinger API".`,
  }).catch(() => {});
  return true;
}

/** Cheap, no network: what we already know. Used to word flash messages honestly right after a publish. */
export function knownReady(site) {
  return !hostingEnabled() || !!site.hosting_ready_at;
}

export function updateSiteSettings(siteId, { title, allow_framing, listed }) {
  const db = getDb();
  const sets = [];
  const vals = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(String(title).trim().slice(0, 100)); }
  if (listed !== undefined) { sets.push('listed = ?'); vals.push(listed ? 1 : 0); sets.push('listed_choice = ?'); vals.push(listed ? 1 : 0); }
  if (allow_framing !== undefined) { sets.push('allow_framing = ?'); vals.push(allow_framing ? 1 : 0); }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(nowIso(), siteId);
  db.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function setSiteStatus(siteId, status, reason = '') {
  if (status === 'suspended') { try { holdSite(siteId, { reason: `suspended: ${reason}` }); } catch { /* evidence is best effort */ } }
  getDb().prepare('UPDATE sites SET status = ?, suspended_reason = ?, updated_at = ? WHERE id = ?').run(status, reason, nowIso(), siteId);
  resync(siteId);
}

export function setSiteBranding(siteId, removed) {
  getDb().prepare('UPDATE sites SET branding_removed = ?, updated_at = ? WHERE id = ?').run(removed ? 1 : 0, nowIso(), siteId);
  resync(siteId);
}

/** Admin-only: move a site to a new subdomain (reclaim / rename). */
export function renameSubdomain(siteId, newName) {
  const name = normalizeSubdomain(newName);
  const reason = subdomainUnavailableReason(name);
  if (reason) return { ok: false, reason };
  const before = getSiteById(siteId);
  getDb().prepare("UPDATE sites SET subdomain = ?, hosting_state = 'pending', updated_at = ? WHERE id = ?").run(name, nowIso(), siteId);
  if (hostingEnabled() && before) {
    deprovisionSubdomain(before.subdomain).catch(() => {});
    provisionSubdomain(name)
      .then((r) => { if (r.provisioned) getDb().prepare("UPDATE sites SET hosting_state = 'ready' WHERE id = ? AND hosting_state = 'pending'").run(siteId); resync(siteId); })
      .catch((e) => getDb().prepare("UPDATE sites SET hosting_state = 'error', hosting_error = ? WHERE id = ?").run(String(e.message).slice(0, 500), siteId));
  }
  return { ok: true, subdomain: name };
}

/** Soft-delete in DB, then remove files. The subdomain becomes available again immediately. */
export function deleteSite(siteId, { reason = 'deleted', actorId = null } = {}) {
  const db = getDb();
  const site = getSiteById(siteId);
  if (!site) return false;
  try { holdSite(siteId, { reason, actorId }); } catch { /* evidence is best effort */ }
  db.transaction(() => {
    // Free the name: deleted rows keep the id but the unique subdomain is suffixed.
    db.prepare("UPDATE sites SET status = 'deleted', subdomain = subdomain || '.deleted.' || id, current_release_id = NULL, updated_at = ? WHERE id = ?")
      .run(nowIso(), siteId);
    db.prepare('DELETE FROM releases WHERE site_id = ?').run(siteId);
  })();
  deleteSiteStorage(siteId);
  if (hostingEnabled()) deprovisionSubdomain(site.subdomain).catch(() => {});
  return true;
}

export function storageUsedByUser(userId) {
  return getDb().prepare("SELECT COALESCE(SUM(total_storage_bytes), 0) AS n FROM sites WHERE user_id = ? AND status != 'deleted'").get(userId).n;
}

/** Public showcase: live sites of active owners. Free plans are listed unless they opted out; plans that may hide
 *  from the showcase (Plus, Beta, admin override) are listed only when the owner switched it on. */
export function listShowcaseSites(limit = 500) {
  const rows = getDb().prepare(`
    SELECT s.subdomain, s.title, s.last_deployed_at, s.listed, s.listed_choice, u.plan_id, u.plan_expires_at, u.overrides_json
    FROM sites s JOIN users u ON u.id = s.user_id
    WHERE s.status = 'live' AND u.status = 'active'
    ORDER BY s.last_deployed_at DESC LIMIT ?`).all(limit);
  return rows.filter((r) => {
    const ent = entitlementsFor({ plan_id: r.plan_id, plan_expires_at: r.plan_expires_at, overrides_json: r.overrides_json });
    const canHide = (ent.features.hide_from_showcase ?? ent.features.branding_removable) && !ent.expired;
    return canHide ? r.listed_choice === 1 : r.listed !== 0;
  }).map(({ subdomain, title, last_deployed_at }) => ({ subdomain, title, last_deployed_at }));
}

// ---- reserved names (admin) ------------------------------------------------------

export function listReserved() {
  return getDb().prepare('SELECT * FROM reserved_subdomains ORDER BY name').all();
}

export function addReserved(name, reason = 'admin') {
  const n = normalizeSubdomain(name);
  if (!n) return false;
  getDb().prepare('INSERT OR IGNORE INTO reserved_subdomains (name, reason) VALUES (?, ?)').run(n, reason);
  return true;
}

export function removeReserved(name) {
  getDb().prepare('DELETE FROM reserved_subdomains WHERE name = ?').run(name);
}

// ---- blocked words (admin; matched inside any name) ----------------------------------

export function listBlockedWords() {
  return getDb().prepare('SELECT * FROM blocked_words ORDER BY word').all();
}

export function addBlockedWord(word, reason = 'admin') {
  const w = String(word ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(w)) return false;
  getDb().prepare('INSERT OR IGNORE INTO blocked_words (word, reason) VALUES (?, ?)').run(w, reason);
  loadBlockedWords();
  return true;
}

export function removeBlockedWord(word) {
  getDb().prepare("DELETE FROM blocked_words WHERE word = ? AND reason != 'system'").run(String(word ?? '').toLowerCase());
  loadBlockedWords();
}

// ---- traffic counters -----------------------------------------------------------------

const trafficBuffer = new Map();
export function recordTraffic(siteId, bytes) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${siteId}|${day}`;
  const cur = trafficBuffer.get(key) ?? { siteId, day, requests: 0, bytes: 0 };
  cur.requests += 1;
  cur.bytes += bytes;
  trafficBuffer.set(key, cur);
}

let flushStmt;
export function flushTraffic() {
  if (trafficBuffer.size === 0) return 0;
  const db = getDb();
  flushStmt ??= db.prepare(`
    INSERT INTO site_traffic_daily (site_id, day, requests, bytes) VALUES (?, ?, ?, ?)
    ON CONFLICT(site_id, day) DO UPDATE SET requests = requests + excluded.requests, bytes = bytes + excluded.bytes`);
  const entries = [...trafficBuffer.values()];
  trafficBuffer.clear();
  db.transaction(() => {
    for (const e of entries) flushStmt.run(e.siteId, e.day, e.requests, e.bytes);
  })();
  return entries.length;
}

export function trafficForSite(siteId, days = 30) {
  return getDb().prepare("SELECT day, requests, bytes FROM site_traffic_daily WHERE site_id = ? AND day >= date('now', ?) ORDER BY day")
    .all(siteId, `-${days} days`);
}

export function monthlyBytesForSite(siteId) {
  return getDb().prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM site_traffic_daily WHERE site_id = ? AND day >= strftime('%Y-%m-01','now')").get(siteId).n;
}
