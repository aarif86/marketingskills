import { html, formatBytes, formatDate, timeAgo } from '../../lib/html.js';
import { config } from '../../config.js';

const pill = (s) => html`<span class="pill pill-${s}">${s}</span>`;
const stat = (label, value, sub = '') => html`<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? html`<div class="muted small">${sub}</div>` : ''}</div>`;
const hidden = (csrf, extra = {}) => html`<input type="hidden" name="_csrf" value="${csrf}">${Object.entries(extra).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}`;

export function overview({ stats, alerts, recentUsers, recentDeploys, extensions, upgrades, csrf }) {
  return html`<h1>Overview</h1>
<div class="stats">
  ${stat('Users', stats.users, `${stats.usersActive} active · +${stats.usersNew7d} this week`)}
  ${stat('Sites', stats.sites, `${stats.live} live · ${stats.suspended} suspended`)}
  ${stat('Storage', formatBytes(stats.storage))}
  ${stat('Deploys (7d)', stats.deploys7d)}
  ${stat('Requests (7d)', stats.requests7d.toLocaleString(), formatBytes(stats.bytes7d) + ' served')}
  ${stat('Open abuse', stats.openAbuse)}
  ${stat('Plans expiring ≤14d', stats.expiringSoon, `${stats.expired} already expired`)}
</div>
<div class="grid two">
<div class="card"><h2>Extension requests (${extensions.length})</h2>
  ${extensions.length === 0 ? html`<p class="muted">None pending.</p>` : extensions.map((e) => html`
  <div class="row-between"><div><a href="/admin/users/${e.user_id}">${e.email}</a> <span class="muted small">${e.plan_id} · expires ${e.plan_expires_at ? e.plan_expires_at.slice(0, 10) : 'never'} · asked ${timeAgo(e.created_at)}</span><div class="muted small">${(JSON.parse(e.details || '{}').note) || ''}</div></div>
  <form method="post" action="/admin/users/${e.user_id}/action" class="inline">${hidden(csrf, { action: 'extend', days: 90, reason: 'extension request' })}<button class="btn btn-tiny btn-primary">+90 days</button></form></div>`)}
</div>
<div class="card"><h2>Upgrade requests (30d)</h2>
  ${upgrades.length === 0 ? html`<p class="muted">None.</p>` : upgrades.map((e) => html`<div class="row-between"><a href="/admin/users/${e.user_id}">${e.email}</a><span class="muted small">→ ${e.to_plan} · ${timeAgo(e.created_at)}</span></div>`)}
</div>
</div>
<div class="grid two">
<div class="card"><h2>Recent security events</h2>
  ${alerts.length === 0 ? html`<p class="muted">Quiet.</p>` : html`<table class="table small"><tbody>${alerts.map((a) => html`<tr><td>${pill(a.severity)}</td><td>${a.action}</td><td class="muted">${a.target_type} ${a.target_id.slice(0, 26)}</td><td class="muted">${a.ip}</td><td class="muted">${timeAgo(a.at)}</td></tr>`)}</tbody></table>`}
  <a href="/admin/audit" class="small">Full audit log →</a></div>
<div class="card"><h2>Recent deploys</h2>
  <table class="table small"><tbody>${recentDeploys.map((r) => html`<tr><td><a href="/admin/sites/${r.site_id}">${r.subdomain}</a></td><td>v${r.version} ${r.source}</td><td class="muted">${r.file_count} files · ${formatBytes(r.size_bytes)}</td><td class="muted">${timeAgo(r.created_at)}</td></tr>`)}</tbody></table>
  <h2 class="mt">New users</h2>
  <table class="table small"><tbody>${recentUsers.map((u) => html`<tr><td><a href="/admin/users/${u.id}">${u.email}</a></td><td>${u.plan_id}</td><td>${pill(u.status)}</td><td class="muted">${timeAgo(u.created_at)}</td></tr>`)}</tbody></table>
</div>
</div>`.toString();
}

