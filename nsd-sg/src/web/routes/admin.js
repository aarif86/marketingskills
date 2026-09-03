// Administrator panel. Every route requires role=admin; every mutation is audited.
import os from 'node:os';
import { config, publicUrlForSubdomain } from '../../config.js';
import { isEnabled as hostingEnabled, listOrphanDirs, removeOrphanDir, envFileKeys, syncAll } from '../../publish/hostinger.js';
import { getDb } from '../../db/index.js';
import { audit } from '../../lib/audit.js';
import { nowIso } from '../../lib/ids.js';
import {
  findUserById, findUserByEmail, setUserStatus, setUserOverrides, setUserNotes, setUserRole, destroyAllSessions, listSessions, countAdmins,
} from '../../services/users.js';
import {
  getSiteById, setSiteStatus, setSiteBranding, renameSubdomain, deleteSite, listReserved, addReserved, removeReserved, trafficForSite, flushTraffic,
} from '../../services/sites.js';
import { listPlans, getPlan, upsertPlan, assignPlan, extendPlan, entitlementsFor, pendingExtensionRequests, listPlanEvents, listPromoCodes, createPromoCode, deletePromoCode } from '../../services/plans.js';
import { listReleases, listReleaseFiles, diskUsage } from '../../storage/releases.js';
import { adminLayout } from '../views/layout.js';
import * as V from '../views/admin.js';
import { requireAdmin, csrfTokenFor, readFlash, flash } from '../middleware.js';

const startedAt = Date.now();

