// Self-aware hosting status. Hostinger publishes a Statuspage.io feed; we read its summary every 10 minutes
// (cached in DATA_DIR/status.json because the process is killed when idle) and show a plain-words bar on every
// platform page when maintenance or an incident touches the servers we sit on. Nothing for admin to do.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const REFRESH_MS = 10 * 60_000;
const LOOKAHEAD_MS = 24 * 60 * 60_000;
let fetchImpl = (...a) => fetch(...a);
export function setFetch(fn) { fetchImpl = fn ?? ((...a) => fetch(...a)); }

const file = () => path.join(config.dataDir, 'status.json');
let mem = null;          // { fetched_at, ok, notices: [...], error }
let inflight = null;

function load() {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { mem = { fetched_at: 0, ok: false, notices: [], error: '' }; }
  return mem;
}
function save(v) { mem = v; try { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(file(), JSON.stringify(v)); } catch { /* memory only */ } }

const sgt = (iso) => new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(/\s*(am|pm)$/i, (m) => m.trim().toLowerCase());

/** Does this entry concern us? Server name from config, else anything Singapore/Asia-wide. */
function relevant(text) {
  const t = String(text ?? '').toLowerCase();
  const mine = String(config.hostinger.serverName ?? '').toLowerCase();
  if (mine && t.includes(mine)) return true;
  return /singapore|\bsg-|\basia\b|all servers|all customers|node\.?js|hpanel/.test(t);
}

/** Turn a Statuspage summary into plain-words notices. */
export function noticesFrom(summary, now = Date.now()) {
  const out = [];
  for (const m of summary?.scheduled_maintenances ?? []) {
    const text = `${m.name} ${(m.incident_updates ?? []).map((u) => u.body).join(' ')}`;
    if (!relevant(text)) continue;
    const start = Date.parse(m.scheduled_for); const end = Date.parse(m.scheduled_until);
    if (m.status === 'in_progress' || (start <= now && end >= now)) {
      out.push({ level: 'warn', text: `Our hosting provider is doing maintenance on the servers in Singapore until about ${sgt(m.scheduled_until)} Singapore time. Pages may load slowly or fail for a few minutes. Nothing is lost; please try again shortly.`, url: m.shortlink, id: m.id });
    } else if (m.status === 'scheduled' && start > now && start - now <= LOOKAHEAD_MS) {
      out.push({ level: 'info', text: `Planned maintenance by our hosting provider ${sgt(m.scheduled_for)} to ${sgt(m.scheduled_until)} Singapore time. Sites may be slow or briefly unreachable during that window.`, url: m.shortlink, id: m.id });
    }
  }
  for (const i of summary?.incidents ?? []) {
    if (i.status === 'resolved' || i.status === 'postmortem') continue;
    const text = `${i.name} ${(i.incident_updates ?? []).map((u) => u.body).join(' ')}`;
    if (!relevant(text) && !['major', 'critical'].includes(i.impact)) continue;
    out.push({ level: 'warn', text: `Our hosting provider is dealing with a problem right now (“${String(i.name).slice(0, 80)}”). Some pages may not load. Nothing is lost.`, url: i.shortlink, id: i.id });
  }
  return out;
}

/** Fetch if stale. Never throws; keeps the last good answer on failure. */
export async function refresh({ force = false } = {}) {
  const cur = load();
  if (!force && Date.now() - (cur.fetched_at ?? 0) < REFRESH_MS) return cur;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetchImpl(config.hostinger.statusUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const summary = await res.json();
      const v = { fetched_at: Date.now(), ok: true, notices: noticesFrom(summary), error: '', page: summary?.page?.url ?? '', overall: summary?.status?.description ?? '' };
      save(v); return v;
    } catch (e) {
      const v = { ...cur, fetched_at: Date.now(), ok: false, error: String(e.message).slice(0, 120) };
      save(v); return v;
    } finally { inflight = null; }
  })();
  return inflight;
}

/** Synchronous: what to show on this page load (and kick a refresh in the background when stale). */
export function currentNotices() {
  const cur = load();
  if (Date.now() - (cur.fetched_at ?? 0) >= REFRESH_MS) refresh().catch(() => {});
  return cur.notices ?? [];
}
export function statusInfo() { return load(); }
