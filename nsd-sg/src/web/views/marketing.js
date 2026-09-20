// Marketing pages. Copy is deliberately plain: the audience is non-technical.
import { html, raw } from '../../lib/html.js';
import { config } from '../../config.js';
import { expiresLabel, TRY_FREE_PER_PERSON } from '../../services/tryit.js';

const price = (cents) => (cents === 0 ? 'Free' : `S$${(cents / 100).toFixed(0)}/mo`);

export function homePage({ baseDomain, plans, csrf = '' }) {
  return html`
<section class="hero"><div class="container">
  <p class="eyebrow">For anyone who makes things with AI · Singapore</p>
  <h1>You made it with AI.<br><span class="grad">Give it a proper address.</span></h1>
  <p class="lead">Claude, ChatGPT or Gemini made you a page. Now you want to send it to someone. Put it at <strong>yourname.${baseDomain}</strong>. It takes a minute, it is free, and it looks like yours.</p>
  <form class="hero-form" action="/signup" method="get">
    <div class="domain-input"><input name="name" placeholder="yourname" maxlength="40" autocomplete="off" spellcheck="false" data-availability aria-label="Pick your web address"><span>.${baseDomain}</span></div>
    <button class="btn btn-primary btn-lg" type="submit">Claim my address</button>
  </form>
  <p class="hero-note" data-availability-msg>Free. No card needed. Not sure yet? <a href="#try">Try it first, no account</a>.</p>
  <div class="loop">
    <div class="card"><h3>Before</h3><p class="muted small">The link the AI gives you</p><span class="ugly">claude.ai/public/artifacts/9f3a1c2e-7b…</span></div>
    <div class="card"><h3>After</h3><p class="muted small">The link you send with NSD.SG</p><span class="nice">https://yourname.${baseDomain}/proposal</span></div>
    <div class="card"><h3>How</h3><p class="muted small">Three steps, no computer skills needed</p><code>Copy the code → paste it here → send the link</code></div>
  </div>
</div></section>

<section id="try" class="section try"><div class="container narrow">
  <p class="eyebrow">Try it first · no account needed</p>
  <h2>Put your page online for 3 hours</h2>
  <p class="section-lead">Your AI made you a page. Upload the file or paste the code, press the button, and you get a link you can send to anyone. Like it? Sign up and keep it at your own address.</p>
  <form method="post" action="/try" enctype="multipart/form-data" target="_blank" class="form card try-form" data-try-form>
    <input type="hidden" name="_csrf" value="${csrf}">
    <div class="try-choices">
      <div class="choice"><h3>Upload the file</h3><p class="muted">In <strong>Claude</strong>: press <strong>Download</strong> on the page it made. You get a file ending in <code>.html</code>.</p>
        <label class="btn btn-ghost btn-lg file-pick">Choose the file<input type="file" name="file" accept=".html,.htm,text/html" hidden data-try-file></label>
        <p class="muted small drop-hint">or drag the file anywhere into this box</p></div>
      <div class="choice"><h3>Or paste the code</h3><p class="muted">In <strong>ChatGPT</strong> or <strong>Gemini</strong>: press <strong>Copy</strong> at the top of the code box, then paste it here.</p>
        <textarea name="html" rows="6" spellcheck="false" placeholder="It usually starts with <!doctype html> or <html>. Paste all of it."></textarea></div>
    </div>
    <div class="try-actions">
      <button class="btn btn-primary btn-lg" type="submit" data-try-submit>Put my page online</button>
      <span class="muted" data-try-note>Your page opens in a new tab.</span>
    </div>
    <div class="bar busy" hidden data-try-bar><span></span></div>
    <div class="drop-veil" aria-hidden="true"><span>Drop it to put it online</span></div>
    <p class="muted small try-fine">Anyone with the link can see a test page. It is deleted after 3 hours. ${TRY_FREE_PER_PERSON} test pages free without an account. No email, nothing to install.</p>
  </form>
</div></section>

<section id="who" class="section who"><div class="container">
  <h2>Who this is for</h2>
  <p class="section-lead">People who are not web designers, but who now make web pages with AI and need to hand them to someone else without it looking like a test.</p>
  <div class="grid three">
    <div class="card"><h3><span class="ico">💼</span>People who share their work</h3><p>Consultants, trainers, coaches, freelancers. A proposal, a price calculator, an explainer, a checklist, a one-page pitch.</p><p class="eg">yourname.${baseDomain}/proposal</p></div>
    <div class="card"><h3><span class="ico">📖</span>Teachers and educators</h3><p>A lesson page, a class quiz, a reading list, the term timetable. Send it to the parents’ WhatsApp group. It opens on any phone.</p><p class="eg">teachername.${baseDomain}/quiz</p></div>
    <div class="card"><h3><span class="ico">📅</span>Event and community organisers</h3><p>The programme, the timings, the map, how to register. It only needs to live for three weeks, but it has to look trustworthy for all of them.</p><p class="eg">event.${baseDomain}</p></div>
    <div class="card"><h3><span class="ico">🧪</span>People trying out an idea</h3><p>You made something last night and want feedback this morning. Send a proper link. Change it tonight. Every older copy is kept.</p><p class="eg">project.${baseDomain}</p></div>
    <div class="card"><h3><span class="ico">🏪</span>Small businesses with one page</h3><p>Opening hours, what you do, how to reach you. The page the AI wrote for you, on a Singapore address, for free.</p><p class="eg">shopname.${baseDomain}</p></div>
    <div class="card"><h3><span class="ico">🚫</span>Not for</h3><p>Things that need a login, save people’s data, or take payments. NSD.SG shows pages; it does not run programs. When you need that, <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> builds it for you.</p></div>
  </div>
</div></section>

<section id="how" class="section alt"><div class="container">
  <h2>How it works</h2>
  <div class="grid three">
    <div class="card"><div class="step">1</div><h3>Ask the AI for a page</h3><p>Tell Claude, ChatGPT or Gemini what you want. When it is done, press “Copy code”. That code is your whole page.</p></div>
    <div class="card"><div class="step">2</div><h3>Paste it here</h3><p>Sign up for free, pick your name, paste the code. Have files instead? Drop them in. That works too.</p></div>
    <div class="card"><div class="step">3</div><h3>Send the link</h3><p>Your page is now at <strong>yourname.${baseDomain}</strong>. Send it on WhatsApp, email, anywhere. Paste again any time to change it.</p></div>
  </div>
</div></section>

<section id="why" class="section"><div class="container">
  <h2>Why not just send the link the AI gave you?</h2>
  <div class="grid three">
    <div class="card"><h3>It looks like yours</h3><p><strong>yourname.${baseDomain}</strong> is short, says Singapore, and has no other company’s name in it. Not a long string of random letters.</p></div>
    <div class="card"><h3>Nothing to learn</h3><p>No setup, no settings, no technical words. If the page opens in your browser, it works here.</p></div>
    <div class="card"><h3>One page is enough</h3><p>Most things people make with AI are one page. Paste it and you are done. Add more pages only if you want to.</p></div>
    <div class="card"><h3>Safe</h3><p>Every page gets the padlock (secure connection) for free. Pages cannot run programs, so nothing on them can harm your visitors.</p></div>
    <div class="card"><h3>A real person in Singapore</h3><p>Built and looked after by <a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a>. Stuck? Email us and a person replies.</p></div>
    <div class="card"><h3>Room to grow</h3><p>When your page becomes a business, we help with your own .sg or .com name, a professional website and getting found on Google. Same team.</p></div>
  </div>
</div></section>

<section id="features" class="section alt"><div class="container">
  <h2>What you get</h2>
  <ul class="features">
    <li>Paste the code, or drop in files, a folder or a ZIP</li><li>Extra pages with their own names: /proposal, /quiz, /menu</li><li>Older copies kept, so you can go back</li>
    <li>The padlock (secure connection) on every page</li><li>Your own “page not found” page if you want one</li><li>Protection against fake and copycat names</li>
    <li>See how many people visited</li><li>Your own domain name on Plus</li><li>Email help from NasarDigital</li>
  </ul>
</div></section>

<section id="pricing" class="section"><div class="container">
  <h2>Simple pricing</h2>
  <div class="grid pricing">${plans.map((p) => html`
    <div class="card plan ${p.id === 'plus' ? 'featured' : ''}">
      <h3>${p.name}</h3><div class="price">${price(p.price_cents_month)}</div>
      <p>${p.description}</p>
      <ul>
        <li>${p.limits.max_sites} site${p.limits.max_sites === 1 ? '' : 's'}, as many pages as you like</li>
        <li>${Math.round(p.limits.max_storage_bytes / 1024 / 1024)} MB of space</li>
        <li>Last ${p.limits.max_releases} copies kept</li>
        <li>${p.features.branding_removable ? 'No NSD.SG badge, on your pages or in link previews' : 'Small “Powered by NasarDigital” badge on your pages'}</li>
        <li>${p.features.custom_domains ? 'Use your own domain name (extra)' : 'yourname.' + config.baseDomain + ' address'}</li>
        <li>${p.features.hide_from_showcase ? 'Off the public showcase unless you want to be on it' : html`Listed on the public <a href="/showcase">showcase</a>`}</li>
        ${p.trial_days ? html`<li>Free for ${Math.round(p.trial_days / 30)} months, then ask for more time or upgrade</li>` : ''}
      </ul>
      <a class="btn ${p.id === 'plus' ? 'btn-primary' : 'btn-ghost'}" href="/signup?plan=${p.id}">${p.price_cents_month ? 'Choose ' + p.name : 'Start free'}</a>
    </div>`)}
  </div>
</div></section>

<section id="faq-teaser" class="section alt"><div class="container narrow">
  <h2>Questions people ask</h2>
  <details><summary>I only have one page. Is that enough?</summary><p>Yes. Paste it and it becomes your home page. You can add more pages later, each with its own name, like <code>/proposal</code>.</p></details>
  <details><summary>What is “the code”?</summary><p>When an AI makes you a page, it writes it in a language called HTML. That is the code. You never need to read it. Just copy all of it and paste it here.</p></details>
  <details><summary>Can I change the page after I send the link?</summary><p>Yes. Paste the new code and the link stays the same. The old copy is kept, so you can go back if you need to.</p></details>
  <details><summary>Why is there a small badge on my page?</summary><p>Free pages show a small “Powered by NasarDigital · nsd.sg” badge in the corner. That is what pays for the free plan. Plus removes it.</p></details>
  <p><a href="/faq">Read all the questions →</a></p>
</div></section>

<section class="cta"><div class="container">
  <h2>Your page is ready. Give it an address.</h2>
  <a class="btn btn-primary btn-lg" href="/signup">Claim my ${baseDomain} address</a>
  <p class="muted">Make it with AI → Put it online with NSD.SG → Grow with NasarDigital</p>
</div></section>`.toString();
}

