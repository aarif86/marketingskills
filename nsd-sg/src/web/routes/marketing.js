// Public marketing pages + abuse report form.
import { config } from '../../config.js';
import { getDb } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { limiter } from '../../lib/ratelimit.js';
import { audit } from '../../lib/audit.js';
import { listPlans } from '../../services/plans.js';
import { normalizeSubdomain } from '../../lib/subdomain.js';
import { appLayout, marketingLayout, html, whatsappTarget } from '../views/layout.js';
import { supportConfig } from '../help.js';
import { pastedHtml } from '../../lib/html.js';
import { csrfTokenFor, readFlash, flash } from '../middleware.js';
import { contactPage, homePage, pricingPage, faqPage, termsPage, privacyPage, reportPage, showcasePage, badgePage, roadmapPage, changelogPage, tryResultPage, tryGonePage, tryLimitPage } from '../views/marketing.js';
import { createPreview, getPreview, claimPreview, previewUrl, checkReady, validatePaste, listShowcasePreviews, readTryCookie, writeTryCookie, anonBlockReason, TRY_COOKIE, TRY_FREE_PER_PERSON, TRY_MAX_BYTES, TryError } from '../../services/tryit.js';
import { listSitesForUser, getSiteForUser } from '../../services/sites.js';
import { entitlementsFor } from '../../services/plans.js';
import { listShowcaseSites } from '../../services/sites.js';
import { getSetting } from '../../services/settings.js';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// One of our bundled sample pages (src/public/sample-*.html), by file name. Null for anything else.
function sampleHtml(name) {
  if (!/^sample-[a-z]+\.html$/.test(String(name ?? ''))) return null;
  const abs = path.join(config.rootDir, 'src', 'public', name);
  try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
}
import { listRoadmap, listChangelog, toggleVote, suggest, addAttachment, ATTACHMENT_EXTS, ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_BYTES, attachmentExt } from '../../services/roadmap.js';
import { tempFile } from '../../storage/releases.js';
import { requireUser, csrfGuard } from '../middleware.js';
import { brandingMarkup } from '../../serve/branding.js';

