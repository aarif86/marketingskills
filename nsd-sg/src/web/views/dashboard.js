import { html, formatBytes, formatDate, timeAgo } from '../../lib/html.js';
import { config, publicUrlForSubdomain } from '../../config.js';

const statusPill = (s) => html`<span class="pill pill-${s}">${s}</span>`;

function planBanner(ent) {
  if (ent.expired) return html`<div class="flash flash-error">Your <strong>${ent.plan.name}</strong> plan expired on ${formatDate(ent.expiresAt)}. Your sites stay online for now, but publishing is paused. <a href="/billing">Request an extension or upgrade →</a></div>`;
  if (ent.daysLeft !== null && ent.daysLeft <= 14) return html`<div class="flash flash-warn">Your free period ends in <strong>${ent.daysLeft} day${ent.daysLeft === 1 ? '' : 's'}</strong>. <a href="/billing">Extend for free or upgrade →</a></div>`;
  return '';
}

export function sitesIndex({ sites, ent, storageUsed, user }) {
  return html`
${planBanner(ent)}
${!user.email_verified_at ? html`<div class="flash flash-warn">Please confirm your email address. <a href="/account">Resend the link from your account page →</a></div>` : ''}
<div class="page-head"><div><h1>Your sites</h1><p class="muted">${sites.length} of ${ent.limits.max_sites} · ${formatBytes(storageUsed)} of ${formatBytes(ent.limits.max_storage_bytes)} used · ${ent.plan.name} plan</p></div>
${sites.length < ent.limits.max_sites && !ent.expired ? html`<a class="btn btn-primary" href="/sites/new">+ New site</a>` : ''}</div>
${sites.length === 0 ? html`<div class="card empty"><h3>No sites yet</h3><p>Claim your <strong>name.${config.baseDomain}</strong> address and upload the website you generated.</p><a class="btn btn-primary" href="/sites/new">Create your first site</a></div>` : ''}
<div class="site-list">${sites.map((s) => html`
<a class="card site-row" href="/sites/${s.id}">
  <div><div class="site-name">${s.subdomain}<span class="muted">.${config.baseDomain}</span></div><div class="muted small">${s.title}</div></div>
  <div>${statusPill(s.status)}</div>
  <div class="muted small">${s.last_deployed_at ? `Updated ${timeAgo(s.last_deployed_at)}` : 'Nothing published'}</div>
  <div class="muted small">${formatBytes(s.storage_bytes)}</div>
</a>`)}</div>`.toString();
}

export function newSite({ csrf, ent, count }) {
  if (count >= ent.limits.max_sites) {
    return html`<h1>New site</h1><div class="card"><p>Your ${ent.plan.name} plan allows ${ent.limits.max_sites} site${ent.limits.max_sites === 1 ? '' : 's'}.</p><a class="btn btn-primary" href="/billing">See plans</a></div>`.toString();
  }
  return html`<h1>New site</h1>
<form method="post" action="/sites" class="form card">
  <input type="hidden" name="_csrf" value="${csrf}">
  <label>Site address <div class="domain-input"><input name="subdomain" required maxlength="40" placeholder="yourname" autocomplete="off" spellcheck="false" data-availability autofocus><span>.${config.baseDomain}</span></div><small data-availability-msg>3–40 characters: letters, numbers, hyphens.</small></label>
  <label>Title <span class="muted">(only shown in your dashboard)</span><input name="title" maxlength="100" placeholder="My portfolio"></label>
  <button class="btn btn-primary" type="submit">Create site</button>
</form>`.toString();
}

