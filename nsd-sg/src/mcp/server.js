// MCP over streamable HTTP, zero dependencies. A new front door to the same publish path the dashboard uses.
//   POST https://nsd.sg/mcp/<token>   (or POST /mcp with Authorization: Bearer <token>)
// Stateless JSON-RPC: initialize, ping, tools/list, tools/call. No server-initiated streams (GET answers 405).
import fs from 'node:fs';
import { config, publicUrlForSubdomain, platformUrl } from '../config.js';
import { audit, watchdog } from '../lib/audit.js';
import { hit, LIMITS } from '../lib/ratelimit.js';
import { formatBytes } from '../lib/html.js';
import { normalizeSubdomain, blockedTermIn } from '../lib/subdomain.js';
import { sanitizeRelativePath } from '../lib/paths.js';
import { authenticateToken } from '../services/tokens.js';
import { createSite, listSitesForUser, getSiteForUser, deleteSite, knownReady } from '../services/sites.js';
import { entitlementsFor } from '../services/plans.js';
import { deployFiles, listReleaseFiles, tempFile, StorageError } from '../storage/releases.js';
import { listDomainsForSite } from '../services/domains.js';

const PROTOCOL = '2025-06-18';
const MAX_FILES = 40;
const MAX_TOTAL = 8 * 1024 * 1024;

const upgradeUrl = () => platformUrl('/billing');
const pricingUrl = () => platformUrl('/pricing');

export const TOOLS = [
  { name: 'nsd_publish', description: 'Put a page online at <name>.nsd.sg. Give a site name and either the full HTML of the page or a list of text files. Creates the site if you do not have it yet; on a site you already own it adds or replaces the given files and keeps the rest. Returns the live URL.',
    inputSchema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', description: 'The site name: letters, numbers, hyphens. Becomes <name>.nsd.sg. Use an existing site name to update it.' },
      html: { type: 'string', description: 'Full HTML of the home page (index.html). Use this for a single page.' },
      files: { type: 'array', description: 'Text files to publish, e.g. [{path:"index.html", content:"..."}, {path:"style.css", content:"..."}]. Max 40 files, 8 MB total.', items: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
      title: { type: 'string', description: 'Optional label shown only in the owner\'s dashboard.' },
    } } },
  { name: 'nsd_update', description: 'Replace ALL files of an existing site with the given HTML or files. Older versions are kept and can be restored from the dashboard.',
    inputSchema: { type: 'object', required: ['site_id'], properties: {
      site_id: { type: 'string', description: 'The site id from nsd_list_sites.' },
      html: { type: 'string', description: 'Full HTML of the new home page.' },
      files: { type: 'array', items: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
    } } },
  { name: 'nsd_list_sites', description: 'List the caller\'s sites: id, name, live URL, status, plan and days of free period left.', inputSchema: { type: 'object', properties: {} } },
  { name: 'nsd_get_site', description: 'One site: URL, status, files, storage used and the plan\'s limits.', inputSchema: { type: 'object', required: ['site_id'], properties: { site_id: { type: 'string' } } } },
  { name: 'nsd_delete_site', description: 'Delete a site and all its versions. Requires the site id (never a name). The address becomes free for anyone.', inputSchema: { type: 'object', required: ['site_id', 'confirm'], properties: { site_id: { type: 'string' }, confirm: { type: 'boolean', description: 'Must be true.' } } } },
];

class ToolError extends Error {}

function daysLeft(ent) { return ent.daysLeft === null ? null : Math.max(0, ent.daysLeft); }

function siteSummary(site, ent) {
  const domains = listDomainsForSite(site.id).filter((d) => d.status === 'active').map((d) => `https://${d.hostname}`);
  return {
    id: site.id, name: site.subdomain, url: publicUrlForSubdomain(site.subdomain), custom_domains: domains,
    status: site.status === 'live' ? (knownReady(site) ? 'online' : 'online (address being set up, usually 5-15 min)') : site.status,
    plan: ent.plan.name, badge: !(site.branding_removed || ent.brandingRemoved) ? 'shown (free plan)' : 'none',
    days_left: daysLeft(ent), storage_used: formatBytes(site.storage_bytes), last_published: site.last_deployed_at,
  };
}

function collectFiles(args, { needPage = true } = {}) {
  const out = [];
  if (typeof args.html === 'string' && args.html.trim()) out.push({ path: 'index.html', content: args.html });
  if (Array.isArray(args.files)) for (const f of args.files) if (f && typeof f.path === 'string' && typeof f.content === 'string') out.push({ path: f.path, content: f.content });
  if (!out.length) throw new ToolError('Nothing to publish. Send `html` (the whole page) or `files` (a list of {path, content}).');
  if (out.length > MAX_FILES) throw new ToolError(`Too many files: ${out.length}. Send up to ${MAX_FILES} per call, or upload a ZIP from the dashboard at ${platformUrl('/dashboard')}.`);
  let total = 0;
  const list = [];
  for (const f of out) {
    const r = sanitizeRelativePath(f.path);
    if (!r.ok) throw new ToolError(`"${f.path}": ${r.reason}`);
    const size = Buffer.byteLength(f.content, 'utf8');
    total += size;
    list.push({ relPath: r.path, content: f.content, size });
  }
  if (total > MAX_TOTAL) throw new ToolError(`These files add up to ${formatBytes(total)}; the limit per call is ${formatBytes(MAX_TOTAL)}. Upload a ZIP from the dashboard for bigger sites.`);
  if (needPage && !list.some((f) => /\.html?$/i.test(f.relPath))) throw new ToolError('No web page in the files. Include index.html (the home page).');
  return list;
}

