// Monthly transfer cap per site, enforced where the bytes leave: a site over its plan's allowance gets a small
// "paused for this month" page instead of its files. Cached per site for a minute so serving stays cheap.
import { entitlementsFor } from './plans.js';
import { monthlyBytesForSite } from './sites.js';

const cache = new Map(); // siteId -> { over, at }
const TTL = 60_000;

export function overBandwidth(site) {
  const hit = cache.get(site.id);
  if (hit && Date.now() - hit.at < TTL) return hit.over;
  const ent = entitlementsFor({ plan_id: site.plan_id, plan_expires_at: site.plan_expires_at, overrides_json: site.overrides_json });
  const limit = ent.limits.max_bandwidth_bytes_month;
  const over = !!limit && monthlyBytesForSite(site.id) > limit;
  cache.set(site.id, { over, at: Date.now() });
  return over;
}
export const resetBandwidthCache = () => cache.clear();
