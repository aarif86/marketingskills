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
import { entitlementsFor, extendPlan, getPlan } from './plans.js';
import { listSitesForUser, deleteSite } from './sites.js';
import { liveSubscriptionFor, paidUntil } from './hitpay.js';

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
export const AUTO_EXTEND_MAX_DAYS = 30;

export function autoExtendOrQueue({ user }) {
  const db = getDb();
  const ent = entitlementsFor(user);
  if (!ent.plan.trial_days) return { ok: false, reason: 'Your plan does not expire, so there is nothing to extend.' };
  const already = db.prepare("SELECT 1 FROM plan_events WHERE user_id = ? AND type = 'auto_extended'").get(user.id);
  if (already) return { auto: false };
  const days = Math.min(ent.plan.trial_days, AUTO_EXTEND_MAX_DAYS); // a long gift period does not double itself
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

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const period = (o) => (o.paid ? `your ${o.planName} plan` : 'your free period');
const keepLines = (o) => (o.paid
  ? `Keep going: choose a plan again on your Plan page and everything continues. ${platformUrl('/billing')}`
  : `Two ways to keep going, both take a minute:\n- Ask for more time (free): ${platformUrl('/billing')}\n- Move to Plus (no badge, five sites, help first in line): ${platformUrl('/pricing')}`);
const MAIL = {
  expiring_7: (u, when, _x, o = {}) => ({ subject: `${cap(period(o))} on NSD.SG ends in 7 days`, text: `Hi ${u.name || ''},\n\n${cap(period(o))} ends on ${when}. Your site stays online after that, but you will not be able to change it.\n\n${keepLines(o)}\n\nNSD.SG` }),
  expiring_1: (u, when, _x, o = {}) => ({ subject: `${cap(period(o))} on NSD.SG ends tomorrow`, text: `Hi ${u.name || ''},\n\nTomorrow (${when}) ${period(o)} ends. Your site stays online; changes pause.\n\n${keepLines(o)}\n\nNSD.SG` }),
  expired: (u, when, _x, o = {}) => ({ subject: `${cap(period(o))} on NSD.SG has ended`, text: `Hi ${u.name || ''},\n\n${cap(period(o))} ended on ${when}. Your site is still online, but publishing is paused.\n\n${keepLines(o)}\n\nWhat happens if you do nothing: after ${DORMANT_AFTER_DAYS} days your site shows a "this page has moved on" notice, and after ${DELETE_AFTER_DAYS} days it is removed. Your address is yours until then.\n\nNSD.SG` }),
  dormant: (u, _w, _x, o = {}) => ({ subject: `Your NSD.SG site now shows a holding page`, text: `Hi ${u.name || ''},\n\nIt has been ${DORMANT_AFTER_DAYS} days since ${period(o)} ended, so visitors to your site now see a short holding page instead of your content. Nothing is deleted.\n\nBring it back in one minute: ${platformUrl('/billing')}\n\nIf you do nothing, the site is removed after ${DELETE_AFTER_DAYS} days in total.\n\nNSD.SG` }),
  delete_warning: (u, _w, _x, o = {}) => ({ subject: `Your NSD.SG site will be removed in 7 days`, text: `Hi ${u.name || ''},\n\n${cap(period(o))} ended ${DELETE_WARN_DAYS} days ago. In 7 days your site and its files are removed and the address becomes available to others.\n\nTo keep it, choose a plan or ask for more time now: ${platformUrl('/billing')}\n\nNSD.SG` }),
  deleted: (u, when, names, o = {}) => ({ subject: `Your NSD.SG site has been removed`, text: `Hi ${u.name || ''},\n\nAs mentioned, ${names} ${String(names).includes(',') ? 'have' : 'has'} been removed after ${DELETE_AFTER_DAYS} days past the end of ${period(o)}. Your account is still here, and a copy of your files is kept for 90 more days: reply to this email if you want it.\n\nNSD.SG` }),
};

/** Idempotent daily-ish sweep. Safe to run every 10 minutes; each notice goes out once per expiry date. */
export async function lifecycleSweep({ now = Date.now() } = {}) {
  const db = getDb();
  const out = { reminded: 0, dormant: 0, warned: 0, deleted: 0, nudged: 0, renewals: 0 };
  const users = db.prepare("SELECT * FROM users WHERE status = 'active' AND plan_expires_at IS NOT NULL").all();
  for (const u of users) {
    if (liveSubscriptionFor(u.id, u.plan_id)) continue; // card saved, HitPay charges on the expiry date: nothing to remind
    const ref = u.plan_expires_at;
    const when = ref.slice(0, 10);
    const left = (Date.parse(ref) - now) / DAY;
    const gone = -left;
    const plan = getPlan(u.plan_id);
    const o = { paid: !!plan && plan.price_cents_month > 0, planName: plan?.name ?? 'Plus' };
    const send = async (kind, extra) => {
      if (alreadySent(u.id, kind, ref)) return false;
      markSent(u.id, kind, ref);
      const m = MAIL[kind](u, when, extra, o);
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
  out.nudged = await nudgeSweep({ now });
  out.renewals = await renewalSweep({ now });
  return out;
}

// Day-after nudge: signed up, picked an address, never published. One email, 24-72 h after sign-up, never again.
// The 72 h ceiling means a deploy of this feature does not mail every old silent account.
export async function nudgeSweep({ now = Date.now() } = {}) {
  const db = getDb();
  const rows = db.prepare(`SELECT u.* FROM users u WHERE u.status = 'active' AND u.role != 'admin'
      AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.user_id = u.id AND s.current_release_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM plan_notices n WHERE n.user_id = u.id AND n.kind = 'nudge_day0')`).all();
  let sent = 0;
  for (const u of rows) {
    const age = (now - Date.parse(u.created_at)) / DAY;
    if (age < 1 || age > 3) continue;
    const site = db.prepare("SELECT subdomain FROM sites WHERE user_id = ? AND status != 'deleted' ORDER BY created_at LIMIT 1").get(u.id);
    markSent(u.id, 'nudge_day0', u.created_at);
    const where = site ? `${site.subdomain}.${config.baseDomain}` : 'your address';
    const text = `Hi ${u.name || ''},\n\nYesterday you picked ${where} on NSD.SG. There is nothing on it yet, and it takes about a minute to change that.\n\nThree ways:\n1. Paste the code your AI gave you: ${platformUrl('/dashboard')}\n2. No page yet? Use one of ours (a proposal, a quiz, a one-page shop): ${platformUrl('/#try')}\n3. Let your AI do it for you: ${platformUrl('/connect')}\n\nStuck on anything at all? Reply to this email or WhatsApp a real human from any page: ${platformUrl('/contact')}\n\nNSD.SG`;
    await sendMail({ to: u.email, subject: `${where} is waiting for its first page`, text }).catch(() => {});
    sent += 1;
  }
  return sent;
}

// Yearly members get a heads-up 7 days before the automatic renewal. Monthly renewals are routine; HitPay receipts cover them.
export async function renewalSweep({ now = Date.now() } = {}) {
  const db = getDb();
  let sent = 0;
  const subs = db.prepare("SELECT s.*, u.email, u.name FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.status = 'active' AND s.last_paid_at IS NOT NULL AND u.status = 'active'").all();
  for (const s of subs) {
    const plan = getPlan(s.plan_id);
    if (plan?.features?.interval !== 'year') continue;
    const due = paidUntil(s.last_paid_at, 'canceled', 'year');
    const left = (Date.parse(due) - now) / DAY;
    if (left < 0 || left > 7 || alreadySent(s.user_id, 'renewal_7', due)) continue;
    markSent(s.user_id, 'renewal_7', due);
    const amount = `S$${((plan.features?.price_cents_total ?? plan.price_cents_month * 12) / 100).toFixed(0)}`;
    await sendMail({ to: s.email, subject: `Your ${plan.name} renews on ${due.slice(0, 10)}`, text: `Hi ${s.name || ''},\n\nA quick heads-up: your ${plan.name} renews automatically on ${due.slice(0, 10)} and your card will be charged ${amount} for the next year.\n\nNothing to do if you want to keep going. To stop, cancel before then from your Plan page: ${platformUrl('/billing')}. Your plan stays until the end of the year you have paid for.\n\nYou are a paying member, so you are first in line: reply to this email or WhatsApp a real human from any page.\n\nNSD.SG` }).catch(() => {});
    sent += 1;
  }
  return sent;
}

export const holdingUrl = (site) => publicUrlForSubdomain(site.subdomain);
export { nowIso };
