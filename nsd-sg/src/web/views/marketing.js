// Marketing pages. Copy is deliberately plain: the audience is non-technical.
import { html, raw } from '../../lib/html.js';
import { config } from '../../config.js';

const price = (cents) => (cents === 0 ? 'Free' : `S$${(cents / 100).toFixed(0)}/mo`);

export function homePage({ baseDomain, plans }) {
  return html`
<section class="hero"><div class="container">
  <p class="eyebrow">Hosting for the AI era · Singapore</p>
  <h1>Create your website with AI.<br><span class="grad">Host it on your own .sg address.</span></h1>
  <p class="lead">You used Claude, ChatGPT or Cursor to build a site. Now put it online in under a minute at <strong>yourname.${baseDomain}</strong> — no servers, no configs, no <code>.vercel.app</code>.</p>
  <form class="hero-form" action="/signup" method="get">
    <div class="domain-input"><input name="name" placeholder="yourname" maxlength="40" autocomplete="off" spellcheck="false" data-availability aria-label="Choose your site name"><span>.${baseDomain}</span></div>
    <button class="btn btn-primary btn-lg" type="submit">Claim my address</button>
  </form>
  <p class="hero-note" data-availability-msg>Free to start. No credit card.</p>
  <div class="flow"><span>AI-generated website</span><i>→</i><span>Upload</span><i>→</i><span>Live on name.${baseDomain}</span></div>
</div></section>

<section id="how" class="section"><div class="container">
  <h2>How it works</h2>
  <div class="grid three">
    <div class="card"><div class="step">1</div><h3>Generate</h3><p>Ask any AI tool for a website. Download the HTML, CSS, images — or export a ZIP.</p></div>
    <div class="card"><div class="step">2</div><h3>Upload</h3><p>Sign up, pick a name, drag the ZIP or the files into NSD.SG. We check every file for safety.</p></div>
    <div class="card"><div class="step">3</div><h3>Live</h3><p>Your site is on <strong>https://name.${baseDomain}</strong> with SSL, instantly. Upload again any time to update it.</p></div>
  </div>
</div></section>

<section id="why" class="section alt"><div class="container">
  <h2>Why NSD.SG</h2>
  <p class="section-lead">Developer platforms are built for developers. NSD.SG is built for people who have a website and just want it online.</p>
  <div class="grid three">
    <div class="card"><h3>A clean local address</h3><p><strong>name.${baseDomain}</strong> is short, memorable and says Singapore. It looks like yours, not like a deployment preview.</p></div>
    <div class="card"><h3>Nothing to configure</h3><p>No git, no build commands, no framework detection, no DNS. If it opens in your browser, it works on NSD.SG.</p></div>
    <div class="card"><h3>Update by re-uploading</h3><p>Regenerated your site? Upload the new version. Every publish is kept, so you can roll back with one click.</p></div>
    <div class="card"><h3>Safe by design</h3><p>Sites are static and isolated from each other. Only web files are accepted, served with strict content types and HTTPS.</p></div>
    <div class="card"><h3>Made in Singapore</h3><p>Built and supported by <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a>. Talk to a real person when you need help.</p></div>
    <div class="card"><h3>A path to more</h3><p>When you outgrow a subdomain, we help with a custom domain, a professional build, SEO and growth — same team.</p></div>
  </div>
</div></section>

<section id="features" class="section"><div class="container">
  <h2>Everything you need, nothing you don't</h2>
  <ul class="features">
    <li>ZIP or drag-and-drop upload</li><li>File manager with add, replace, delete</li><li>Version history and rollback</li>
    <li>Automatic HTTPS</li><li>Custom 404 page</li><li>Reserved-name and abuse protection</li>
    <li>Usage and storage in your dashboard</li><li>Custom domains on Plus</li><li>Email support from NasarDigital</li>
  </ul>
</div></section>

<section id="pricing" class="section alt"><div class="container">
  <h2>Simple pricing</h2>
  <div class="grid pricing">${plans.map((p) => html`
    <div class="card plan ${p.id === 'plus' ? 'featured' : ''}">
      <h3>${p.name}</h3><div class="price">${price(p.price_cents_month)}</div>
      <p>${p.description}</p>
      <ul>
        <li>${p.limits.max_sites} site${p.limits.max_sites === 1 ? '' : 's'}</li>
        <li>${Math.round(p.limits.max_storage_bytes / 1024 / 1024)} MB storage</li>
        <li>${p.limits.max_releases} versions kept</li>
        <li>${p.features.branding_removable ? 'No NSD.SG badge' : 'Small “Powered by NasarDigital” badge'}</li>
        <li>${p.features.custom_domains ? 'Bring your own domain (add-on)' : 'name.' + config.baseDomain + ' address'}</li>
        <li>${p.features.hide_from_showcase ? 'Hide your site from the public showcase' : html`Listed on the public <a href="/showcase">showcase</a>`}</li>
        ${p.trial_days ? html`<li>Free for ${Math.round(p.trial_days / 30)} months, then extend or upgrade</li>` : ''}
      </ul>
      <a class="btn ${p.id === 'plus' ? 'btn-primary' : 'btn-ghost'}" href="/signup?plan=${p.id}">${p.price_cents_month ? 'Choose ' + p.name : 'Start free'}</a>
    </div>`)}
  </div>
</div></section>

<section id="faq-teaser" class="section"><div class="container narrow">
  <h2>Questions people ask</h2>
  <details><summary>What kind of websites can I host?</summary><p>Static websites: HTML, CSS, JavaScript, images, fonts, video. That is exactly what AI tools generate. Server-side code such as PHP or Node is not run, which keeps every site fast and safe.</p></details>
  <details><summary>Can I update my site after publishing?</summary><p>Yes. Upload a new ZIP to replace everything, or change single files in the file manager. Older versions are kept so you can roll back.</p></details>
  <details><summary>Why is there a badge on my site?</summary><p>Free sites carry a small “Powered by NasarDigital · nsd.sg” badge. It pays for the free tier. Plus removes it.</p></details>
  <p><a href="/faq">Read the full FAQ →</a></p>
</div></section>

<section class="cta"><div class="container">
  <h2>Your site is ready. Give it a home.</h2>
  <a class="btn btn-primary btn-lg" href="/signup">Create my ${baseDomain} address</a>
  <p class="muted">Create with AI → Deploy with NSD.SG → Grow with NasarDigital</p>
</div></section>`.toString();
}

