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
import { homePage, pricingPage, faqPage, termsPage, privacyPage, reportPage, showcasePage, badgePage, roadmapPage, changelogPage } from '../views/marketing.js';
import { listShowcaseSites } from '../../services/sites.js';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { listRoadmap, listChangelog, toggleVote, suggest, addAttachment, ATTACHMENT_EXTS, ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_BYTES, attachmentExt } from '../../services/roadmap.js';
import { tempFile } from '../../storage/releases.js';
import { requireUser, csrfGuard } from '../middleware.js';
import { brandingMarkup } from '../../serve/branding.js';

export async function registerMarketingRoutes(app) {
  const render = (req, reply, { title, description, body }) =>
    reply.type('text/html; charset=utf-8').send(marketingLayout({ title, description, body, user: req.user, flash: readFlash(req, reply) }));

  app.get('/', async (req, reply) => render(req, reply, { body: homePage({ baseDomain: config.baseDomain, plans: listPlans({ publicOnly: true }) }) }));
  app.get('/pricing', async (req, reply) => render(req, reply, { title: 'Pricing', body: pricingPage({ plans: listPlans({ publicOnly: true }) }) }));
  app.get('/faq', async (req, reply) => render(req, reply, { title: 'FAQ', body: faqPage() }));
  app.get('/roadmap', async (req, reply) => render(req, reply, { title: 'Roadmap', description: 'What NSD.SG is building next — vote and suggest.', body: roadmapPage({ items: listRoadmap({ userId: req.user?.id ?? null }), user: req.user, csrf: csrfTokenFor(req) }) }));
  app.get('/changelog', async (req, reply) => render(req, reply, { title: 'Changelog', description: 'Every NSD.SG release in plain words.', body: changelogPage({ entries: listChangelog() }) }));
  app.post('/roadmap/vote/:id', { preHandler: requireUser }, async (req, reply) => {
    toggleVote({ itemId: String(req.params.id), userId: req.user.id });
    return reply.redirect('/roadmap');
  });
  app.post('/roadmap/suggest', { preHandler: [requireUser, limiter('suggest', (r) => r.user?.id ?? r.ip)] }, async (req, reply) => {
    // Multipart (idea + optional screenshots/PDF) or a plain form post. CSRF is checked after the parts are read.
    const fields = {};
    const files = [];
    const temps = [];
    let problem = '';
    try {
      if (req.isMultipart?.()) {
        for await (const part of req.parts()) {
          if (part.type === 'field') { fields[part.fieldname] = String(part.value).slice(0, 2000); continue; }
          if (!part.filename) { part.file.resume(); continue; }
          const ext = attachmentExt(part.filename);
          if (files.length >= ATTACHMENT_MAX_FILES) { part.file.resume(); problem ||= `At most ${ATTACHMENT_MAX_FILES} files per idea.`; continue; }
          if (!ATTACHMENT_EXTS.has(ext)) { part.file.resume(); problem ||= `"${part.filename}" is not an image or PDF.`; continue; }
          const tmp = tempFile('fb'); temps.push(tmp);
          await pipeline(part.file, fs.createWriteStream(tmp, { mode: 0o600 }));
          const bytes = fs.statSync(tmp).size;
          if (bytes > ATTACHMENT_MAX_BYTES || part.file.truncated) { problem ||= `"${part.filename}" is over ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`; continue; }
          files.push({ filename: part.filename, tmpPath: tmp, bytes });
        }
        req.csrfFromMultipart = fields._csrf ?? '';
        req.body = { _csrf: fields._csrf };
        let rejected = false;
        await csrfGuard(req, { code: (c) => ({ send: (m) => { rejected = m; return c; } }) });
        if (rejected) { flash(reply, 'error', 'Security token expired. Refresh the page and try again.'); return reply.redirect('/roadmap#suggest'); }
      } else {
        Object.assign(fields, req.body ?? {});
      }
      if (problem) { flash(reply, 'error', problem); return reply.redirect('/roadmap#suggest'); }
      const r = suggest({ userId: req.user.id, title: fields.title, body: fields.body });
      if (r.ok) for (const f of files) addAttachment({ itemId: r.id, ...f });
      audit({ req, action: 'roadmap.suggest', targetType: 'roadmap', targetId: r.id ?? '-', details: { ok: r.ok, files: files.length } });
      flash(reply, r.ok ? 'success' : 'error', r.ok ? `Thanks — your idea is in${files.length ? ` with ${files.length} file${files.length === 1 ? '' : 's'}` : ''}. We read every one.` : r.reason);
      return reply.redirect('/roadmap#suggest');
    } finally {
      for (const t of temps) fs.rmSync(t, { force: true });
    }
  });
  app.get('/showcase', async (req, reply) => render(req, reply, { title: 'Showcase', description: `Every site currently hosted on ${config.baseDomain}.`, body: showcasePage({ sites: listShowcaseSites(), baseDomain: config.baseDomain }) }));
  app.get('/badge', async (req, reply) => {
    // The real badge markup minus its guard <script> (platform CSP forbids inline scripts; the demo does not need it).
    const badgeHtml = brandingMarkup().replace(/<script>[\s\S]*<\/script>/, '').replace('position:fixed !important', 'position:absolute !important');
    return render(req, reply, { title: 'The badge', description: 'What the Powered by NasarDigital badge on free sites looks like.', body: badgePage({ badgeHtml, baseDomain: config.baseDomain }) });
  });
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
