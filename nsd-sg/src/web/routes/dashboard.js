// Signed-in user area: sites, uploads, file manager, releases, account, plan.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config, publicUrlForSubdomain } from '../../config.js';
import { audit } from '../../lib/audit.js';
import { limiter } from '../../lib/ratelimit.js';
import { validatePasswordStrength } from '../../lib/password.js';
import { sanitizeRelativePath } from '../../lib/paths.js';
import { contentTypeFor, extensionOf } from '../../lib/mime.js';
import {
  createSite, listSitesForUser, getSiteForUser, updateSiteSettings, deleteSite, storageUsedByUser, trafficForSite, monthlyBytesForSite,
} from '../../services/sites.js';
import { entitlementsFor, requestExtension, listPlanEvents, listPlans } from '../../services/plans.js';
import { updateProfile, changePassword, listSessions, destroyAllSessions, verifyPasswordForUser, setUserStatus } from '../../services/users.js';
import {
  deployZip, deployFiles, deleteFileFromSite, rollbackTo, listReleases, listReleaseFiles, readReleaseFile, tempFile, StorageError,
} from '../../storage/releases.js';
import { appLayout } from '../views/layout.js';
import * as V from '../views/dashboard.js';
import { requireUser, csrfTokenFor, csrfGuard, readFlash, flash, clearSessionCookie } from '../middleware.js';

const TEXT_PREVIEW = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'xml', 'svg', 'webmanifest', 'csv', 'vtt', 'map']);