export function pricingPage({ plans }) {
  return html`<section class="section"><div class="container">
  <h1>Pricing</h1>
  <p class="section-lead">Start free. Pay only if you want the badge gone, more sites, or your own domain name.</p>
  <div class="grid pricing">${plans.map((p) => html`
    <div class="card plan ${p.id === 'plus' ? 'featured' : ''}"><h3>${p.name}</h3><div class="price">${price(p.price_cents_month)}</div><p>${p.description}</p>
    <ul><li>${p.limits.max_sites} site${p.limits.max_sites === 1 ? '' : 's'}</li><li>${Math.round(p.limits.max_storage_bytes / 1024 / 1024)} MB of space</li>
    <li>Files up to ${Math.round(p.limits.max_file_bytes / 1024 / 1024)} MB each</li><li>Last ${p.limits.max_releases} copies kept</li>
    <li>${p.features.branding_removable ? 'No badge, on pages or in link previews' : html`Small <a href="/badge">“Powered by” badge</a>`}</li><li>${p.features.custom_domains ? 'Use your own domain name (extra)' : 'yourname.' + config.baseDomain + ' only'}</li><li>${p.features.hide_from_showcase ? 'Off the showcase unless you opt in' : html`Listed on the <a href="/showcase">showcase</a>`}</li>
    <li>${p.features.priority_support ? 'Faster help by email' : 'Help by email'}</li></ul>
    <a class="btn ${p.id === 'plus' ? 'btn-primary' : 'btn-ghost'}" href="/signup?plan=${p.id}">${p.price_cents_month ? 'Choose ' + p.name : 'Start free'}</a></div>`)}
  </div>
  <div class="card mt"><h3>Want your own domain name and a professional website?</h3><p><a href="${config.branding.partnerUrl}" rel="noopener">NasarDigital</a> designs, builds and grows websites for Singapore businesses. NSD.SG customers go to the front of the queue.</p></div>
</div></section>`.toString();
}