export function pricingPage({ plans }) {
  return html`<section class="section"><div class="container">
  <h1>Pricing</h1>
  <p class="section-lead">Start free. Pay only when you want the badge gone, more sites, or your own domain.</p>
  <div class="grid pricing">${plans.map((p) => html`
    <div class="card plan ${p.id === 'plus' ? 'featured' : ''}"><h3>${p.name}</h3><div class="price">${price(p.price_cents_month)}</div><p>${p.description}</p>
    <ul><li>${p.limits.max_sites} site${p.limits.max_sites === 1 ? '' : 's'}</li><li>${Math.round(p.limits.max_storage_bytes / 1024 / 1024)} MB storage</li>
    <li>${Math.round(p.limits.max_file_bytes / 1024 / 1024)} MB max per file</li><li>${p.limits.max_releases} versions kept</li>
    <li>${p.features.branding_removable ? 'No badge' : html`<a href="/badge">Powered-by badge</a>`}</li><li>${p.features.custom_domains ? 'Bring your own domain (add-on)' : 'Subdomain only'}</li><li>${p.features.hide_from_showcase ? 'Can hide from the showcase' : html`Listed on the <a href="/showcase">showcase</a>`}</li>
    <li>${p.features.priority_support ? 'Priority support' : 'Email support'}</li></ul>
    <a class="btn ${p.id === 'plus' ? 'btn-primary' : 'btn-ghost'}" href="/signup?plan=${p.id}">${p.price_cents_month ? 'Choose ' + p.name : 'Start free'}</a></div>`)}
  </div>
  <div class="card mt"><h3>Need a proper domain and a professional website?</h3><p><a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> designs, builds and grows websites for Singapore businesses. NSD.SG customers get priority onboarding.</p></div>
</div></section>`.toString();
}

