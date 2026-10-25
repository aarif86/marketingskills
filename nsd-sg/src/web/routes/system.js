// Health check + Caddy on-demand TLS "ask" endpoint.
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { getDb } from '../../db/index.js';
import { tenantFromHost } from '../../lib/subdomain.js';
import { diskUsage } from '../../storage/releases.js';
import { listPlans } from '../../services/plans.js';
import { FAQ_QA, period } from '../views/marketing.js';

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

  const site = () => `${config.publicScheme}://${config.platformHosts[0]}`;
  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain').send(`User-agent: *\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /account\nDisallow: /internal\n\nSitemap: ${site()}/sitemap.xml\n`));

  const PUBLIC_PAGES = ['/', '/pricing', '/faq', '/showcase', '/roadmap', '/changelog', '/contact', '/terms', '/privacy', '/report'];
  app.get('/sitemap.xml', async (_req, reply) => reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=3600')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map((p) => `  <url><loc>${site()}${p}</loc></url>`).join('\n')}\n</urlset>\n`));

  // Plain-text summary for AI assistants that are asked "what is nsd.sg?" (the llms.txt convention).
  app.get('/llms.txt', async (_req, reply) => {
    const plans = listPlans({ publicOnly: true });
    const money = (c) => (c === 0 ? 'free' : `S$${(c / 100).toFixed(0)}/month`);
    const lines = [
      '# NSD.SG',
      '',
      `> Static hosting for pages made with AI, at yourname.${config.baseDomain}. Paste the HTML, drop in files or a ZIP, or let your AI publish through a connector. HTTPS on every page, Singapore, run by NasarDigital (${config.branding.partnerUrl}).`,
      '',
      '## What it does',
      `- Hosts static sites (HTML, CSS, JS, images, fonts, video, PDF) at <name>.${config.baseDomain}. No server-side code runs, ever.`,
      '- Try without an account: a page goes live for 3 hours from the home page.',
      '- Every publish keeps the older copies; roll back from the dashboard.',
      '- 404.html for a custom not-found page; _redirects (Netlify format, same-site only) for redirects and single-page-app fallback; hashed build assets cached for a year.',
      '- Own domain name on paid plans. Public showcase. Abuse reports at /report.',
      '',
      '## Connect your AI (MCP)',
      '- Any MCP-capable AI (Claude, ChatGPT, Codex, Gemini CLI, Cursor, …) can publish directly. The user signs in, opens /connect, creates a key, and adds the connector URL to their AI.',
      '- Tools: nsd_publish (name + html or files), nsd_update, nsd_list_sites, nsd_get_site, nsd_delete_site. Up to 100 files / 8 MB per call; bigger builds go up as a ZIP from the dashboard.',
      '- A brand-new address needs 5-15 minutes before HTTPS works. Tell the user to wait and reload.',
      '',
      '## Plans',
      ...plans.map((p) => `- ${p.name}: ${money(p.price_cents_month)}. ${p.limits.max_sites} site${p.limits.max_sites === 1 ? '' : 's'}, ${Math.round(p.limits.max_storage_bytes / 1024 / 1024)} MB${p.trial_days ? `, free for ${period(p.trial_days)}` : ''}. ${p.description}`),
      '',
      '## Questions people ask',
      ...FAQ_QA.map(([q, a]) => `- ${q} ${a}`),
      '',
      '## Links',
      `- Home: ${site()}/`,
      `- Pricing: ${site()}/pricing`,
      `- FAQ: ${site()}/faq`,
      `- Roadmap: ${site()}/roadmap · Changelog: ${site()}/changelog`,
      `- Contact: ${site()}/contact · Report a page: ${site()}/report`,
      '',
    ];
    return reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600').send(lines.join('\n'));
  });
}