export function faqPage() {
  const qa = [
    ['What is NSD.SG?', 'A place to put the page you made with AI online, at your own name.nsd.sg address. Paste the code or drop in your files, then send the link to anyone.'],
    ['What is “the code”?', 'When Claude, ChatGPT or Gemini makes you a page, it writes it in a language called HTML. That is the code. You do not need to understand it. Copy all of it and paste it into NSD.SG.'],
    ['Can I try it before I sign up?', 'Yes. On the home page, paste the code into the “Try it first” box. You get a link that works for 3 hours. If you like it, sign up and press “Keep it” to move the page to your own address.'],
    ['Where do I find the copy button?', 'In Claude: open the page it made, press the ⋯ menu at the top, then “Copy code”. In ChatGPT and Gemini: there is a copy button at the top right of the code box.'],
    ['I only have one page. Is that enough?', 'Yes. Most people start with one page. Add more whenever you like, each with its own name, such as name.nsd.sg/proposal.'],
    ['Can I make a page where people log in, or pay, or fill in a form that saves answers?', 'Not on NSD.SG. NSD.SG shows pages; it does not run programs behind them. For forms, most people use a free form service (Google Forms, Tally) and put the link on their page. If you need the full thing, NasarDigital can build it.'],
    ['Do I need to know how to code?', 'No. If you can copy and paste, you can use NSD.SG.'],
    ['Which AI tools work with NSD.SG?', 'Any tool that gives you a web page: Claude, ChatGPT, Gemini, Cursor, v0, Lovable, Bolt and more. Files from Framer, Webflow and similar tools work too.'],
    ['What kind of files can I put on my site?', 'Web pages, pictures, fonts, videos, sounds and PDFs. Programs and scripts that run on a server are not allowed, which keeps every page safe.'],
    ['Can I just share a few PDFs, with no page?', 'Yes. Upload the files and leave out the home page. Visitors get a tidy list of your files in NSD.SG style, and each one opens with a click.'],
    ['How do I change my page after it is online?', 'Open your site in NSD.SG and paste the new code, or drop in the new files. The link stays the same. The old copy is kept so you can go back.'],
    ['What happens after 3 months on the Free plan?', 'Ask for more time from your Plan page (we say yes to most real projects), or move to Plus. Your site stays online while we look at your request.'],
    ['Can I remove the “Powered by NasarDigital” badge?', 'Yes, on the Plus plan. On the Free plan it stays. Changing your code will not remove it, because it is added when the page is shown.'],
    ['Can I use my own domain name, like mybusiness.sg?', 'Yes, on Plus and Beta. Buy the name from any seller, open your site’s Settings, type the name, and add the two records we show you where you bought it. Press Check and it connects, padlock included.'],
    ['Are there names I cannot use?', 'Names that look like banks, government services or well-known brands are blocked, so nobody can trick your visitors. Rude names are blocked too.'],
    ['What if someone puts something bad on a page?', 'Every page is checked and kept separate from the others. Anyone can report a page at /report, and we take bad pages down quickly.'],
    ['Where are the pages kept?', 'On NasarDigital servers in Singapore and Asia, with the padlock (secure connection) on every page. Copies are made every day.'],
  ];
  return html`<section class="section"><div class="container narrow"><h1>Questions people ask</h1>
  ${qa.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}
  <p class="mt">Something else? Email <a href="mailto:hello@${config.baseDomain}">hello@${config.baseDomain}</a>. A person replies.</p></div></section>`.toString();
}

