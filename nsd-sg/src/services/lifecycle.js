// What happens as a free period runs out, without anyone watching:
//   7 days and 1 day before: reminder email.          day 0: "paused" email; publishing stops, site stays up.
//   +30 days: own domains stop answering (redirect to the nsd.sg address).
//   +60 days: the site shows a holding page ("dormant"); files kept.   +143 days: deletion warning email.
//   +150 days: sites deleted (evidence hold keeps a copy 90 more days), account stays.
// Paid subscriptions never expire on their own (plan_expires_at is NULL), so none of this touches them.
import { config, publicUrlForSubdomain, platformUrl } from '../config.js';
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { sendMail } from '../lib/mailer.js';
import { entitlementsFor, extendPlan } from './plans.js';
import { listSitesForUser, deleteSite } from './sites.js';

export const DOMAIN_GRACE_DAYS = 30;
export const DORMANT_AFTER_DAYS = 60;
export const DELETE_WARN_DAYS = 143;
export const DELETE_AFTER_DAYS = 150;

const DAY = 86400000;

/** Days since the plan expired (0 when still active or never expires). */
export function daysExpired(user) {
  if (!user?.plan_expires_at) return 0;
  const d = (Date.now() - Date.parse(user.plan_expires_at)) / DAY;
  return d > 0 ? d : 0;
}
export const domainsOff = (user) => daysExpired(user) >= DOMAIN_GRACE_DAYS;
export const isDormant = (user) => daysExpired(user) >= DORMANT_AFTER_DAYS;

/** First extension is granted on the spot; from the second one on it goes to admin. */
export function autoExtendOrQueue({ user }) {
  const db = getDb();
  const ent = entitlementsFor(user);
  if (!ent.plan.trial_days) return { ok: false, reason: 'Your plan does not expire, so there is nothing to extend.' };
  const already = db.prepare("SELECT 1 FROM plan_events WHERE user_id = ? AND type = 'auto_extended'").get(user.id);
  if (already) return { auto: false };
  const days = ent.plan.trial_days;
  extendPlan({ userId: user.id, days, actorId: user.id, type: 'auto_extended', reason: 'first extension, granted automatically' });
  const until = db.prepare('SELECT plan_expires_at FROM users WHERE id = ?').get(user.id).plan_expires_at;
  return { auto: true, days, until };
}

function alreadySent(userId, kind, ref) {
  return !!getDb().prepare('SELECT 1 FROM plan_notices WHERE user_id = ? AND kind = ? AND ref = ?').get(userId, kind, ref);
}
function markSent(userId, kind, ref) {
  getDb().prepare('INSERT OR IGNORE INTO plan_notices (user_id, kind, ref) VALUES (?, ?, ?)').run(userId, kind, ref);
}

const MAIL = {
  expiring_7: (u, when) => ({ subject: `Your free period on NSD.SG ends in 7 days`, text: `Hi ${u.name || ''},\n\nYour free period ends on ${when}. Your site stays online after that, but you will not be able to change it.\n\nTwo ways to keep going, both take a minute:\n- Ask for more time (free): ${platformUrl('/billing')}\n- Move to Plus (your own domain name, no badge): ${platformUrl('/pricing')}\n\nNSD.SG` }),
  expiring_1: (u, when) => ({ subject: `Your free period on NSD.SG ends tomorrow`, text: `Hi ${u.name || ''},\n\nTomorrow (${when}) your free period ends. Your site stays online; changes pause.\n\nAsk for more time or upgrade here: ${platformUrl('/billing')}\n\nNSD.SG` }),
  expired: (u, when) => ({ subject: `Your NSD.SG free period has ended`, text: `Hi ${u.name || ''},\n\nYour free period ended on ${when}. Your site is still online, but publishing is paused.\n\nTo pick up where you left off: ${platformUrl('/billing')}\n\nWhat happens if you do nothing: after ${DORMANT_AFTER_DAYS} days your site shows a "this page has moved on" notice, and after ${DELETE_AFTER_DAYS} days it is removed. Your address is yours until then.\n\nNSD.SG` }),
  dormant: (u) => ({ subject: `Your NSD.SG site now shows a holding page`, text: `Hi ${u.name || ''},\n\nIt has been ${DORMANT_AFTER_DAYS} days since your free period ended, so visitors to your site now see a short holding page instead of your content. Nothing is deleted.\n\nBring it back in one minute: ${platformUrl('/billing')}\n\nIf you do nothing, the site is removed after ${DELETE_AFTER_DAYS} days in total.\n\nNSD.SG` }),
  delete_warning: (u) => ({ subject: `Your NSD.SG site will be removed in 7 days`, text: `Hi ${u.name || ''},\n\nYour free period ended ${DELETE_WARN_DAYS} days ago. In 7 days your site and its files are removed and the address becomes available to others.\n\nTo keep it: ${platformUrl('/billing')}\n\nNSD.SG` }),
  deleted: (u, when, names) => ({ subject: `Your NSD.SG site has been removed`, text: `Hi ${u.name || ''},\n\nAs mentioned, ${names} ${names.includes(',') ? 'have' : 'has'} been removed after ${DELETE_AFTER_DAYS} days past the end of your free period. Your account still works, and you can make a new site any time: ${platformUrl('/dashboard')}\n\nNSD.SG` }),
};

/** Idempotent daily-ish sweep. Safe to run every 10 minutes; each notice goes out once per expiry date. */
export async function lifecycleSweep({ now = Date.now() } = {}) {
  const db = getDb();
  const out = { reminded: 0, dormant: 0, warned: 0, deleted: 0 };
  const users = db.prepare("SELECT * FROM users WHERE status = 'active' AND plan_expires_at IS NOT NULL").all();
  for (const u of users) {
    const ref = u.plan_expires_at;
    const when = ref.slice(0, 10);
    const left = (Date.parse(ref) - now) / DAY;
    const gone = -left;
    const send = async (kind, extra) => {
      if (alreadySent(u.id, kind, ref)) return false;
      markSent(u.id, kind, ref);
      const m = MAIL[kind](u, when, extra);
      await sendMail({ to: u.email, ...m }).catch(() => {});
      return true;
    };
    if (left > 0 && left <= 7 && await send('expiring_7')) out.reminded++;
    if (left > 0 && left <= 1 && await send('expiring_1')) out.reminded++;
    if (gone >= 0 && gone < DORMANT_AFTER_DAYS && await send('expired')) out.reminded++;
    if (gone >= DORMANT_AFTER_DAYS && gone < DELETE_WARN_DAYS && await send('dormant')) out.dormant++;
    if (gone >= DELETE_WARN_DAYS && gone < DELETE_AFTER_DAYS && await send('delete_warning')) out.warned++;
    if (gone >= DELETE_AFTER_DAYS) {
      const sites = listSitesForUser(u.id);
      if (sites.length && !alreadySent(u.id, 'deleted', ref)) {
        for (const s of sites) deleteSite(s.id, { reason: `removed ${DELETE_AFTER_DAYS} days after the free period ended` });
        db.prepare("INSERT INTO plan_events (id, user_id, type, from_plan, to_plan, details, created_by) VALUES (lower(hex(randomblob(13))), ?, 'sites_removed', ?, ?, ?, NULL)").run(u.id, u.plan_id, u.plan_id, JSON.stringify({ sites: sites.map((s) => s.subdomain) }));
        await send('deleted', sites.map((s) => `${s.subdomain}.${config.baseDomain}`).join(', '));
        out.deleted += sites.length;
      }
    }
  }
  return out;
}

export const holdingUrl = (site) => publicUrlForSubdomain(site.subdomain);
export { nowIso };