export function usersList({ users, search, status, plan, plans }) {
  return html`<div class="page-head"><h1>Users <span class="muted">(${users.length})</span></h1></div>
<form class="filters" method="get"><input name="q" value="${search}" placeholder="email, name or id">
<select name="status"><option value="">any status</option>${['active', 'suspended', 'disabled', 'pending'].map((s) => html`<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`)}</select>
<select name="plan"><option value="">any plan</option>${plans.map((p) => html`<option value="${p.id}" ${plan === p.id ? 'selected' : ''}>${p.name}</option>`)}</select>
<button class="btn btn-ghost">Filter</button></form>
<table class="table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Plan</th><th>Expires</th><th>Sites</th><th>Storage</th><th>Last login</th><th>Joined</th></tr></thead><tbody>
${users.map((u) => html`<tr><td><a href="/admin/users/${u.id}">${u.email}</a>${u.email_verified_at ? '' : html` <span class="muted small" title="email not verified">✉?</span>`}</td><td>${u.name}</td><td>${u.role}</td><td>${pill(u.status)}</td><td>${u.plan_id}</td><td class="small">${u.plan_expires_at ? u.plan_expires_at.slice(0, 10) : '—'}</td><td>${u.site_count}</td><td>${formatBytes(u.storage)}</td><td class="muted small">${timeAgo(u.last_login_at)}</td><td class="muted small">${u.created_at.slice(0, 10)}</td></tr>`)}
</tbody></table>`.toString();
}