export function faqPage() {
  const qa = [
    ['What is NSD.SG?', 'A place to put a finished website online. You upload the files, we serve them on your own name.nsd.sg address with HTTPS.'],
    ['Do I need to know how to code?', 'No. If you can download a ZIP and drag it into a browser window, you can publish on NSD.SG.'],
    ['Which AI tools work with NSD.SG?', 'Any tool that produces website files: Claude, ChatGPT, Gemini, Cursor, v0, Lovable, Bolt, Framer exports, Webflow exports, Hugo/Astro/Next static exports, or a site you wrote yourself.'],
    ['What files are accepted?', 'HTML, CSS, JavaScript, JSON, images (PNG, JPG, GIF, WebP, AVIF, SVG, ICO), fonts (WOFF, WOFF2, TTF, OTF), video/audio (MP4, WebM, MP3, OGG, WAV), PDF, text. Anything executable (PHP, scripts, binaries) is rejected.'],
    ['Can my site have a contact form or a database?', 'Not on NSD.SG itself: sites are static. Most people use a form service (Formspree, Tally, Google Forms) or an embed. For a full custom build, talk to NasarDigital.'],
    ['How do I update my site?', 'Open the site in your dashboard and upload a new ZIP (replaces everything) or upload individual files (adds/replaces). Every publish becomes a version you can roll back to.'],
    ['What happens after 3 months on the Free plan?', 'You can request a free extension from your dashboard, or move to Plus. Your site stays online while an extension is pending.'],
    ['Can I remove the “Powered by NasarDigital” badge?', 'Yes, on the Plus plan. On the Free plan it is required; editing your HTML will not remove it because it is added when the page is served.'],
    ['Can I use my own domain?', 'Custom domains are part of Plus. Point your domain at NSD.SG and we take care of SSL.'],
    ['Is there a name I cannot use?', 'Names that look like banks, government services or well-known brands are reserved to protect visitors from phishing. Offensive names are also declined.'],
    ['What about abuse?', 'Every site is isolated, static, and served with strict security headers. We accept abuse reports at /report and suspend sites that host phishing, malware or illegal content.'],
    ['Where is my site hosted?', 'On NasarDigital infrastructure in Singapore/Asia, behind HTTPS. Backups run daily.'],
  ];
  return html`<section class="section"><div class="container narrow"><h1>Frequently asked questions</h1>
  ${qa.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}
  <p class="mt">Something else? Email <a href="mailto:hello@${config.baseDomain}">hello@${config.baseDomain}</a>.</p></div></section>`.toString();
}

export function termsPage() {
  return html`<section class="section"><div class="container narrow legal"><h1>Terms of Service</h1>
  <p class="muted">Last updated ${new Date().toISOString().slice(0, 10)}. This is a plain-language summary; have a lawyer review before relying on it commercially.</p>
  <h3>1. The service</h3><p>NSD.SG (“the Service”) is operated by NasarDigital (“we”). It hosts static websites uploaded by account holders on subdomains of ${config.baseDomain}.</p>
  <h3>2. Your content</h3><p>You own what you upload and are responsible for it. You confirm you have the right to publish it. You grant us the technical licence needed to store and serve it.</p>
  <h3>3. Acceptable use</h3><p>You may not use the Service for phishing, malware, scams, impersonation, harassment, adult content, gambling, copyright infringement, unlawful content under Singapore law, or anything that harms the Service or its users. You may not attempt to access other users' data or bypass platform controls, including the mandatory branding badge on free plans.</p>
  <h3>4. Branding</h3><p>Sites on plans that include the “Powered by NasarDigital · nsd.sg” badge must display it. Removing, hiding or obscuring it by any technical means is a breach of these terms and may result in suspension.</p>
  <h3>5. Names</h3><p>Subdomains are allocated first-come, first-served, subject to reserved-name rules. We may reclaim names that infringe third-party rights, mislead visitors, or belong to inactive accounts after 6 months of inactivity, with notice where possible.</p>
  <h3>6. Free plans and expiry</h3><p>Free plans run for the stated period and may be extended at our discretion. When a plan expires and is not extended or upgraded, the site may be taken offline and later deleted after notice.</p>
  <h3>7. Suspension and termination</h3><p>We may suspend or remove sites and accounts that breach these terms, at any time, with or without notice depending on severity.</p>
  <h3>8. Availability and liability</h3><p>The Service is provided “as is”. We aim for high availability and keep backups but do not guarantee either. To the extent permitted by law, our liability is limited to the fees paid in the preceding 3 months.</p>
  <h3>9. Changes</h3><p>We may update these terms; continued use after notice means acceptance.</p>
  <h3>10. Law</h3><p>These terms are governed by the laws of Singapore.</p></div></section>`.toString();
}

export function privacyPage() {
  return html`<section class="section"><div class="container narrow legal"><h1>Privacy</h1>
  <p>We collect the minimum needed to run the Service: your email, name, password (stored hashed), IP addresses and browser details in security logs, the files you upload, and aggregate traffic counts per site.</p>
  <p>We do not sell personal data. We use it to operate the Service, prevent abuse, and, if you opt in, to tell you about NasarDigital services. Data is stored in Singapore/Asia on infrastructure we control.</p>
  <p>Visitors to hosted sites: we record request counts and bytes served per site. We do not set cookies on hosted sites. Site owners may add their own analytics.</p>
  <p>You can export or delete your account from the account page. Questions: <a href="mailto:privacy@${config.baseDomain}">privacy@${config.baseDomain}</a>. This policy is written to align with Singapore's PDPA.</p></div></section>`.toString();
}