export function termsPage() {
  return html`<section class="section"><div class="container narrow legal"><h1>Terms of Service</h1>
  <p class="muted">Last updated ${new Date().toISOString().slice(0, 10)}. This is a plain-language summary; have a lawyer review before relying on it commercially.</p>
  <h3>1. The service</h3><p>NSD.SG (“the Service”) is operated by NasarDigital (“we”). It hosts static websites uploaded by account holders on subdomains of ${config.baseDomain}.</p>
  <h3>2. Your content</h3><p>You own what you upload and are responsible for it. You confirm you have the right to publish it. You grant us the technical licence needed to store and serve it.</p>
  <h3>3. Acceptable use</h3><p>You may not use the Service for phishing, malware, scams, impersonation, harassment, adult content, gambling, copyright infringement, unlawful content under Singapore law, or anything that harms the Service or its users. The Service also does not host content that promotes or advocates LGBTQ+ lifestyles, causes, events or related advocacy, or content that promotes terrorism, extremism or hatred of any group. We decide what falls under these categories and may remove such content without notice. You may not attempt to access other users' data or bypass platform controls, including the mandatory branding badge on free plans.</p>
  <h3>4. Branding</h3><p>Sites on plans that include the “Powered by NasarDigital · nsd.sg” badge must display it. Removing, hiding or obscuring it by any technical means is a breach of these terms and may result in suspension.</p>
  <h3>5. Names</h3><p>Subdomains are allocated first-come, first-served, subject to reserved-name rules. We may reclaim names that infringe third-party rights, mislead visitors, or belong to inactive accounts after 6 months of inactivity, with notice where possible.</p>
  <h3>6. Free plans and expiry</h3><p>Free plans run for the stated period and may be extended at our discretion. When a plan expires and is not extended or upgraded, the site may be taken offline and later deleted after notice.</p>
  <h3>7. Suspension and termination</h3><p>We may suspend or remove sites and accounts that breach these terms, at any time, with or without notice depending on severity. When a site is suspended or deleted, we keep a copy of its files for up to 90 days, together with the account's security logs, so that abuse can be investigated and reported to the authorities where required.</p>
  <h3>8. Availability and liability</h3><p>The Service is provided “as is”. We aim for high availability and keep backups but do not guarantee either. To the extent permitted by law, our liability is limited to the fees paid in the preceding 3 months.</p>
  <h3>9. Changes</h3><p>We may update these terms; continued use after notice means acceptance.</p>
  <h3>10. Law</h3><p>These terms are governed by the laws of Singapore.</p></div></section>`.toString();
}