export function userDetail({ user, ent, sites, sessions, events, auditRows, plans, csrf, isLastAdmin }) {
  const act = (fields, label, cls = '', confirm = '') => html`<form method="post" action="/admin/users/${user.id}/action" class="inline" ${confirm ? html`data-confirm="${confirm}"` : ''}>${hidden(csrf, fields)}<button class="btn btn-tiny ${cls}">${label}</button></form>`;
  const o = ent.overrides;
  return html`<p class="crumb"><a href="/admin/users">Users</a> / ${user.email}</p>
<div class="page-head"><div><h1>${user.email} ${pill(user.status)} ${user.role === 'admin' ? pill('admin') : ''}</h1><p class="muted">${user.name || 'no name'} · id ${user.id} · joined ${formatDate(user.created_at)} · last login ${timeAgo(user.last_login_at)} from ${user.last_login_ip || '—'} · email ${user.email_verified_at ? 'verified' : 'NOT verified'}</p></div>
<div class="actions">
  ${user.status !== 'active' ? act({ action: 'activate' }, 'Activate', 'btn-primary') : ''}
  ${user.status === 'active' ? act({ action: 'suspend' }, 'Suspend', 'btn-danger', 'Suspend this user and take all their sites offline?') : ''}
  ${user.status !== 'disabled' ? act({ action: 'disable' }, 'Disable', 'btn-danger', 'Disable this account? They will not be able to log in.') : ''}
  ${act({ action: 'logout_all' }, 'Log out everywhere')}
  ${!user.email_verified_at ? act({ action: 'verify_email' }, 'Mark email verified') : ''}
  ${user.role === 'admin' ? (isLastAdmin ? '' : act({ action: 'role', role: 'user' }, 'Demote to user', 'btn-danger', 'Remove admin rights?')) : act({ action: 'role', role: 'admin' }, 'Make admin', 'btn-danger', 'Grant full admin rights to this user?')}
</div></div>

<div class="grid two">
<div class="card"><h2>Plan</h2>
  <p><strong>${ent.plan.name}</strong> (${ent.plan.id}) · started ${formatDate(user.plan_started_at)} · expires <strong>${ent.expiresAt ? formatDate(ent.expiresAt) : 'never'}</strong> ${ent.expired ? pill('expired') : ''}</p>
  <p class="muted small">Effective limits: ${ent.limits.max_sites} sites · ${formatBytes(ent.limits.max_storage_bytes)} · ${formatBytes(ent.limits.max_file_bytes)}/file · ${ent.limits.max_releases} versions · ${formatBytes(ent.limits.max_bandwidth_bytes_month)}/month · badge ${ent.brandingRemoved ? 'removed' : 'shown'}</p>
  <form method="post" action="/admin/users/${user.id}/action" class="form-inline">${hidden(csrf, { action: 'plan' })}<select name="plan_id">${plans.map((p) => html`<option value="${p.id}" ${p.id === user.plan_id ? 'selected' : ''}>${p.name} (${p.id})</option>`)}</select><button class="btn btn-tiny btn-primary">Set plan</button></form>
  <form method="post" action="/admin/users/${user.id}/action" class="form-inline">${hidden(csrf, { action: 'extend' })}<input name="days" type="number" value="90" min="1" max="3650" style="width:6em"> days<input name="reason" placeholder="reason"><button class="btn btn-tiny">Extend</button></form>
  ${ent.expiresAt ? act({ action: 'never_expire' }, 'Never expire') : ''}
</div>
<form method="post" action="/admin/users/${user.id}/action" class="card form">${hidden(csrf, { action: 'overrides' })}
  <h2>Per-user overrides</h2><p class="muted small">Blank = inherit from plan. These are how you give one person special treatment without a new plan.</p>
  <label>Badge <select name="branding_removed"><option value="">inherit (${ent.plan.features.branding_removable ? 'removable' : 'shown'})</option><option value="true" ${o.branding_removed === true ? 'selected' : ''}>removed</option><option value="false" ${o.branding_removed === false ? 'selected' : ''}>forced on</option></select></label>
  <div class="grid three tight">
    <label>Max sites <input name="max_sites" type="number" min="1" value="${o.max_sites ?? ''}" placeholder="${ent.plan.limits.max_sites}"></label>
    <label>Storage MB <input name="max_storage_mb" type="number" min="1" value="${o.max_storage_bytes ? Math.round(o.max_storage_bytes / 1024 ** 2) : ''}" placeholder="${Math.round(ent.plan.limits.max_storage_bytes / 1024 ** 2)}"></label>
    <label>File MB <input name="max_file_mb" type="number" min="1" value="${o.max_file_bytes ? Math.round(o.max_file_bytes / 1024 ** 2) : ''}" placeholder="${Math.round(ent.plan.limits.max_file_bytes / 1024 ** 2)}"></label>
    <label>Versions <input name="max_releases" type="number" min="1" value="${o.max_releases ?? ''}" placeholder="${ent.plan.limits.max_releases}"></label>
    <label>Bandwidth GB/mo <input name="max_bandwidth_gb" type="number" min="1" value="${o.max_bandwidth_bytes_month ? Math.round(o.max_bandwidth_bytes_month / 1024 ** 3) : ''}" placeholder="${Math.round(ent.plan.limits.max_bandwidth_bytes_month / 1024 ** 3)}"></label>
    <label>Custom domains <select name="custom_domains"><option value="">inherit</option><option value="true" ${o.custom_domains === true ? 'selected' : ''}>yes</option><option value="false" ${o.custom_domains === false ? 'selected' : ''}>no</option></select></label>
  </div>
  <button class="btn btn-primary btn-tiny">Save overrides</button>
</form>
</div>

<div class="card"><h2>Sites (${sites.length})</h2>
  <table class="table"><thead><tr><th>Subdomain</th><th>Status</th><th>Storage</th><th>Badge</th><th>Updated</th></tr></thead><tbody>
  ${sites.map((s) => html`<tr><td><a href="/admin/sites/${s.id}">${s.subdomain}</a></td><td>${pill(s.status)}</td><td>${formatBytes(s.total_storage_bytes)}</td><td>${s.branding_removed ? 'removed (site)' : ent.brandingRemoved ? 'removed (plan/user)' : 'shown'}</td><td class="muted small">${timeAgo(s.last_deployed_at)}</td></tr>`)}</tbody></table></div>

<div class="grid two">
<form method="post" action="/admin/users/${user.id}/action" class="card form">${hidden(csrf, { action: 'notes' })}<h2>Admin notes</h2><textarea name="notes" rows="4">${user.notes}</textarea><button class="btn btn-tiny">Save notes</button></form>
<div class="card"><h2>Sessions (${sessions.length})</h2><table class="table small"><tbody>${sessions.map((s) => html`<tr><td>${s.ip}</td><td class="muted">${s.user_agent.slice(0, 50)}</td><td class="muted">${timeAgo(s.last_seen_at)}</td></tr>`)}</tbody></table>
  <h2 class="mt">Plan history</h2><table class="table small"><tbody>${events.map((e) => html`<tr><td>${formatDate(e.created_at)}</td><td>${e.type}</td><td class="muted">${e.from_plan ?? ''}${e.to_plan ? ' → ' + e.to_plan : ''} ${e.details !== '{}' ? e.details : ''}</td></tr>`)}</tbody></table></div>
</div>
<div class="card"><h2>Audit trail</h2><table class="table small"><tbody>${auditRows.map((a) => html`<tr><td>${pill(a.severity)}</td><td>${a.action}</td><td class="muted">${a.target_type} ${a.target_id}</td><td class="muted">${a.details !== '{}' ? a.details : ''}</td><td class="muted">${a.ip}</td><td class="muted">${formatDate(a.at)}</td></tr>`)}</tbody></table></div>`.toString();
}