async function writeAndDeploy({ site, user, list, replaceAll, note }) {
  const ent = entitlementsFor(user);
  if (ent.expired) throw new ToolError(`Your free period ended on ${ent.expiresAt.slice(0, 10)}. Your site stays online, but publishing is paused. Ask for more time (free) or upgrade at ${upgradeUrl()}`);
  if (site.status === 'suspended') throw new ToolError('This site has been switched off by NSD.SG. Log in to the dashboard to see why.');
  const temps = [];
  try {
    const files = list.map((f) => { const tmp = tempFile('mcp'); temps.push(tmp); fs.writeFileSync(tmp, f.content, { mode: 0o600 }); return { relPath: f.relPath, tmpPath: tmp, size: f.size }; });
    return await deployFiles({ site, files, user, limits: ent.limits, replaceAll, note });
  } catch (e) {
    if (e instanceof StorageError) {
      if (/quota|exceed/i.test(e.message)) throw new ToolError(`${e.message} Your ${ent.plan.name} plan allows ${formatBytes(ent.limits.max_storage_bytes)} per site and ${formatBytes(ent.limits.max_file_bytes)} per file. More room on Plus: ${pricingUrl()}`);
      throw new ToolError(e.message);
    }
    throw e;
  } finally {
    for (const t of temps) fs.rm(t, { force: true }, () => {});
  }
}