export function siteDetail({ site, ent, files, releases, traffic, monthBytes, csrf, url }) {
  const reqs = traffic.reduce((a, t) => a + t.requests, 0);
  const brandingOn = !(site.branding_removed || ent.brandingRemoved);
  return html`
${planBanner(ent)}
<div class="page-head">
  <div><p class="crumb"><a href="/dashboard">Sites</a> / ${site.subdomain}</p>
  <h1>${site.subdomain}<span class="muted">.${config.baseDomain}</span> ${statusPill(site.status)}</h1>
  <p class="muted">${site.title} · ${files.length} files · ${formatBytes(site.storage_bytes)} · ${site.last_deployed_at ? `updated ${timeAgo(site.last_deployed_at)}` : 'nothing published yet'}</p></div>
  <div class="actions">${site.status === 'live' ? html`<a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Open site ↗</a>` : ''}<a class="btn btn-ghost" href="/sites/${site.id}/settings">Settings</a></div>
</div>
${site.status === 'suspended' ? html`<div class="flash flash-error"><strong>This site is suspended.</strong> ${site.suspended_reason || 'Contact support for details.'}</div>` : ''}
${site.status !== 'suspended' ? html`<section class="card steps-card"><h2>${site.current_release_id ? 'Your site is live' : 'Three steps to go live'}</h2>
<ol class="steps">
  <li class="done"><strong>Claim your address</strong><span class="muted">${site.subdomain}.${config.baseDomain} is yours.</span></li>
  <li class="${site.current_release_id ? 'done' : 'now'}"><strong>Publish your files</strong><span class="muted">Drop a ZIP or your HTML/CSS/image files below. Every upload is a new version you can roll back to.</span></li>
  <li class="${site.current_release_id ? 'now' : ''}"><strong>Open and share it</strong><span class="muted">${site.current_release_id ? html`<a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">Open ${site.subdomain}.${config.baseDomain} ↗</a>` : 'The Open button appears here once something is published.'}</span></li>
</ol>
${Date.now() - new Date(site.created_at).getTime() < 45 * 60_000 ? html`<p class="notice"><strong>New address:</strong> the security certificate for <code>${site.subdomain}.${config.baseDomain}</code> can take 5–15 minutes to be issued. If your browser shows a connection or SSL error, wait a little and refresh — nothing is wrong.</p>` : ''}
</section>` : ''}

<section class="card upload-card" id="upload">
  <h2>${site.current_release_id ? 'Publish a new version' : 'Publish your site'}</h2>
  <p class="muted">Drop a <strong>ZIP</strong> of your whole website (replaces everything), or drop individual files and folders (added to the current version). Max ${formatBytes(ent.limits.max_file_bytes)} per file, ${formatBytes(ent.limits.max_storage_bytes)} per site.</p>
  <form method="post" action="/sites/${site.id}/upload" enctype="multipart/form-data" class="dropzone" data-dropzone ${ent.expired || site.status === 'suspended' ? 'data-disabled' : ''}>
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="mode" value="merge" data-mode>
    <div class="dz-inner">
      <p class="dz-title">Drag &amp; drop your ZIP or files here</p>
      <p class="muted">or</p>
      <div class="dz-buttons">
        <label class="btn btn-primary">Choose ZIP<input type="file" name="files" accept=".zip,application/zip" hidden data-pick="zip"></label>
        <label class="btn btn-ghost">Choose files<input type="file" name="files" multiple hidden data-pick="files"></label>
        <label class="btn btn-ghost">Choose folder<input type="file" name="files" webkitdirectory multiple hidden data-pick="folder"></label>
      </div>
      <p class="muted small">Your site needs an <code>index.html</code> at the top level. HTML, CSS, JS, images, fonts, video and PDF are accepted; scripts that run on a server (PHP etc.) are not.</p>
    </div>
    <div class="dz-progress" hidden><div class="bar"><span></span></div><p class="dz-status">Uploading…</p></div>
    <noscript><button class="btn btn-primary" type="submit">Upload</button></noscript>
  </form>
</section>

<div class="grid two">
<section class="card">
  <h2>Files <span class="muted small">(current version)</span></h2>
  ${files.length === 0 ? html`<p class="muted">No files yet.</p>` : html`
  <div class="file-list">${files.map((f) => html`
    <div class="file-row">
      <a href="/sites/${site.id}/files/view?path=${encodeURIComponent(f.path)}" target="_blank" rel="noopener" title="View file" class="file-path">${f.path}</a>
      <span class="muted small">${formatBytes(f.size)}</span>
      <form method="post" action="/sites/${site.id}/files/delete" class="inline" data-confirm="Delete ${f.path}? A new version without it will be published.">
        <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="path" value="${f.path}">
        <button class="btn btn-tiny btn-danger" type="submit" aria-label="Delete ${f.path}">✕</button></form>
    </div>`)}</div>`}
  ${!files.some((f) => f.path === 'index.html') && files.length ? html`<p class="flash flash-warn">There is no <code>index.html</code> at the top level, so visitors will see “page not found” at the root.</p>` : ''}
</section>

<section class="card">
  <h2>Versions</h2>
  ${releases.length === 0 ? html`<p class="muted">Every publish is kept here so you can roll back.</p>` : html`
  <div class="release-list">${releases.map((r) => html`
    <div class="release-row ${r.id === site.current_release_id ? 'current' : ''}">
      <div><strong>v${r.version}</strong> <span class="muted small">${r.source}</span>${r.id === site.current_release_id ? html` <span class="pill pill-live">live</span>` : ''}
        <div class="muted small">${r.note} · ${r.file_count} files · ${formatBytes(r.size_bytes)} · ${formatDate(r.created_at)}</div></div>
      ${r.id !== site.current_release_id ? html`<form method="post" action="/sites/${site.id}/rollback" class="inline" data-confirm="Make version ${r.version} live again?"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="release_id" value="${r.id}"><button class="btn btn-tiny" type="submit">Restore</button></form>` : ''}
    </div>`)}</div>
  <p class="muted small">Your plan keeps the last ${ent.limits.max_releases} versions.</p>`}
</section>
</div>

<div class="grid two">
<section class="card"><h2>Traffic (30 days)</h2><p><strong>${reqs.toLocaleString()}</strong> requests · <strong>${formatBytes(monthBytes)}</strong> served this month of ${formatBytes(ent.limits.max_bandwidth_bytes_month)}</p>
  ${traffic.length ? html`<div class="spark">${traffic.map((t) => html`<i style="height:${Math.max(4, Math.min(100, (t.requests / Math.max(1, Math.max(...traffic.map((x) => x.requests)))) * 100))}%" title="${t.day}: ${t.requests} requests"></i>`)}</div>` : html`<p class="muted small">No visits recorded yet.</p>`}
</section>
<section class="card"><h2>Branding</h2>
  ${brandingOn ? html`<p>This site shows the <strong>“${config.branding.text}”</strong> badge. It is added when pages are served, so editing your HTML will not remove it.</p><a class="btn btn-ghost" href="/billing">Remove it with Plus →</a>` : html`<p>No badge is shown on this site.</p>`}
</section>
</div>`.toString();
}

