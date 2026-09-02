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
import { serveTenant } from './serve/tenant.js';
import { loadSession, csrfGuard, platformSecurityHeaders } from './web/middleware.js';
import { ensureBootstrapAdmin, purgeExpiredSessions } from './services/users.js';
import { flushTraffic } from './services/sites.js';
import { ensureStorageDirs, cleanTemp } from './storage/releases.js';
import { hit, LIMITS } from './lib/ratelimit.js';
import { contentTypeFor } from './lib/mime.js';
import { registerMarketingRoutes } from './web/routes/marketing.js';
import { registerAuthRoutes } from './web/routes/auth.js';
import { registerDashboardRoutes } from './web/routes/dashboard.js';
import { registerAdminRoutes } from './web/routes/admin.js';
import { registerSystemRoutes } from './web/routes/system.js';

export async function buildApp({ logger = true } = {}) {
  getDb();
  ensureStorageDirs();

  const app = Fastify({
    logger: logger ? { level: config.isProd ? 'info' : 'debug' } : false,
    trustProxy: config.trustProxy || false,
    bodyLimit: 1024 * 1024, // non-multipart bodies (forms/json)
    disableRequestLogging: config.isProd,
    routerOptions: { ignoreTrailingSlash: false },
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(formbody, { bodyLimit: 256 * 1024 });
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

  app.setNotFoundHandler((req, reply) => {
    if (req.isTenant) return reply; // already handled
    reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Not found</title><p style="font-family:system-ui;padding:2rem">Page not found. <a href="/">Back to NSD.SG</a></p>');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send('Bad request.');
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
      if (n || t) app.log.info({ sessions: n, temp: t }, 'maintenance');
    } catch (e) { app.log.error(e); }
  }, 10 * 60_000).unref());
  app.addHook('onClose', async () => {
    timers.forEach(clearInterval);
    flushTraffic();
  });

  await ensureBootstrapAdmin(app.log);
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const app = await buildApp();
  const shutdown = async (sig) => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`NSD.SG v${config.version} platform on ${config.platformHosts.join(', ')} · tenants on *.${config.baseDomain}`);
}