export async function registerMarketingRoutes(app) {
  const render = (req, reply, { title, description, body }) =>
    reply.type('text/html; charset=utf-8').send(marketingLayout({ title, description, body, user: req.user, flash: readFlash(req, reply), path: String(req.raw.url ?? '').split('?')[0] }));
  // Roadmap and changelog are linked from the dashboard menu. A logged-in user stays inside the dashboard shell
  // (same menu, tab highlighted) instead of being dropped onto the public site and having to find the way back.
  const renderInApp = (req, reply, { title, description, body, active }) => req.user
    ? reply.type('text/html; charset=utf-8').send(appLayout({ title, body, user: req.user, flash: readFlash(req, reply), csrf: csrfTokenFor(req), active, path: String(req.raw.url ?? '').split('?')[0] }))
    : render(req, reply, { title, description, body });

  // The "New" pill in the hero shows the changelog entry the admin pinned (settings home.pill), else the latest one.
  const heroPill = () => { const pin = getSetting('home.pill', 'latest'); const all = listChangelog(200); return (pin !== 'latest' && all.find((e) => e.id === pin)) || all[0] || null; };
  const liveStrip = () => { const sites = listShowcaseSites(); const previews = listShowcasePreviews(); return { total: sites.length, sites: sites.slice(0, 3), previews: previews.slice(0, 3), previewTotal: previews.length }; };
  app.get('/', async (req, reply) => render(req, reply, { body: homePage({ baseDomain: config.baseDomain, plans: listPlans({ publicOnly: true }), csrf: csrfTokenFor(req), live: liveStrip(), latest: heroPill() ?? null }) }));

  // ---- Try it: upload the .html file or paste the code, no account, live for 3 hours at try.<baseDomain>/<id>/ ----
  app.post('/try', { preHandler: limiter('tryIt') }, async (req, reply) => {
    const back = (msg) => { flash(reply, 'error', msg); return reply.redirect('/#try'); };
    // Three free tries per person, then a free account. Signed-in users are not capped here.
    const cookieCount = readTryCookie(req.cookies?.[TRY_COOKIE]);
    const blocked = req.user ? null : anonBlockReason({ cookieCount, ip: req.ip });
    if (blocked) {
      if (req.isMultipart?.()) for await (const part of req.parts()) { if (part.type !== 'field') part.file.resume(); }
      audit({ req, action: 'try.capped', targetType: 'preview', targetId: blocked, severity: 'info' });
      return render(req, reply, { title: 'Create a free account to keep going', body: tryLimitPage({ reason: blocked }) });
    }
    let htmlText = '';
    let source = 'paste';
    if (req.isMultipart?.()) {
      const fields = {};
      let tooBig = false;
      for await (const part of req.parts()) {
        if (part.type === 'field') { fields[part.fieldname] = String(part.value).slice(0, TRY_MAX_BYTES + 1); continue; }
        if (!part.filename) { part.file.resume(); continue; }
        const chunks = []; let size = 0;
        for await (const c of part.file) { size += c.length; if (size > TRY_MAX_BYTES) { tooBig = true; part.file.resume(); break; } chunks.push(c); }
        if (!tooBig && chunks.length) { htmlText = Buffer.concat(chunks).toString('utf8'); source = 'file'; }
      }
      req.csrfFromMultipart = fields._csrf ?? '';
      req.body = { _csrf: fields._csrf };
      let rejected = false;
      await csrfGuard(req, { code: (c) => ({ send: (m) => { rejected = m; return c; } }) });
      if (rejected) return back('That page sat open too long. Refresh it and try again.');
      if (tooBig) return back('That file is bigger than 1 MB. Test pages are for a single page; sign up to publish something bigger.');
      if (!htmlText) htmlText = pastedHtml(fields, TRY_MAX_BYTES);
      if (!htmlText.trim() && fields.sample) { const s = sampleHtml(fields.sample); if (s) { htmlText = s; source = 'sample'; } }
    } else {
      htmlText = pastedHtml(req.body, TRY_MAX_BYTES);
      if (!htmlText.trim() && req.body?.sample) { const s = sampleHtml(req.body.sample); if (s) { htmlText = s; source = 'sample'; } }
    }
    if (!htmlText.trim()) return back('Choose the file or paste the code first, then press the button.');
    const problem = validatePaste(htmlText);
    if (problem) return back(source === 'file' ? problem.replace('Copy the whole code, from the first line to the last, and paste it again.', 'Choose the .html file your AI gave you (not a picture, PDF or Word file).') : problem);
    try {
      const r = await createPreview({ html: htmlText, ip: req.ip });
      audit({ req, action: 'try.create', targetType: 'preview', targetId: r.id, details: { bytes: Buffer.byteLength(htmlText, 'utf8'), source, tries: cookieCount + 1 } });
      if (!req.user) reply.setCookie(TRY_COOKIE, writeTryCookie(cookieCount + 1), { path: '/', httpOnly: true, sameSite: 'Lax', secure: config.isProd, maxAge: 86400 });
      return reply.redirect(`/try/${r.id}`);
    } catch (e) {
      if (!(e instanceof TryError)) throw e;
      return back(e.message);
    }
  });
  app.get('/try/:id', async (req, reply) => {
    const id = String(req.params.id);
    const row = getPreview(id);
    if (!row) return reply.code(404).type('text/html; charset=utf-8').send(marketingLayout({ title: 'Test page', body: tryGonePage(), user: req.user, flash: readFlash(req, reply) , path: '/try'}));
    const status = await checkReady(id);
    const sites = req.user ? listSitesForUser(req.user.id).filter((s) => s.status !== 'suspended') : [];
    return render(req, reply, { title: status.ready ? 'Your test page is online' : 'Putting your page online', description: 'A test page on NSD.SG, live for 3 hours.', body: tryResultPage({ id, url: previewUrl(id), expiresAt: row.expires_at, status, user: req.user, sites, csrf: csrfTokenFor(req) }) });
  });
  // Polled by the result page until the preview really answers on try.<baseDomain>.
  app.get('/try/:id/status', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const r = await checkReady(String(req.params.id));
    return { ready: r.ready, reason: r.reason ?? null, url: r.url ?? null };
  });
  // Signed-in users can drop a test page onto one of their sites as its home page.
  app.post('/try/:id/claim', { preHandler: requireUser }, async (req, reply) => {
    const id = String(req.params.id);
    const site = getSiteForUser(String(req.body?.site_id ?? ''), req.user.id);
    if (!site) { flash(reply, 'error', 'Pick one of your sites first.'); return reply.redirect(`/try/${id}`); }
    const ent = entitlementsFor(req.user);
    if (ent.expired) { flash(reply, 'error', 'Your plan has ended. Ask for more time or upgrade first.'); return reply.redirect('/billing'); }
    try {
      const r = await claimPreview({ id, site, user: req.user, limits: ent.limits });
      audit({ req, action: 'site.deploy', targetType: 'site', targetId: site.id, details: { source: 'try', preview: id, version: r.version } });
      flash(reply, 'success', `Done. Your page is now the home page of ${site.subdomain}.${config.baseDomain}.`);
      return reply.redirect(`/sites/${site.id}`);
    } catch (e) {
      if (!(e instanceof TryError)) throw e;
      flash(reply, 'error', e.message);
      return reply.redirect(`/try/${id}`);
    }
  });
  app.get('/pricing', async (req, reply) => render(req, reply, { title: 'Pricing', body: pricingPage({ plans: listPlans({ publicOnly: true }) }) }));
  app.get('/faq', async (req, reply) => render(req, reply, { title: 'FAQ', body: faqPage() }));
  app.get('/roadmap', async (req, reply) => renderInApp(req, reply, { active: 'feedback', title: 'Roadmap', description: 'What NSD.SG is building next — vote and suggest.', body: roadmapPage({ items: listRoadmap({ userId: req.user?.id ?? null }), user: req.user, csrf: csrfTokenFor(req) }) }));
  app.get('/changelog', async (req, reply) => renderInApp(req, reply, { active: 'changelog', title: 'Changelog', description: 'Every NSD.SG release in plain words.', body: changelogPage({ entries: listChangelog() }) }));
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
  app.get('/showcase', async (req, reply) => render(req, reply, { title: 'Showcase', description: `Every site currently hosted on ${config.baseDomain}.`, body: showcasePage({ sites: listShowcaseSites(), previews: listShowcasePreviews(), baseDomain: config.baseDomain }) }));
  app.get('/badge', async (req, reply) => {
    // The real badge markup minus its guard <script> (platform CSP forbids inline scripts; the demo does not need it).
    const badgeHtml = brandingMarkup().replace(/<script>[\s\S]*<\/script>/, '').replace('position:fixed !important', 'position:absolute !important');
    return render(req, reply, { title: 'The badge', description: 'What the Powered by NasarDigital badge on free sites looks like.', body: badgePage({ badgeHtml, baseDomain: config.baseDomain }) });
  });
  app.get('/terms', async (req, reply) => render(req, reply, { title: 'Terms of Service', body: termsPage() }));
  app.get('/privacy', async (req, reply) => render(req, reply, { title: 'Privacy', body: privacyPage() }));

  // WhatsApp hand-off: the number lives only here. Rate-limited per IP; every tap is counted in the audit log.
  app.get('/wa', { preHandler: limiter('waClick') }, async (req, reply) => {
    const ctx = String(req.query?.c ?? '').slice(0, 200);
    const target = whatsappTarget(ctx);
    if (!target) return reply.code(404).send('WhatsApp help is switched off.');
    audit({ req, action: 'support.whatsapp_tap', targetType: 'support', targetId: 'whatsapp', details: { ctx } });
    return reply.redirect(target);
  });
  app.get('/contact', async (req, reply) => render(req, reply, { title: 'Contact', description: 'How to reach a real person at NSD.SG.', body: contactPage({ support: supportConfig(), user: req.user }) }));
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
    if (site) getDb().prepare('UPDATE sites SET log_visitors = 1 WHERE id = ?').run(site.id); // a reported site keeps a raw visitor log from now on
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