export function sitesList({ sites, search, status, sort }) {
  return html`<div class="page-head"><h1>Sites <span class="muted">(${sites.length})</span></h1></div>
<form class="filters" method="get"><input name="q" value="${search}" placeholder="subdomain, owner email or id">
<select name="status"><option value="">any status</option>${['empty', 'live', 'suspended'].map((s) => html`<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`)}</select>
<select name="sort">${[['created', 'newest'], ['updated', 'recently deployed'], ['storage', 'largest'], ['traffic', 'most traffic (30d)']].map(([k, l]) => html`<option value="${k}" ${sort === k ? 'selected' : ''}>${l}</option>`)}</select>
<button class="btn btn-ghost">Filter</button></form>
<table class="table"><thead><tr><th>Subdomain</th><th>Owner</th><th>Status</th><th>Plan</th><th>Storage</th><th>Traffic 30d</th><th>Badge</th><th>Updated</th><th>Created</th></tr></thead><tbody>
${sites.map((s) => html`<tr><td><a href="/admin/sites/${s.id}">${s.subdomain}</a> <a href="${config.publicScheme}://${s.subdomain}.${config.baseDomain}" target="_blank" rel="noopener" class="muted small">↗</a></td><td><a href="/admin/users/${s.user_id}">${s.email}</a> ${s.owner_status !== 'active' ? pill(s.owner_status) : ''}</td><td>${pill(s.status)}</td><td>${s.plan_id}</td><td>${formatBytes(s.total_storage_bytes)}</td><td>${s.req30.toLocaleString()} · ${formatBytes(s.bytes30)}</td><td>${s.branding_removed ? 'off' : 'on'}</td><td class="muted small">${timeAgo(s.last_deployed_at)}</td><td class="muted small">${s.created_at.slice(0, 10)}</td></tr>`)}
</tbody></table>`.toString();
}