export function siteSettings({ site, csrf, ent }) {
  return html`<p class="crumb"><a href="/dashboard">Sites</a> / <a href="/sites/${site.id}">${site.subdomain}</a> / Settings</p>
<h1>Settings</h1>
<form method="post" action="/sites/${site.id}/settings" class="form card">
  <input type="hidden" name="_csrf" value="${csrf}">
  <label>Address <div class="domain-input"><input value="${site.subdomain}" disabled><span>.${config.baseDomain}</span></div><small>Addresses cannot be renamed. Create a new site for a different name.</small></label>
  <label>Title <input name="title" value="${site.title}" maxlength="100"></label>
  <label class="check"><input type="checkbox" name="allow_framing" value="1" ${site.allow_framing ? 'checked' : ''}> Allow other websites to embed this site in an iframe <small>(off by default to prevent click-jacking)</small></label>
  ${(ent.features.hide_from_showcase ?? ent.features.branding_removable) ? html`<label class="check"><input type="checkbox" name="listed" value="1" ${site.listed ? 'checked' : ''}> List this site on the public <a href="/showcase">showcase</a> <small>(untick to keep it off the list)</small></label>` : html`<p class="muted small">Live sites on the free plan appear on the public <a href="/showcase">showcase</a>. Plus lets you hide yours.</p>`}
  <button class="btn btn-primary" type="submit">Save</button>
</form>
${ent.features.custom_domains ? html`<div class="card"><h2>Custom domain</h2><p class="muted">Bring your own domain (an add-on — the domain itself is bought separately from any registrar, ~S$20–60/yr for .sg). Connecting it is done by hand for now — email <a href="mailto:hello@${config.baseDomain}">hello@${config.baseDomain}</a> and we will set it up for you today.</p></div>` : ''}
<div class="card danger">
  <h2>Delete this site</h2>
  <p class="muted">Removes all files and versions. The address becomes available to anyone.</p>
  <form method="post" action="/sites/${site.id}/delete" class="form-inline">
    <input type="hidden" name="_csrf" value="${csrf}">
    <input name="confirm" placeholder="type ${site.subdomain} to confirm" required autocomplete="off">
    <button class="btn btn-danger" type="submit">Delete site</button>
  </form>
</div>`.toString();
}

export function accountPage({ user, sessions, csrf }) {
  return html`<h1>Account</h1>
<div class="grid two">
<form method="post" action="/account/profile" class="form card"><input type="hidden" name="_csrf" value="${csrf}">
  <h2>Profile</h2>
  <label>Name <input name="name" value="${user.name}" maxlength="80"></label>
  <label>Email <input value="${user.email}" disabled> ${user.email_verified_at ? html`<small class="ok">Confirmed</small>` : html`<small class="warn">Not confirmed</small>`}</label>
  <button class="btn btn-primary" type="submit">Save</button>
  ${!user.email_verified_at ? html`<button class="btn btn-ghost" type="submit" formaction="/resend-verification">Resend confirmation</button>` : ''}
</form>
<form method="post" action="/account/password" class="form card"><input type="hidden" name="_csrf" value="${csrf}">
  <h2>Password</h2>
  <label>Current password <input type="password" name="current" required autocomplete="current-password"></label>
  <label>New password <input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
  <button class="btn btn-primary" type="submit">Change password</button>
</form>
</div>
<div class="card"><h2>Sessions</h2>
  <table class="table"><thead><tr><th>IP</th><th>Browser</th><th>Started</th><th>Last seen</th></tr></thead><tbody>
  ${sessions.map((s) => html`<tr><td>${s.ip}</td><td class="muted small">${s.user_agent.slice(0, 60)}</td><td>${formatDate(s.created_at)}</td><td>${timeAgo(s.last_seen_at)}</td></tr>`)}</tbody></table>
  <form method="post" action="/account/sessions/revoke" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost" type="submit">Sign out everywhere</button></form>
</div>
<div class="card"><h2>Account status</h2><p>${user.status} · ${user.role} · member since ${formatDate(user.created_at)}</p></div>
${user.role !== 'admin' ? html`<div class="card danger"><h2>Delete account</h2><p class="muted">Deletes all your sites and disables your account.</p>
<form method="post" action="/account/delete" class="form-inline"><input type="hidden" name="_csrf" value="${csrf}">
<input type="password" name="password" placeholder="password" required><input name="confirm" placeholder="type DELETE" required autocomplete="off"><button class="btn btn-danger" type="submit">Delete my account</button></form></div>` : ''}`.toString();
}

