// Page shells. Three variants: marketing (public), app (signed-in dashboard), admin.
import { html, raw, esc } from '../../lib/html.js';
import { config } from '../../config.js';
import { currentNotices } from '../../services/status.js';

/** "WhatsApp a real human": one floating button on every nsd.sg page (not on hosted sites, not in admin).
 *  The message is pre-filled with where the person is, so the reply can start from context. */
export function whatsappLink(context = '') {
  if (!config.branding.whatsapp) return '';
  const text = `Hi NSD.SG, I have a question.${context ? ` (${context})` : ''}`;
  return `https://wa.me/${config.branding.whatsapp}?text=${encodeURIComponent(text)}`;
}
function whatsappFab(context = '') {
  const href = whatsappLink(context);
  if (!href) return '';
  return html`<a class="wa-fab" href="${href}" target="_blank" rel="noopener" aria-label="WhatsApp a real human" data-wa-fab>
<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12.04 2a9.9 9.9 0 0 0-8.5 15.02L2 22l5.12-1.5A9.93 9.93 0 1 0 12.04 2m0 1.67a8.26 8.26 0 0 1 0 16.52 8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3.04.9.92-2.96-.2-.31a8.26 8.26 0 0 1 6.82-12.82m-3.3 4.45c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.1 4.36 2.5.98 3 .79 3.55.74.55-.05 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35s-1.76-.87-2.03-.97c-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.56"/></svg><span>WhatsApp a real human</span></a>`;
}

function hostingBar() {
  const n = currentNotices();
  if (!n.length) return '';
  return html`<div class="host-bar ${n.some((x) => x.level === 'warn') ? 'warn' : 'info'}" data-host-bar="${n.map((x) => x.id).join(',')}" role="status">${n.map((x) => html`<p>${x.text}${x.url ? html` <a href="${x.url}" target="_blank" rel="noopener">Details</a>` : ''}</p>`)}<button type="button" aria-label="Hide" data-host-bar-close>×</button></div>`;
}

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
    links: [['/#try', 'Try it'], ['/#who', 'Who it’s for'], ['/#how', 'How it works'], ['/pricing', 'Pricing'], ['/showcase', 'Showcase'], ['/faq', 'FAQ']],
    ctas: user
      ? html`<a class="btn btn-primary btn-sm" href="/dashboard">Dashboard</a>`
      : html`<a class="btn btn-ghost btn-sm" href="/login">Log in</a><a class="btn btn-primary btn-sm" href="/signup">Sign up free</a>`,
  }))}
${hostingBar()}<main>${flashBox(flash)}${raw(body)}</main>
${whatsappFab(title ? `on the ${title} page` : 'on the home page')}
<footer class="site-footer"><div class="container">
<div class="foot-grid">
<div><div class="brand small">NSD<span>.SG</span></div><p>Make it with AI. Put it online with NSD.SG. Grow with <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a></p></div>
<div><h4>Product</h4><a href="/#try">Try it</a><a href="/#who">Who it’s for</a><a href="/#how">How it works</a><a href="/pricing">Pricing</a><a href="/roadmap">Roadmap</a><a href="/changelog">What’s new</a><a href="/faq">Questions</a></div>
<div><h4>Account</h4><a href="/login">Log in</a><a href="/signup">Sign up</a><a href="/forgot">Reset password</a></div>
<div><h4>Trust</h4><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/report">Report abuse</a>${config.branding.whatsapp ? html`<a href="${whatsappLink('from the footer')}" target="_blank" rel="noopener">WhatsApp a real human</a>` : ''}</div>
</div>
<p class="fine">© ${new Date().getFullYear()} <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> · Singapore. Pages on NSD.SG are made by their owners. See something wrong? Report it and we act quickly.</p>
</div></footer>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function appLayout({ title, body, user, flash, csrf, active = '' }) {
  const nav = [
    ['/dashboard', 'Sites', 'sites'],
    ['/account', 'Account', 'account'],
    ['/billing', 'Plan & payment', 'billing'],
    ['/connect', 'Connect to Claude', 'connect'],
    ['/changelog', 'What’s new', 'changelog'],
    ['/roadmap#suggest', 'Feedback', 'feedback'],
  ];
  return html`${head(title)}<body class="app">
${raw(header({
    cls: 'app-header',
    links: [...nav.map(([href, label, key]) => [href, label, active === key]), ...(user?.role === 'admin' ? [['/admin', 'Admin', false, 'admin-link']] : [])],
    ctas: html`<span class="muted small nav-email">${user.email}</span>
<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-ghost btn-sm" type="submit">Log out</button></form>`,
  }))}
${hostingBar()}<main class="container app-main">${flashBox(flash)}${raw(body)}</main>
${whatsappFab(`${user.email}, on ${title || 'the dashboard'}`)}
<footer class="site-footer slim"><div class="container"><span><a href="/">NSD.SG</a> · a <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> product</span><span><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/report">Report abuse</a></span></div></footer>
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
${hostingBar()}<main class="container app-main">${flashBox(flash)}${raw(body)}</main>
<script src="/assets/app.js?v=${config.version}" defer></script>
</body></html>`.toString();
}

export function simplePage(title, bodyHtml) {
  return html`${head(title)}<body class="marketing"><main class="container narrow">${raw(bodyHtml)}</main></body></html>`.toString();
}

export { esc, html, raw };
