// Page shells. Three variants: marketing (public), app (signed-in dashboard), admin.
import { html, raw, esc } from '../../lib/html.js';
import { config } from '../../config.js';

const brand = html`<a class="brand" href="/">NSD<span>.SG</span></a>`;

// One header for all three shells: brand · desktop links · CTAs · hamburger. The drawer repeats links + CTAs
// for phones (app.js toggles .open; every link still works without JS).
function header({ links, ctas, extra = '', cls = '' }) {
  const linkHtml = links.map(([href, label, active, extraCls]) => html`<a href="${href}" class="${active ? 'active' : ''} ${extraCls ?? ''}">${label}</a>`);
  return html`<header class="site-header ${cls}"><div class="container nav">${brand}${raw(extra)}
<nav class="nav-links" aria-label="Primary">${linkHtml}</nav>
<div class="nav-cta">${raw(ctas)}</div>
<button class="hamburger" type="button" aria-label="Open menu" aria-expanded="false" data-drawer-open><span></span><span></span><span></span></button>
</div></header>
<div class="drawer" data-drawer aria-hidden="true"><button class="drawer-close" type="button" aria-label="Close menu" data-drawer-close>×</button>
<nav class="drawer-links" aria-label="Menu">${linkHtml}</nav><div class="drawer-cta">${raw(ctas)}</div></div>`;
}

function flashBox(flash) {
  if (!flash) return '';
  return html`<div class="flash flash-${flash.type}" role="status">${flash.message}</div>`;
}

function head(title, { description = '' } = {}) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title ? `${title} · NSD.SG` : 'NSD.SG — You made it with AI. Give it a proper address.'}</title>
<meta name="description" content="${description || 'Made a page with Claude, ChatGPT or Gemini? Paste the code and it is online at yourname.nsd.sg in a minute. Free to start. Try it without an account.'}">
<link rel="stylesheet" href="/assets/app.css?v=${config.version}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0f1014">
</head>`;
}

export function marketingLayout({ title, description, body, user, flash }) {
  return html`${head(title, { description })}<body class="marketing">
${raw(header({
    links: [['/#try', 'Try it'], ['/#how', 'How it works'], ['/#who', 'Who it’s for'], ['/showcase', 'Showcase'], ['/pricing', 'Pricing'], ['/faq', 'FAQ']],
    ctas: user
      ? html`<a class="btn btn-primary btn-sm" href="/dashboard">Dashboard</a>`
      : html`<a class="btn btn-ghost btn-sm" href="/login">Log in</a><a class="btn btn-primary btn-sm" href="/signup">Sign up free</a>`,
  }))}
<main>${flashBox(flash)}${raw(body)}</main>
<footer class="site-footer"><div class="container">
<div class="foot-grid">
<div><div class="brand small">NSD<span>.SG</span></div><p>Make it with AI. Put it online with NSD.SG. Grow with <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a></p></div>
<div><h4>Product</h4><a href="/#try">Try it</a><a href="/#how">How it works</a><a href="/pricing">Pricing</a><a href="/roadmap">Roadmap</a><a href="/changelog">What’s new</a><a href="/faq">Questions</a></div>
<div><h4>Account</h4><a href="/login">Log in</a><a href="/signup">Sign up</a><a href="/forgot">Reset password</a></div>
<div><h4>Trust</h4><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/report">Report abuse</a></div>
</div>
<p class="fine">© ${new Date().getFullYear()} NasarDigital · Singapore. Pages on NSD.SG are made by their owners. See something wrong? Report it and we act quickly.</p>
</div></footer>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function appLayout({ title, body, user, flash, csrf, active = '' }) {
  const nav = [
    ['/dashboard', 'Sites', 'sites'],
    ['/account', 'Account', 'account'],
    ['/billing', 'Plan & payment', 'billing'],
    ['/roadmap#suggest', 'Feedback', 'feedback'],
  ];
  return html`${head(title)}<body class="app">
${raw(header({
    cls: 'app-header',
    links: [...nav.map(([href, label, key]) => [href, label, active === key]), ...(user?.role === 'admin' ? [['/admin', 'Admin', false, 'admin-link']] : [])],
    ctas: html`<span class="muted small nav-email">${user.email}</span>
<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost btn-sm" type="submit">Log out</button></form>`,
  }))}
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
    ['/admin/promo', 'Promo codes', 'promo'],
    ['/admin/roadmap', 'Roadmap', 'roadmap'],
    ['/admin/abuse', 'Abuse reports', 'abuse'],
    ['/admin/audit', 'Audit log', 'audit'],
    ['/admin/health', 'System health', 'health'],
  ];
  return html`${head(title ? `Admin · ${title}` : 'Admin')}<body class="app admin">
${raw(header({
    cls: 'app-header admin-header',
    extra: html`<span class="pill pill-admin">ADMIN</span>`,
    links: nav.map(([href, label, key]) => [href, label, active === key]),
    ctas: html`<a class="btn btn-ghost btn-sm" href="/dashboard">My dashboard</a>
<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost btn-sm" type="submit">Log out</button></form>`,
  }))}
<main class="container app-main">${flashBox(flash)}${raw(body)}</main>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function simplePage(title, bodyHtml) {
  return html`${head(title)}<body class="marketing"><main class="container narrow">${raw(bodyHtml)}</main></body></html>`.toString();
}

export { esc, html, raw };