export function siteDetail({ site, owner, ent, files, releases, traffic, reports, auditRows, csrf, url }) {
  const act = (fields, label, cls = '', confirm = '') => html`<form method="post" action="/admin/sites/${site.id}/action" class="inline" ${confirm ? html`data-confirm="${confirm}"` : ''}>${hidden(csrf, fields)}<button class="btn btn-tiny ${cls}">${label}</button></form>`;
  const reqs = traffic.reduce((a, t) => a + t.requests, 0);
  const bytes = traffic.reduce((a, t) => a + t.bytes, 0);
  return html`<p class="crumb"><a href="/admin/sites">Sites</a> / ${site.subdomain}</p>
<div class="page-head"><div><h1>${site.subdomain}<span class="muted">.${config.baseDomain}</span> ${pill(site.status)}</h1>
<p class="muted">${site.title} · owner <a href="/admin/users/${site.user_id}">${owner?.email ?? '?'}</a> (${owner?.plan_id ?? '?'}) · ${files.length} files · ${formatBytes(site.storage_bytes)} current / ${formatBytes(site.total_storage_bytes)} total · created ${formatDate(site.created_at)} · deployed ${timeAgo(site.last_deployed_at)}</p>
${site.status === 'suspended' ? html`<p class="flash flash-error">Suspended: ${site.suspended_reason || 'no reason recorded'}</p>` : ''}</div>
<div class="actions"><a class="btn btn-ghost" href="${url}" target="_blank" rel="noopener">Open ↗</a>
  ${site.status === 'suspended' ? act({ action: 'unsuspend' }, 'Unsuspend', 'btn-primary') : ''}
  ${site.branding_removed ? act({ action: 'branding', value: 'shown' }, 'Restore badge') : act({ action: 'branding', value: 'removed' }, 'Remove badge')}
</div></div>

<div class="grid two">
<div class="card"><h2>Moderation</h2>
  <form method="post" action="/admin/sites/${site.id}/action" class="form-inline">${hidden(csrf, { action: 'suspend' })}<input name="reason" placeholder="reason shown to owner" maxlength="300"><button class="btn btn-tiny btn-danger">Suspend</button></form>
  <form method="post" action="/admin/sites/${site.id}/action" class="form-inline">${hidden(csrf, { action: 'rename' })}<input name="subdomain" placeholder="new subdomain" maxlength="40"><button class="btn btn-tiny">Rename</button></form>
  <form method="post" action="/admin/sites/${site.id}/action" class="form-inline">${hidden(csrf, { action: 'transfer' })}<input name="email" placeholder="transfer to user email" type="email"><button class="btn btn-tiny">Transfer</button></form>
  <div class="row-gap">${act({ action: 'delete' }, 'Delete site', 'btn-danger', `Delete ${site.subdomain} and all its files? The name becomes available again.`)} ${act({ action: 'reserve_and_delete' }, 'Reclaim (delete + reserve name)', 'btn-danger', `Delete ${site.subdomain} AND reserve the name so nobody can take it?`)}</div>
  <p class="muted small">Badge state: site override ${site.branding_removed ? 'REMOVED' : 'none'} · owner entitlement ${ent?.brandingRemoved ? 'removed' : 'shown'} · effective: <strong>${site.branding_removed || ent?.brandingRemoved ? 'no badge' : 'badge shown'}</strong></p>
</div>
<div class="card"><h2>Traffic (30d)</h2><p><strong>${reqs.toLocaleString()}</strong> requests · <strong>${formatBytes(bytes)}</strong> · limit ${ent ? formatBytes(ent.limits.max_bandwidth_bytes_month) : '?'}/month</p>
  ${traffic.length ? html`<div class="spark">${traffic.map((t) => html`<i style="height:${Math.max(4, Math.min(100, (t.bytes / Math.max(1, Math.max(...traffic.map((x) => x.bytes)))) * 100))}%" title="${t.day}: ${t.requests} req, ${formatBytes(t.bytes)}"></i>`)}</div>` : html`<p class="muted small">No traffic.</p>`}
  <h2 class="mt">Abuse reports (${reports.length})</h2>${reports.map((r) => html`<div class="small">${pill(r.status)} ${r.category} · ${timeAgo(r.created_at)} · ${r.details.slice(0, 200)}</div>`)}
</div>
</div>

<div class="grid two">
<div class="card"><h2>Files (current)</h2><div class="file-list">${files.map((f) => html`<div class="file-row"><span class="file-path">${f.path}</span><span class="muted small">${formatBytes(f.size)}</span></div>`)}</div></div>
<div class="card"><h2>Releases</h2><table class="table small"><tbody>${releases.map((r) => html`<tr><td>v${r.version} ${r.id === site.current_release_id ? pill('live') : ''}</td><td>${r.source}</td><td class="muted">${r.note}</td><td class="muted">${r.file_count} · ${formatBytes(r.size_bytes)}</td><td class="muted">${formatDate(r.created_at)}</td></tr>`)}</tbody></table></div>
</div>
<div class="card"><h2>Audit trail</h2><table class="table small"><tbody>${auditRows.map((a) => html`<tr><td>${pill(a.severity)}</td><td>${a.action}</td><td class="muted">${a.details !== '{}' ? a.details : ''}</td><td class="muted">${a.ip}</td><td class="muted">${formatDate(a.at)}</td></tr>`)}</tbody></table></div>`.toString();
}

