import { html, formatBytes, formatDate, timeAgo } from '../../lib/html.js';
import { config, publicUrlForSubdomain } from '../../config.js';

const statusPill = (s) => html`<span class="pill pill-${s}">${s}</span>`;

function planBanner(ent) {
  if (ent.expired) return html`<div class="flash flash-error">Your <strong>${ent.plan.name}</strong> plan ended on ${formatDate(ent.expiresAt)}. Your sites stay online for now, but you cannot change them until you <a href="/billing">ask for more time or upgrade →</a></div>`;
  if (ent.daysLeft !== null && ent.daysLeft <= 1) return html`<div class="flash flash-error">Your free period ends <strong>${ent.daysLeft === 0 ? 'today' : 'tomorrow'}</strong>. Your site stays online, but after that you cannot change it until you <a href="/billing">ask for more time (free) or upgrade →</a></div>`;
  if (ent.daysLeft !== null && ent.daysLeft <= 7) return html`<div class="flash flash-warn">Your free period ends in <strong>${ent.daysLeft} days</strong>. <a href="/billing">Ask for more time (free) or upgrade →</a></div>`;
  return '';
}

export function sitesIndex({ sites, ent, storageUsed, user }) {
  return html`
${planBanner(ent)}
${!user.email_verified_at ? html`<div class="flash flash-warn">Please confirm your email: we sent you a link. Did not get it? <a href="/account">Send it again from your account page →</a></div>` : ''}
<div class="page-head"><div><h1>Your sites</h1><p class="muted">${sites.length} of ${ent.limits.max_sites} site${ent.limits.max_sites === 1 ? '' : 's'} · ${formatBytes(storageUsed)} of ${formatBytes(ent.limits.max_storage_bytes)} space used · ${ent.plan.name} plan</p></div>
${sites.length < ent.limits.max_sites && !ent.expired ? html`<a class="btn btn-primary" href="/sites/new">+ New site</a>` : ''}</div>
${sites.length === 0 ? html`<div class="card empty"><h3>No sites yet</h3><p>Pick your <strong>name.${config.baseDomain}</strong> address, then paste the page your AI made.</p><a class="btn btn-primary" href="/sites/new">Pick my address</a></div>` : ''}
<div class="site-list">${sites.map((s) => html`
<a class="card site-row" href="/sites/${s.id}">
  <div><div class="site-name">${s.subdomain}<span class="muted">.${config.baseDomain}</span></div><div class="muted small">${s.title}</div></div>
  <div>${statusPill(s.status)}</div>
  <div class="muted small">${s.last_deployed_at ? `Changed ${timeAgo(s.last_deployed_at)}` : 'Nothing online yet'}</div>
  <div class="muted small">${formatBytes(s.storage_bytes)}</div>
</a>`)}</div>`.toString();
}

export function newSite({ csrf, ent, count, preview = '' }) {
  if (count >= ent.limits.max_sites) {
    return html`<h1>New site</h1><div class="card"><p>Your ${ent.plan.name} plan allows ${ent.limits.max_sites} site${ent.limits.max_sites === 1 ? '' : 's'}, and you already have ${count}. Add more pages to a site you have, or upgrade for more sites.</p><a class="btn btn-primary" href="/billing">See plans</a></div>`.toString();
  }
  return html`<h1>${preview ? 'Pick an address for your test page' : 'New site'}</h1>
${preview ? html`<p class="muted">Your test page moves here as the home page the moment you press the button.</p>` : ''}
<form method="post" action="/sites" class="form card">
  <input type="hidden" name="_csrf" value="${csrf}">
  ${preview ? html`<input type="hidden" name="preview" value="${preview}">` : ''}
  <label>Web address <div class="domain-input"><input name="subdomain" required maxlength="40" placeholder="yourname" autocomplete="off" spellcheck="false" data-availability autofocus><span>.${config.baseDomain}</span></div><small data-availability-msg>3 to 40 letters, numbers or hyphens. This is the link you will send people.</small></label>
  <label>Name for your own reference <span class="muted">(only you see it)</span><input name="title" maxlength="100" placeholder="e.g. Ramadan quiz, Client proposal"></label>
  <button class="btn btn-primary" type="submit">${preview ? 'Create site and keep my page' : 'Create site'}</button>
</form>`.toString();
}

