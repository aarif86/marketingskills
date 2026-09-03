// Roadmap + changelog. Seeded once with the real history; admin edits from /admin/roadmap and /admin/changelog.
import { getDb } from '../db/index.js';
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

export function deleteItem(id) { getDb().prepare('DELETE FROM roadmap_items WHERE id = ?').run(id); }

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
  ['rm-google-login', 'Sign in with Google', 'One-click sign-up and login with a Google account, alongside email + password.', 'planned', 'platform', 10],
  ['rm-custom-domain', 'Connect your own domain', 'Point www.yourdomain.sg at your NSD.SG site with a guided DNS check. Add-on for Plus and Beta.', 'planned', 'platform', 20],
  ['rm-expiry-emails', 'Reminder emails before your free period ends', 'A heads-up at day 76, a grace period, and a clear path to extend or upgrade — no surprises.', 'planned', 'billing', 30],
  ['rm-analytics', 'Simple visitor stats per site', 'Visits and top pages for each site, privacy-friendly, no cookies.', 'planned', 'dashboard', 40],
  ['rm-demo-video', 'A 60-second "upload to live" walkthrough', 'Short video on the home page showing claim → upload → open.', 'planned', 'design', 50],
  ['rm-psl', 'Stronger isolation between sites', 'Registering nsd.sg on the Public Suffix List so browsers treat every site as fully separate.', 'in_progress', 'platform', 5],
  ['rm-zip-drop', 'Drag-and-drop ZIP or folder upload', 'Drop a ZIP, files or a whole folder; every upload is a version you can roll back to.', 'shipped', 'dashboard', 900],
  ['rm-badge', 'Powered-by badge with a demo page', 'Free sites carry a small badge; Plus removes it. See exactly what it looks like at /badge.', 'shipped', 'design', 901],
  ['rm-showcase', 'Public showcase of hosted sites', 'Every live site listed at /showcase; Plus and Beta can opt out.', 'shipped', 'platform', 902],
  ['rm-hitpay', 'Card payments through HitPay', 'Plus and Beta subscriptions billed monthly by card, activated automatically.', 'shipped', 'billing', 903],
  ['rm-promo', 'Promo codes for beta testers', 'Codes that unlock the Beta plan: 3 sites, no badge, 90 days free.', 'shipped', 'billing', 904],
  ['rm-steps', 'Three-step guide on every site page', 'Claim → publish → open, with an SSL heads-up for brand-new addresses.', 'shipped', 'dashboard', 905],
  ['rm-mobile', 'Mobile-first redesign', 'New navigation drawer, pill buttons and motion across the whole site.', 'shipped', 'design', 906],
  ['rm-watchdog', 'Abuse-name watchdog', 'Names that break the terms (adult, gambling, scams, impersonation) are refused at signup and logged.', 'shipped', 'admin', 907],
];
const SEED_CHANGELOG = [
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