export function privacyPage() {
  return html`<section class="section"><div class="container narrow legal"><h1>Privacy</h1>
  <p>We collect the minimum needed to run the Service: your email, name, password (stored hashed), IP addresses and browser details in security logs, the files you upload, and aggregate traffic counts per site.</p>
  <p>How long we keep it: security logs (who did what, when, from which IP address) are kept for 12 months. When a site is suspended or deleted we keep a copy of its files for 90 days; expired test pages made without an account are kept for 7 days. Deleting your account disables it and removes your sites, but these security records stay for the periods above so that abuse can be investigated.</p>
  <p>We do not sell personal data. We use it to operate the Service, prevent abuse, and, if you opt in, to tell you about NasarDigital services. Data is stored in Singapore/Asia on infrastructure we control.</p>
  <p>Visitors to hosted sites: we record request counts and bytes served per site. We do not set cookies on hosted sites. Site owners may add their own analytics.</p>
  <p>You can export or delete your account from the account page. Questions: <a href="mailto:privacy@${config.baseDomain}">privacy@${config.baseDomain}</a>. This policy is written to align with Singapore's PDPA.</p></div></section>`.toString();
}

export function reportPage({ csrf, site }) {
  return html`<section class="section"><div class="container narrow"><h1>Report abuse</h1>
  <p>Seen a fake login page, a scam, a virus or stolen content on a ${config.baseDomain} site? Tell us. A person reads every report. For a test page (try.${config.baseDomain}), type <strong>try</strong> as the site name and paste the full link below.</p>
  <form method="post" action="/report" class="form">
    <input type="hidden" name="_csrf" value="${csrf}">
    <label>Site name <div class="domain-input"><input name="site" value="${site}" required maxlength="60" placeholder="name"><span>.${config.baseDomain}</span></div></label>
    <label>What kind of problem? <select name="category"><option value="phishing">Fake page pretending to be a bank, company or person</option><option value="malware">Virus or harmful download</option><option value="copyright">Stolen content</option><option value="spam">Spam or scam</option><option value="other">Something else</option></select></label>
    <label>What is wrong? <textarea name="details" rows="5" required minlength="10" maxlength="4000"></textarea></label>
    <label>Your email (optional) <input type="email" name="email" maxlength="200"></label>
    <button class="btn btn-primary" type="submit">Send report</button>
  </form></div></section>`.toString();
}

