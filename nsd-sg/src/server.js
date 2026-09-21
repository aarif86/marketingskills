// Entry point. One process serves two things, decided by the Host header:
//   nsd.sg / www.nsd.sg  -> platform (marketing site, dashboard, admin, API)
//   <name>.nsd.sg        -> that tenant's static files (src/serve/tenant.js)
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { tenantFromHost } from './lib/subdomain.js';
import { customHostLookup } from './services/domains.js';
import { lifecycleSweep } from './services/lifecycle.js';
import { refresh as refreshStatus } from './services/status.js';

// Cloudflare edge ranges (https://www.cloudflare.com/ips/). Only used when TRUST_CLOUDFLARE=1.
const CLOUDFLARE_RANGES = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
function trustProxySetting() {
  const own = String(config.trustProxy || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!config.trustCloudflare) return config.trustProxy || false;
  return [...(own.length ? own : ['127.0.0.1']), ...CLOUDFLARE_RANGES];
}
import { serveTenant } from './serve/tenant.js';
import { loadSession, csrfGuard, platformSecurityHeaders } from './web/middleware.js';
import { ensureBootstrapAdmin, purgeExpiredSessions } from './services/users.js';
import { flushTraffic } from './services/sites.js';
import { ensureStorageDirs, cleanTemp } from './storage/releases.js';
import { hit, LIMITS } from './lib/ratelimit.js';
import { expirePreviews } from './services/tryit.js';
import { purgeEvidence } from './services/evidence.js';
import { repairPending, isEnabled as hostingEnabled } from './publish/hostinger.js';
import { contentTypeFor } from './lib/mime.js';
import { registerMarketingRoutes } from './web/routes/marketing.js';
import { registerAuthRoutes } from './web/routes/auth.js';
import { registerDashboardRoutes } from './web/routes/dashboard.js';
import { registerAdminRoutes } from './web/routes/admin.js';
import { registerSystemRoutes } from './web/routes/system.js';
import { registerMcpRoutes } from './mcp/server.js';