export function billingPage({ user, ent, plans, events, storageUsed, siteCount, csrf }) {
  const pct = Math.min(100, Math.round((storageUsed / ent.limits.max_storage_bytes) * 100));
  return html`<h1>Plan &amp; billing</h1>
${planBanner(ent)}
<div class="grid two">
<div class="card"><h2>Current plan: ${ent.plan.name}</h2>
  <p>${ent.plan.description}</p>
  <ul class="plain">
    <li>Sites: <strong>${siteCount} / ${ent.limits.max_sites}</strong></li>
    <li>Storage: <strong>${formatBytes(storageUsed)} / ${formatBytes(ent.limits.max_storage_bytes)}</strong><div class="meter"><span style="width:${pct}%"></span></div></li>
    <li>Versions kept: <strong>${ent.limits.max_releases}</strong></li>
    <li>Badge: <strong>${ent.brandingRemoved ? 'removed' : 'shown'}</strong></li>
    <li>Started: ${formatDate(user.plan_started_at)}</li>
    <li>Expires: <strong>${ent.expiresAt ? formatDate(ent.expiresAt) : 'never'}</strong>${ent.daysLeft !== null && !ent.expired ? html` <span class="muted">(${ent.daysLeft} days left)</span>` : ''}</li>
  </ul>
  ${ent.plan.trial_days ? html`<form method="post" action="/billing/extend" class="form"><input type="hidden" name="_csrf" value="${csrf}">
    <h3>Need more time?</h3><p class="muted small">Ask for another ${Math.round(ent.plan.trial_days / 30)} months free. Tell us why — we say yes to most real projects.</p>
    <label>Reason <select name="reason" required><option value="">Choose one…</option>
      <option>Still building my site</option><option>Showing it to clients or an employer</option><option>Student or learning project</option>
      <option>Community, mosque or non-profit site</option><option>Waiting for budget approval to upgrade</option><option>Something else</option></select></label>
    <label>In your own words <textarea name="note" rows="3" maxlength="500" minlength="20" required placeholder="What is the site for, and what happens in the next 3 months?"></textarea></label>
    <button class="btn btn-ghost" type="submit">Request free extension</button></form>` : ''}
  <hr><h3>Have a promo code?</h3>
  <form method="post" action="/billing/redeem" class="form-inline"><input type="hidden" name="_csrf" value="${csrf}"><input name="code" placeholder="e.g. ASATIZAH-2026" maxlength="32" required autocomplete="off" style="text-transform:uppercase"><button class="btn btn-ghost" type="submit">Redeem</button></form>
</div>
<div class="card"><h2>Upgrade</h2>
  ${plans.filter((p) => p.id !== ent.plan.id && p.price_cents_month > 0).map((p) => html`
    <div class="plan-line"><div><strong>${p.name}</strong> · S$${(p.price_cents_month / 100).toFixed(0)}/month<div class="muted small">${p.description}</div></div>
    <form method="post" action="/billing/upgrade" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="plan" value="${p.id}"><button class="btn btn-primary" type="submit">${config.hitpay.plans[p.id] || config.payLinks[p.id] ? `Choose ${p.name} — pay with HitPay` : `Choose ${p.name}`}</button></form></div>`)}
  <p class="muted small">Card payments are handled by HitPay (Nasar Pte Ltd). Custom domains are an add-on on top of Plus — you buy the domain, we connect it.</p>
  <hr><h3>Want a real domain and a professional website?</h3><p class="muted"><a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> builds and grows websites for Singapore businesses. Ask us about moving from ${config.baseDomain} to your own domain.</p>
</div>
</div>
<div class="card"><h2>History</h2>
  ${events.length ? html`<table class="table"><tbody>${events.map((e) => html`<tr><td>${formatDate(e.created_at)}</td><td>${e.type.replace(/_/g, ' ')}</td><td class="muted small">${e.from_plan ?? ''}${e.to_plan ? ' → ' + e.to_plan : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No plan changes yet.</p>`}
</div>`.toString();
}

export { publicUrlForSubdomain };