export function showcasePage({ sites, baseDomain, previews = [] }) {
  return html`<section class="section"><div class="container">
  <p class="eyebrow">Live on NSD.SG</p>
  <h1>${sites.length} site${sites.length === 1 ? '' : 's'} hosted right now</h1>
  <p class="section-lead">Every one of these was made with an AI tool and put online here. Free sites are listed automatically. Paid plans are off the list unless the owner switches it on.</p>
  ${sites.length ? html`<ul class="showcase">${sites.map((s) => html`<li><a href="https://${s.subdomain}.${baseDomain}" target="_blank" rel="noopener"><span class="sc-name">${s.subdomain}<i>.${baseDomain}</i></span><span class="sc-title muted">${s.title && s.title !== s.subdomain ? s.title : ''}</span><span class="arrow">↗</span></a></li>`)}</ul>` : html`<div class="card empty"><p>Nothing published yet — <a href="/signup">be the first</a>.</p></div>`}
  ${previews.length ? html`<div class="sc-temp"><h2>Test pages right now <span class="muted">${previews.length}</span></h2>
  <p class="section-lead">Made in the last 3 hours with the <a href="/#try">try box</a>, no account. Each one disappears at the time shown (Singapore time).</p>
  <ul class="showcase temp">${previews.map((p) => html`<li><a href="${p.url}" target="_blank" rel="noopener nofollow"><span class="sc-name">try.${baseDomain}/<i>${p.id}</i></span><span class="sc-title muted"><span class="pill pill-temp">test page</span> gone at ${p.gone}</span><span class="arrow">↗</span></a></li>`)}</ul></div>` : ''}
  <p class="muted small mt">Something here breaks our <a href="/terms">terms</a>? <a href="/report">Report it</a>.</p>
</div></section>`.toString();
}