export function plansPage({ plans, counts, csrf, editing }) {
  const e = editing ?? { id: '', name: '', description: '', price_cents_month: 0, trial_days: null, is_public: true, is_default: false, sort_order: 50, limits: { max_sites: 1, max_storage_bytes: 100 * 1024 ** 2, max_file_bytes: 20 * 1024 ** 2, max_releases: 3, max_bandwidth_bytes_month: 5 * 1024 ** 3 }, features: {} };
  return html`<h1>Plans</h1>
<p class="muted">Plans are data. Create a “community”, “founding” or “agency” plan here and assign it per user — no code changes needed.</p>
<table class="table"><thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Trial</th><th>Public</th><th>Default</th><th>Sites</th><th>Storage</th><th>Versions</th><th>Badge</th><th>Custom domain</th><th>Users</th><th></th></tr></thead><tbody>
${plans.map((p) => html`<tr><td><code>${p.id}</code></td><td>${p.name}</td><td>${p.price_cents_month ? 'S$' + (p.price_cents_month / 100).toFixed(2) : 'free'}</td><td>${p.trial_days ? p.trial_days + 'd' : '∞'}</td><td>${p.is_public ? 'yes' : 'no'}</td><td>${p.is_default ? '★' : ''}</td><td>${p.limits.max_sites}</td><td>${formatBytes(p.limits.max_storage_bytes)}</td><td>${p.limits.max_releases}</td><td>${p.features.branding_removable ? 'removable' : 'shown'}</td><td>${p.features.custom_domains ? 'yes' : 'no'}</td><td>${counts[p.id] ?? 0}</td><td><a href="/admin/plans?edit=${p.id}" class="btn btn-tiny">Edit</a></td></tr>`)}
</tbody></table>
<form method="post" action="/admin/plans" class="card form">${hidden(csrf)}
  <h2>${editing ? `Edit “${editing.id}”` : 'New plan'}</h2>
  <div class="grid three tight">
    <label>ID <input name="id" value="${e.id}" required pattern="[a-z0-9-]{2,30}" ${editing ? 'readonly' : ''}></label>
    <label>Name <input name="name" value="${e.name}" required></label>
    <label>Sort order <input name="sort_order" type="number" value="${e.sort_order}"></label>
  </div>
  <label>Description <input name="description" value="${e.description}" maxlength="300"></label>
  <div class="grid three tight">
    <label>Price SGD / month <input name="price_sgd" type="number" step="0.01" min="0" value="${(e.price_cents_month / 100).toFixed(2)}"></label>
    <label>Trial days (blank = never expires) <input name="trial_days" type="number" min="0" value="${e.trial_days ?? ''}"></label>
    <label>Max sites <input name="max_sites" type="number" min="1" value="${e.limits.max_sites}"></label>
    <label>Storage MB <input name="max_storage_mb" type="number" min="1" value="${Math.round(e.limits.max_storage_bytes / 1024 ** 2)}"></label>
    <label>Max file MB <input name="max_file_mb" type="number" min="1" value="${Math.round(e.limits.max_file_bytes / 1024 ** 2)}"></label>
    <label>Versions kept <input name="max_releases" type="number" min="1" value="${e.limits.max_releases}"></label>
    <label>Bandwidth GB / month <input name="max_bandwidth_gb" type="number" min="1" value="${Math.round(e.limits.max_bandwidth_bytes_month / 1024 ** 3)}"></label>
  </div>
  <div class="checks">
    <label class="check"><input type="checkbox" name="is_public" value="1" ${e.is_public ? 'checked' : ''}> Shown on pricing page</label>
    <label class="check"><input type="checkbox" name="is_default" value="1" ${e.is_default ? 'checked' : ''}> Default for new signups</label>
    <label class="check"><input type="checkbox" name="branding_removable" value="1" ${e.features.branding_removable ? 'checked' : ''}> Badge removed</label>
    <label class="check"><input type="checkbox" name="custom_domains" value="1" ${e.features.custom_domains ? 'checked' : ''}> Custom domains</label>
    <label class="check"><input type="checkbox" name="analytics" value="1" ${e.features.analytics ? 'checked' : ''}> Analytics</label>
    <label class="check"><input type="checkbox" name="priority_support" value="1" ${e.features.priority_support ? 'checked' : ''}> Priority support</label>
  </div>
  <button class="btn btn-primary">Save plan</button> ${editing ? html`<a class="btn btn-ghost" href="/admin/plans">Cancel</a>` : ''}
</form>`.toString();
}