export async function registerDashboardRoutes(app) {
  const render = (req, reply, { title, body, active }) =>
    reply.type('text/html; charset=utf-8').send(appLayout({ title, body, user: req.user, flash: readFlash(req, reply), csrf: csrfTokenFor(req), active }));

  const loadSite = (req, reply) => {
    const site = getSiteForUser(String(req.params.id), req.user.id);
    if (!site) { reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:2rem">Site not found.</p>'); return null; }
    return site;
  };

  app.get('/dashboard', { preHandler: requireUser }, async (req, reply) => {
    const sites = listSitesForUser(req.user.id);
    const ent = entitlementsFor(req.user);
    return render(req, reply, { title: 'Your sites', active: 'sites', body: V.sitesIndex({ sites, ent, user: req.user, storageUsed: storageUsedByUser(req.user.id), csrf: csrfTokenFor(req) }) });
  });

  app.get('/sites/new', { preHandler: requireUser }, async (req, reply) => {
    const ent = entitlementsFor(req.user);
    return render(req, reply, { title: 'New site', active: 'sites', body: V.newSite({ csrf: csrfTokenFor(req), ent, count: listSitesForUser(req.user.id).length }) });
  });

  app.post('/sites', { preHandler: [requireUser, limiter('siteCreate', (r) => r.user?.id ?? r.ip)] }, async (req, reply) => {
    const r = createSite({ user: req.user, subdomain: req.body?.subdomain, title: req.body?.title });
    if (!r.ok) { flash(reply, 'error', r.reason); return reply.redirect('/sites/new'); }
    audit({ req, action: 'site.create', targetType: 'site', targetId: r.site.id, details: { subdomain: r.site.subdomain } });
    flash(reply, 'success', `${r.site.subdomain}.${config.baseDomain} is yours. Upload your files to go live.`);
    return reply.redirect(`/sites/${r.site.id}`);
  });

  app.get('/sites/:id', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    const ent = entitlementsFor(req.user);
    const files = site.current_release_id ? listReleaseFiles(site.id, site.current_release_id) : [];
    return render(req, reply, {
      title: site.subdomain, active: 'sites',
      body: V.siteDetail({ site, ent, files, releases: listReleases(site.id), traffic: trafficForSite(site.id, 30), monthBytes: monthlyBytesForSite(site.id), csrf: csrfTokenFor(req), url: publicUrlForSubdomain(site.subdomain) }),
    });
  });

  // ---- uploads (multipart) ----
  app.post('/sites/:id/upload', { preHandler: [requireUser, limiter('upload', (r) => r.user?.id ?? r.ip)] }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    const ent = entitlementsFor(req.user);
    const wantsJson = (req.headers.accept ?? '').includes('application/json');
    const fail = (status, message) => {
      if (wantsJson) return reply.code(status).send({ ok: false, error: message });
      flash(reply, 'error', message);
      return reply.redirect(`/sites/${site.id}`);
    };
    if (ent.expired) return fail(403, 'Your plan has expired. Request an extension or upgrade before publishing.');
    if (!req.isMultipart()) return fail(400, 'Expected a file upload.');

    const temps = [];
    const files = [];
    const fields = {};
    let tooLarge = false;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') { fields[part.fieldname] = String(part.value).slice(0, 500); continue; }
        if (files.length >= config.limits.maxFilesPerUpload) { part.file.resume(); continue; }
        const tmp = tempFile('up');
        temps.push(tmp);
        await pipeline(part.file, fs.createWriteStream(tmp, { mode: 0o600 }));
        if (part.file.truncated) tooLarge = true;
        files.push({ fieldname: part.fieldname, filename: part.filename, tmpPath: tmp, size: fs.statSync(tmp).size });
      }
      // CSRF is verified after parsing because the token travels as a form field.
      req.csrfFromMultipart = fields._csrf ?? '';
      req.body = { _csrf: fields._csrf };
      let rejected = false;
      await csrfGuard(req, { code: (c) => ({ send: (m) => { rejected = m; return c; } }) });
      if (rejected) return fail(403, 'Security token expired. Refresh the page and try again.');
      if (tooLarge) return fail(413, `A file exceeded the upload limit (${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} MB).`);
      if (!files.length) return fail(400, 'No files received.');

      const mode = fields.mode === 'replace' ? 'replace' : 'merge';
      const zipFile = files.find((f) => /\.zip$/i.test(f.filename ?? '') && files.length === 1);
      let result;
      if (zipFile) {
        result = await deployZip({ site, zipPath: zipFile.tmpPath, user: req.user, limits: ent.limits, note: `ZIP: ${zipFile.filename}`.slice(0, 120) });
        audit({ req, action: 'site.deploy', targetType: 'site', targetId: site.id, details: { source: 'zip', version: result.version, files: result.count, bytes: result.bytes, rejected: result.rejected.length } });
        const msgParts = [`Version ${result.version} is live: ${result.count} files.`];
        if (result.rejected.length) msgParts.push(`${result.rejected.length} file${result.rejected.length === 1 ? ' was' : 's were'} skipped (not a supported type): ${result.rejected.slice(0, 5).map((r) => r.path).join(', ')}${result.rejected.length > 5 ? '…' : ''}.`);
        if (wantsJson) return reply.send({ ok: true, version: result.version, files: result.count, rejected: result.rejected, skipped: result.skipped });
        flash(reply, result.rejected.length ? 'warn' : 'success', msgParts.join(' '));
        return reply.redirect(`/sites/${site.id}`);
      }
      // Individual files. The relative path comes from the filename (folder uploads send `dir/file.ext`).
      const list = [];
      const problems = [];
      for (const f of files) {
        const r = sanitizeRelativePath(f.filename ?? '');
        if (!r.ok) { problems.push(`${f.filename}: ${r.reason}`); continue; }
        list.push({ relPath: r.path, tmpPath: f.tmpPath, size: f.size });
      }
      if (!list.length) return fail(400, `Nothing to publish. ${problems[0] ?? ''}`);
      result = await deployFiles({ site, files: list, user: req.user, limits: ent.limits, replaceAll: mode === 'replace', note: `${mode === 'replace' ? 'Replace' : 'Upload'} ${list.length} file${list.length === 1 ? '' : 's'}` });
      audit({ req, action: 'site.deploy', targetType: 'site', targetId: site.id, details: { source: mode, version: result.version, files: result.count, bytes: result.bytes } });
      if (wantsJson) return reply.send({ ok: true, version: result.version, files: result.count, problems });
      flash(reply, problems.length ? 'warn' : 'success', `Version ${result.version} is live.${problems.length ? ` Skipped: ${problems.slice(0, 3).join('; ')}` : ''}`);
      return reply.redirect(`/sites/${site.id}`);
    } catch (e) {
      if (e instanceof StorageError) return fail(400, e.message);
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT' || e.code === 'FST_PARTS_LIMIT') return fail(413, 'Upload too large or too many files for one request. Try a ZIP.');
      throw e;
    } finally {
      for (const t of temps) fs.rm(t, { force: true }, () => {});
    }
  });

  app.post('/sites/:id/files/delete', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    const ent = entitlementsFor(req.user);
    try {
      const r = deleteFileFromSite({ site, relPath: String(req.body?.path ?? ''), user: req.user, limits: ent.limits });
      audit({ req, action: 'site.file_delete', targetType: 'site', targetId: site.id, details: { path: req.body?.path, version: r.version } });
      flash(reply, 'success', `Deleted. Version ${r.version} is live.`);
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      flash(reply, 'error', e.message);
    }
    return reply.redirect(`/sites/${site.id}`);
  });

  app.get('/sites/:id/files/view', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    if (!site.current_release_id) return reply.code(404).send('No files');
    const r = sanitizeRelativePath(String(req.query.path ?? ''));
    if (!r.ok) return reply.code(400).send(r.reason);
    let buf;
    try { buf = readReleaseFile(site.id, site.current_release_id, r.path); } catch { return reply.code(404).send('Not found'); }
    const ext = extensionOf(r.path);
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store');
    // Previews on the platform origin are always inert: text as text/plain, everything else as a download.
    if (TEXT_PREVIEW.has(ext)) return reply.type('text/plain; charset=utf-8').send(buf);
    reply.header('Content-Disposition', `attachment; filename="${r.path.split('/').pop().replace(/[^\w.-]/g, '_')}"`);
    return reply.type(ext && !['svg'].includes(ext) ? contentTypeFor(r.path) : 'application/octet-stream').send(buf);
  });

  app.post('/sites/:id/rollback', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    const ent = entitlementsFor(req.user);
    try {
      const r = rollbackTo({ site, releaseId: String(req.body?.release_id ?? ''), user: req.user, limits: ent.limits });
      audit({ req, action: 'site.rollback', targetType: 'site', targetId: site.id, details: { to: req.body?.release_id, version: r.version } });
      flash(reply, 'success', `Rolled back. Version ${r.version} is live.`);
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      flash(reply, 'error', e.message);
    }
    return reply.redirect(`/sites/${site.id}`);
  });

  app.get('/sites/:id/settings', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    return render(req, reply, { title: `${site.subdomain} · settings`, active: 'sites', body: V.siteSettings({ site, csrf: csrfTokenFor(req), ent: entitlementsFor(req.user) }) });
  });

  app.post('/sites/:id/settings', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    updateSiteSettings(site.id, { title: req.body?.title, allow_framing: req.body?.allow_framing === '1' });
    audit({ req, action: 'site.settings', targetType: 'site', targetId: site.id });
    flash(reply, 'success', 'Settings saved.');
    return reply.redirect(`/sites/${site.id}/settings`);
  });

  app.post('/sites/:id/delete', { preHandler: requireUser }, async (req, reply) => {
    const site = loadSite(req, reply); if (!site) return;
    if (String(req.body?.confirm ?? '') !== site.subdomain) {
      flash(reply, 'error', 'Type the site name exactly to confirm deletion.');
      return reply.redirect(`/sites/${site.id}/settings`);
    }
    deleteSite(site.id);
    audit({ req, action: 'site.delete', targetType: 'site', targetId: site.id, details: { subdomain: site.subdomain }, severity: 'warn' });
    flash(reply, 'success', `${site.subdomain}.${config.baseDomain} has been deleted.`);
    return reply.redirect('/dashboard');
  });

  // ---- account ----
  app.get('/account', { preHandler: requireUser }, async (req, reply) =>
    render(req, reply, { title: 'Account', active: 'account', body: V.accountPage({ user: req.user, sessions: listSessions(req.user.id), csrf: csrfTokenFor(req) }) }));

  app.post('/account/profile', { preHandler: requireUser }, async (req, reply) => {
    updateProfile(req.user.id, { name: req.body?.name });
    flash(reply, 'success', 'Profile updated.');
    return reply.redirect('/account');
  });

  app.post('/account/password', { preHandler: requireUser }, async (req, reply) => {
    const b = req.body ?? {};
    const ok = await verifyPasswordForUser(req.user.id, String(b.current ?? ''));
    if (!ok) { flash(reply, 'error', 'Current password is incorrect.'); return reply.redirect('/account'); }
    const err = validatePasswordStrength(String(b.password ?? ''));
    if (err) { flash(reply, 'error', err); return reply.redirect('/account'); }
    await changePassword(req.user.id, String(b.password));
    audit({ req, action: 'auth.password_changed', targetType: 'user', targetId: req.user.id, severity: 'warn' });
    clearSessionCookie(reply);
    flash(reply, 'success', 'Password changed. Please log in again.');
    return reply.redirect('/login');
  });

  app.post('/account/sessions/revoke', { preHandler: requireUser }, async (req, reply) => {
    destroyAllSessions(req.user.id);
    clearSessionCookie(reply);
    audit({ req, action: 'auth.sessions_revoked', targetType: 'user', targetId: req.user.id });
    flash(reply, 'success', 'All sessions signed out.');
    return reply.redirect('/login');
  });

  app.post('/account/delete', { preHandler: requireUser }, async (req, reply) => {
    const ok = await verifyPasswordForUser(req.user.id, String(req.body?.password ?? ''));
    if (!ok || req.body?.confirm !== 'DELETE') { flash(reply, 'error', 'Password incorrect or confirmation missing.'); return reply.redirect('/account'); }
    if (req.user.role === 'admin') { flash(reply, 'error', 'Admin accounts cannot self-delete. Demote first.'); return reply.redirect('/account'); }
    for (const s of listSitesForUser(req.user.id)) deleteSite(s.id);
    setUserStatus(req.user.id, 'disabled');
    audit({ req, action: 'user.self_delete', targetType: 'user', targetId: req.user.id, severity: 'warn' });
    clearSessionCookie(reply);
    flash(reply, 'success', 'Your account and sites have been removed.');
    return reply.redirect('/');
  });

  // ---- plan & billing ----
  app.get('/billing', { preHandler: requireUser }, async (req, reply) =>
    render(req, reply, { title: 'Plan & billing', active: 'billing', body: V.billingPage({ user: req.user, ent: entitlementsFor(req.user), plans: listPlans({ publicOnly: true }), events: listPlanEvents(req.user.id), storageUsed: storageUsedByUser(req.user.id), siteCount: listSitesForUser(req.user.id).length, csrf: csrfTokenFor(req) }) }));

  app.post('/billing/extend', { preHandler: requireUser }, async (req, reply) => {
    const r = requestExtension({ userId: req.user.id, note: String(req.body?.note ?? '').slice(0, 500) });
    audit({ req, action: 'plan.extension_requested', targetType: 'user', targetId: req.user.id });
    flash(reply, r.ok ? 'success' : 'error', r.ok ? 'Extension requested. We will confirm by email, usually within a day.' : r.reason);
    return reply.redirect('/billing');
  });

  app.post('/billing/upgrade', { preHandler: requireUser }, async (req, reply) => {
    // Payment integration is deliberately out of MVP scope. This records intent so admin can follow up
    // and a Stripe/HitPay checkout can be dropped in here later without touching anything else.
    const planId = String(req.body?.plan ?? '');
    audit({ req, action: 'plan.upgrade_requested', targetType: 'user', targetId: req.user.id, details: { plan: planId } });
    const { getDb } = await import('../../db/index.js');
    const { newId } = await import('../../lib/ids.js');
    getDb().prepare('INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), req.user.id, 'upgrade_requested', req.user.plan_id, planId, '{}', req.user.id);
    flash(reply, 'success', 'Thanks! Online payment is coming soon. We have logged your request and will email you a payment link.');
    return reply.redirect('/billing');
  });
}