export function badgePage({ badgeHtml, baseDomain }) {
  return html`<section class="section"><div class="container narrow">
  <p class="eyebrow">The badge</p>
  <h1>What the “Powered by NasarDigital” badge looks like</h1>
  <p class="section-lead">Free sites show this small pill in the bottom-right corner of every page, and an NSD.SG card when the link is shared on WhatsApp or Telegram. It is what pays for the free plan. It never covers your content, never tracks your visitors, and both disappear the moment you move to Plus.</p>
  <div class="badge-demo"><div class="bd-bar"><span></span><span></span><span></span><em>yourname.${baseDomain}</em></div>
    <div class="bd-page"><div class="bd-line w60"></div><div class="bd-line w90"></div><div class="bd-line w80"></div><div class="bd-block"></div><div class="bd-line w70"></div><div class="bd-line w50"></div>
    <div class="bd-badge">${raw(badgeHtml)}</div></div></div>
  <div class="grid two mt">
    <div class="card"><h3>On the free plan</h3><p class="muted">Badge shown, site listed on the <a href="/showcase">showcase</a>. Free for 3 months, and you can ask for more time.</p></div>
    <div class="card"><h3>On Plus</h3><p class="muted">No badge, up to 5 sites, off the showcase unless you opt in, use your own domain name as an extra. <a href="/pricing">See pricing →</a></p></div>
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
  ${user ? html`<p class="muted">Feature ideas, bugs, anything that got in your way — attach a screenshot if it helps.</p>
    <form method="post" action="/roadmap/suggest" class="form" enctype="multipart/form-data"><input type="hidden" name="_csrf" value="${csrf}">
    <label>Title <input name="title" maxlength="120" required placeholder="e.g. Let me schedule a publish for later"></label>
    <label>Why it would help <small>(optional)</small> <textarea name="body" rows="3" maxlength="2000"></textarea></label>
    <label>Screenshots or a PDF <small>(optional)</small> <input type="file" name="files" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.pdf,image/*,application/pdf"><small class="muted">Images (PNG, JPG, GIF, WebP, AVIF, SVG) or PDF · up to 3 files, 5 MB each. Only the NSD.SG team sees them.</small></label>
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

export function tryResultPage({ id, url, expiresAt, status, user, sites, csrf }) {
  const when = expiresLabel(expiresAt);
  const shown = url.replace(/^https?:\/\//, '');
  if (!status.ready) {
    const slow = (status.waitedMs ?? 0) > 60_000;
    return html`<section class="section try-result" data-try-status="/try/${id}/status"><div class="container narrow">
  <noscript><meta http-equiv="refresh" content="5"></noscript>
  <p class="eyebrow">Almost there</p>
  <h1>Putting your page online…</h1>
  <ol class="steps wait">
    <li class="done"><strong>Page saved</strong><span class="muted">We have your page.</span></li>
    <li class="now"><strong>Setting up the address</strong><span class="muted">${status.reason === 'error' ? 'Something went wrong on our side. It has been logged; we are on it.' : 'Checking that the link answers. This page updates by itself, keep it open.'}</span></li>
    <li><strong>Ready</strong><span class="muted">Then your link appears here.</span></li>
  </ol>
  <p class="muted">${slow ? html`Taking longer than usual. The address <strong>try.${config.baseDomain}</strong> is new, so its padlock (secure connection) can take up to 15 minutes the first time. We keep checking; you can also come back to this page later.` : 'This usually takes a few seconds.'}</p>
  ${status.reason === 'error' ? html`<p class="muted small">Or <a href="/#try">try again</a> in a minute.</p>` : ''}
</div></section>`.toString();
  }
  return html`<section class="section try-result"><div class="container narrow">
  <p class="eyebrow">Your test page is online</p>
  <h1>It works. Here is your link.</h1>
  <div class="card try-link"><a href="${url}" target="_blank" rel="noopener">${shown}</a><a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Open in a new tab ↗</a></div>
  <p class="muted">Anyone with this link can see the page. It stops working at <strong>${when} Singapore time</strong> (3 hours from now), then it is deleted.</p>
  <div class="try-frame-wrap"><div class="bd-bar"><span></span><span></span><span></span><em>${shown}</em></div><iframe class="try-frame" src="${url}" title="Your test page, live" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe></div>
  <div class="card keep"><h2>Want to keep it?</h2>
    ${user ? html`<p>Put it on one of your sites as the home page, or make a new site for it.</p>
      ${sites.length ? html`<form method="post" action="/try/${id}/claim" class="form-inline"><input type="hidden" name="_csrf" value="${csrf}">
        <select name="site_id" required>${sites.map((s) => html`<option value="${s.id}">${s.subdomain}.${config.baseDomain}${s.current_release_id ? ' (replaces its home page)' : ''}</option>`)}</select>
        <button class="btn btn-primary" type="submit">Put it on this site</button></form>` : ''}
      <p class="mt"><a class="btn ${sites.length ? 'btn-ghost' : 'btn-primary'}" href="/sites/new?preview=${id}">Make a new site for it</a></p>`
    : html`<p>Sign up for free, pick a name, and this page moves to <strong>yourname.${config.baseDomain}</strong>. It stays online for good, and you can change it any time.</p>
      <a class="btn btn-primary btn-lg" href="/signup?preview=${id}">Keep it at my own address</a>
      <p class="muted small mt">Already have an account? <a href="/login?next=${encodeURIComponent(`/try/${id}`)}">Log in</a> and you can add it to a site you already have.</p>`}
  </div>
  <p class="muted small">Something wrong with the page? Get the file or the code from your AI tool again and <a href="/#try">try once more</a>. Each try makes a new link.</p>
</div></section>`.toString();
}

export function tryLimitPage({ reason }) {
  return html`<section class="section try-result"><div class="container narrow">
  <p class="eyebrow">That was your ${TRY_FREE_PER_PERSON} free tries</p>
  <h1>Like it? Make a free account to keep going.</h1>
  <p class="section-lead">${reason === 'ip' ? 'A lot of test pages have come from your network today.' : `You have made ${TRY_FREE_PER_PERSON} test pages without an account.`} With a free account your pages stay online for good at <strong>yourname.${config.baseDomain}</strong>, you can change them any time, and there is no 3-hour limit.</p>
  <p class="try-actions"><a class="btn btn-primary btn-lg" href="/signup">Create my free account</a><a class="btn btn-ghost btn-lg" href="/login?next=%2F%23try">I already have one</a></p>
  <p class="muted small">Free means free: no card, and your first site can be online a minute from now.</p>
</div></section>`.toString();
}

export function tryGonePage() {
  return html`<section class="section"><div class="container narrow">
  <p class="eyebrow">Test page</p>
  <h1>This test page is gone.</h1>
  <p class="section-lead">Test pages last 3 hours, then they are deleted. <a href="/#try">Make a new one</a>, or <a href="/signup">sign up</a> to keep a page online for good.</p>
</div></section>`.toString();
}
