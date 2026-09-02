// Page shells. Three variants: marketing (public), app (signed-in dashboard), admin.
import { html, raw, esc } from '../../lib/html.js';
import { config } from '../../config.js';

const brand = html`<a class="brand" href="/">NSD<span>.SG</span></a>`;

function flashBox(flash) {
  if (!flash) return '';
  return html`<div class="flash flash-${flash.type}" role="status">${flash.message}</div>`;
}

function head(title, { description = '' } = {}) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title ? `${title} · NSD.SG` : 'NSD.SG — Create your website with AI. Host it on your own .sg address.'}</title>
<meta name="description" content="${description || 'Upload the website you generated with AI and put it live on name.nsd.sg in under a minute. Clean .sg address, free to start.'}">
<link rel="stylesheet" href="/assets/app.css?v=${config.version}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0f1014">
</head>`;
}

export function marketingLayout({ title, description, body, user, flash }) {
  return html`${head(title, { description })}<body class="marketing">
<header class="site-header"><div class="container nav">${brand}
<nav><a href="/#how">How it works</a><a href="/#why">Why NSD.SG</a><a href="/pricing">Pricing</a><a href="/faq">FAQ</a></nav>
<div class="nav-cta">${user
    ? html`<a class="btn btn-primary" href="/dashboard">Dashboard</a>`
    : html`<a class="btn btn-ghost" href="/login">Log in</a><a class="btn btn-primary" href="/signup">Get started</a>`}</div>
</div></header>
<main>${flashBox(flash)}${raw(body)}</main>
<footer class="site-footer"><div class="container">
<div class="foot-grid">
<div><div class="brand small">NSD<span>.SG</span></div><p>Create with AI. Deploy with NSD.SG. Grow with <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a>.</p></div>
<div><h4>Product</h4><a href="/#how">How it works</a><a href="/pricing">Pricing</a><a href="/faq">FAQ</a></div>
<div><h4>Account</h4><a href="/login">Log in</a><a href="/signup">Sign up</a><a href="/forgot">Reset password</a></div>
<div><h4>Trust</h4><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/report">Report abuse</a></div>
</div>
<p class="fine">© ${new Date().getFullYear()} NasarDigital · Singapore. Sites hosted on NSD.SG are created by their owners; report abuse and we act quickly.</p>
</div></footer>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function appLayout({ title, body, user, flash, csrf, active = '' }) {
  const nav = [
    ['/dashboard', 'Sites', 'sites'],
    ['/account', 'Account', 'account'],
    ['/billing', 'Plan & billing', 'billing'],
  ];
  return html`${head(title)}<body class="app">
<header class="site-header app-header"><div class="container nav">${brand}
<nav>${nav.map(([href, label, key]) => html`<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`)}
${user?.role === 'admin' ? html`<a href="/admin" class="admin-link">Admin</a>` : ''}</nav>
<div class="nav-cta"><span class="muted hide-sm">${user.email}</span>
<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost" type="submit">Log out</button></form></div>
</div></header>
<main class="container app-main">${flashBox(flash)}${raw(body)}</main>
<footer class="site-footer slim"><div class="container"><span>NSD.SG · a NasarDigital product</span><span><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/report">Report abuse</a></span></div></footer>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function adminLayout({ title, body, user, flash, csrf, active = '' }) {
  const nav = [
    ['/admin', 'Overview', 'overview'],
    ['/admin/users', 'Users', 'users'],
    ['/admin/sites', 'Sites', 'sites'],
    ['/admin/plans', 'Plans', 'plans'],
    ['/admin/reserved', 'Reserved names', 'reserved'],
    ['/admin/abuse', 'Abuse reports', 'abuse'],
    ['/admin/audit', 'Audit log', 'audit'],
    ['/admin/health', 'System health', 'health'],
  ];
  return html`${head(title ? `Admin · ${title}` : 'Admin')}<body class="app admin">
<header class="site-header app-header"><div class="container nav">${brand}<span class="pill pill-admin">ADMIN</span>
<nav class="admin-nav">${nav.map(([href, label, key]) => html`<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`)}</nav>
<div class="nav-cta"><a class="btn btn-ghost" href="/dashboard">My dashboard</a>
<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost" type="submit">Log out</button></form></div>
</div></header>
<main class="container app-main">${flashBox(flash)}${raw(body)}</main>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function simplePage(title, bodyHtml) {
  return html`${head(title)}<body class="marketing"><main class="container narrow">${raw(bodyHtml)}</main></body></html>`.toString();
}

export { esc, html, raw };