export async function buildApp({ logger = true } = {}) {
  getDb();
  ensureStorageDirs();

  const app = Fastify({
    logger: logger ? { level: config.isProd ? 'info' : 'debug' } : false,
    trustProxy: trustProxySetting(),
    bodyLimit: 4 * 1024 * 1024, // non-multipart bodies (forms/json); pasted HTML is form-encoded, which grows it ~3x
    disableRequestLogging: config.isProd,
    routerOptions: { ignoreTrailingSlash: false },
  });

  // Keep the raw JSON body around: webhook signatures (HitPay) are computed over the exact bytes.
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 12 * 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body;
    try { done(null, body ? JSON.parse(body) : {}); } catch (e) { e.statusCode = 400; done(e); }
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(formbody, { bodyLimit: 4 * 1024 * 1024 });
  await app.register(multipart, {
    preservePath: true, // folder uploads send "dir/file.ext" as the filename
    limits: {
      fileSize: config.limits.maxUploadBytes,
      files: config.limits.maxFilesPerUpload,
      fields: 20,
      parts: config.limits.maxFilesPerUpload + 20,
      headerPairs: 200,
    },
  });

  // ---- Host routing: tenants short-circuit before any platform hook runs ----
  app.addHook('onRequest', async (req, reply) => {
    const label = tenantFromHost(req.headers.host, config.baseDomain, config.platformHosts);
    if (label) {
      req.isTenant = true;
      await serveTenant(req, reply, label);
      return reply; // handled
    }
    const host = String(req.headers.host ?? '').toLowerCase().split(':')[0];
    if (!config.platformHosts.includes(host)) {
      const custom = customHostLookup(host);
      if (custom?.off) return reply.code(302).header('Cache-Control', 'no-store').redirect(`${config.publicScheme}://${custom.label}.${config.baseDomain}${(req.raw.url ?? '/').split('?')[0]}`);
      if (custom) { req.isTenant = true; await serveTenant(req, reply, custom.label); return reply; }
    }
    if (config.isProd && !config.platformHosts.includes(host)) {
      // Unknown host (raw IP, stray domain): refuse rather than serve the platform under a foreign name.
      return reply.code(421).send('Misdirected request');
    }
    platformSecurityHeaders(reply);
    const rl = hit(`platform:${req.ip}`, LIMITS.platformGeneral.limit, LIMITS.platformGeneral.windowMs);
    if (!rl.ok) return reply.code(429).header('Retry-After', String(rl.retryAfterSec)).send('Too many requests');
    await loadSession(req);
  });

  app.addHook('preHandler', async (req, reply) => {
    if (req.isTenant) return;
    if (req.isMultipart?.()) return; // multipart handlers verify CSRF after parsing fields
    return csrfGuard(req, reply);
  });

  // ---- Static assets for the platform UI ----
  const publicDir = path.join(config.rootDir, 'src', 'public');
  app.get('/assets/:file', async (req, reply) => {
    const name = String(req.params.file);
    if (!/^[a-z0-9.-]+$/i.test(name)) return reply.code(404).send();
    const abs = path.join(publicDir, name);
    if (!abs.startsWith(publicDir + path.sep) || !fs.existsSync(abs)) return reply.code(404).send();
    const type = contentTypeFor(name);
    if (!type) return reply.code(404).send();
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.type(type).send(fs.createReadStream(abs));
  });

  await registerMarketingRoutes(app);
  await registerAuthRoutes(app);
  await registerDashboardRoutes(app);
  await registerAdminRoutes(app);
  await registerSystemRoutes(app);
  await registerMcpRoutes(app);

  app.setNotFoundHandler((req, reply) => {
    if (req.isTenant) return reply; // already handled
    reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Not found</title><p style="font-family:system-ui;padding:2rem">Page not found. <a href="/">Back to NSD.SG</a></p>');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send('Bad request.');
    if (String(err.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      req.log.warn({ err, url: req.url }, 'constraint violation');
      return reply.code(409).type('text/html; charset=utf-8')
        .send('<!doctype html><title>Cannot do that</title><p style="font-family:system-ui;padding:2rem">That change was refused because other records still depend on this one. Go back and retire or reassign it instead. <a href="javascript:history.back()">Back</a></p>');
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
      return reply.code(413).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:2rem">That upload is larger than the limit for your plan.</p>');
    }
    req.log.error({ err, url: req.url }, 'unhandled error');
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).type('text/html; charset=utf-8')
      .send('<!doctype html><title>Error</title><p style="font-family:system-ui;padding:2rem">Something went wrong on our side. It has been logged.</p>');
  });

  // ---- Maintenance timers ----
  const timers = [];
  timers.push(setInterval(() => { try { flushTraffic(); } catch (e) { app.log.error(e); } }, 15_000).unref());
  timers.push(setInterval(() => {
    try {
      const n = purgeExpiredSessions();
      const t = cleanTemp();
      const p = expirePreviews();
      const ev = purgeEvidence();
      if (n || t || p || ev) app.log.info({ sessions: n, temp: t, previews: p, evidence: ev }, 'maintenance');
      refreshStatus().catch(() => {});
      lifecycleSweep().then((r) => { if (r.reminded || r.dormant || r.warned || r.deleted) app.log.info(r, 'plan lifecycle'); }).catch((e) => app.log.error(e));
    } catch (e) { app.log.error(e); }
  }, 10 * 60_000).unref());
  if (hostingEnabled()) {
    timers.push(setInterval(() => {
      repairPending().then((r) => { if (r.repaired || r.failed) app.log.info(r, 'hosting repair sweep'); }).catch((e) => app.log.error(e));
    }, 2 * 60_000).unref());
  }
  app.addHook('onClose', async () => {
    timers.forEach(clearInterval);
    flushTraffic();
  });

  await ensureBootstrapAdmin(app.log);
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) await import('./start.js');