export function siteDetail({ site, ent, files, releases, traffic, monthBytes, csrf, url, ready = { ready: true } }) {
  const reqs = traffic.reduce((a, t) => a + t.requests, 0);
  const isReady = !!ready.ready;
  const slow = (ready.waitedMs ?? 0) > 20 * 60_000;
  const brandingOn = !(site.branding_removed || ent.brandingRemoved);
  return html`
${planBanner(ent)}
<div class="page-head">
  <div><p class="crumb"><a href="/dashboard">Sites</a> / ${site.subdomain}</p>
  <h1>${site.subdomain}<span class="muted">.${config.baseDomain}</span> ${site.status === 'live' && !isReady ? html`<span class="pill pill-empty">setting up</span>` : statusPill(site.status)}</h1>
  <p class="muted">${site.title} · ${files.length} file${files.length === 1 ? '' : 's'} · ${formatBytes(site.storage_bytes)} · ${site.last_deployed_at ? `changed ${timeAgo(site.last_deployed_at)}` : 'nothing online yet'}</p></div>
  <div class="actions">${site.status === 'live' ? (isReady ? html`<a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Open site ↗</a>` : html`<span class="btn btn-ghost is-wait" title="Your address is still being set up">Setting up…</span>`) : ''}<a class="btn btn-ghost" href="/sites/${site.id}/settings">Settings</a></div>
</div>
${site.status === 'suspended' ? html`<div class="flash flash-error"><strong>This site has been switched off by NSD.SG.</strong> ${site.suspended_reason || 'Email us to find out why.'}</div>` : ''}
${site.status !== 'suspended' ? html`<section class="card steps-card" ${!isReady ? html`data-site-status="/sites/${site.id}/status"` : ''}><h2>${site.current_release_id ? (isReady ? 'Your site is online' : 'Putting your site online…') : 'Three steps to get online'}</h2>
<ol class="steps ${!isReady ? 'waiting' : ''}">
  <li class="${isReady ? 'done' : 'now'}"><strong>${isReady ? 'Your address is ready' : 'Setting up your address'}</strong><span class="muted">${isReady ? `${site.subdomain}.${config.baseDomain} is yours and answers with the padlock (secure connection).` : ready.reason === 'error' ? 'Hostinger did not create the address on the first try. We are retrying automatically every minute while you are here; nothing is needed from you.' : `${site.subdomain}.${config.baseDomain} is yours. We are checking that it answers with the padlock (secure connection). This page updates by itself.`}</span></li>
  <li class="${site.current_release_id ? 'done' : isReady ? 'now' : ''}"><strong>Put your page on it</strong><span class="muted">${site.current_release_id ? 'Your page is saved. Paste again any time to change it; every change is kept.' : 'Paste the code from Claude, ChatGPT or Gemini below. Or drop in files if you have them. Every change is kept, so you can always go back.'}</span></li>
  <li class="${site.current_release_id && isReady ? 'now' : ''}"><strong>Open it and send the link</strong><span class="muted">${site.current_release_id && isReady ? html`<a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">Open ${site.subdomain}.${config.baseDomain} ↗</a>` : site.current_release_id ? 'The Open button appears here the moment your address answers.' : 'The Open button appears here once your page is on and the address answers.'}</span></li>
</ol>
${!isReady && ready.reason !== 'error' ? html`<p class="notice">${slow ? html`<strong>Taking longer than usual.</strong> A new address normally needs 5 to 15 minutes for its padlock. It has been longer; we keep checking. If it is still not ready in an hour, email <a href="mailto:hello@${config.baseDomain}">hello@${config.baseDomain}</a> and a person will look.` : html`<strong>New address:</strong> the padlock (secure connection) for <code>${site.subdomain}.${config.baseDomain}</code> usually takes 5 to 15 minutes to switch on. You can leave this page open or come back later; nothing else is needed from you.`}</p>` : ''}
</section>` : ''}

<section class="card upload-card" id="upload">
  <h2>${site.current_release_id ? 'Change your page' : 'Put your page online'}</h2>
  <p class="muted">Easiest: paste the code in the box below. Have files instead? Drop them here. A ZIP replaces the whole site; loose files and folders are added to what is already there. Up to ${formatBytes(ent.limits.max_file_bytes)} per file and ${formatBytes(ent.limits.max_storage_bytes)} per site.</p>
  <form method="post" action="/sites/${site.id}/upload" enctype="multipart/form-data" class="dropzone" data-dropzone ${ent.expired || site.status === 'suspended' ? 'data-disabled' : ''}>
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="mode" value="merge" data-mode>
    <div class="dz-inner">
      <p class="dz-title">Drop your files or ZIP here</p>
      <p class="muted">or</p>
      <div class="dz-buttons">
        <label class="btn btn-primary">Choose ZIP<input type="file" name="files" accept=".zip,application/zip" hidden data-pick="zip"></label>
        <label class="btn btn-ghost">Choose files<input type="file" name="files" multiple hidden data-pick="files"></label>
        <label class="btn btn-ghost">Choose folder<input type="file" name="files" webkitdirectory multiple hidden data-pick="folder"></label>
      </div>
      <p class="muted small">Web pages, pictures, fonts, video and PDF are fine; programs that run on a server are not. A file called <code>index.html</code> becomes your home page. No home page? Visitors get a tidy list of your files.</p>
    </div>
    <div class="dz-progress" hidden><div class="bar"><span></span></div><p class="dz-status">Uploading…</p></div>
    <noscript><button class="btn btn-primary" type="submit">Upload</button></noscript>
  </form>
  <details class="paste-box" ${!site.current_release_id ? 'open' : ''}>
    <summary><strong>Paste the code from Claude, ChatGPT or Gemini</strong> <span class="muted">· or, if your AI gave you a file, use “Choose files” above</span></summary>
    <form method="post" action="/sites/${site.id}/paste" class="form">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label>Which page? <span class="muted">(leave empty for your home page)</span>
        <div class="domain-input page-input"><span>${site.subdomain}.${config.baseDomain}/</span><input name="page" placeholder="proposal" maxlength="60" pattern="[A-Za-z0-9-]*" autocomplete="off"></div>
        <small>Empty means your home page, ${site.subdomain}.${config.baseDomain}. Type a word like <code>proposal</code> and the page gets its own link: <code>${site.subdomain}.${config.baseDomain}/proposal</code>.</small></label>
      <label>The code <textarea name="html" rows="8" placeholder="It usually starts with <!doctype html> or <html>. Paste all of it." required spellcheck="false" ${ent.expired || site.status === 'suspended' ? 'disabled' : ''}></textarea>
        <small>In Claude: open the page it made, press ⋯, then “Copy code”. In ChatGPT or Gemini: the copy button at the top of the code box. Pasting replaces that one page and keeps the rest of your site.</small></label>
      <button class="btn btn-primary" type="submit" ${ent.expired || site.status === 'suspended' ? 'disabled' : ''}>Put this page online</button>
    </form>
  </details>
</section>

<div class="grid two">
<section class="card">
  <h2>Files <span class="muted small">(what is online now)</span></h2>
  ${files.length === 0 ? html`<p class="muted">Nothing yet. Paste your page above.</p>` : html`
  <div class="file-list">${files.map((f) => html`
    <div class="file-row">
      <a href="/sites/${site.id}/files/view?path=${encodeURIComponent(f.path)}" target="_blank" rel="noopener" title="View file" class="file-path">${f.path}</a>
      <span class="muted small">${formatBytes(f.size)}</span>
      <form method="post" action="/sites/${site.id}/files/delete" class="inline" data-confirm="Remove ${f.path} from your site? You can restore the older copy later.">
        <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="path" value="${f.path}">
        <button class="btn btn-tiny btn-danger" type="submit" aria-label="Delete ${f.path}">✕</button></form>
    </div>`)}</div>`}
  ${!files.some((f) => f.path === 'index.html') && files.length ? html`<p class="flash flash-info">No home page yet, so visitors to ${site.subdomain}.${config.baseDomain} see a simple list of these files, in NSD.SG style. Fine for sharing a few PDFs. Want a proper page instead? Paste one above with the “Which page?” box left empty (a file called <code>index.html</code>).</p>` : ''}
</section>

<section class="card">
  <h2>Older copies</h2>
  ${releases.length === 0 ? html`<p class="muted">Every change is kept here, so you can always go back.</p>` : html`
  <div class="release-list">${releases.map((r) => html`
    <div class="release-row ${r.id === site.current_release_id ? 'current' : ''}">
      <div><strong>v${r.version}</strong> <span class="muted small">${r.source}</span>${r.id === site.current_release_id ? html` <span class="pill pill-live">live</span>` : ''}
        <div class="muted small">${r.note} · ${r.file_count} files · ${formatBytes(r.size_bytes)} · ${formatDate(r.created_at)}</div></div>
      ${r.id !== site.current_release_id ? html`<form method="post" action="/sites/${site.id}/rollback" class="inline" data-confirm="Put copy ${r.version} back online?"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="release_id" value="${r.id}"><button class="btn btn-tiny" type="submit">Go back to this</button></form>` : ''}
    </div>`)}</div>
  <p class="muted small">Your plan keeps the last ${ent.limits.max_releases} copies.</p>`}
</section>
</div>

<div class="grid two">
<section class="card"><h2>Visits (last 30 days)</h2><p><strong>${reqs.toLocaleString()}</strong> page and file loads · <strong>${formatBytes(monthBytes)}</strong> sent this month of ${formatBytes(ent.limits.max_bandwidth_bytes_month)} allowed</p>
  ${traffic.length ? html`<div class="spark">${traffic.map((t) => html`<i style="height:${Math.max(4, Math.min(100, (t.requests / Math.max(1, Math.max(...traffic.map((x) => x.requests)))) * 100))}%" title="${t.day}: ${t.requests} requests"></i>`)}</div>` : html`<p class="muted small">No visits recorded yet.</p>`}
</section>
<section class="card"><h2>Branding</h2>
  ${brandingOn ? html`<p>This site shows a small <strong>“${config.branding.text}”</strong> badge in the corner, and an NSD.SG card when its link is shared on WhatsApp or Telegram (unless your page has its own preview image). Both are added when the page is shown, so changing your code will not remove them.</p><a class="btn btn-ghost" href="/billing">Remove them with Plus →</a>` : html`<p>No badge is shown on this site, and link previews carry no NSD.SG branding.</p>`}
</section>
</div>`.toString();
}

