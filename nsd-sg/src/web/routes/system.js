// Health check + Caddy on-demand TLS "ask" endpoint.
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { getDb } from '../../db/index.js';
import { tenantFromHost } from '../../lib/subdomain.js';
import { diskUsage } from '../../storage/releases.js';

export async function registerSystemRoutes(app) {
  app.get('/healthz', async (_req, reply) => {
    const db = getDb();
    const sites = db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status = 'live'").get().n;
    const disk = diskUsage();
    return reply.header('Cache-Control', 'no-store').send({ ok: true, version: config.version, liveSites: sites, freeBytes: disk.freeBytes, time: new Date().toISOString() });
  });

  // Caddy `on_demand_tls { ask http://127.0.0.1:3000/internal/tls-ask }` — return 200 only for hostnames we know,
  // so attackers cannot make us request certificates for arbitrary names. Only used when the wildcard
  // certificate path is not configured (see deploy/caddy/Caddyfile).
  app.get('/internal/tls-ask', async (req, reply) => {
    if (config.tlsAskToken) {
      const t = String(req.query.token ?? '');
      const ok = t.length === config.tlsAskToken.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(config.tlsAskToken));
      if (!ok) return reply.code(403).send('forbidden');
    }
    const domain = String(req.query.domain ?? '').toLowerCase();
    if (config.platformHosts.includes(domain)) return reply.send('ok');
    const label = tenantFromHost(domain, config.baseDomain, config.platformHosts);
    if (label && getDb().prepare("SELECT 1 FROM sites WHERE subdomain = ? AND status != 'deleted'").get(label)) return reply.send('ok');
    const custom = getDb().prepare("SELECT 1 FROM custom_domains WHERE hostname = ? AND status = 'active'").get(domain);
    if (custom) return reply.send('ok');
    return reply.code(404).send('unknown host');
  });

  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /account\nDisallow: /internal\n'));
}