async function runTool(name, args, ctx) {
  const { user, req } = ctx;
  const ent = entitlementsFor(user);
  switch (name) {
    case 'nsd_list_sites': {
      const sites = listSitesForUser(user.id);
      return { sites: sites.map((s) => siteSummary(s, ent)), plan: ent.plan.name, sites_allowed: ent.limits.max_sites, days_left: daysLeft(ent), dashboard: platformUrl('/dashboard') };
    }
    case 'nsd_get_site': {
      const site = getSiteForUser(String(args.site_id ?? ''), user.id);
      if (!site) throw new ToolError('No site with that id on your account. Call nsd_list_sites to see your sites.');
      return { ...siteSummary(site, ent), files: site.current_release_id ? listReleaseFiles(site.id, site.current_release_id).map((f) => `${f.path} (${formatBytes(f.size)})`) : [], limits: { storage_per_site: formatBytes(ent.limits.max_storage_bytes), per_file: formatBytes(ent.limits.max_file_bytes), versions_kept: ent.limits.max_releases } };
    }
    case 'nsd_publish': {
      const sub = normalizeSubdomain(args.name ?? '');
      if (!sub) throw new ToolError('Give the site a name, e.g. name: "ramadan-quiz". It becomes ramadan-quiz.nsd.sg.');
      let site = listSitesForUser(user.id).find((s) => s.subdomain === sub);
      const list = collectFiles(args, { needPage: !site || !site.current_release_id });
      let created = false;
      if (!site) {
        const t = blockedTermIn(sub); if (t) watchdog(req, sub, t);
        const r = createSite({ user, subdomain: sub, title: String(args.title ?? '').slice(0, 100) });
        if (!r.ok) {
          if (/allows \d+ site/.test(r.reason)) throw new ToolError(`${r.reason} You already have ${listSitesForUser(user.id).map((s) => s.subdomain + '.' + config.baseDomain).join(', ')}. Publish to one of those names to update it, or get up to 5 sites on Plus (S$9/month) at ${upgradeUrl()}`);
          if (/expired/i.test(r.reason)) throw new ToolError(`${r.reason} ${upgradeUrl()}`);
          throw new ToolError(`${r.reason} Try another name.`);
        }
        site = r.site; created = true;
        audit({ req, actor: user, action: 'site.create', targetType: 'site', targetId: site.id, details: { subdomain: sub, via: 'mcp' } });
      }
      const result = await writeAndDeploy({ site, user, list, replaceAll: false, note: `Published from Claude (${list.length} file${list.length === 1 ? '' : 's'})` });
      audit({ req, actor: user, action: 'site.deploy', targetType: 'site', targetId: site.id, details: { source: 'mcp', version: result.version, files: result.count, bytes: result.bytes } });
      const fresh = getSiteForUser(site.id, user.id);
      return { ok: true, created, url: publicUrlForSubdomain(sub), site_id: site.id, version: result.version, files: result.count, ...(knownReady(fresh) ? {} : { note: 'New address: the padlock (HTTPS) takes 5-15 minutes the first time. The link works after that.' }), badge: !(site.branding_removed || ent.brandingRemoved) ? `A small "Powered by NasarDigital" badge shows on free sites. Remove it with Plus: ${pricingUrl()}` : 'none', days_left: daysLeft(ent), dashboard: platformUrl(`/sites/${site.id}`) };
    }
    case 'nsd_update': {
      const site = getSiteForUser(String(args.site_id ?? ''), user.id);
      if (!site) throw new ToolError('No site with that id on your account. Call nsd_list_sites to see your sites.');
      const list = collectFiles(args);
      const result = await writeAndDeploy({ site, user, list, replaceAll: true, note: `Replaced from Claude (${list.length} file${list.length === 1 ? '' : 's'})` });
      audit({ req, actor: user, action: 'site.deploy', targetType: 'site', targetId: site.id, details: { source: 'mcp-replace', version: result.version, files: result.count, bytes: result.bytes } });
      return { ok: true, url: publicUrlForSubdomain(site.subdomain), site_id: site.id, version: result.version, files: result.count, previous_versions_kept: ent.limits.max_releases };
    }
    case 'nsd_delete_site': {
      if (args.confirm !== true) throw new ToolError('Deleting is permanent. Call again with confirm: true.');
      const site = getSiteForUser(String(args.site_id ?? ''), user.id);
      if (!site) throw new ToolError('No site with that id on your account. Call nsd_list_sites to see your sites.');
      deleteSite(site.id, { reason: 'deleted via mcp', actorId: user.id });
      audit({ req, actor: user, action: 'site.delete', targetType: 'site', targetId: site.id, details: { subdomain: site.subdomain, via: 'mcp' }, severity: 'warn' });
      return { ok: true, deleted: `${site.subdomain}.${config.baseDomain}` };
    }
    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

async function handleMessage(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined;
  switch (method) {
    case 'initialize':
      return rpcResult(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'NSD.SG', version: config.version }, instructions: `You are connected to NSD.SG as ${ctx.user.email}. Publish a page with nsd_publish (name + html). Sites live at <name>.${config.baseDomain}. Dashboard: ${platformUrl('/dashboard')}` });
    case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed':
      return null;
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(params.name ?? '');
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool ${name}`);
      const heavy = name === 'nsd_publish' || name === 'nsd_update';
      if (heavy) {
        const r = hit(`mcpPublish:${ctx.tokenId}`, LIMITS.mcpPublish.limit, LIMITS.mcpPublish.windowMs);
        if (!r.ok) return rpcResult(id, { content: [{ type: 'text', text: `Slow down: ${LIMITS.mcpPublish.limit} publishes per hour per token. Try again in ${Math.ceil(r.retryAfterSec / 60)} min.` }], isError: true });
      }
      try {
        const out = await runTool(name, params.arguments ?? {}, ctx);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out });
      } catch (e) {
        if (e instanceof ToolError) return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true });
        ctx.req.log.error({ err: e, tool: name }, 'mcp tool failed');
        return rpcResult(id, { content: [{ type: 'text', text: 'Something went wrong on our side. It has been logged.' }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function registerMcpRoutes(app) {
  const opts = { config: { skipCsrf: true }, bodyLimit: 12 * 1024 * 1024 };
  const unauthorized = (reply) => reply.code(401).header('WWW-Authenticate', 'Bearer realm="NSD.SG"').send({ jsonrpc: '2.0', id: null, error: { code: -32001, message: `Unauthorized. Create a token at ${platformUrl('/connect')} and use ${platformUrl('/mcp/<token>')}` } });

  const handle = async (req, reply, rawToken) => {
    reply.header('Cache-Control', 'no-store');
    const auth = authenticateToken(rawToken, req.ip);
    if (!auth) { audit({ req, action: 'mcp.unauthorized', targetType: 'token', targetId: '', severity: 'warn' }); return unauthorized(reply); }
    const rl = hit(`mcp:${auth.tokenId}`, LIMITS.mcp.limit, LIMITS.mcp.windowMs);
    if (!rl.ok) return reply.code(429).header('Retry-After', String(rl.retryAfterSec)).send(rpcError(null, -32000, `Rate limit: ${LIMITS.mcp.limit} calls per hour per token.`));
    const ctx = { user: auth.user, tokenId: auth.tokenId, req };
    const body = req.body;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleMessage(m, ctx)))).filter(Boolean);
      return out.length ? reply.send(out) : reply.code(202).send();
    }
    const out = await handleMessage(body, ctx);
    return out ? reply.send(out) : reply.code(202).send();
  };

  const bearer = (req) => { const h = String(req.headers.authorization ?? ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
  app.post('/mcp', opts, (req, reply) => handle(req, reply, bearer(req)));
  app.post('/mcp/:token', opts, (req, reply) => handle(req, reply, String(req.params.token)));
  for (const p of ['/mcp', '/mcp/:token']) {
    app.get(p, opts, async (_req, reply) => reply.code(405).header('Allow', 'POST').send({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'NSD.SG MCP: send JSON-RPC by POST. Setup guide: ' + platformUrl('/connect') } }));
    app.delete(p, opts, async (_req, reply) => reply.code(204).send());
    app.options(p, opts, async (_req, reply) => reply.code(204).header('Allow', 'POST, GET, DELETE, OPTIONS').send());
  }
}

export const __test = { handleMessage, ToolError };