export function reservedPage({ names, csrf }) {
  return html`<h1>Reserved names <span class="muted">(${names.length})</span></h1>
<form method="post" action="/admin/reserved" class="card form">${hidden(csrf, { action: 'add' })}
  <label>Add names (space or comma separated) <textarea name="names" rows="2" placeholder="brandname anotherone"></textarea></label>
  <label>Reason <input name="reason" placeholder="trademark / partner / abuse" maxlength="100"></label>
  <button class="btn btn-primary btn-tiny">Reserve</button></form>
<div class="card"><div class="chips">${names.map((n) => html`<form method="post" action="/admin/reserved" class="chip">${hidden(csrf, { action: 'remove', name: n.name })}<span title="${n.reason}">${n.name}</span>${n.reason === 'system' ? '' : html`<button aria-label="remove ${n.name}">✕</button>`}</form>`)}</div></div>`.toString();
}

export function abusePage({ reports, status, csrf }) {
  return html`<div class="page-head"><h1>Abuse reports</h1>
<nav class="tabs">${['open', 'reviewing', 'resolved', 'dismissed', 'all'].map((s) => html`<a href="/admin/abuse?status=${s}" class="${status === s ? 'active' : ''}">${s}</a>`)}</nav></div>
${reports.length === 0 ? html`<p class="muted">Nothing here.</p>` : reports.map((r) => html`
<div class="card"><div class="row-between"><div><strong>${r.subdomain}.${config.baseDomain}</strong> ${pill(r.status)} <span class="pill">${r.category}</span> <span class="muted small">${formatDate(r.created_at)} · from ${r.reporter_email || 'anonymous'} · ${r.ip}</span></div>
  ${r.site_id ? html`<a class="btn btn-tiny" href="/admin/sites/${r.site_id}">Open site</a>` : html`<span class="muted small">site not found / deleted</span>`}</div>
  <p>${r.details}</p>
  ${r.resolution ? html`<p class="muted small">Resolution: ${r.resolution}</p>` : ''}
  <form method="post" action="/admin/abuse/${r.id}" class="form-inline">${hidden(csrf)}
    <select name="status">${['open', 'reviewing', 'resolved', 'dismissed'].map((s) => html`<option value="${s}" ${r.status === s ? 'selected' : ''}>${s}</option>`)}</select>
    <input name="resolution" placeholder="resolution note" value="${r.resolution}" maxlength="1000">
    ${r.site_id ? html`<label class="check small"><input type="checkbox" name="suspend" value="1"> suspend site</label>` : ''}
    <button class="btn btn-tiny btn-primary">Update</button></form></div>`)}`.toString();
}

export function auditPage({ rows, sev, search }) {
  return html`<h1>Audit log</h1>
<form class="filters" method="get"><input name="q" value="${search}" placeholder="action, target, ip, email">
<select name="severity"><option value="">any severity</option>${['info', 'warn', 'alert'].map((s) => html`<option value="${s}" ${sev === s ? 'selected' : ''}>${s}</option>`)}</select><button class="btn btn-ghost">Filter</button></form>
<table class="table small"><thead><tr><th>When</th><th>Sev</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th><th>IP</th></tr></thead><tbody>
${rows.map((a) => html`<tr><td class="muted">${formatDate(a.at)}</td><td>${pill(a.severity)}</td><td>${a.action}</td><td>${a.email ? html`<a href="/admin/users/${a.actor_id}">${a.email}</a>` : html`<span class="muted">${a.actor_id ?? 'anon'}</span>`}</td><td class="muted">${a.target_type} ${a.target_id}</td><td class="muted">${a.details !== '{}' ? a.details : ''}</td><td class="muted">${a.ip}</td></tr>`)}
</tbody></table>`.toString();
}