export function reportPage({ csrf, site }) {
  return html`<section class="section"><div class="container narrow"><h1>Report abuse</h1>
  <p>Seen phishing, malware, scams or stolen content on a ${config.baseDomain} site? Tell us. Reports are reviewed by a person.</p>
  <form method="post" action="/report" class="form">
    <input type="hidden" name="_csrf" value="${csrf}">
    <label>Site name <div class="domain-input"><input name="site" value="${site}" required maxlength="60" placeholder="name"><span>.${config.baseDomain}</span></div></label>
    <label>Category <select name="category"><option value="phishing">Phishing / impersonation</option><option value="malware">Malware</option><option value="copyright">Copyright</option><option value="spam">Spam / scam</option><option value="other">Other</option></select></label>
    <label>What is wrong? <textarea name="details" rows="5" required minlength="10" maxlength="4000"></textarea></label>
    <label>Your email (optional) <input type="email" name="email" maxlength="200"></label>
    <button class="btn btn-primary" type="submit">Send report</button>
  </form></div></section>`.toString();
}

export function showcasePage({ sites, baseDomain }) {
  return html`<section class="section"><div class="container">
  <p class="eyebrow">Live on NSD.SG</p>
  <h1>${sites.length} site${sites.length === 1 ? '' : 's'} hosted right now</h1>
  <p class="section-lead">Every one of these was generated with an AI tool and uploaded as plain files. Free-plan sites are listed automatically; Plus lets you opt out.</p>
  ${sites.length ? html`<ul class="showcase">${sites.map((s) => html`<li><a href="https://${s.subdomain}.${baseDomain}" target="_blank" rel="noopener"><span class="sc-name">${s.subdomain}<i>.${baseDomain}</i></span><span class="sc-title muted">${s.title && s.title !== s.subdomain ? s.title : ''}</span><span class="arrow">↗</span></a></li>`)}</ul>` : html`<div class="card empty"><p>Nothing published yet — <a href="/signup">be the first</a>.</p></div>`}
  <p class="muted small mt">Something here breaks our <a href="/terms">terms</a>? <a href="/report">Report it</a>.</p>
</div></section>`.toString();
}

export function badgePage({ badgeHtml, baseDomain }) {
  return html`<section class="section"><div class="container narrow">
  <p class="eyebrow">The badge</p>
  <h1>What the “Powered by NasarDigital” badge looks like</h1>
  <p class="section-lead">Free sites carry this small pill in the bottom-right corner of every page. It is how the free tier pays for itself. It never covers your content, never tracks your visitors, and disappears the moment you move to Plus.</p>
  <div class="badge-demo"><div class="bd-bar"><span></span><span></span><span></span><em>yourname.${baseDomain}</em></div>
    <div class="bd-page"><div class="bd-line w60"></div><div class="bd-line w90"></div><div class="bd-line w80"></div><div class="bd-block"></div><div class="bd-line w70"></div><div class="bd-line w50"></div>
    <div class="bd-badge">${raw(badgeHtml)}</div></div></div>
  <div class="grid two mt">
    <div class="card"><h3>On the free plan</h3><p class="muted">Badge shown, site listed on the <a href="/showcase">showcase</a>. Free for 3 months, extendable when you ask.</p></div>
    <div class="card"><h3>On Plus</h3><p class="muted">No badge, up to 5 sites, hide from the showcase, bring your own domain as an add-on. <a href="/pricing">See pricing →</a></p></div>
  </div>
</div></section>`.toString();
}

const STATUS_LABEL = { under_review: 'Under review', planned: 'Planned', in_progress: 'In progress', shipped: 'Shipped', declined: 'Not planned' };
const CAT_LABEL = { platform: 'Platform', dashboard: 'Dashboard', billing: 'Billing', admin: 'Trust & safety', design: 'Design' };
export const roadmapLabels = { STATUS_LABEL, CAT_LABEL };

