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

export function listChangelog(limit = 50) {
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
  ['rm-mcp', 'Publish straight from Claude', 'Add NSD.SG to Claude once, then say “publish this as my-site” and get a live link back. Tokens you can revoke, same rules as the dashboard.', 'shipped', 'platform', 8],
  ['rm-lifecycle', 'Clear rules when a free period ends', 'Site stays online, changes pause; own domain off after 30 days, holding page after 60, removed after 150 with emails before each step.', 'shipped', 'billing', 11],
  ['rm-file-list', 'A tidy file list when there is no home page', 'Upload a few PDFs and nothing else, and visitors get a clean NSD.SG-style list instead of “page not found”.', 'shipped', 'platform', 12],
  ['rm-self-heal', 'Addresses that fix themselves', 'If Hostinger misses creating an address, NSD.SG retries on its own and tells admin if it stays stuck.', 'shipped', 'platform', 13],
  ['rm-abuse-tools', 'Blocked words, evidence holds and share cards', 'Admin-managed blocked words, 90-day evidence copies of removed sites, and proper link previews on WhatsApp and Telegram.', 'shipped', 'admin', 14],
  ['rm-domain-buy', 'Buy a domain inside NSD.SG', 'Search, pay and connect a name without leaving the site. Needs a registrar arrangement first.', 'planned', 'billing', 21],
  ['rm-capacity', 'Capacity gauge and waitlist mode', 'Admin sees how close the hosting is to its limits; sign-ups switch to a waitlist automatically near the ceiling.', 'planned', 'admin', 22],
  ['rm-email-gate', 'Confirm your email before the first publish', 'A small gate that keeps throwaway accounts from putting pages online.', 'planned', 'admin', 23],
  ['rm-vs-pages', 'Honest comparisons with Vercel and shared hosting', 'Two pages that show what a one-page site really costs elsewhere.', 'planned', 'design', 45],
  ['rm-try-it', 'Try it before you sign up', 'Paste the code on the home page, no account, and get a link that works for 3 hours. Sign up to keep it at your own address.', 'shipped', 'platform', 9],
  ['rm-google-login', 'Sign in with Google', 'One-click sign-up and login with a Google account, alongside email + password.', 'shipped', 'platform', 10],
  ['rm-custom-domain', 'Connect your own domain', 'Point www.yourdomain.sg at your NSD.SG site with a guided DNS check. Plus and Beta.', 'shipped', 'platform', 20],
  ['rm-expiry-emails', 'Reminder emails before your free period ends', 'Emails 7 days and 1 day before, on the day, and before a site is removed. First extension is granted instantly.', 'shipped', 'billing', 30],
  ['rm-analytics', 'Simple visitor stats per site', 'Visits and top pages for each site, privacy-friendly, no cookies.', 'planned', 'dashboard', 40],
  ['rm-demo-video', 'A 60-second "upload to live" walkthrough', 'Short video on the home page showing claim → upload → open.', 'planned', 'design', 50],
  ['rm-psl', 'Stronger isolation between sites', 'Registering nsd.sg on the Public Suffix List so browsers treat every site as fully separate.', 'planned', 'platform', 5],
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
