// Roadmap + changelog. Seeded once with the real history; admin edits from /admin/roadmap and /admin/changelog.
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { newId, nowIso } from '../lib/ids.js';

export const STATUSES = ['under_review', 'planned', 'in_progress', 'shipped', 'declined'];
export const CATEGORIES = ['platform', 'dashboard', 'billing', 'admin', 'design'];

export function listRoadmap({ userId = null, includeHidden = false } = {}) {
  const rows = getDb().prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = r.id) AS votes,
           ${userId ? '(SELECT 1 FROM roadmap_votes v WHERE v.item_id = r.id AND v.user_id = ?) AS voted' : '0 AS voted'},
           u.name AS suggested_name
    FROM roadmap_items r LEFT JOIN users u ON u.id = r.suggested_by
    ${includeHidden ? '' : 'WHERE r.is_public = 1'}
    ORDER BY CASE r.status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 WHEN 'under_review' THEN 2 WHEN 'shipped' THEN 3 ELSE 4 END, r.sort_order, votes DESC, r.created_at DESC`).all(...(userId ? [userId] : []));
  return rows;
}

export function toggleVote({ itemId, userId }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM roadmap_items WHERE id = ? AND is_public = 1').get(itemId)) return { ok: false };
  const has = db.prepare('SELECT 1 FROM roadmap_votes WHERE item_id = ? AND user_id = ?').get(itemId, userId);
  if (has) db.prepare('DELETE FROM roadmap_votes WHERE item_id = ? AND user_id = ?').run(itemId, userId);
  else db.prepare('INSERT INTO roadmap_votes (item_id, user_id) VALUES (?, ?)').run(itemId, userId);
  return { ok: true, voted: !has };
}

export function suggest({ userId, title, body }) {
  const t = String(title ?? '').trim().slice(0, 120);
  if (t.length < 6) return { ok: false, reason: 'Give the idea a short title (at least 6 characters).' };
  const recent = getDb().prepare("SELECT COUNT(*) n FROM roadmap_items WHERE suggested_by = ? AND created_at > datetime('now','-1 day')").get(userId).n;
  if (recent >= 5) return { ok: false, reason: 'You have sent a few ideas today already — thank you. Try again tomorrow.' };
  const id = newId();
  getDb().prepare("INSERT INTO roadmap_items (id, title, body, status, is_public, sort_order, suggested_by) VALUES (?, ?, ?, 'under_review', 0, 500, ?)")
    .run(id, t, String(body ?? '').trim().slice(0, 2000), userId);
  getDb().prepare('INSERT INTO roadmap_votes (item_id, user_id) VALUES (?, ?)').run(id, userId);
  return { ok: true, id };
}

// ---- attachments (feedback screenshots / PDFs) ----
export const ATTACHMENT_EXTS = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'],
  ['avif', 'image/avif'], ['svg', 'image/svg+xml'], ['pdf', 'application/pdf'],
]);
export const ATTACHMENT_MAX_FILES = 3;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const attachmentDir = (itemId) => path.join(config.dataDir, 'feedback', itemId);
export const attachmentExt = (name) => String(name ?? '').split('.').pop().toLowerCase();

/** Move an already-written temp file into the item's folder and record it. Caller has validated ext + size. */
export function addAttachment({ itemId, filename, tmpPath, bytes }) {
  const ext = attachmentExt(filename);
  if (!ATTACHMENT_EXTS.has(ext)) throw new Error('unsupported attachment type');
  const id = newId();
  fs.mkdirSync(attachmentDir(itemId), { recursive: true, mode: 0o700 });
  fs.renameSync(tmpPath, path.join(attachmentDir(itemId), `${id}.${ext}`));
  getDb().prepare('INSERT INTO roadmap_attachments (id, item_id, filename, ext, bytes) VALUES (?, ?, ?, ?, ?)').run(id, itemId, String(filename).slice(0, 120), ext, bytes);
  return id;
}
export function listAttachments(itemId) { return getDb().prepare('SELECT * FROM roadmap_attachments WHERE item_id = ? ORDER BY created_at').all(itemId); }
export function attachmentsByItem(itemIds) {
  const out = new Map();
  if (!itemIds.length) return out;
  for (const a of getDb().prepare(`SELECT * FROM roadmap_attachments WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY created_at`).all(...itemIds)) {
    if (!out.has(a.item_id)) out.set(a.item_id, []);
    out.get(a.item_id).push(a);
  }
  return out;
}
export function getAttachment(id) {
  const a = getDb().prepare('SELECT * FROM roadmap_attachments WHERE id = ?').get(id);
  if (!a) return null;
  return { ...a, path: path.join(attachmentDir(a.item_id), `${a.id}.${a.ext}`), mime: ATTACHMENT_EXTS.get(a.ext) ?? 'application/octet-stream' };
}

export function upsertItem({ id, title, body, status, category, is_public, sort_order }) {
  const db = getDb();
  const now = nowIso();
  if (!STATUSES.includes(status)) status = 'planned';
  if (!CATEGORIES.includes(category)) category = 'platform';
  if (id && db.prepare('SELECT 1 FROM roadmap_items WHERE id = ?').get(id)) {
    const cur = db.prepare('SELECT status, shipped_at FROM roadmap_items WHERE id = ?').get(id);
    db.prepare('UPDATE roadmap_items SET title = ?, body = ?, status = ?, category = ?, is_public = ?, sort_order = ?, shipped_at = ?, updated_at = ? WHERE id = ?')
      .run(title, body, status, category, is_public ? 1 : 0, sort_order, status === 'shipped' ? (cur.shipped_at ?? now) : null, now, id);
    return id;
  }
  const nid = id || newId();
  db.prepare('INSERT INTO roadmap_items (id, title, body, status, category, is_public, sort_order, shipped_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nid, title, body, status, category, is_public ? 1 : 0, sort_order, status === 'shipped' ? now : null);
  return nid;
}

export function deleteItem(id) {
  getDb().prepare('DELETE FROM roadmap_items WHERE id = ?').run(id);
  fs.rmSync(attachmentDir(id), { recursive: true, force: true });
}

export function listChangelog(limit = 1000) {
  return getDb().prepare('SELECT * FROM changelog ORDER BY published_at DESC LIMIT ?').all(limit);
}
export function upsertChangelog({ id, version, title, body, tags, published_at }) {
  const db = getDb();
  const nid = id || newId();
  db.prepare(`INSERT INTO changelog (id, version, title, body, tags, published_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, title = excluded.title, body = excluded.body, tags = excluded.tags, published_at = excluded.published_at`)
    .run(nid, version ?? '', title, body ?? '', tags ?? '', published_at || nowIso());
  return nid;
}
export function deleteChangelog(id) { getDb().prepare('DELETE FROM changelog WHERE id = ?').run(id); }

// ---- seed: the real history of the product so the pages are never empty -------------------------
const SEED_ROADMAP = [
  ['rm-mcp', 'Publish straight from your AI', 'Connect your AI once (Claude, ChatGPT, Codex, Gemini CLI, Cursor and any other tool that supports connectors), then say “put this online as my-site” and get a live link back. Keys you can switch off, same rules as the dashboard.', 'shipped', 'platform', 8],
  ['rm-help-panel', 'A real human one tap away', 'A small help panel on every page: three quick answers for where you are, then WhatsApp a real person. It shows up when you seem stuck, not all the time.', 'shipped', 'platform', 4],
  ['rm-samples', 'Three sample pages to try', 'No page yet? A proposal, a class quiz and a one-page shop, one click each, so anyone can see the whole flow before making their own.', 'shipped', 'platform', 5],
  ['rm-evidence-grade', 'Evidence packs an investigator can use', 'Plain-words summary, every version with the IP that uploaded it, a SHA-256 manifest and chain of custody, legal hold, and visitor logs for reported sites.', 'shipped', 'admin', 6],
  ['rm-lifecycle', 'Clear rules when a free period ends', 'Site stays online, changes pause; own domain off after 30 days, holding page after 60, removed after 150 with emails before each step.', 'shipped', 'billing', 11],
  ['rm-file-list', 'A tidy file list when there is no home page', 'Upload a few PDFs and nothing else, and visitors get a clean NSD.SG-style list instead of “page not found”.', 'shipped', 'platform', 12],
  ['rm-self-heal', 'Addresses that fix themselves', 'If Hostinger misses creating an address, NSD.SG retries on its own and tells admin if it stays stuck.', 'shipped', 'platform', 13],
  ['rm-gift-plans', 'Gift plans that charge only when the free period ends', 'A promo code can unlock a plan for months. Keep it by card and the first charge lands on the day the free period ends, not today. Admin can make gift plans that stay on the showcase.', 'shipped', 'billing', 7],
  ['rm-abuse-tools', 'Blocked words, evidence holds and share cards', 'Admin-managed blocked words, 90-day evidence copies of removed sites, and proper link previews on WhatsApp and Telegram.', 'shipped', 'admin', 14],
  ['rm-domain-buy', 'Buy a domain inside NSD.SG', 'Search, pay and connect a name without leaving the site. Needs a registrar arrangement first.', 'planned', 'billing', 15],
  ['rm-capacity', 'Capacity gauge and waitlist mode', 'The gauge is live in admin (amber at 70%, red at 90%). Next: sign-ups switch to a waitlist automatically near the ceiling.', 'in_progress', 'admin', 2],
  ['rm-email-gate', 'Confirm your email before the first publish', 'A site goes online only once the owner has confirmed their email. Google sign-ups are already confirmed; test pages are unaffected.', 'shipped', 'admin', 3],
  ['rm-vs-pages', 'Honest comparisons with Vercel and shared hosting', 'Two pages that show what a one-page site really costs elsewhere.', 'planned', 'design', 14],
  ['rm-try-it', 'Try it before you sign up', 'Paste the code on the home page, no account, and get a link that works for 3 hours. Sign up to keep it at your own address.', 'shipped', 'platform', 9],
  ['rm-google-login', 'Sign in with Google', 'One-click sign-up and login with a Google account, alongside email + password.', 'shipped', 'platform', 10],
  ['rm-custom-domain', 'Connect your own domain', 'Point www.yourdomain.sg at your NSD.SG site with a guided DNS check. Plus and Beta.', 'shipped', 'platform', 20],
  ['rm-expiry-emails', 'Reminder emails before your free period ends', 'Emails 7 days and 1 day before, on the day, and before a site is removed. First extension is granted instantly.', 'shipped', 'billing', 30],
  ['rm-analytics', 'Simple visitor stats per site', 'A 30-day traffic chart is already on every site page. Next: visits and top pages, privacy-friendly, no cookies.', 'in_progress', 'dashboard', 1],
  ['rm-demo-video', 'A 60-second "upload to live" walkthrough', 'Short video on the home page showing claim → upload → open.', 'planned', 'design', 11],
  ['rm-psl', 'Stronger isolation between sites', 'Registering nsd.sg on the Public Suffix List so browsers treat every site as fully separate.', 'planned', 'platform', 13],
  ['rm-zip-drop', 'Drag-and-drop ZIP or folder upload', 'Drop a ZIP, files or a whole folder; every upload is a version you can roll back to.', 'shipped', 'dashboard', 900],
  ['rm-badge', 'Powered-by badge with a demo page', 'Free sites carry a small badge; Plus removes it. See exactly what it looks like at /badge.', 'shipped', 'design', 901],
  ['rm-showcase', 'Public showcase of hosted sites', 'Every live site listed at /showcase; Plus and Beta can opt out.', 'shipped', 'platform', 902],
  ['rm-hitpay', 'Card payments through HitPay', 'Plus and Beta subscriptions billed monthly by card, activated automatically.', 'shipped', 'billing', 903],
  ['rm-promo', 'Promo codes for beta testers', 'Codes that unlock the Beta plan: 3 sites, no badge, 30 days free.', 'shipped', 'billing', 904],
  ['rm-steps', 'Three-step guide on every site page', 'Claim → publish → open, with an SSL heads-up for brand-new addresses.', 'shipped', 'dashboard', 905],
  ['rm-mobile', 'Mobile-first redesign', 'New navigation drawer, pill buttons and motion across the whole site.', 'shipped', 'design', 906],
  ['rm-watchdog', 'Abuse-name watchdog', 'Names that break the terms (adult, gambling, scams, impersonation) are refused at signup and logged.', 'shipped', 'admin', 907],
];
const SEED_CHANGELOG = [
  ['cl-0-13-36', '0.13.36', 'No more “setting up” on an address that already works', `- Fixed: on Hostinger the server sometimes cannot fetch its own new subdomain even though every browser can, so a site stayed on “setting up your address” for days. Once Hostinger reports the address provisioned and 30 minutes have passed, the site is shown as online and the retries stop. Admin sees why, and can still mark it reachable at once.`, 'fix', '2026-10-26T06:00:00Z'],
  ['cl-0-13-35', '0.13.35', 'Yearly for the S$6 members too', `- New: Beta yearly, S$60 instead of S$72. Everyone on the S$6 rate sees it when their free period is ending: Beta members and the gift and promo plans that renew at the Beta price. Plus yearly stays for everyone.`, 'new', '2026-10-26T05:00:00Z'],
  ['cl-0-13-34', '0.13.34', 'Link previews with the new words; the Sunday funnel for admin', `- Changed: when you share nsd.sg on WhatsApp or anywhere else, the preview card now carries the new words: made something with AI, sharing it is the hard part, a real person in Singapore behind it.
- Admin: the Overview opens with the three numbers that matter, sites live, people who talked to you (WhatsApp taps, with paying members counted separately) and leads for NasarDigital, with a “Lead for NasarDigital” button on every user page.`, 'improved', '2026-10-26T04:00:00Z'],
  ['cl-0-13-33', '0.13.33', 'Paying members, looked after properly', `- New: an email for every money moment: payment received (what you have, next charge, how to cancel), card saved for later, a scheduled switch, a cancellation with the paid-until date, a failed card with three days to fix it, a refund on its way, and a heads-up seven days before a yearly renewal.
- Changed: switching plans while paying (say, Plus monthly to Plus yearly) starts the new plan on the day your current paid period ends. The old subscription stops charging now. Nothing lost, nothing double.
- Changed: reminders to a member whose paid plan is ending say “your Plus plan”, not “your free period”, and point to resubscribing.
- Changed: when a paying member presses “WhatsApp a real human”, the opening message says so, so they are first in line.
- Admin: a failed payment shows as an alert on the Overview.`, 'improved', '2026-10-26T03:00:00Z'],
  ['cl-0-13-32', '0.13.32', 'Yearly Plus and real voices', `- New: Plus can be paid once a year, S$90 instead of S$108. The offer appears on your Plan page when a free period is ending or has ended, the moment it matters.
- New: “What people say” on the home page, real quotes from real users, added one by one by a person. It stays invisible until there is at least one.
- Changed: anyone paying monthly can switch to yearly from the Plan page, and switching plans cancels the old subscription the moment the new one starts. No double charge, ever.`, 'new', '2026-10-26T02:00:00Z'],
  ['cl-0-13-31', '0.13.31', 'Lead with the problem, show the proof, nudge the silent', `- Changed: the home page opens with the problem (the link your AI gives you is random letters, a file, or a page in someone else’s branding) before the promise.
- New: a proof line in the hero, “N sites live · M put online this week”, that appears once enough sites are live (admin sets the number on the Health page).
- New: a single day-after email to anyone who signed up, picked an address and never published: three ways to get a page up and a WhatsApp link. Sent once, between 24 and 72 hours after sign-up, never to older accounts.
- Admin: the Overview shows the activation rate, how many sign-ups in the last 30 days published within 24 hours.`, 'improved', '2026-10-26T01:00:00Z'],
  ['cl-0-13-30', '0.13.30', 'A clear answer when an extension is not approved', `- New: when a second free extension is not approved, the Plan page says so plainly, your pages stay online, nothing is deleted, and the paid plans are right there. An email says the same, with a reply address that reaches a person.
- Admin: a Decline button next to +90 days on the extension queue. Declined requests leave the queue instead of sitting forever.`, 'improved', '2026-10-26T00:00:00Z'],
  ['cl-0-13-29', '0.13.29', 'Try it, explained the first time; test pages back on show', `- Changed: the Try it box now says what a test page is in one breath (your page, at a real link, for 3 hours, no account), shows the four steps, and lists what it is good for: feedback tonight, seeing it on a real phone, things that live for an afternoon, showing a client in the meeting.
- Changed: test pages are listed again, on the showcase and in “Live right now” on the home page, as “Being tried right now”. Both places, and the try box itself, ask people to keep anything private off a test page: no NRIC or passport numbers, phone numbers, addresses, passwords or customer data.`, 'improved', '2026-10-25T23:00:00Z'],
  ['cl-0-13-28', '0.13.28', 'More in Plus, clearer words, no test pages on the showcase', `- Changed: Plus keeps 20 versions (was 10) and can download the whole site as a ZIP any time; so can every plan with a code. The plan cards now say what you get in plain words: your address is at nsd.sg (mybusiness.nsd.sg), the monthly visitor traffic allowance, help first in line on WhatsApp, no expiry while you subscribe and 30 days of grace if a payment fails. Own a .sg or .com name? Connect it from Settings and we switch it on.
- Changed: the public showcase lists real sites only. Test pages made from the try box no longer appear there.`, 'improved', '2026-10-25T22:00:00Z'],
  ['cl-0-13-27', '0.13.27', 'Codes at sign-up, real sites on the front page, straighter words', `- New: a “Have a code?” box on the sign-up page, and links like nsd.sg/signup?code=YOURCODE fill it in. The code is applied the moment the account exists, also when you continue with Google.
- New: “Live right now” on the home page shows three real sites and a link to the full showcase.
- Changed: the Free plan now says what it is, one site at your own nsd.sg address. “Last 3 copies kept” reads “3 versions kept, so you can go back”. Help says WhatsApp or email, not email only.
- Changed: a card for people who build with AI tools (Claude Code, Cursor, v0, Bolt, Lovable) next to the teachers, event organisers and small businesses. The hero names those tools too.
- Changed: the “What you get” list is folded into one line under “Why not just send the link”, so the page is shorter. The closing band says who runs NSD.SG and where pages live.
- Admin: the home page “New” pill can be pinned to a chosen release (Health page).`, 'improved', '2026-10-25T21:00:00Z'],
  ['cl-0-13-26', '0.13.26', 'A menu that reads like a story, and a roomier Try it box', `- Changed: the top menu now follows the visitor's path: How it works, Who it's for, Connect your AI, Showcase, Pricing, FAQ. Roadmap, What's new and Contact sit under “More”, so nothing is cut off on any screen. The phone menu lists everything.
- Changed: the Try it box on the home page is as wide as the rest of the page instead of a narrow column.`, 'improved', '2026-10-25T20:00:00Z'],
  ['cl-0-13-25', '0.13.25', 'Sample pages open with one tap', `- Fixed: “Try this one” on the home page did nothing on phones and only filled the paste box on computers. The three sample buttons now read “Put this one online” and open the sample in a new tab straight away, like your own page would. No download, no paste.`, 'fix', '2026-10-25T19:00:00Z'],
  ['cl-0-13-24', '0.13.24', 'Connect your AI, now on the front page', `- New: the home page has a “Connect your AI” section: Claude, ChatGPT, Codex, Gemini, Cursor and any AI tool with connectors can put your page online when you say so. Three steps, an example conversation, and a Connect my AI button. Also in the top menu, the feature list and the FAQ.
- New: nsd.sg/llms.txt, a plain-text summary for AI assistants that are asked “what is nsd.sg?”, plus a sitemap and link-preview (Open Graph) tags on every public page, and structured data (software listing and FAQ) on the home page.
- Changed: the top menu is shorter (Try it, Connect your AI, Pricing, Showcase, Roadmap, What’s new, FAQ) so nothing is cut off on laptop screens; “Who it’s for” and “How it works” stay in the footer.
- Fixed: on narrow phones the address box on the home page was slightly wider than the screen.`, 'new', '2026-10-25T18:30:00Z'],
  ['cl-0-13-23', '0.13.23', 'Builder essentials: redirects, single-page apps, caching', `- New: a _redirects file in your site works like on Netlify or Cloudflare Pages: /old /new 301, /blog/* /posts/:splat 302, /gone / 404, and /* /index.html 200 for apps with their own page addresses (React, Vue, Svelte). Rules only point to pages on your own site; links to other websites are refused with the line number, so nobody can misuse an nsd.sg address.
- New: hashed build files (index-BxK3f9aQ.js, _astro/…) are cached by browsers for a year; pages still refresh within a minute. Same on the Node server and the LiteSpeed docroot.
- Fixed: folders and files starting with an underscore (_astro/, _next/) were refused at upload.
- Changed: the connector takes 100 files a time (was 40) and its description names 404.html and _redirects; the Connect page, FAQ and help panel explain ZIP upload for build output.
- Changed: a refused site name now says why (blocked word to protect visitors, or reserved by NSD.SG).`, 'new', '2026-10-25T17:00:00Z'],
  ['cl-0-13-22', '0.13.22', 'Images through the connector', `- Fixed: an image sent through the AI connector was saved as text and showed up broken. Binary files (images, fonts, PDFs) are now sent as base64 and land as real files; sending one as plain text is refused with a clear hint.
- Changed: a site name with capitals, spaces or underscores gets a suggested fix in the error, e.g. “Try abc-test-site”.`, 'fix', '2026-10-25T15:00:00Z'],
  ['cl-0-13-21', '0.13.21', 'Who is on the showcase', `- Changed: every plan now has a showcase rule. Free sites are listed. Sites on a promo, gift or beta plan are listed unless the owner hides them (one tick on the site’s Settings). Paid plans stay hidden unless the owner shows them. Admin can change the rule for any plan without a deploy. Choices people already made are kept.`, 'improved', '2026-10-25T14:00:00Z'],
  ['cl-0-13-20', '0.13.20', 'Your AI now warns you about the padlock wait', `- Changed: when a page goes to a brand-new address through a connector, the result opens with a plain sentence the AI repeats: the secure padlock takes 5 to 15 minutes the first time, wait and reload. The Connect page and its help tips say the same.`, 'improved', '2026-10-25T13:30:00Z'],
  ['cl-0-13-19', '0.13.19', 'What to answer when your AI asks for permission', `- Changed: the Connect your AI page now explains the permission screen each tool shows after adding NSD.SG: allow the read-only tools, keep publish, update and delete on “ask me first”.`, 'improved', '2026-10-25T13:00:00Z'],
  ['cl-0-13-18', '0.13.18', 'Connect steps match the new Claude dialog', `- Changed: Claude’s “Add custom connector” box now asks about sign-in. The steps say what to pick: No sign-in, no headers, Add. Also the safer variant with the key as a hidden header.`, 'fix', '2026-10-25T12:30:00Z'],
  ['cl-0-13-17', '0.13.17', 'Copy button for your key', `- New: the Connect your AI page has a Copy button next to the key, so there is no long address to select by hand on a phone.`, 'improved', '2026-10-25T12:00:00Z'],
  ['cl-0-13-16', '0.13.16', 'Two more guard rails before the crowd arrives', `- New: a site that uses more transfer than its plan allows in a month is paused with a plain notice until the 1st, so one busy or abused site cannot slow down everyone else's.
- New: anonymous test pages cannot contain a password or login form. Real sites can; sign up for those.
- Changed: the promo code boxes show a made-up example instead of a real-looking code.
- New: a Contact page (in the footer) that lists every way to reach a person: WhatsApp, email, the roadmap for ideas, Report abuse. WhatsApp taps now go through nsd.sg, so the number is not in the page for scrapers and taps are rate-limited.`, 'improved', '2026-10-25T11:00:00Z'],
  ['cl-0-13-15', '0.13.15', 'Confirm your email before your site goes online', `- Changed: a site can only go online once the owner has confirmed their email address. Sign-ups with Google are already confirmed. Test pages on the home page are unchanged. This closes the easiest path for throwaway accounts, which protects every site on nsd.sg from being flagged together.`, 'new', '2026-10-25T10:00:00Z'],
  ['cl-0-13-14', '0.13.14', 'Roadmap caught up', `- Changed: the roadmap now shows the help panel, the sample pages and the evidence upgrade as shipped, and the “publish from your AI” card no longer says Claude only. In progress: visitor stats and the capacity gauge (waitlist mode next). Planned list unchanged.`, 'improved', '2026-10-25T09:00:00Z'],
  ['cl-0-13-13', '0.13.13', '“Connect your AI”: not only Claude', `- Changed: the page is now called Connect your AI, because it works with any AI tool that supports connectors (MCP): Claude, ChatGPT, Codex, Gemini CLI, Cursor, VS Code and more. Setup steps for each are on the page, in plain words.`, 'improved', '2026-10-25T08:00:00Z'],
  ['cl-0-13-12', '0.13.12', 'Connect to Claude, explained in plain words', `- Changed: the Connect to Claude page now says why you need a key (“like a house key you give to a helper”), walks through the three steps in order, and uses everyday words throughout. Tokens are now called keys on that page; nothing changed underneath.`, 'improved', '2026-10-25T07:00:00Z'],
  ['cl-0-13-11', '0.13.11', 'Clearer example on Connect to Claude', `- Fixed: the Connect to Claude page used your own site's name in its example (“publish this as yoursite”), which read like an instruction to overwrite it. It now uses a made-up name.`, 'fix', '2026-10-25T06:00:00Z'],
  ['cl-0-13-10', '0.13.10', 'Roadmap and What’s new in the public menu', `- Changed: the public menu now has Roadmap and What’s new, so you can vote and read the release notes without logging in. The page you are on is underlined.`, 'improved', '2026-10-25T05:00:00Z'],
  ['cl-0-13-9', '0.13.9', 'Security update of the web server library', `- Changed: the web server library (Fastify) and a helper it uses were updated to versions with the October 2026 security fixes. No change to how anything works.`, 'fix', '2026-10-25T04:00:00Z'],
  ['cl-0-13-8', '0.13.8', 'Capacity gauge', `- Admin: System health shows how many subdomains are in use against the hosting plan's ceiling, with a bar that turns amber at 70% and red at 90%. The ceiling is a setting, because the provider does not publish it.`, 'new', '2026-10-25T03:00:00Z'],
  ['cl-0-13-7', '0.13.7', 'No false alarms from routine patches', `- Fixed: the hosting-status bar treated the provider's routine security updates as outages and told visitors "some pages may not load". Only incidents that actually affect service show the bar now.`, 'fix', '2026-10-25T02:00:00Z'],
  ['cl-0-13-6', '0.13.6', 'Pasting a page no longer trips the hosting firewall', `- Fixed: pasting a page with scripts in it (including our sample pages) could be answered with “Forbidden” by the hosting provider’s firewall before it reached NSD.SG. The browser now sends the pasted code encoded, so the firewall has nothing to object to. Uploading the file was never affected.`, 'fix', '2026-10-21T07:00:00Z'],
  ['cl-0-13-5', '0.13.5', 'Help that shows up when you need it; the badge moves out of the way', `- Changed: the badge on free sites now sits bottom-left and folds to a small chip after a few seconds, so it never covers a site's own buttons.
- Changed: “WhatsApp a real human” is now a small help panel in the site's own style. It offers three quick answers for the page you are on, then the WhatsApp link. On most pages it appears only when you seem stuck (an error, 40 seconds without a click, a test page still waiting); on Plan & billing and the 404 page it is always there.
- New: outside support hours the panel says when to expect a reply. Admin sets the hours or switches the button off under System health, no deploy needed.
- Changed: the 404 page is now a proper NSD.SG page.`, 'improved', '2026-10-21T06:00:00Z'],
  ['cl-0-13-4', '0.13.4', 'WhatsApp a real human; sample pages polished', `- New: a green WhatsApp button on every nsd.sg page, bottom left. It opens a chat with a real person, with the message already saying which page you were on. On phones it shows its label for a moment, then tucks away until you tap it. Also in the footer and on the FAQ page.
- Changed: the three sample pages in the try box got a proper design pass.`, 'new', '2026-10-21T03:00:00Z'],
  ['cl-0-13-3', '0.13.3', 'Three sample pages to try', `- New: no page of your own yet? The try box on the home page now offers three of ours: a one-page proposal, a class quiz that marks itself, and a one-page shop. Press “Try this one” and it goes online like any upload, or download the file to see what an AI-made page looks like.`, 'new', '2026-10-21T02:00:00Z'],
  ['cl-0-13-2', '0.13.2', 'Promo codes you can edit', `- Admin: every promo code now has its own page. Raise the cap when demand is high, push the end date out, fix the note, and see who redeemed it and whether they are still on the plan. A retired code can be reactivated instead of making a new one (the same name cannot be created twice).`, 'improved', '2026-10-20T12:30:00Z'],
  ['cl-0-13-1', '0.13.1', 'Delete my account really deletes it', `- Fixed: deleting your own account used to leave it switched off, so your email was still taken and logging in again said “contact support”. It is now removed for good, with a copy kept for 90 days as our records require, and you can sign up again any time.`, 'fix', '2026-10-20T11:30:00Z'],
  ['cl-0-13-0', '0.13.0', 'Evidence packs fit for a police report', `- New: every evidence pack opens with SUMMARY.txt in plain words (who, when, which IPs, which sites, what was removed), carries a SHA-256 manifest of every file and a chain-of-custody note, and lists every version ever uploaded with the IP and browser that sent it. All times are given in Singapore time as well as UTC.
- New: legal hold. One switch on an account keeps its held files, packs and visitor logs until an admin lifts it, instead of the usual 90 days.
- New: a pack is stored on the server automatically before an account is deleted permanently, and admin can store one on demand with a reason (e.g. a police report number). Stored packs are listed under System health.
- New: a raw visitor log (IP, browser, path, time) for sites that are reported or suspended, or switched on by admin. Normal sites keep only daily counts.`, 'new', '2026-10-20T20:00:00Z'],
  ['cl-0-12-15', '0.12.15', 'What’s new and Feedback stay inside the dashboard', `- Fixed: opening What’s new or Feedback from the dashboard menu no longer throws you onto the public site with a different menu. Both pages now open inside the dashboard, with the tab highlighted, so Sites and Plan are one click away.`, 'fix', '2026-10-20T18:00:00Z'],
  ['cl-0-12-14', '0.12.14', 'Roadmap sorted', `- Changed: visitor stats is marked in progress (the traffic chart is already on every site page), Planned is in a sensible order, and today's gift-plan work has its own Shipped card.`, 'improved', '2026-10-20T17:30:00Z'],
  ['cl-0-12-13', '0.12.13', 'A shorter roadmap page', `- Changed: the Shipped column shows the four newest items with a “Show more” button for the rest, and the In-progress column only appears when something is being built.`, 'improved', '2026-10-20T17:00:00Z'],
  ['cl-0-12-12', '0.12.12', 'One offer, not two', `- Changed: on a gift or promo plan, the Plan page no longer lists the dearer public plan next to your offer. It shows one “Keep …” offer with the usual price struck through.`, 'improved', '2026-10-20T16:30:00Z'],
  ['cl-0-12-11', '0.12.11', 'Had a look at the payment page and came back? One click clears it', `- Changed: the “payment started” note on the Plan page says plainly that nothing was charged if you only looked, clears itself after 20 minutes instead of 2 hours, and has an “I didn’t pay, clear this” button.`, 'improved', '2026-10-20T16:00:00Z'],
  ['cl-0-12-10', '0.12.10', 'Google sign-ups can delete their account and set a password', `- Fixed: if you signed up with Google, the Delete account box asked for a password you never had. It now asks only for DELETE.
- New: the same accounts see “Set a password” on the Account page, with no current password to type, in case you also want email login.`, 'fix', '2026-10-20T15:00:00Z'],
  ['cl-0-12-9', '0.12.9', 'Unfinished checkouts no longer look like subscriptions; admin can delete an account for good', `- Changed: the payment buttons say “pay by card” instead of “pay with HitPay”. HitPay still handles the card, as the small print says.
- Fixed: a checkout you closed without paying showed up as “card saved”. Only a finished checkout with a future start date counts now.
- Admin: a disabled or suspended account has a “Delete permanently” button that frees the email and site names.`, 'fix', '2026-10-20T14:00:00Z'],
  ['cl-0-12-8', '0.12.8', 'Keep your plan: pay when the free period ends, not today', `- Changed: pressing “Keep … pay with HitPay” during a free period saves your card and takes the first payment on the day the free period ends. Nothing is charged today, and the reminder emails stay quiet because there is nothing to remind you about.
- New: the Plan page shows “card saved, first charge on …” with a cancel button, the same as a running subscription.`, 'improved', '2026-10-20T12:30:00Z'],
  ['cl-0-12-7', '0.12.7', 'The pay-with-HitPay button opens the checkout', `- Fixed: pressing “pay with HitPay” did nothing in Chrome and Safari. A security rule on the site blocked the hand-off to HitPay’s checkout page. It now opens as it should.`, 'fix', '2026-10-20T11:30:00Z'],
  ['cl-0-12-6', '0.12.6', 'Gift plans: fair extension, card payment, clearer Plan page', `- Changed: the instant first extension is 30 days on every plan. A 4-month gift no longer doubles itself with one click.
- Fixed: a plan made in admin with a hyphen in its id (like plus-turn40) can now be paid by card: set HITPAY_PLAN_PLUS_TURN40 in the environment.
- Changed: on the Plan page, keeping your current plan is listed above the other paid plans.`, 'improved', '2026-10-20T10:00:00Z'],
  ['cl-0-12-5', '0.12.5', 'Gift plans can stay on the showcase', `- Admin: a plan now has its own “Can hide from showcase” switch. Leave it off for a free gift plan (no badge, own domain, but listed on the showcase like a free site). Paid plans keep the opt-out.`, 'improved', '2026-10-20T08:00:00Z'],
  ['cl-0-12-4', '0.12.4', 'Ready for Cloudflare in front', `- New: settings so NSD.SG can sit behind Cloudflare (real visitor addresses kept, customer domains pointed at an un-proxied door), and a maintenance page Cloudflare can show instead of the provider’s error page. Setup guide in the docs.`, 'improved', '2026-09-21T13:00:00Z'],
  ['cl-0-12-2', '0.12.2', 'A banner that knows when the hosting is under maintenance', `- New: NSD.SG reads its hosting provider’s status page every 10 minutes. If maintenance or a problem touches the Singapore servers, every page shows a short bar saying so, with the expected end time in Singapore time. It goes away on its own.
- Changed: “What’s new” is now in the dashboard menu, and the home page shows the latest release under the headline.`, 'new,improved', '2026-09-21T12:00:00Z'],
  ['cl-0-12-1', '0.12.1', 'Admin menu shows every link; roadmap caught up', `- Fixed: the admin menu wraps onto a second line instead of hiding System health, Audit log and Abuse reports. The Overview also has buttons for all three.
- Changed: the public roadmap now lists everything shipped this week and what is planned next.`, 'fix,improved', '2026-09-21T11:00:00Z'],
  ['cl-0-12-0', '0.12.0', 'More time in one click, and clear rules when a free period ends', `- New: your first extension is instant. Press “Get more time” on the Plan page and you have another 30 days on the spot. A second one goes to a person.
- New: reminder emails 7 days and 1 day before your free period ends, and on the day.
- Changed: when a free period ends, the site stays online but cannot be changed. An own domain stops answering after 30 days, visitors see a holding page after 60 days, and the site is removed after 150 days, with an email a week before. Paid plans are never affected.
- Fixed: the pricing page now matches the plans (Plus leads with your own domain, “1 GB”, off the showcase by default).`, 'new,improved,fix', '2026-09-21T10:00:00Z'],
  ['cl-0-11-0', '0.11.0', 'Publish straight from Claude; 30 free days; Plus leads with your own domain', `- New: Connect to Claude. Make a token, add NSD.SG to Claude (web, Desktop or Claude Code) once, then say “publish this as my-site” and get a live link back. Claude can publish, update, list and delete your own sites, within your plan, with the same name checks as the dashboard.
- Changed: new Free and Beta accounts get 30 days. Everyone who signed up before keeps their dates. Warnings appear at 7 days and 1 day left.
- Changed: pricing now leads with what people actually pay for: your own domain name on Plus. Prices unchanged.`, 'new,improved', '2026-09-21T09:00:00Z'],
  ['cl-0-10-0', '0.10.0', 'Connect your own domain name, by yourself', `- New: on Plus and Beta, open your site’s Settings, type a domain you bought (like mybusiness.sg), and we show the two records to add where you bought it, in plain words. Press “Check the records” and the site connects, padlock included. Your name.nsd.sg address keeps working.
- Admin: a queue of domains waiting to be connected, and a monthly-recurring revenue figure on the overview.`, 'new', '2026-09-21T08:00:00Z'],
  ['cl-0-9-8', '0.9.8', 'Test-page bar fits on a phone', `- Fixed: on phones the bar above a test page cut its words off. It now wraps onto two lines with shorter labels, and the × is always reachable. Older test links get the new bar too.
- Fixed: the try box, the result page, site page buttons and admin tables now fit a phone screen.`, 'fix', '2026-09-21T07:00:00Z'],
  ['cl-0-9-7', '0.9.7', 'Admin menu no longer hides its last links', `- Fixed: on a normal laptop width the admin menu silently cut off Abuse reports, Audit log and System health. It now switches to the menu button earlier instead of clipping.`, 'fix', '2026-09-21T06:30:00Z'],
  ['cl-0-9-6', '0.9.6', 'Addresses fix themselves', `- New: if Hostinger fails to create your address on the first try, NSD.SG asks again on its own: every minute while your site page is open, every 2 minutes in the background, and on the hourly check. You do not need to do anything.
- Admin: “Repair now” on a site, “Repair all stuck addresses” and “Test Hostinger API” on System health, a table of addresses not yet confirmed, and one email per site that is still stuck after 30 minutes.`, 'new,fix', '2026-09-21T06:00:00Z'],
  ['cl-0-9-5', '0.9.5', 'Paid plans are off the showcase by default', `- Admin: a site page shows whether the address is confirmed reachable, with “Check address now” (shows the exact answer) and “Mark ready by hand”.
- Changed: on Plus, Beta or any plan that may hide from the showcase, your sites are no longer listed unless you tick “Show this site on the public showcase” in the site’s Settings. Free sites are listed as before.`, 'improved', '2026-09-21T05:00:00Z'],
  ['cl-0-9-4', '0.9.4', 'Your site page checks before it says “online”; a file list when there is no home page', `- New: a site (or folder) without a home page now shows a tidy NSD.SG-style list of its files instead of “page not found”. Upload two PDFs and nothing else, and the link just works.
- Changed: after you publish, the site page shows “Putting your site online…” with three steps and only shows the Open button once your address really answers with the padlock. New addresses take 5 to 15 minutes; the page updates by itself, and says so plainly if it is taking longer.
- Changed: the message after a publish says “saved and will be online as soon as your address is ready” instead of “live” while that is still true.`, 'improved', '2026-09-21T04:00:00Z'],
  ['cl-0-9-3', '0.9.3', 'Paid plans: no NSD.SG in link previews either', `- Changed: on Plus, Beta or any plan without the badge, link previews on WhatsApp and Telegram carry no NSD.SG image or wording. Just your title, your description and your address. The promise that removes the badge now covers previews too.
- Fixed: the NasarDigital name in both footers is now a link.`, 'improved,fix', '2026-09-21T03:30:00Z'],
  ['cl-0-9-2', '0.9.2', 'Test-page bar no longer covers your header; nicer link previews', `- Fixed: the test-page bar now sits above the page instead of over it, so a page with its own menu at the top is not cut off. There is an × to hide the bar; it comes back on the next load.
- New: sharing a test link on WhatsApp or Telegram shows an NSD.SG card (“… · test page on NSD.SG”, when it expires) instead of whatever logo the pasted page referenced.
- New: real sites get a share preview too when the page has none: the page title, its description or first paragraph, the address, and an NSD.SG card image. Pages that already carry their own preview tags are left alone.`, 'fix,new', '2026-09-21T03:00:00Z'],
  ['cl-0-9-1', '0.9.1', 'Evidence holds and the acceptable-use line', `- New: when a site is suspended or deleted, a copy of its files is kept for 90 days where only admin can reach it. Expired test pages are kept for 7 days. Admin can download one hold, or an evidence pack for a whole account (record, logins, every audit row, sites, IPs, held files).
- Changed: every audit row now records the browser, not only logins.
- Changed: Terms section 3 (acceptable use) and section 7 name the content we do not host and the 90-day hold; the Privacy page says how long security records are kept.`, 'new', '2026-09-21T02:00:00Z'],
  ['cl-0-9-0', '0.9.0', 'Blocked words you can manage yourself', `- New: Admin → Reserved names has a second list, Blocked words. A blocked word is refused anywhere inside a name (“terror” stops terrorist and terror-sg). Add or remove words without a deploy.
- Changed: hamas, hezbollah, taliban, alqaeda and zionis are blocked words; israel, palestine, gaza, hamas, hezbollah, idf, zionist, taliban, alqaeda and isis are reserved exact names.`, 'new', '2026-09-21T01:00:00Z'],
  ['cl-0-8-3', '0.8.3', 'Small fixes: time zone, menu order, plainer words', `- Changed: test-page times now say “Singapore time” so nobody has to guess.
- Changed: the menu follows the order of the home page (Try it → Who it’s for → How it works), links land just below the menu bar, and the menu shows which part you are reading.
- Changed: “Teachers and asatizah” is now “Teachers and educators”, in words everyone knows.`, 'improved', '2026-09-21T00:30:00Z'],
  ['cl-0-8-2', '0.8.2', 'Drop the file, see it live, three free tries', `- New: drag the .html file anywhere into the try box and it goes online. Your page opens in a new tab and is shown live on that page, with the link next to it.
- Changed: three test pages free without an account, then we ask you to make a free account. Test pages that are live also appear at the bottom of the showcase, clearly marked as temporary.
- Admin: the test-page panel lists every live test page with a Remove button.
- Design: more room to breathe in the try box and on the result page.`, 'new,improved', '2026-09-20T23:30:00Z'],
  ['cl-0-8-1', '0.8.1', 'Try it: upload the file, and we check the link before showing it', `- New: on the home page you can now upload the .html file your AI gave you, not only paste the code. Picking the file starts it straight away.
- Changed: after you press the button, the page shows “Putting your page online…” and only shows the link once it really answers. If the try address is brand new and its padlock is still being issued, it says so and keeps checking instead of sending you to a broken link.
- Fixed: the web address box on sign-up looked like a box inside a box.
- Admin: System health shows whether try.nsd.sg answers, with a button to set it up or repair it.`, 'new,fix', '2026-09-20T22:00:00Z'],
  ['cl-0-8-0', '0.8.0', 'Try it first, and plainer words everywhere', `- New: paste the code on the home page without an account and see it online at try.nsd.sg in seconds. The link works for 3 hours. Press “Keep it” to sign up and move the page to your own address; signed-in users can drop it onto a site they already have.
- Changed: the whole site now uses everyday words. “Publish a version” is “put your page online”, “versions” are “older copies”, “HTTPS” is “the padlock”. Same product, less jargon.`, 'new,improved', '2026-09-20T20:00:00Z'],
  ['cl-0-7-0', '0.7.0', 'Paste HTML, get a link', `- New: on your site page, paste the HTML straight from Claude or ChatGPT and it is live — no download, no upload. Give it a page name for an address like name.nsd.sg/proposal, or leave it blank for the home page.
- Changed: the home page now says who NSD.SG is for: people who make things with AI and need to hand them to someone else. One page counts.`, 'new', '2026-09-20T16:00:00Z'],
  ['cl-0-6-1', '0.6.1', 'Promo tidy-ups', `- Fixed: a promo code that people already used can be retired by admin instead of failing to delete.
- Changed: once you pay for a plan, the promo comparison box disappears and the code can no longer be removed — your subscription is what keeps the plan now.`, 'fix', '2026-09-20T15:00:00Z'],
  ['cl-0-6-0', '0.6.0', 'Continue with Google', `- New: sign up or log in with your Google account — one click, no password to remember. If you already have an account with the same email, it is linked automatically.`, 'new', '2026-09-20T14:00:00Z'],
  ['cl-0-5-6', '0.5.6', 'Cancelling keeps what you paid for, exactly', `- Changed: when you cancel a paid plan you keep it until the end of the month you already paid for (last charge + 1 month), the same as any subscription service. Previously it was 30 days from the day you cancelled.
- Fixed: HitPay error messages in admin no longer show raw HTML.`, 'improved', '2026-09-20T13:00:00Z'],
  ['cl-0-5-5', '0.5.5', 'Cancelling never shortens time you were already given', `- Fixed: if an admin extended your plan and you later cancel a subscription, the later date is kept instead of being replaced by the 30-day grace period.`, 'fix', '2026-09-20T11:30:00Z'],
  ['cl-0-5-4', '0.5.4', 'Payments show up in your history reliably', `- Fixed: HitPay payment notifications are now matched to your subscription every time, so each charge appears in your Plan & billing history.`, 'fix', '2026-09-20T02:00:00Z'],
  ['cl-0-5-3', '0.5.3', 'Feedback from the dashboard, clearer promo plans', `- New: a Feedback link in the dashboard — send an idea or a bug with screenshots or a PDF attached.
- New: Plan & billing shows exactly what your promo code unlocked next to the Free plan, and lets you remove the code yourself.
- Improved: after you ask for a free extension, the page shows it was submitted and that we answer within 3–5 working days.`, 'new,improved', '2026-09-03T15:10:00Z'],
  ['cl-0-5-2', '0.5.2', 'Subscriptions you can see and stop', `- New: Plan & billing shows your HitPay subscription and lets you cancel it yourself — your plan stays for 30 days after cancelling.
- New: Public roadmap and changelog (you are reading it). Vote on what we build next, or suggest an idea.
- Improved: if you close the payment page halfway, the dashboard checks with HitPay on its own and clears the leftover "payment started" notice.
- Fixed: payment confirmations from HitPay were sometimes rejected; both webhook formats are now accepted.`, 'new,improved,fixed', '2026-09-03T12:30:00Z'],
  ['cl-0-4-4', '0.4.4', 'Payments by card, promo codes and a public showcase', `- New: Plus and Beta can be paid by card through HitPay — the plan activates automatically after payment.
- New: Promo codes. Redeem one on Plan & billing to unlock the Beta plan (3 sites, no badge, 90 days free, then S$6/month).
- New: /showcase lists every live site. Plus and Beta users can hide theirs from Site settings.
- New: /badge shows exactly what the "Powered by NasarDigital" badge looks like.
- Improved: the site page now walks you through claim → publish → open, and warns that a brand-new address needs a few minutes for its SSL certificate.
- Improved: asking for a free extension now takes a reason plus a sentence or two.
- Improved: names that break our terms are refused at signup.
- Fixed: verification and password-reset emails are now delivered.`, 'new,improved,fixed', '2026-09-03T06:20:00Z'],
  ['cl-0-3-1', '0.3.1', 'A proper mobile experience', `- New: navigation drawer on phones, back-to-top button.
- Improved: new visual language across the site — pill buttons, softer shadows, spring motion, tighter headings.
- Fixed: the phone menu no longer wraps under the logo.`, 'new,improved,fixed', '2026-09-03T01:30:00Z'],
  ['cl-0-2-0', '0.2.0', 'NSD.SG goes live', `- New: nsd.sg is live on Singapore hosting. Claim name.nsd.sg, upload your AI-generated site, and it is online with HTTPS.
- New: every upload is a version — roll back with one click.
- New: hostile ZIP protection, file-type allowlist and per-site isolation.`, 'new', '2026-09-02T23:40:00Z'],
];

export function seedRoadmap(conn = getDb()) {
  const ins = conn.prepare("INSERT OR IGNORE INTO roadmap_items (id, title, body, status, category, sort_order, shipped_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const [id, title, body, status, category, sort] of SEED_ROADMAP) ins.run(id, title, body, status, category, sort, status === 'shipped' ? '2026-09-03T06:20:00Z' : null);
  const cl = conn.prepare('INSERT OR IGNORE INTO changelog (id, version, title, body, tags, published_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const row of SEED_CHANGELOG) cl.run(...row);
}
