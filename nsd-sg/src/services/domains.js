// Custom domains ("Bring your own domain"). Plus/Beta feature. Two facts are checked in DNS before anything else:
//   owner_ok  - a TXT record _nsd-verify.<domain> = nsd-verify=<token>   (proves they control the domain)
//   dns_ok    - www.<domain> CNAME -> <label>.<baseDomain>, or <domain> A -> SERVER_IP (points it at us)
// Both true => 'verified'. Then: VPS/local => 'active' at once (the app serves it, Caddy fetches the cert via
// /internal/tls-ask). Hostinger => try the API to add the domain to the hosting account pointing at the site's
// folder; if that is not possible the domain waits in the admin queue and admin presses "Mark connected".
import dns from 'node:dns';
import crypto from 'node:crypto';
import { config, publicUrlForSubdomain } from '../config.js';
import { getDb } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { entitlementsFor } from './plans.js';
import { isEnabled as hostingEnabled, addDomainToHosting } from '../publish/hostinger.js';

export class DomainError extends Error {}

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

let resolver = {
  txt: (name) => dns.promises.resolveTxt(name),
  cname: (name) => dns.promises.resolveCname(name),
  a: (name) => dns.promises.resolve4(name),
};
export function setResolver(r) { resolver = { ...resolver, ...r }; }

/** Lower-case apex hostname or null. "https://www.Shop.sg/x" -> "shop.sg". */
export function normalizeHostname(input) {
  let h = String(input ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/\.$/, '');
  if (h.startsWith('www.')) h = h.slice(4);
  if (!HOST_RE.test(h) || /[^\x00-\x7f]/.test(h)) return null;
  return h;
}

export function domainProblem(hostname) {
  if (!hostname) return 'That does not look like a domain name. Type it like mybusiness.sg';
  if (hostname === config.baseDomain || hostname.endsWith(`.${config.baseDomain}`)) return `Your ${config.baseDomain} address is already yours. This box is for a domain you bought elsewhere.`;
  if (config.platformHosts.includes(hostname)) return 'That name is not available.';
  return null;
}

export function listDomainsForSite(siteId) {
  return getDb().prepare('SELECT * FROM custom_domains WHERE site_id = ? ORDER BY created_at').all(siteId);
}

export function getDomainForSite(id, siteId) {
  return getDb().prepare('SELECT * FROM custom_domains WHERE id = ? AND site_id = ?').get(id, siteId) ?? null;
}

/** The two records the owner adds at their registrar, in plain words. */
export function instructionsFor(domain, site) {
  const target = `${site.subdomain}.${config.baseDomain}`;
  const ip = config.serverIp;
  return {
    verify: { type: 'TXT', name: `_nsd-verify.${domain.hostname}`, host: '_nsd-verify', value: `nsd-verify=${domain.verify_token}` },
    www: { type: 'CNAME', name: `www.${domain.hostname}`, host: 'www', value: target },
    apex: ip ? { type: 'A', name: domain.hostname, host: '@', value: ip } : null,
    target,
  };
}

export function addDomain({ site, user, hostname }) {
  const ent = entitlementsFor(user);
  if (!ent.features.custom_domains || ent.expired) return { ok: false, reason: 'Your own domain name is part of Plus and Beta. Upgrade on the Plan page and come back here.' };
  const h = normalizeHostname(hostname);
  const problem = domainProblem(h);
  if (problem) return { ok: false, reason: problem };
  const db = getDb();
  if (db.prepare("SELECT 1 FROM custom_domains WHERE hostname = ? AND status != 'disabled'").get(h)) return { ok: false, reason: 'That domain is already connected to a site on NSD.SG. If it is yours, remove it there first or email us.' };
  if (listDomainsForSite(site.id).filter((d) => d.status !== 'disabled').length >= 2) return { ok: false, reason: 'A site can have two domains at most. Remove one first.' };
  const id = newId();
  db.prepare('INSERT INTO custom_domains (id, site_id, hostname, status, verify_token) VALUES (?, ?, ?, ?, ?)').run(id, site.id, h, 'pending', crypto.randomBytes(12).toString('hex'));
  return { ok: true, domain: db.prepare('SELECT * FROM custom_domains WHERE id = ?').get(id) };
}

export function removeDomain(id, siteId) {
  const r = getDb().prepare('DELETE FROM custom_domains WHERE id = ? AND site_id = ?').run(id, siteId);
  return r.changes > 0;
}