function roadmapCard(i, { user, csrf }) {
  return html`<article class="rm-card ${i.status}">
    <div class="rm-top"><span class="rm-cat">${CAT_LABEL[i.category] ?? i.category}</span>${i.shipped_at ? html`<span class="muted small">${new Date(i.shipped_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>` : ''}</div>
    <h3>${i.title}</h3>
    ${i.body ? html`<p class="muted">${i.body}</p>` : ''}
    <div class="rm-foot">
      ${user ? html`<form method="post" action="/roadmap/vote/${i.id}" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="vote ${i.voted ? 'on' : ''}" type="submit" aria-pressed="${i.voted ? 'true' : 'false'}" title="${i.voted ? 'Remove your vote' : 'Vote for this'}">▲ ${i.votes}</button></form>`
             : html`<a class="vote" href="/login?next=/roadmap" title="Log in to vote">▲ ${i.votes}</a>`}
      ${i.suggested_name ? html`<span class="muted small">suggested by ${i.suggested_name.split(' ')[0]}</span>` : ''}
    </div>
  </article>`;
}

export function roadmapPage({ items, user, csrf, flash }) {
  const cols = [['in_progress', 'In progress', 'Being built right now'], ['planned', 'Planned', 'Next up — vote to move it up'], ['shipped', 'Shipped', 'Live on nsd.sg today']];
  const shippedCount = items.filter((i) => i.status === 'shipped').length;
  return html`<section class="section rm-hero"><div class="container">
  <p class="eyebrow">Roadmap</p>
  <h1>What we're building, in the open.</h1>
  <p class="section-lead">NSD.SG is a small Singapore product that ships often. ${shippedCount} things shipped so far; vote on what should come next or send an idea. Full history in the <a href="/changelog">changelog</a>.</p>
  <div class="rm-board">${cols.map(([key, label, sub]) => html`<div class="rm-col"><h2>${label} <span class="muted">${items.filter((i) => i.status === key).length}</span></h2><p class="muted small">${sub}</p>
    ${items.filter((i) => i.status === key).map((i) => roadmapCard(i, { user, csrf }))}</div>`)}</div>
  ${items.some((i) => i.status === 'under_review') ? html`<h2 class="mt">Under review <span class="muted">${items.filter((i) => i.status === 'under_review').length}</span></h2><p class="muted small">Ideas from users we are looking at.</p><div class="rm-grid">${items.filter((i) => i.status === 'under_review').map((i) => roadmapCard(i, { user, csrf }))}</div>` : ''}
  <div class="card mt rm-suggest" id="suggest"><h2>Have an idea?</h2>
  ${user ? html`<form method="post" action="/roadmap/suggest" class="form"><input type="hidden" name="_csrf" value="${csrf}">
    <label>Title <input name="title" maxlength="120" required placeholder="e.g. Let me schedule a publish for later"></label>
    <label>Why it would help <small>(optional)</small> <textarea name="body" rows="3" maxlength="2000"></textarea></label>
    <button class="btn btn-primary" type="submit">Send idea</button> <span class="muted small">It shows up under review once we've read it.</span></form>`
   : html`<p class="muted"><a href="/login?next=/roadmap#suggest">Log in</a> or <a href="/signup">create a free account</a> to vote and suggest ideas.</p>`}
  </div>
</div></section>`.toString();
}

function renderBody(body) {
  const lines = String(body ?? '').split('\n');
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(html`<ul>${list.map((l) => html`<li>${l}</li>`)}</ul>`); list = []; } };
  for (const l of lines) {
    if (l.startsWith('- ')) list.push(l.slice(2));
    else { flush(); if (l.trim()) out.push(html`<p>${l}</p>`); }
  }
  flush();
  return out;
}

export function changelogPage({ entries }) {
  return html`<section class="section"><div class="container narrow">
  <p class="eyebrow">Changelog</p>
  <h1>Every release, in plain words.</h1>
  <p class="section-lead">What changed on nsd.sg and when. Want something that isn't here? <a href="/roadmap">Vote on the roadmap</a>.</p>
  <div class="cl-list">${entries.map((e) => html`<article class="cl-entry" id="v${e.version.replace(/\./g, '-')}">
    <div class="cl-meta"><time datetime="${e.published_at}">${new Date(e.published_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</time>${e.version ? html`<code>v${e.version}</code>` : ''}
      ${e.tags.split(',').filter(Boolean).map((t) => html`<span class="tag tag-${t.trim()}">${t.trim()}</span>`)}</div>
    <h2>${e.title}</h2>
    <div class="cl-body">${renderBody(e.body)}</div>
  </article>`)}</div>
</div></section>`.toString();
}