export async function registerAdminRoutes(app) {
  const render = (req, reply, { title, body, active }) =>
    reply.type('text/html; charset=utf-8').send(adminLayout({ title, body, user: req.user, flash: readFlash(req, reply), csrf: csrfTokenFor(req), active }));
  const opts = { preHandler: requireAdmin };
  const db = () => getDb();
  const q = (sql, ...args) => db().prepare(sql).get(...args);
  const all = (sql, ...args) => db().prepare(sql).all(...args);

  app.get('/admin', opts, async (req, reply) => {
    flushTraffic();
    const stats = {
      users: q('SELECT COUNT(*) n FROM users').n,
      usersActive: q("SELECT COUNT(*) n FROM users WHERE status='active'").n,
      usersNew7d: q("SELECT COUNT(*) n FROM users WHERE created_at > datetime('now','-7 days')").n,
      sites: q("SELECT COUNT(*) n FROM sites WHERE status != 'deleted'").n,
      live: q("SELECT COUNT(*) n FROM sites WHERE status = 'live'").n,
      suspended: q("SELECT COUNT(*) n FROM sites WHERE status = 'suspended'").n,
      storage: q("SELECT COALESCE(SUM(total_storage_bytes),0) n FROM sites WHERE status != 'deleted'").n,
      deploys7d: q("SELECT COUNT(*) n FROM releases WHERE created_at > datetime('now','-7 days')").n,
      requests7d: q("SELECT COALESCE(SUM(requests),0) n FROM site_traffic_daily WHERE day >= date('now','-7 days')").n,
      bytes7d: q("SELECT COALESCE(SUM(bytes),0) n FROM site_traffic_daily WHERE day >= date('now','-7 days')").n,
      openAbuse: q("SELECT COUNT(*) n FROM abuse_reports WHERE status IN ('open','reviewing')").n,
      expiringSoon: q("SELECT COUNT(*) n FROM users WHERE plan_expires_at IS NOT NULL AND plan_expires_at BETWEEN datetime('now') AND datetime('now','+14 days')").n,
      expired: q("SELECT COUNT(*) n FROM users WHERE plan_expires_at IS NOT NULL AND plan_expires_at < datetime('now')").n,
    };
    const alerts = all("SELECT * FROM audit_log WHERE severity IN ('warn','alert') ORDER BY at DESC LIMIT 15");
    const recentUsers = all('SELECT id, email, name, plan_id, status, created_at FROM users ORDER BY created_at DESC LIMIT 8');
    const recentDeploys = all('SELECT r.*, s.subdomain FROM releases r JOIN sites s ON s.id = r.site_id ORDER BY r.created_at DESC LIMIT 8');
    const upgrades = all("SELECT e.*, u.email FROM plan_events e JOIN users u ON u.id = e.user_id WHERE e.type = 'upgrade_requested' AND e.created_at > datetime('now','-30 days') ORDER BY e.created_at DESC LIMIT 10");
    return render(req, reply, { title: 'Overview', active: 'overview', body: V.overview({ stats, alerts, recentUsers, recentDeploys, extensions: pendingExtensionRequests(), upgrades, csrf: csrfTokenFor(req) }) });
  });

  // ---- users ----
  app.get('/admin/users', opts, async (req, reply) => {
    const search = String(req.query.q ?? '').trim().slice(0, 100);
    const status = String(req.query.status ?? '');
    const plan = String(req.query.plan ?? '');
    let sql = 'SELECT u.*, (SELECT COUNT(*) FROM sites s WHERE s.user_id = u.id AND s.status != \'deleted\') AS site_count, (SELECT COALESCE(SUM(total_storage_bytes),0) FROM sites s WHERE s.user_id = u.id AND s.status != \'deleted\') AS storage FROM users u WHERE 1=1';
    const args = [];
    if (search) { sql += ' AND (u.email LIKE ? OR u.name LIKE ? OR u.id = ?)'; args.push(`%${search}%`, `%${search}%`, search); }
    if (status) { sql += ' AND u.status = ?'; args.push(status); }
    if (plan) { sql += ' AND u.plan_id = ?'; args.push(plan); }
    sql += ' ORDER BY u.created_at DESC LIMIT 200';
    return render(req, reply, { title: 'Users', active: 'users', body: V.usersList({ users: all(sql, ...args), search, status, plan, plans: listPlans() }) });
  });

  app.get('/admin/users/:id', opts, async (req, reply) => {
    const user = findUserById(String(req.params.id));
    if (!user) return reply.code(404).send('No such user');
    const sites = all("SELECT * FROM sites WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC", user.id);
    const auditRows = all('SELECT * FROM audit_log WHERE actor_id = ? OR (target_type = ? AND target_id = ?) ORDER BY at DESC LIMIT 50', user.id, 'user', user.id);
    return render(req, reply, { title: user.email, active: 'users', body: V.userDetail({ user, ent: entitlementsFor(user), sites, sessions: listSessions(user.id), events: listPlanEvents(user.id, 30), auditRows, plans: listPlans(), csrf: csrfTokenFor(req), isLastAdmin: user.role === 'admin' && countAdmins() <= 1 }) });
  });

  app.post('/admin/users/:id/action', opts, async (req, reply) => {
    const user = findUserById(String(req.params.id));
    if (!user) return reply.code(404).send('No such user');
    const b = req.body ?? {};
    const action = String(b.action ?? '');
    const back = `/admin/users/${user.id}`;
    const isSelf = user.id === req.user.id;
    switch (action) {
      case 'suspend': case 'disable': case 'activate': {
        if (isSelf) { flash(reply, 'error', 'You cannot change your own status.'); break; }
        const status = action === 'activate' ? 'active' : action === 'suspend' ? 'suspended' : 'disabled';
        setUserStatus(user.id, status);
        if (status !== 'active') db().prepare("UPDATE sites SET status = 'suspended', suspended_reason = ? WHERE user_id = ? AND status = 'live'").run(`Account ${status}`, user.id);
        else db().prepare("UPDATE sites SET status = CASE WHEN current_release_id IS NULL THEN 'empty' ELSE 'live' END, suspended_reason = '' WHERE user_id = ? AND status = 'suspended'").run(user.id);
        audit({ req, action: `admin.user.${action}`, targetType: 'user', targetId: user.id, details: { reason: b.reason ?? '' }, severity: 'warn' });
        flash(reply, 'success', `User ${status}.`);
        break;
      }
      case 'plan': {
        const exp = assignPlan({ userId: user.id, planId: String(b.plan_id), actorId: req.user.id, reason: String(b.reason ?? 'admin') });
        audit({ req, action: 'admin.user.plan', targetType: 'user', targetId: user.id, details: { plan: b.plan_id, expires: exp } });
        flash(reply, 'success', `Plan set to ${b.plan_id}.`);
        break;
      }
      case 'extend': {
        const days = Math.max(1, Math.min(3650, parseInt(b.days, 10) || 90));
        const next = extendPlan({ userId: user.id, days, actorId: req.user.id, reason: String(b.reason ?? 'admin') });
        audit({ req, action: 'admin.user.extend', targetType: 'user', targetId: user.id, details: { days, until: next } });
        flash(reply, 'success', `Extended by ${days} days (until ${next.slice(0, 10)}).`);
        break;
      }
      case 'never_expire': {
        db().prepare('UPDATE users SET plan_expires_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), user.id);
        audit({ req, action: 'admin.user.never_expire', targetType: 'user', targetId: user.id });
        flash(reply, 'success', 'Plan no longer expires.');
        break;
      }
      case 'overrides': {
        const o = {};
        if (b.branding_removed === 'true') o.branding_removed = true;
        if (b.branding_removed === 'false') o.branding_removed = false;
        for (const k of ['max_sites', 'max_releases']) { const v = parseInt(b[k], 10); if (Number.isFinite(v) && v > 0) o[k] = v; }
        for (const k of ['max_storage_mb', 'max_file_mb', 'max_bandwidth_gb']) {
          const v = parseFloat(b[k]);
          if (Number.isFinite(v) && v > 0) o[k === 'max_storage_mb' ? 'max_storage_bytes' : k === 'max_file_mb' ? 'max_file_bytes' : 'max_bandwidth_bytes_month'] = Math.round(v * (k === 'max_bandwidth_gb' ? 1024 ** 3 : 1024 ** 2));
        }
        for (const k of ['custom_domains', 'analytics', 'priority_support']) { if (b[k] === 'true') o[k] = true; if (b[k] === 'false') o[k] = false; }
        setUserOverrides(user.id, o);
        audit({ req, action: 'admin.user.overrides', targetType: 'user', targetId: user.id, details: o });
        flash(reply, 'success', 'Overrides saved.');
        break;
      }
      case 'notes': {
        setUserNotes(user.id, b.notes);
        flash(reply, 'success', 'Notes saved.');
        break;
      }
      case 'role': {
        const role = b.role === 'admin' ? 'admin' : 'user';
        if (isSelf && role !== 'admin') { flash(reply, 'error', 'You cannot demote yourself.'); break; }
        if (user.role === 'admin' && role === 'user' && countAdmins() <= 1) { flash(reply, 'error', 'There must be at least one admin.'); break; }
        setUserRole(user.id, role);
        audit({ req, action: 'admin.user.role', targetType: 'user', targetId: user.id, details: { role }, severity: 'alert' });
        flash(reply, 'success', `Role set to ${role}.`);
        break;
      }
      case 'logout_all': {
        destroyAllSessions(user.id);
        audit({ req, action: 'admin.user.logout_all', targetType: 'user', targetId: user.id, severity: 'warn' });
        flash(reply, 'success', 'All sessions revoked.');
        break;
      }
      case 'verify_email': {
        db().prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(nowIso(), user.id);
        flash(reply, 'success', 'Email marked verified.');
        break;
      }
      default:
        flash(reply, 'error', 'Unknown action.');
    }
    return reply.redirect(back);
  });

  // ---- sites ----
  app.get('/admin/sites', opts, async (req, reply) => {
    const search = String(req.query.q ?? '').trim().slice(0, 100);
    const status = String(req.query.status ?? '');
    const sort = ['storage', 'traffic', 'updated', 'created'].includes(req.query.sort) ? req.query.sort : 'created';
    let sql = `SELECT s.*, u.email, u.status AS owner_status, u.plan_id,
      (SELECT COALESCE(SUM(bytes),0) FROM site_traffic_daily t WHERE t.site_id = s.id AND t.day >= date('now','-30 days')) AS bytes30,
      (SELECT COALESCE(SUM(requests),0) FROM site_traffic_daily t WHERE t.site_id = s.id AND t.day >= date('now','-30 days')) AS req30
      FROM sites s JOIN users u ON u.id = s.user_id WHERE s.status != 'deleted'`;
    const args = [];
    if (search) { sql += ' AND (s.subdomain LIKE ? OR u.email LIKE ? OR s.id = ?)'; args.push(`%${search}%`, `%${search}%`, search); }
    if (status) { sql += ' AND s.status = ?'; args.push(status); }
    sql += { storage: ' ORDER BY s.total_storage_bytes DESC', traffic: ' ORDER BY bytes30 DESC', updated: ' ORDER BY s.last_deployed_at DESC', created: ' ORDER BY s.created_at DESC' }[sort] + ' LIMIT 200';
    return render(req, reply, { title: 'Sites', active: 'sites', body: V.sitesList({ sites: all(sql, ...args), search, status, sort }) });
  });

  app.get('/admin/sites/:id', opts, async (req, reply) => {
    const site = getSiteById(String(req.params.id));
    if (!site) return reply.code(404).send('No such site');
    const owner = findUserById(site.user_id);
    const files = site.current_release_id ? listReleaseFiles(site.id, site.current_release_id) : [];
    const reports = all('SELECT * FROM abuse_reports WHERE site_id = ? ORDER BY created_at DESC', site.id);
    const auditRows = all("SELECT * FROM audit_log WHERE target_type = 'site' AND target_id = ? ORDER BY at DESC LIMIT 40", site.id);
    return render(req, reply, { title: site.subdomain, active: 'sites', body: V.siteDetail({ site, owner, ent: owner ? entitlementsFor(owner) : null, files, releases: listReleases(site.id), traffic: trafficForSite(site.id, 30), reports, auditRows, csrf: csrfTokenFor(req), url: publicUrlForSubdomain(site.subdomain) }) });
  });

  app.post('/admin/sites/:id/action', opts, async (req, reply) => {
    const site = getSiteById(String(req.params.id));
    if (!site) return reply.code(404).send('No such site');
    const b = req.body ?? {};
    const action = String(b.action ?? '');
    let back = `/admin/sites/${site.id}`;
    switch (action) {
      case 'suspend':
        setSiteStatus(site.id, 'suspended', String(b.reason ?? '').slice(0, 300));
        audit({ req, action: 'admin.site.suspend', targetType: 'site', targetId: site.id, details: { reason: b.reason }, severity: 'warn' });
        flash(reply, 'success', 'Site suspended.');
        break;
      case 'unsuspend':
        setSiteStatus(site.id, site.current_release_id ? 'live' : 'empty', '');
        audit({ req, action: 'admin.site.unsuspend', targetType: 'site', targetId: site.id });
        flash(reply, 'success', 'Site restored.');
        break;
      case 'branding':
        setSiteBranding(site.id, b.value === 'removed');
        audit({ req, action: 'admin.site.branding', targetType: 'site', targetId: site.id, details: { removed: b.value === 'removed' } });
        flash(reply, 'success', b.value === 'removed' ? 'Badge removed for this site.' : 'Badge restored for this site.');
        break;
      case 'rename': {
        const r = renameSubdomain(site.id, String(b.subdomain ?? ''));
        if (!r.ok) flash(reply, 'error', r.reason);
        else { audit({ req, action: 'admin.site.rename', targetType: 'site', targetId: site.id, details: { from: site.subdomain, to: r.subdomain }, severity: 'warn' }); flash(reply, 'success', `Renamed to ${r.subdomain}.`); }
        break;
      }
      case 'transfer': {
        const target = findUserByEmail(String(b.email ?? ''));
        if (!target) { flash(reply, 'error', 'No user with that email.'); break; }
        db().prepare('UPDATE sites SET user_id = ?, updated_at = ? WHERE id = ?').run(target.id, nowIso(), site.id);
        audit({ req, action: 'admin.site.transfer', targetType: 'site', targetId: site.id, details: { from: site.user_id, to: target.id }, severity: 'warn' });
        flash(reply, 'success', `Transferred to ${target.email}.`);
        break;
      }
      case 'delete':
        deleteSite(site.id);
        audit({ req, action: 'admin.site.delete', targetType: 'site', targetId: site.id, details: { subdomain: site.subdomain, owner: site.user_id }, severity: 'alert' });
        flash(reply, 'success', `Deleted ${site.subdomain}.`);
        back = '/admin/sites';
        break;
      case 'reserve_and_delete':
        addReserved(site.subdomain, `reclaimed ${nowIso().slice(0, 10)}`);
        deleteSite(site.id);
        audit({ req, action: 'admin.site.reclaim', targetType: 'site', targetId: site.id, details: { subdomain: site.subdomain }, severity: 'alert' });
        flash(reply, 'success', `Reclaimed ${site.subdomain}: deleted and reserved.`);
        back = '/admin/sites';
        break;
      default:
        flash(reply, 'error', 'Unknown action.');
    }
    return reply.redirect(back);
  });

  // ---- plans ----
  app.get('/admin/plans', opts, async (req, reply) => {
    const counts = Object.fromEntries(all('SELECT plan_id, COUNT(*) n FROM users GROUP BY plan_id').map((r) => [r.plan_id, r.n]));
    return render(req, reply, { title: 'Plans', active: 'plans', body: V.plansPage({ plans: listPlans(), counts, csrf: csrfTokenFor(req), editing: req.query.edit ? getPlan(String(req.query.edit)) : null }) });
  });

  app.post('/admin/plans', opts, async (req, reply) => {
    const b = req.body ?? {};
    const id = String(b.id ?? '').trim().toLowerCase();
    if (!/^[a-z0-9-]{2,30}$/.test(id)) { flash(reply, 'error', 'Plan id: lowercase letters, numbers, hyphens.'); return reply.redirect('/admin/plans'); }
    const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
    upsertPlan({
      id, name: String(b.name ?? id).slice(0, 60), description: String(b.description ?? '').slice(0, 300),
      price_cents_month: Math.round(num(b.price_sgd, 0) * 100), trial_days: b.trial_days ? Math.round(num(b.trial_days, 0)) || null : null,
      is_public: b.is_public === '1', is_default: b.is_default === '1', sort_order: Math.round(num(b.sort_order, 0)),
      limits: {
        max_sites: Math.round(num(b.max_sites, 1)), max_storage_bytes: Math.round(num(b.max_storage_mb, 100) * 1024 ** 2), max_file_bytes: Math.round(num(b.max_file_mb, 20) * 1024 ** 2),
        max_releases: Math.round(num(b.max_releases, 3)), max_bandwidth_bytes_month: Math.round(num(b.max_bandwidth_gb, 5) * 1024 ** 3),
      },
      features: { branding_removable: b.branding_removable === '1', custom_domains: b.custom_domains === '1', version_history: true, analytics: b.analytics === '1', priority_support: b.priority_support === '1' },
    });
    audit({ req, action: 'admin.plan.upsert', targetType: 'plan', targetId: id, severity: 'warn' });
    flash(reply, 'success', `Plan "${id}" saved.`);
    return reply.redirect('/admin/plans');
  });

  // ---- reserved names ----
  app.get('/admin/promo', opts, async (req, reply) => render(req, reply, { title: 'Promo codes', active: 'promo', body: V.promoPage({ codes: listPromoCodes(), plans: listPlans(), csrf: csrfTokenFor(req) }) }));
  app.post('/admin/promo', opts, async (req, reply) => {
    const b = req.body ?? {};
    if (b.action === 'delete') {
      deletePromoCode(String(b.code ?? ''));
      audit({ req, action: 'admin.promo.delete', targetType: 'promo', targetId: String(b.code ?? '') });
      flash(reply, 'success', 'Deleted.');
    } else {
      const days = Number(b.expires_days) || 0;
      const r = createPromoCode({ code: b.code, planId: String(b.plan_id ?? 'beta'), maxUses: b.max_uses, expiresAt: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null, note: b.note, actorId: req.user.id });
      audit({ req, action: 'admin.promo.create', targetType: 'promo', targetId: r.code ?? String(b.code ?? ''), details: { ok: r.ok, plan: b.plan_id } });
      flash(reply, r.ok ? 'success' : 'error', r.ok ? `Code ${r.code} created.` : r.reason);
    }
    return reply.redirect('/admin/promo');
  });

  app.get('/admin/reserved', opts, async (req, reply) => render(req, reply, { title: 'Reserved names', active: 'reserved', body: V.reservedPage({ names: listReserved(), csrf: csrfTokenFor(req) }) }));
  app.post('/admin/reserved', opts, async (req, reply) => {
    const b = req.body ?? {};
    if (b.action === 'remove') { removeReserved(String(b.name ?? '')); audit({ req, action: 'admin.reserved.remove', targetType: 'reserved', targetId: b.name }); flash(reply, 'success', 'Removed.'); }
    else {
      const names = String(b.names ?? '').split(/[\s,]+/).filter(Boolean).slice(0, 200);
      let n = 0;
      for (const name of names) if (addReserved(name, String(b.reason ?? 'admin').slice(0, 100))) n++;
      audit({ req, action: 'admin.reserved.add', targetType: 'reserved', targetId: names.join(','), details: { count: n } });
      flash(reply, 'success', `Reserved ${n} name${n === 1 ? '' : 's'}.`);
    }
    return reply.redirect('/admin/reserved');
  });

  // ---- abuse ----
  app.get('/admin/abuse', opts, async (req, reply) => {
    const status = String(req.query.status ?? 'open');
    const rows = status === 'all' ? all('SELECT * FROM abuse_reports ORDER BY created_at DESC LIMIT 200') : all('SELECT * FROM abuse_reports WHERE status = ? ORDER BY created_at DESC LIMIT 200', status);
    return render(req, reply, { title: 'Abuse reports', active: 'abuse', body: V.abusePage({ reports: rows, status, csrf: csrfTokenFor(req) }) });
  });
  app.post('/admin/abuse/:id', opts, async (req, reply) => {
    const b = req.body ?? {};
    const report = q('SELECT * FROM abuse_reports WHERE id = ?', String(req.params.id));
    if (!report) return reply.code(404).send('No such report');
    const status = ['open', 'reviewing', 'resolved', 'dismissed'].includes(b.status) ? b.status : report.status;
    db().prepare('UPDATE abuse_reports SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?')
      .run(status, String(b.resolution ?? '').slice(0, 1000), ['resolved', 'dismissed'].includes(status) ? nowIso() : null, report.id);
    if (b.suspend === '1' && report.site_id) {
      setSiteStatus(report.site_id, 'suspended', `Abuse report: ${report.category}`);
      audit({ req, action: 'admin.site.suspend', targetType: 'site', targetId: report.site_id, details: { via: 'abuse', report: report.id }, severity: 'warn' });
    }
    audit({ req, action: 'admin.abuse.update', targetType: 'abuse', targetId: report.id, details: { status } });
    flash(reply, 'success', 'Report updated.');
    return reply.redirect('/admin/abuse');
  });

  // ---- audit ----
  app.get('/admin/audit', opts, async (req, reply) => {
    const sev = String(req.query.severity ?? '');
    const search = String(req.query.q ?? '').trim().slice(0, 100);
    let sql = 'SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE 1=1';
    const args = [];
    if (sev) { sql += ' AND a.severity = ?'; args.push(sev); }
    if (search) { sql += ' AND (a.action LIKE ? OR a.target_id LIKE ? OR a.ip LIKE ? OR u.email LIKE ?)'; args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    sql += ' ORDER BY a.at DESC LIMIT 300';
    return render(req, reply, { title: 'Audit log', active: 'audit', body: V.auditPage({ rows: all(sql, ...args), sev, search }) });
  });

  // ---- health ----
  app.get('/admin/health', opts, async (req, reply) => {
    flushTraffic();
    const disk = diskUsage();
    const mem = process.memoryUsage();
    const top = all("SELECT s.subdomain, s.id, SUM(t.bytes) bytes, SUM(t.requests) requests FROM site_traffic_daily t JOIN sites s ON s.id = t.site_id WHERE t.day >= date('now','-7 days') GROUP BY s.id ORDER BY bytes DESC LIMIT 10");
    const bigSites = all("SELECT subdomain, id, total_storage_bytes FROM sites WHERE status != 'deleted' ORDER BY total_storage_bytes DESC LIMIT 10");
    const dbSize = q("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()").n;
    return render(req, reply, { title: 'System health', active: 'health', body: V.healthPage({
      version: config.version, node: process.version, uptimeSec: Math.round((Date.now() - startedAt) / 1000), disk, mem, load: os.loadavg(), cpus: os.cpus().length, totalMem: os.totalmem(), freeMem: os.freemem(),
      dataDir: config.dataDir, dbSize, top, bigSites, baseDomain: config.baseDomain, smtp: !!config.smtp.host, env: config.env,
      hosting: hostingEnabled() ? {
        tenantRoot: config.hostinger.tenantRoot, apiToken: !!config.hostinger.apiToken, username: config.hostinger.username,
        byState: all("SELECT hosting_state, COUNT(*) n FROM sites WHERE status != 'deleted' GROUP BY hosting_state"),
        errors: all("SELECT id, subdomain, hosting_error FROM sites WHERE hosting_state = 'error' ORDER BY updated_at DESC LIMIT 20"),
        orphans: listOrphanDirs(),
        envFile: envFileKeys(),
        csrf: csrfTokenFor(req),
      } : null,
      siteBytes: q("SELECT COALESCE(SUM(total_storage_bytes),0) n FROM sites WHERE status != 'deleted'").n,
      siteCount: q("SELECT COUNT(*) n FROM sites WHERE status != 'deleted'").n,
      releaseCount: q('SELECT COUNT(*) n FROM releases').n,
    }) });
  });

  app.post('/admin/health/sync', opts, async (req, reply) => {
    const r = await syncAll();
    audit({ req, action: 'hosting.sync_all', targetType: 'system', targetId: '-', details: r });
    flash(reply, r.errors ? 'error' : 'ok', `Sync done: ${r.provisioned ?? 0} provisioned, ${r.synced ?? 0} rebuilt, ${r.errors ?? 0} errors.`);
    return reply.redirect('/admin/health');
  });

  app.post('/admin/health/orphan', opts, async (req, reply) => {
    const name = String(req.body?.name ?? '');
    const ok = removeOrphanDir(name);
    audit({ req, action: 'hosting.orphan_removed', targetType: 'dir', targetId: name, details: { ok } });
    flash(reply, ok ? 'ok' : 'error', ok ? `Removed ${name}.` : 'Not an orphan folder.');
    return reply.redirect('/admin/health');
  });
}