async function lookupTxt(name) { try { return (await resolver.txt(name)).map((parts) => parts.join('')); } catch { return []; } }
async function lookupCname(name) { try { return (await resolver.cname(name)).map((c) => String(c).toLowerCase().replace(/\.$/, '')); } catch { return []; } }
async function lookupA(name) { try { return await resolver.a(name); } catch { return []; } }

/** Look the records up now, record what we found, move the status on. Never throws. */
export async function checkDomain(domain, site) {
  const db = getDb();
  const ins = instructionsFor(domain, site);
  const txt = await lookupTxt(ins.verify.name);
  const ownerOk = txt.includes(ins.verify.value);
  const cname = await lookupCname(ins.www.name);
  const a = await lookupA(domain.hostname);
  const wwwOk = cname.includes(ins.target);
  const apexOk = !!config.serverIp && a.includes(config.serverIp);
  const dnsOk = wwwOk || apexOk;
  const notes = [];
  if (!ownerOk) notes.push(txt.length ? `The TXT record at ${ins.verify.name} exists but says "${txt[0].slice(0, 60)}", not "${ins.verify.value}".` : `No TXT record found at ${ins.verify.name} yet.`);
  if (!dnsOk) notes.push(cname.length ? `www points to ${cname[0]}, not ${ins.target}.` : ins.apex && a.length ? `${domain.hostname} points to ${a[0]}, not ${ins.apex.value}.` : `Neither www (CNAME) nor the bare domain (A) points at NSD.SG yet.`);
  let status = domain.status;
  let hostNote = domain.host_note;
  if (ownerOk && dnsOk && (status === 'pending' || status === 'verified')) {
    status = 'verified';
    if (!hostingEnabled()) status = 'active';
    else {
      const r = await addDomainToHosting(domain.hostname, site.subdomain);
      if (r.ok) status = 'active'; else hostNote = r.reason;
    }
  }
  db.prepare("UPDATE custom_domains SET owner_ok = ?, dns_ok = ?, status = ?, verified_at = COALESCE(verified_at, ?), last_checked_at = ?, check_note = ?, host_note = ? WHERE id = ?")
    .run(ownerOk ? 1 : 0, dnsOk ? 1 : 0, status, ownerOk && dnsOk ? nowIso() : null, nowIso(), notes.join(' '), hostNote, domain.id);
  return { ownerOk, dnsOk, wwwOk, apexOk, status, notes, hostNote };
}

/** Which site answers for this hostname (custom domains only; *.baseDomain is handled elsewhere). */
let serveStmt;
/** { label, off } for an active custom hostname; `off` when the owner's free period ended 30+ days ago. */
export function customHostLookup(hostname) {
  const h = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  const apex = h.startsWith('www.') ? h.slice(4) : h;
  serveStmt ??= getDb().prepare("SELECT s.subdomain, u.plan_expires_at FROM custom_domains d JOIN sites s ON s.id = d.site_id JOIN users u ON u.id = s.user_id WHERE d.hostname = ? AND d.status = 'active' AND s.status != 'deleted'");
  const row = serveStmt.get(apex);
  if (!row) return null;
  const gone = row.plan_expires_at ? (Date.now() - Date.parse(row.plan_expires_at)) / 86400000 : 0;
  return { label: row.subdomain, off: gone >= 30 };
}
export function siteLabelForHostname(hostname) { const r = customHostLookup(hostname); return r && !r.off ? r.label : null; }

// ---- admin ----
export function listDomainsWaiting() {
  return getDb().prepare("SELECT d.*, s.subdomain, u.email FROM custom_domains d JOIN sites s ON s.id = d.site_id JOIN users u ON u.id = s.user_id WHERE d.status IN ('pending','verified') ORDER BY d.created_at DESC LIMIT 100").all();
}
export function listDomainsActive() {
  return getDb().prepare("SELECT d.*, s.subdomain, u.email FROM custom_domains d JOIN sites s ON s.id = d.site_id JOIN users u ON u.id = s.user_id WHERE d.status = 'active' ORDER BY d.created_at DESC LIMIT 200").all();
}
export function setDomainStatus(id, status, note = '') {
  getDb().prepare('UPDATE custom_domains SET status = ?, host_note = ? WHERE id = ?').run(status, note, id);
}

export const __test = { HOST_RE, publicUrlForSubdomain };
