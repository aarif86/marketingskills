// First-party page views for the platform's own public pages (home, pricing, FAQ, sign-up …).
// No cookies, no IPs, no fingerprints: one counter per day, hour, path, referrer domain and device class.
// Enough to answer "did Sunday's post do anything, and from where", nothing that needs a consent banner.
import { getDb } from '../db/index.js';

const BOT_RE = /bot|crawl|spider|slurp|preview|whatsapp|facebookexternalhit|telegram|twitterbot|linkedinbot|discordbot|skypeuripreview|curl\/|wget\/|python-requests|headlesschrome|lighthouse|pingdom|uptime/i;
export const isBot = (ua) => !ua || BOT_RE.test(String(ua));
export const deviceOf = (ua) => (/Mobi|Android|iPhone|iPad|iPod/i.test(String(ua ?? '')) ? 'phone' : 'desktop');

/** Referrer domain, or '' for none / our own platform host. Tenant sites (name.nsd.sg) count as real referrers. */
export function refHost(referer, selfHosts = []) {
  try {
    const h = new URL(String(referer)).hostname.toLowerCase().replace(/^www\./, '');
    if (!h || selfHosts.includes(h)) return '';
    return h.slice(0, 80);
  } catch { return ''; }
}

const buffer = new Map();

export function recordPageView({ path, ua, referer, selfHosts = [] }) {
  if (isBot(ua)) return false;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const p = String(path ?? '/').split('?')[0].slice(0, 120) || '/';
  const ref = refHost(referer, selfHosts);
  const device = deviceOf(ua);
  const key = `${day}|${hour}|${p}|${ref}|${device}`;
  const cur = buffer.get(key) ?? { day, hour, path: p, ref, device, n: 0 };
  cur.n += 1;
  buffer.set(key, cur);
  return true;
}

let stmt;
export function flushPageViews() {
  if (buffer.size === 0) return 0;
  const db = getDb();
  stmt ??= db.prepare(`INSERT INTO page_views (day, hour, path, ref_host, device, n) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, hour, path, ref_host, device) DO UPDATE SET n = n + excluded.n`);
  const rows = [...buffer.values()];
  buffer.clear();
  db.transaction(() => { for (const r of rows) stmt.run(r.day, r.hour, r.path, r.ref, r.device, r.n); })();
  return rows.length;
}

/** Numbers for the admin "This week" card. Days are UTC; Singapore evenings land on the same date for most of the day. */
export function pageViewStats({ days = 14 } = {}) {
  flushPageViews();
  const db = getDb();
  const since = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const perDayRows = db.prepare('SELECT day, SUM(n) n FROM page_views WHERE day >= ? GROUP BY day').all(since(days - 1));
  const byDay = Object.fromEntries(perDayRows.map((r) => [r.day, r.n]));
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) { const d = since(i); perDay.push({ day: d, n: byDay[d] ?? 0 }); }
  const sum = (from) => db.prepare('SELECT COALESCE(SUM(n), 0) n FROM page_views WHERE day >= ?').get(from).n;
  const today = byDay[since(0)] ?? 0;
  const yesterday = byDay[since(1)] ?? 0;
  const week = sum(since(6));
  const prevWeek = sum(since(13)) - week;
  const referrers = db.prepare("SELECT ref_host host, SUM(n) n FROM page_views WHERE day >= ? AND ref_host != '' GROUP BY ref_host ORDER BY n DESC LIMIT 8").all(since(6));
  const pages = db.prepare('SELECT path, SUM(n) n FROM page_views WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 8').all(since(6));
  const phone = db.prepare("SELECT COALESCE(SUM(n), 0) n FROM page_views WHERE day >= ? AND device = 'phone'").get(since(6)).n;
  const busiestHour = db.prepare('SELECT hour, SUM(n) n FROM page_views WHERE day >= ? GROUP BY hour ORDER BY n DESC LIMIT 1').get(since(6));
  return { perDay, today, yesterday, week, prevWeek, referrers, pages, phoneShare: week ? Math.round((phone / week) * 100) : 0, busiestHourSgt: busiestHour ? (busiestHour.hour + 8) % 24 : null };
}

/** The 1×1 GIF answered to the per-site visit beacon. */
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