export function healthPage(h) {
  const pct = h.disk.totalBytes ? Math.round(((h.disk.totalBytes - h.disk.freeBytes) / h.disk.totalBytes) * 100) : 0;
  return html`<h1>System health</h1>
<div class="stats">
  ${stat('Version', h.version, `Node ${h.node} · ${h.env}`)}
  ${stat('Uptime', `${Math.floor(h.uptimeSec / 3600)}h ${Math.floor((h.uptimeSec % 3600) / 60)}m`)}
  ${stat('Disk used', `${pct}%`, `${formatBytes(h.disk.freeBytes)} free of ${formatBytes(h.disk.totalBytes)}`)}
  ${stat('Process RSS', formatBytes(h.mem.rss), `heap ${formatBytes(h.mem.heapUsed)}`)}
  ${stat('System memory', formatBytes(h.totalMem - h.freeMem), `of ${formatBytes(h.totalMem)}`)}
  ${stat('Load (1/5/15)', h.load.map((l) => l.toFixed(2)).join(' / '), `${h.cpus} CPU`)}
  ${stat('Database', formatBytes(h.dbSize), h.dataDir)}
  ${stat('Email', h.smtp ? 'SMTP configured' : 'console only', h.smtp ? '' : 'set SMTP_* in .env')}
</div>
${pct > 85 ? html`<div class="flash flash-error">Disk is ${pct}% full. Prune releases (node src/cli.js prune) or grow the volume.</div>` : ''}
<div class="grid two">
<div class="card"><h2>Top bandwidth (7d)</h2><table class="table small"><tbody>${h.top.map((t) => html`<tr><td><a href="/admin/sites/${t.id}">${t.subdomain}</a></td><td>${t.requests.toLocaleString()} req</td><td>${formatBytes(t.bytes)}</td></tr>`)}</tbody></table></div>
<div class="card"><h2>Largest sites</h2><table class="table small"><tbody>${h.bigSites.map((s) => html`<tr><td><a href="/admin/sites/${s.id}">${s.subdomain}</a></td><td>${formatBytes(s.total_storage_bytes)}</td></tr>`)}</tbody></table></div>
</div>
${h.hosting ? html`<div class="card"><h2>Hostinger publisher</h2>
<p>Tenant sites are served by LiteSpeed from <code>${h.hosting.tenantRoot}/&lt;name&gt;</code>; this app rebuilds each folder on every change. API token: <strong>${h.hosting.apiToken ? 'set' : 'MISSING — subdomains will not be created'}</strong> · account <code>${h.hosting.username || '?'}</code>.</p>
<p>${h.hosting.byState.map((r) => html`<span class="badge">${r.hosting_state}: ${r.n}</span> `)}</p>
${h.hosting.errors.length ? html`<table class="table small"><tbody>${h.hosting.errors.map((e) => html`<tr><td><a href="/admin/sites/${e.id}">${e.subdomain}</a></td><td>${e.hosting_error}</td></tr>`)}</tbody></table>` : ''}
${h.hosting.orphans.length ? html`<p class="muted">Orphan folders in tenant root: <code>${h.hosting.orphans.join(', ')}</code></p>` : ''}
<p class="muted">Retry: <code>node src/cli.js sync-all</code> (also run by the hourly cron).</p></div>` : ''}
<div class="card"><h2>Checks</h2><ul class="plain">
  <li>Platform hosts: <code>${config.platformHosts.join(', ')}</code> · tenants: <code>*.${h.baseDomain}</code></li>
  <li>Health endpoint: <code>GET /healthz</code> (use for uptime monitoring)</li>
  <li>Backups: see <code>deploy/scripts/backup.sh</code> — verify the latest archive exists off-box.</li>
</ul></div>`.toString();
}