export function siteSettings({ site, csrf, ent, domains = [] }) {
  return html`<p class="crumb"><a href="/dashboard">Sites</a> / <a href="/sites/${site.id}">${site.subdomain}</a> / Settings</p>
<h1>Settings</h1>
<form method="post" action="/sites/${site.id}/settings" class="form card">
  <input type="hidden" name="_csrf" value="${csrf}">
  <label>Web address <div class="domain-input"><input value="${site.subdomain}" disabled><span>.${config.baseDomain}</span></div><small>An address cannot be renamed. Make a new site if you want a different name.</small></label>
  <label>Name for your own reference <input name="title" value="${site.title}" maxlength="100"></label>
  <label class="check"><input type="checkbox" name="allow_framing" value="1" ${site.allow_framing ? 'checked' : ''}> Let other websites show this site inside their own page <small>(off unless you need it; keeping it off protects your visitors)</small></label>
  ${(ent.features.hide_from_showcase ?? ent.features.branding_removable) ? html`<label class="check"><input type="checkbox" name="listed" value="1" ${site.listed_choice === 1 ? 'checked' : ''}> Show this site on the public <a href="/showcase">showcase</a> <small>(off by default on your plan; tick to be listed)</small></label>` : html`<p class="muted small">Live sites on the free plan appear on the public <a href="/showcase">showcase</a>. On Plus your site is off the list unless you switch it on.</p>`}
  <button class="btn btn-primary" type="submit">Save</button>
</form>
${ent.features.custom_domains ? html`<div class="card" id="domains"><h2>Your own domain name</h2>
<p class="muted">Bought a name like <strong>mybusiness.sg</strong> somewhere? Point it at this site. Your ${site.subdomain}.${config.baseDomain} address keeps working too. We do not sell domains yet; any registrar works.</p>
${domains.map((d) => html`<div class="domain-box">
  <div class="domain-head"><strong>${d.hostname}</strong> ${d.status === 'active' ? html`<span class="pill pill-live">connected</span>` : d.status === 'verified' ? html`<span class="pill pill-resolved">verified · connecting</span>` : html`<span class="pill pill-empty">waiting for records</span>`}
    <form method="post" action="/sites/${site.id}/domains/${d.id}/delete" class="inline" data-confirm="Remove ${d.hostname} from this site?"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-tiny btn-ghost" type="submit">Remove</button></form></div>
  ${d.status === 'active' ? html`<p class="muted small">Visitors can open <a href="https://${d.hostname}" target="_blank" rel="noopener">${d.hostname}</a> and <a href="https://www.${d.hostname}" target="_blank" rel="noopener">www.${d.hostname}</a>. The padlock appears within 15 minutes of connecting.</p>`
  : html`<p class="muted small">Log in where you bought the domain, find <strong>DNS records</strong> (sometimes “DNS zone” or “Manage DNS”), and add these. Copy each value exactly.</p>
    <table class="table small dns"><thead><tr><th>Type</th><th>Name / host</th><th>Value / points to</th><th></th></tr></thead><tbody>
      <tr><td>TXT</td><td><code>${d.ins.verify.host}</code></td><td><code>${d.ins.verify.value}</code></td><td>${d.owner_ok ? html`<span class="ok">✓ found</span>` : html`<span class="muted">proves it is yours</span>`}</td></tr>
      <tr><td>CNAME</td><td><code>www</code></td><td><code>${d.ins.www.value}</code></td><td>${d.dns_ok ? html`<span class="ok">✓ found</span>` : html`<span class="muted">sends www.${d.hostname} here</span>`}</td></tr>
      ${d.ins.apex ? html`<tr><td>A</td><td><code>@</code></td><td><code>${d.ins.apex.value}</code></td><td><span class="muted">sends ${d.hostname} (no www) here</span></td></tr>` : html`<tr><td colspan="4" class="muted small">For the bare name without www, some registrars offer “ALIAS” or “ANAME” to <code>${d.ins.target}</code>; add it if you can. Otherwise send people to www.${d.hostname}.</td></tr>`}
    </tbody></table>
    ${d.check_note ? html`<p class="flash flash-warn small">Last check ${timeAgo(d.last_checked_at)}: ${d.check_note}</p>` : ''}
    ${d.status === 'verified' ? html`<p class="flash flash-info small">Both records found. We are connecting it on our side; you will get an email. Nothing more to do.</p>` : ''}
    <form method="post" action="/sites/${site.id}/domains/${d.id}/check" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-primary btn-sm" type="submit">Check the records</button></form> <span class="muted small">New records can take up to an hour to show up.</span>`}
</div>`)}
${domains.filter((d) => d.status !== 'disabled').length < 2 ? html`<form method="post" action="/sites/${site.id}/domains" class="form-inline mt"><input type="hidden" name="_csrf" value="${csrf}"><input name="hostname" placeholder="mybusiness.sg" maxlength="253" required autocomplete="off"><button class="btn btn-ghost" type="submit">Add this domain</button></form>` : ''}
</div>` : html`<div class="card"><h2>Your own domain name</h2><p class="muted">On Plus or Beta you can point a name you bought, like mybusiness.sg, at this site. <a href="/billing">See plans →</a></p></div>`}
<div class="card danger">
  <h2>Delete this site</h2>
  <p class="muted">Removes every file and every older copy. Anyone can then take the address.</p>
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
  <label>Email <input value="${user.email}" disabled> ${user.email_verified_at ? html`<small class="ok">Confirmed</small>` : html`<small class="warn">Not confirmed</small>`}${user.google_sub ? html`<small class="ok">Signed in with Google. To also log in with a password, use “Forgot password” once to set one.</small>` : ''}</label>
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

function planCompare(freePlan, ent, promo, csrf) {
  const f = { ...freePlan.limits }, m = ent.limits;
  const mb = (b) => `${Math.round(b / 1024 / 1024)} MB`;
  const rows = [
    ['Sites', f.max_sites ?? 1, m.max_sites],
    ['Storage', mb(f.max_storage_bytes ?? 0), mb(m.max_storage_bytes)],
    ['Versions kept', f.max_releases ?? 1, m.max_releases],
    ['NSD.SG badge', 'shown', ent.brandingRemoved ? 'removed' : 'shown'],
    ['Hide from showcase', 'no', ent.features?.hide_from_showcase ? 'yes' : 'no'],
    ['Free period', `${freePlan.trial_days ?? 0} days`, ent.plan.trial_days ? `${ent.plan.trial_days} days, then S$${(ent.plan.price_cents_month / 100).toFixed(0)}/month` : 'none'],
  ];
  return html`<div class="promo-box"><h3>Your code <code>${promo.code}</code> unlocked ${ent.plan.name}</h3>
  <table class="table small compare"><thead><tr><th></th><th>${freePlan.name}</th><th class="hl">${ent.plan.name} (you)</th></tr></thead>
  <tbody>${rows.map(([k, a, b]) => html`<tr><td>${k}</td><td class="muted">${a}</td><td class="hl"><strong>${b}</strong></td></tr>`)}</tbody></table>
  <form method="post" action="/billing/promo/remove" class="inline" data-confirm="Remove the promo code? You go back to your previous plan and dates. The code cannot be used again."><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost btn-sm" type="submit">Remove promo code</button></form>
  <span class="muted small">Back to ${getPlanName(promo.prev_plan_id, freePlan)} with the dates you had before.</span></div>`;
}
const getPlanName = (id, freePlan) => (id && id !== freePlan.id ? id : freePlan.name);

export function billingPage({ user, ent, plans, events, storageUsed, siteCount, csrf, subscriptions = [], promo = null, freePlan = null, pendingExtension = null }) {
  const activeSub = subscriptions.find((s) => s.status === 'active');
  // Only a fresh checkout deserves the "not confirmed yet" notice; older ones are timed out by reconcileUser.
  const pendingSub = subscriptions.find((s) => s.status === 'pending' && Date.now() - Date.parse(s.created_at) < 2 * 3600_000);
  const pct = Math.min(100, Math.round((storageUsed / ent.limits.max_storage_bytes) * 100));
  return html`<h1>Plan &amp; billing</h1>
${planBanner(ent)}
<div class="grid two">
<div class="card"><h2>Current plan: ${ent.plan.name}${promo && !activeSub ? html` <span class="pill pill-live">promo</span>` : ''}</h2>
  <p>${ent.plan.description}</p>
  ${promo && freePlan && !activeSub ? planCompare(freePlan, ent, promo, csrf) : ''}
  <ul class="plain">
    <li>Sites: <strong>${siteCount} / ${ent.limits.max_sites}</strong></li>
    <li>Storage: <strong>${formatBytes(storageUsed)} / ${formatBytes(ent.limits.max_storage_bytes)}</strong><div class="meter"><span style="width:${pct}%"></span></div></li>
    <li>Versions kept: <strong>${ent.limits.max_releases}</strong></li>
    <li>Badge: <strong>${ent.brandingRemoved ? 'removed' : 'shown'}</strong></li>
    <li>Started: ${formatDate(user.plan_started_at)}</li>
    <li>Expires: <strong>${ent.expiresAt ? formatDate(ent.expiresAt) : 'never'}</strong>${ent.daysLeft !== null && !ent.expired ? html` <span class="muted">(${ent.daysLeft} days left)</span>` : ''}</li>
  </ul>
  ${ent.plan.trial_days && pendingExtension ? html`<div class="flash flash-info ext-pending"><strong>Free extension submitted</strong> on ${formatDate(pendingExtension.created_at)}. We review requests within 3–5 working days and confirm by email. Check back here — the expiry date above updates when it is approved.</div>` : ''}
  ${ent.plan.trial_days && !pendingExtension ? html`<form method="post" action="/billing/extend" class="form"><input type="hidden" name="_csrf" value="${csrf}">
    <h3>Need more time?</h3><p class="muted small">Ask for another ${ent.plan.trial_days >= 60 ? `${Math.round(ent.plan.trial_days / 30)} months` : `${ent.plan.trial_days} days`} free. Tell us why — we say yes to most real projects.</p>
    <label>Reason <select name="reason" required><option value="">Choose one…</option>
      <option>Still building my site</option><option>Showing it to clients or an employer</option><option>Student or learning project</option>
      <option>Community, mosque or non-profit site</option><option>Waiting for budget approval to upgrade</option><option>Something else</option></select></label>
    <label>In your own words <textarea name="note" rows="3" maxlength="500" minlength="20" required placeholder="What is the site for, and what happens in the next 3 months?"></textarea></label>
    <button class="btn btn-ghost" type="submit">Request free extension</button></form>` : ''}
  <hr><h3>Have a promo code?</h3>
  <form method="post" action="/billing/redeem" class="form-inline"><input type="hidden" name="_csrf" value="${csrf}"><input name="code" placeholder="e.g. ASATIZAH-2026" maxlength="32" required autocomplete="off" style="text-transform:uppercase"><button class="btn btn-ghost" type="submit">Redeem</button></form>
</div>
<div class="card"><h2>${activeSub ? 'Subscription' : 'Upgrade'}</h2>
  ${activeSub ? html`<div class="sub-box"><p><strong>${activeSub.plan_id === 'beta' ? 'Beta' : 'Plus'} · paid monthly by card via HitPay.</strong> Started ${formatDate(activeSub.created_at)}. Receipts come from HitPay by email.</p>
    <form method="post" action="/billing/hitpay/cancel" class="inline" data-confirm="Cancel your subscription? No more charges. Your plan stays active until the end of the month you have already paid for, then returns to Free."><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="id" value="${activeSub.id}"><button class="btn btn-danger btn-sm" type="submit">Cancel subscription</button></form>
    <p class="muted small">Cancelling stops future charges. Your plan stays active until the end of the month you have already paid for.</p></div><hr>` : ''}
  ${pendingSub && !activeSub ? html`<div class="flash flash-warn">A payment was started ${timeAgo(pendingSub.created_at)} but HitPay has not confirmed it yet. If you paid, reload this page in a minute — it checks automatically.</div>` : ''}
  ${plans.filter((p) => p.price_cents_month > 0 && (p.id === ent.plan.id ? !!ent.expiresAt : p.is_public) && !(activeSub && activeSub.plan_id === p.id)).map((p) => html`
    <div class="plan-line"><div><strong>${p.id === ent.plan.id ? `Keep ${p.name} after your free period` : p.name}</strong> · S$${(p.price_cents_month / 100).toFixed(0)}/month<div class="muted small">${p.id === ent.plan.id ? `Same plan, no expiry. Your card is charged from today — do this any time before ${ent.expiresAt ? formatDate(ent.expiresAt) : 'your trial ends'}.` : p.description}</div></div>
    <form method="post" action="/billing/upgrade" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="plan" value="${p.id}"><button class="btn btn-primary" type="submit">${config.hitpay.plans[p.id] || config.payLinks[p.id] ? `${p.id === ent.plan.id ? 'Keep' : 'Choose'} ${p.name} — pay with HitPay` : `Choose ${p.name}`}</button></form></div>`)}
  <p class="muted small">Card payments are handled by HitPay (Nasar Pte Ltd). Your own domain name is included on Plus and Beta: buy it anywhere, connect it from your site’s Settings.</p>
  <hr><h3>Want a real domain and a professional website?</h3><p class="muted"><a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> builds and grows websites for Singapore businesses. Ask us about moving from ${config.baseDomain} to your own domain.</p>
</div>
</div>
<div class="card"><h2>History</h2>
  ${events.length ? html`<table class="table"><tbody>${events.map((e) => html`<tr><td>${formatDate(e.created_at)}</td><td>${e.type.replace(/_/g, ' ')}</td><td class="muted small">${e.from_plan ?? ''}${e.to_plan ? ' → ' + e.to_plan : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No plan changes yet.</p>`}
</div>`.toString();
}

export { publicUrlForSubdomain };

export function connectPage({ tokens, fresh, csrf, sites }) {
  const base = `${config.publicScheme}://${config.platformHosts[0]}`;
  const live = tokens.filter((t) => !t.revoked_at);
  const example = sites[0]?.subdomain ?? 'my-site';
  return html`<h1>Connect to Claude</h1>
<p class="section-lead">Let Claude put pages online for you. You add NSD.SG to Claude once; after that you can say “publish this as ${example}” and get a live link back. No files to download, nothing to upload.</p>
${fresh ? html`<div class="card token-fresh"><h2>Your new token</h2>
  <p>This is the only time it is shown. Copy it now.</p>
  <p class="token"><code>${fresh.token}</code></p>
  <h3>Your connection address</h3>
  <p class="token"><code>${base}/mcp/${fresh.token}</code></p>
  <p class="muted small">The address contains the token, so treat it like a password: paste it into Claude, do not post it anywhere. If it ever leaks, revoke it below and make a new one.</p>
</div>` : ''}
<div class="grid two">
<div class="card"><h2>1. Make a token</h2>
  <p class="muted">One per app you connect, so you can switch one off without touching the others.</p>
  <form method="post" action="/connect/tokens" class="form-inline"><input type="hidden" name="_csrf" value="${csrf}"><input name="name" placeholder="e.g. Claude Desktop" maxlength="60"><button class="btn btn-primary" type="submit">Make a token</button></form>
  ${live.length ? html`<table class="table small mt"><thead><tr><th>Name</th><th>Made</th><th>Last used</th><th></th></tr></thead><tbody>${live.map((t) => html`<tr><td>${t.name}</td><td class="muted">${formatDate(t.created_at)}</td><td class="muted">${t.last_used_at ? `${timeAgo(t.last_used_at)} · ${t.calls} call${t.calls === 1 ? '' : 's'}` : 'never'}</td><td><form method="post" action="/connect/tokens/${t.id}/revoke" class="inline" data-confirm="Revoke this token? Claude will stop working with it."><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-tiny btn-danger" type="submit">Revoke</button></form></td></tr>`)}</tbody></table>` : html`<p class="muted small mt">No tokens yet.</p>`}
</div>
<div class="card"><h2>2. Add NSD.SG to Claude</h2>
  <h3>Claude on the web or Claude Desktop</h3>
  <ol class="plain-steps">
    <li>Open <strong>Settings → Connectors</strong> (on the web: claude.ai/settings/connectors).</li>
    <li>Press <strong>Add custom connector</strong>.</li>
    <li>Name: <code>NSD.SG</code>. URL: your connection address from step 1 (it starts with <code>${base}/mcp/</code>).</li>
    <li>Leave the OAuth fields empty and press <strong>Add</strong>. Then switch NSD.SG on in the chat’s tools menu.</li>
  </ol>
  <h3>Claude Code</h3>
  <p><code>claude mcp add --transport http nsd ${base}/mcp/YOUR_TOKEN</code></p>
  <h3>Then just ask</h3>
  <p class="example">“Publish this page as <strong>${example}</strong> on NSD.SG.”</p>
  <p class="muted small">Claude sends the page to NSD.SG and answers with the live link, <code>${example}.${config.baseDomain}</code>. Say “update it” to change it, “list my sites” to see what you have. Free plan: one site with the small badge; Plus: up to five, no badge, your own domain name.</p>
</div>
</div>
<div class="card"><h2>What Claude can and cannot do with this</h2>
  <ul class="plain">
    <li>Can: publish, update, list and delete <strong>your</strong> sites, within your plan’s limits. Same rules as this dashboard, including the name checks.</li>
    <li>Cannot: touch anyone else’s site, change your plan, or pay for anything.</li>
    <li>Limits per token: 60 requests an hour, 20 publishes an hour. Enough for a working session, not for a script gone wrong.</li>
  </ul>
</div>`.toString();
}
