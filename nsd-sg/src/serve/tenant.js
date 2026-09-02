// Tenant static server: everything requested on <name>.nsd.sg lands here.
// Design rules:
//  - The DB decides which release directory is current; nothing else is ever read.
//  - Paths are re-validated on every request and resolved with lstat (symlinks never followed).
//  - Content type comes from our extension allowlist, never from the file or the uploader.
//  - HTML is buffered so the branding can be injected; everything else streams.
//  - Only GET/HEAD/OPTIONS are accepted. There is no server-side execution of any kind.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { contentTypeFor, cacheControlFor, extensionOf, HTML_EXTENSIONS } from '../lib/mime.js';
import { hit, LIMITS } from '../lib/ratelimit.js';
import { getSiteForServing, recordTraffic } from '../services/sites.js';
import { entitlementsFor } from '../services/plans.js';
import { releaseDir, resolveWithin } from '../storage/releases.js';
import { injectBranding } from './branding.js';
import { esc } from '../lib/html.js';

const MAX_HTML_INJECT_BYTES = 5 * 1024 * 1024;

function securityHeaders(reply, { allowFraming }) {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('X-Powered-By', 'NSD.SG');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Tenant pages run in their own origin (name.nsd.sg). We do not restrict inline scripts (AI-generated
  // sites rely on them) but we do stop the page from being framed by third parties unless the owner opts in,
  // which blocks click-jacking style abuse of hosted pages.
  reply.header('Content-Security-Policy', allowFraming ? "frame-ancestors *" : "frame-ancestors 'self'");
  if (!allowFraming) reply.header('X-Frame-Options', 'SAMEORIGIN');
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1014;color:#e8e8ec;display:grid;place-items:center;min-height:100vh}
main{max-width:520px;padding:2.5rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#a6a7b2;line-height:1.55}a{color:#a78bfa}
.mark{display:inline-block;font-weight:700;letter-spacing:.06em;color:#fff;margin-bottom:1.5rem}.mark b{color:#a78bfa}</style></head>
<body><main><div class="mark">NSD<b>.SG</b></div>${body}</main></body></html>`;
}

const PAGES = {
  notFoundSite: (label) => page('Site not found', `<h1>There is no site here yet.</h1><p><strong>${esc(label)}.${esc(config.baseDomain)}</strong> is not taken. Want it? <a href="${esc(config.publicScheme)}://${esc(config.platformHosts[0])}/signup?name=${encodeURIComponent(label)}">Create it on NSD.SG</a>.</p>`),
  empty: (label) => page('Coming soon', `<h1>Coming soon.</h1><p><strong>${esc(label)}.${esc(config.baseDomain)}</strong> has been claimed but nothing is published yet.</p>`),
  suspended: () => page('Site unavailable', `<h1>This site is unavailable.</h1><p>It has been suspended by the platform. If you are the owner, sign in to NSD.SG for details.</p>`),
  notFoundFile: () => page('Page not found', `<h1>Page not found.</h1><p>The file you asked for does not exist on this site.</p>`),
  methodNotAllowed: () => page('Not allowed', `<h1>Method not allowed.</h1><p>Sites on NSD.SG are static: only GET and HEAD are supported.</p>`),
};

function sendPage(reply, status, html) {
  return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
}

// Decode + validate the URL path. Returns a clean relative path or null.
function requestPath(url) {
  let p = url.split('?')[0].split('#')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\')) return null;
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' || seg.startsWith('.')) return null;
    if (!/^[\x21-\x7e]+$/.test(seg) && !/^[^\x00-\x1f\x7f/]+$/.test(seg)) return null;
    parts.push(seg);
  }
  return { parts, trailingSlash: p.endsWith('/') || parts.length === 0 };
}

/**
 * Fastify handler for tenant hosts. `label` is the validated subdomain.
 */
export async function serveTenant(req, reply, label) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    return sendPage(reply, 405, PAGES.methodNotAllowed());
  }
  if (req.method === 'OPTIONS') return reply.code(204).header('Allow', 'GET, HEAD, OPTIONS').send();

  const rl = hit(`tenant:${req.ip}`, LIMITS.tenantGeneral.limit, LIMITS.tenantGeneral.windowMs);
  if (!rl.ok) return reply.code(429).header('Retry-After', String(rl.retryAfterSec)).send('Too many requests');

  const site = getSiteForServing(label);
  securityHeaders(reply, { allowFraming: !!site?.allow_framing });
  if (!site) return sendPage(reply, 404, PAGES.notFoundSite(label));
  if (site.status === 'suspended' || site.owner_status !== 'active') return sendPage(reply, 451, PAGES.suspended());
  if (!site.current_release_id) return sendPage(reply, 200, PAGES.empty(label));

  const parsed = requestPath(req.raw.url ?? '/');
  if (!parsed) return sendPage(reply, 404, PAGES.notFoundFile());

  const root = releaseDir(site.id, site.current_release_id);
  const candidates = [];
  const rel = parsed.parts.join('/');
  if (parsed.trailingSlash) candidates.push(rel ? `${rel}/index.html` : 'index.html');
  else {
    candidates.push(rel);
    if (!extensionOf(rel)) candidates.push(`${rel}.html`, `${rel}/index.html`);
  }
  let abs = null;
  let chosen = null;
  for (const c of candidates) {
    abs = resolveWithin(root, c);
    if (abs) { chosen = c; break; }
  }
  if (!abs) {
    // Custom 404 page support: /404.html in the release.
    const custom = resolveWithin(root, '404.html');
    if (custom) return sendHtml(req, reply, site, custom, 404);
    return sendPage(reply, 404, PAGES.notFoundFile());
  }
  // Directory-style URL without trailing slash: redirect so relative asset links work.
  if (chosen.endsWith('/index.html') && !parsed.trailingSlash && rel) {
    return reply.code(301).header('Cache-Control', 'no-store').redirect(`/${rel}/`);
  }

  const type = contentTypeFor(chosen);
  if (!type) return sendPage(reply, 404, PAGES.notFoundFile()); // never serve an unknown type
  reply.header('Cache-Control', cacheControlFor(chosen));
  if (HTML_EXTENSIONS.has(extensionOf(chosen))) return sendHtml(req, reply, site, abs, 200);

  const st = fs.statSync(abs);
  reply.header('Content-Type', type);
  reply.header('Content-Length', String(st.size));
  reply.header('Last-Modified', st.mtime.toUTCString());
  recordTraffic(site.id, st.size);
  if (req.method === 'HEAD') return reply.send();
  return reply.send(fs.createReadStream(abs));
}

function brandingRemovedFor(site) {
  if (site.site_branding_removed) return true;
  const ent = entitlementsFor({ plan_id: site.plan_id, plan_expires_at: site.plan_expires_at, overrides_json: site.overrides_json });
  return ent.brandingRemoved && !ent.expired;
}

function sendHtml(req, reply, site, abs, status) {
  let body = fs.readFileSync(abs);
  if (body.length <= MAX_HTML_INJECT_BYTES && !brandingRemovedFor(site)) body = injectBranding(body);
  reply.header('Content-Type', 'text/html; charset=utf-8');
  reply.header('Content-Length', String(body.length));
  recordTraffic(site.id, body.length);
  reply.code(status);
  if (req.method === 'HEAD') return reply.send();
  return reply.send(body);
}

export const __test = { requestPath, PAGES, path };
