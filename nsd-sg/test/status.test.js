import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from './helpers/env.js';
const { buildApp } = await import('../src/server.js');
const { setFetch, refresh, noticesFrom } = await import('../src/services/status.js');
let app;
before(async () => { app = await buildApp({ logger: false }); });
after(async () => { await app.close(); cleanup(); });
const get = (url) => app.inject({ method: 'GET', url, headers: { host: 'nsd.test' } });
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();

test('maintenance on the Singapore servers becomes a plain-words bar on every page; unrelated regions do not', async () => {
  const summary = { page: { url: 'https://statuspage.hostinger.com' }, status: { description: 'Partially Degraded' }, incidents: [],
    scheduled_maintenances: [
      { id: 'm1', name: 'Server sg-nme-srv175 Maintenance', status: 'in_progress', scheduled_for: iso(-1), scheduled_until: iso(1), shortlink: 'https://stspg.io/x', incident_updates: [{ body: 'sg-nme-srv175 server located in Singapore is currently undergoing maintenance.' }] },
      { id: 'm2', name: 'Server br-srv9 Maintenance', status: 'in_progress', scheduled_for: iso(-1), scheduled_until: iso(1), incident_updates: [{ body: 'Brazil server maintenance' }] },
      { id: 'm3', name: 'Asia network upgrade', status: 'scheduled', scheduled_for: iso(5), scheduled_until: iso(7), incident_updates: [] },
    ] };
  const n = noticesFrom(summary);
  assert.equal(n.length, 2);
  assert.match(n[0].text, /maintenance on the servers in Singapore until about/);
  assert.equal(n[0].level, 'warn');
  assert.match(n[1].text, /Planned maintenance/);
  setFetch(async () => ({ ok: true, json: async () => summary }));
  const r = await refresh({ force: true });
  assert.equal(r.ok, true);
  for (const u of ['/', '/pricing', '/login']) { const b = (await get(u)).body; assert.match(b, /class="host-bar warn"[\s\S]*servers in Singapore/, u); assert.doesNotMatch(b, /Planned maintenance/, 'only the live one shows'); }
  // a failed read keeps the last good notices
  setFetch(async () => { throw new Error('boom'); });
  const r2 = await refresh({ force: true });
  assert.equal(r2.ok, false);
  assert.equal(r2.notices.length, 2, 'kept');
  // all clear removes the bar
  setFetch(async () => ({ ok: true, json: async () => ({ incidents: [], scheduled_maintenances: [] }) }));
  await refresh({ force: true });
  assert.doesNotMatch((await get('/')).body, /host-bar/);
  assert.match((await get('/')).body, /class="hero-new"/, 'latest release pill on the home page');
});
