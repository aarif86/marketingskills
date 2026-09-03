#!/usr/bin/env node
// Operator CLI: node src/cli.js <command>
import { getDb, migrate, closeDb } from './db/index.js';
import { createUser, findUserByEmail, setUserRole, changePassword } from './services/users.js';
import { assignPlan, listPlans } from './services/plans.js';
import { pruneReleases, cleanTemp } from './storage/releases.js';
import { config } from './config.js';
import { syncAll, syncSite, listOrphanDirs, isEnabled as hostingEnabled, provisionSubdomain } from './publish/hostinger.js';
import { expireStalePending } from './services/hitpay.js';

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'migrate': {
      migrate(getDb());
      console.log('Migrations applied.');
      break;
    }
    case 'make-admin': {
      const [email, password] = args;
      if (!email) throw new Error('usage: make-admin <email> [password]');
      let user = findUserByEmail(email);
      if (!user) {
        if (!password) throw new Error('user does not exist; pass a password to create it');
        user = await createUser({ email, password, role: 'admin', planId: 'plus', verified: true });
        console.log(`Created admin ${email}`);
      } else {
        setUserRole(user.id, 'admin');
        if (password) await changePassword(user.id, password);
        console.log(`Promoted ${email} to admin`);
      }
      break;
    }
    case 'set-plan': {
      const [email, planId] = args;
      const user = findUserByEmail(email);
      if (!user) throw new Error('no such user');
      const exp = assignPlan({ userId: user.id, planId, reason: 'cli' });
      console.log(`Plan set to ${planId}; expires ${exp ?? 'never'}`);
      break;
    }
    case 'plans': {
      for (const p of listPlans()) console.log(`${p.id.padEnd(12)} ${p.name.padEnd(12)} SGD ${(p.price_cents_month / 100).toFixed(2)}/mo  trial=${p.trial_days ?? '-'}  limits=${JSON.stringify(p.limits)}`);
      break;
    }
    case 'prune': {
      const db = getDb();
      let n = 0;
      for (const s of db.prepare("SELECT id FROM sites WHERE status != 'deleted'").all()) n += pruneReleases(s.id, 3);
      n += cleanTemp(0);
      console.log(`Pruned ${n} items.`);
      break;
    }
    case 'stats': {
      const db = getDb();
      const q = (sql) => db.prepare(sql).get().n;
      console.log({
        users: q('SELECT COUNT(*) n FROM users'),
        sites: q("SELECT COUNT(*) n FROM sites WHERE status != 'deleted'"),
        live: q("SELECT COUNT(*) n FROM sites WHERE status = 'live'"),
        storageBytes: q("SELECT COALESCE(SUM(total_storage_bytes),0) n FROM sites WHERE status != 'deleted'"),
        dataDir: config.dataDir,
      });
      break;
    }
    case 'sync-all': {
      if (!hostingEnabled()) throw new Error('TENANT_ROOT is not set; nothing to sync');
      console.log(await syncAll());
      const timedOut = expireStalePending();
      if (timedOut) console.log(`Timed out ${timedOut} unpaid HitPay checkout(s)`);
      const orphans = listOrphanDirs();
      if (orphans.length) console.log('Orphan tenant dirs (not owned by any site):', orphans.join(', '));
      break;
    }
    case 'sync-site': {
      const [name] = args;
      const row = getDb().prepare("SELECT id FROM sites WHERE subdomain = ? AND status != 'deleted'").get(name);
      if (!row) throw new Error('no such site');
      await provisionSubdomain(name);
      console.log(syncSite(row.id));
      break;
    }
    case 'hosting': {
      const db = getDb();
      console.log({ enabled: hostingEnabled(), tenantRoot: config.hostinger.tenantRoot, username: config.hostinger.username, apiToken: config.hostinger.apiToken ? 'set' : 'MISSING',
        byState: db.prepare("SELECT hosting_state, COUNT(*) n FROM sites WHERE status != 'deleted' GROUP BY hosting_state").all(),
        errors: db.prepare("SELECT subdomain, hosting_error FROM sites WHERE hosting_state = 'error' LIMIT 20").all() });
      break;
    }
    default:
      console.log(`NSD.SG CLI
  migrate                       apply schema/migrations
  make-admin <email> [password] create or promote an admin
  set-plan <email> <planId>     assign a plan (free | plus | community | ...)
  plans                         list plans
  prune                         prune old releases + temp files
  stats                         quick counts
  sync-all                      (Hostinger) provision pending subdomains + rebuild every tenant docroot
  sync-site <name>              (Hostinger) provision + rebuild one site
  hosting                       (Hostinger) publisher status`);
  }
  closeDb();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
