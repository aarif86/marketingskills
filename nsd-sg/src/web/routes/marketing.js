// Public marketing pages + abuse report form.
import { config } from '../../config.js';
import { getDb } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { limiter } from '../../lib/ratelimit.js';
import { audit } from '../../lib/audit.js';
import { listPlans } from '../../services/plans.js';
import { normalizeSubdomain } from '../../lib/subdomain.js';
import { marketingLayout, html } from '../views/layout.js';
import { csrfTokenFor, readFlash, flash } from '../middleware.js';
import { homePage, pricingPage, faqPage, termsPage, privacyPage, reportPage } from '../views/marketing.js';

export async function registerMarketingRoutes(app) {
  const render = (req, reply, { title, description, body }) =>
    reply.type('text/html; charset=utf-8').send(marketingLayout({ title, description, body, user: req.user, flash: readFlash(req, reply) }));

  app.get('/', async (req, reply) => render(req, reply, { body: homePage({ baseDomain: config.baseDomain, plans: listPlans({ publicOnly: true }) }) }));
  app.get('/pricing', async (req, reply) => render(req, reply, { title: 'Pricing', body: pricingPage({ plans: listPlans({ publicOnly: true }) }) }));
  app.get('/faq', async (req, reply) => render(req, reply, { title: 'FAQ', body: faqPage() }));
  app.get('/terms', async (req, reply) => render(req, reply, { title: 'Terms of Service', body: termsPage() }));
  app.get('/privacy', async (req, reply) => render(req, reply, { title: 'Privacy', body: privacyPage() }));

  app.get('/report', async (req, reply) => render(req, reply, { title: 'Report abuse', body: reportPage({ csrf: csrfTokenFor(req), site: normalizeSubdomain(req.query.site ?? '') }) }));

  app.post('/report', { preHandler: limiter('abuseReport') }, async (req, reply) => {
    const b = req.body ?? {};
    const subdomain = normalizeSubdomain(b.site).slice(0, 60);
    const category = ['phishing', 'malware', 'copyright', 'spam', 'other'].includes(b.category) ? b.category : 'other';
    const details = String(b.details ?? '').slice(0, 4000);
    const email = String(b.email ?? '').trim().slice(0, 200);
    if (!subdomain || details.length < 10) {
      flash(reply, 'error', 'Please tell us which site and what the problem is.');
      return reply.redirect('/report');
    }
    const site = getDb().prepare("SELECT id FROM sites WHERE subdomain = ? AND status != 'deleted'").get(subdomain);
    getDb().prepare('INSERT INTO abuse_reports (id, site_id, subdomain, reporter_email, category, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), site?.id ?? null, subdomain, email, category, details, req.ip);
    audit({ req, action: 'abuse.reported', targetType: 'site', targetId: site?.id ?? subdomain, details: { category }, severity: 'warn' });
    flash(reply, 'success', 'Thank you. The report has been logged and will be reviewed.');
    return reply.redirect('/report');
  });

  // Live availability check used by the signup / create-site forms.
  app.get('/api/availability', async (req, reply) => {
    const { subdomainUnavailableReason } = await import('../../services/sites.js');
    const name = normalizeSubdomain(req.query.name ?? '');
    const reason = subdomainUnavailableReason(name);
    reply.header('Cache-Control', 'no-store');
    return { name, available: !reason, reason: reason ?? null, url: `${name}.${config.baseDomain}` };
  });

  // Convenience: html helper is exported for other route files that need small fragments
  app.decorate('html', html);
}
