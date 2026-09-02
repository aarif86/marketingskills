# 06 · Operations: backups, monitoring, maintenance, troubleshooting

## Daily automation (installed by `setup-vps.sh`)

| When (UTC) | What | Where |
|---|---|---|
| 03:15 daily | `nsd-backup`: consistent SQLite snapshot + tar of `sites/` → `/var/backups/nsd`, 14-day retention, optional `rclone` off-box | `deploy/scripts/backup.sh` |
| 04:30 Sunday | `node src/cli.js prune`: prune releases beyond plan retention, clear stale temp files | `src/cli.js` |
| every 15 s (in-app) | flush traffic counters | `src/server.js` |
| every 10 min (in-app) | purge expired sessions, delete temp uploads older than 1 h | `src/server.js` |

**Off-box backups:** install `rclone`, configure a remote (Backblaze B2 or any S3), then set
`BACKUP_REMOTE=b2:nsd-backups` in `/etc/cron.d/nsd`'s environment or export it in the backup line.

**Test a restore quarterly:** `bash deploy/scripts/restore.sh /var/backups/nsd/<archive>` on a
scratch VPS, or against a second Docker volume by overriding `VOLUME=`.

## Monitoring

* **Uptime:** point any monitor (UptimeRobot, Better Stack, Hostinger's own) at
  `https://nsd.sg/healthz` (expects HTTP 200 and `"ok":true`) and at one tenant, e.g.
  `https://demo.nsd.sg/` (create a demo site).
* **In-app:** `/admin/health` shows disk, memory, load, DB size, top bandwidth and largest sites;
  `/admin` shows security events (`warn`/`alert`), abuse queue and expiring plans.
* **Logs:** `docker compose -f deploy/docker-compose.yml logs -f app` (JSON lines, pino). Caddy
  access logs: `... logs -f caddy`.
* **Disk:** the health page warns above 85%. Fix: prune, delete abusive sites, or resize the VPS.

## Routine tasks

| Task | How |
|---|---|
| Promote/create admin | `docker exec -it nsd-app node src/cli.js make-admin you@nsd.sg 'strong-password'` |
| Give someone the Community plan | Admin → Users → user → Set plan → `community` (or `node src/cli.js set-plan email community`) |
| Remove the badge for one client | Admin → Users → Overrides → Badge = removed (or per site: Admin → Sites → Remove badge) |
| Grant a 90-day extension | Admin → Overview → “+90 days” next to the request |
| Take a phishing site down | Admin → Abuse → suspend site (or Sites → Suspend / Reclaim) |
| Reserve a brand name | Admin → Reserved names |
| Rotate `SESSION_SECRET` | edit `.env`, restart app (all users log out) |
| Update code | `git pull && docker compose -f deploy/docker-compose.yml up -d --build app` |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `https://x.nsd.sg` shows browser TLS error, `https://nsd.sg` fine | on-demand mode: tls-ask refused (site not in DB) or LE rate limit | Check `docker logs nsd-caddy`; confirm the site exists; consider `TLS_MODE=wildcard` |
| Wildcard mode fails to get a cert | Cloudflare token lacks DNS:Edit, or DNS not on Cloudflare | `docker logs nsd-caddy`; fix token/zone |
| 421 Misdirected request | Host not in `PLATFORM_HOSTS` (e.g. raw IP) | expected; use the domain |
| Upload returns 413 | file > `MAX_UPLOAD_BYTES` or Caddy `max_size` | raise both, restart |
| “Security token expired” on upload | CSRF token stale (long-open page) or Origin mismatch behind a different hostname | reload the page |
| Site says “Coming soon” after upload | no `index.html` at top level (wrapper folder not stripped because the ZIP had several top-level entries) | user should re-zip the folder contents; the file list warns about this |
| Emails not arriving | `SMTP_*` blank (mails logged to stdout) or SPF/DKIM missing | configure a transactional provider |
| `SQLITE_BUSY` in logs | very rare under WAL; long backup while heavy writes | busy_timeout is 5 s; retry; schedule backups off-peak |
| Disk full | runaway site or many releases | `node src/cli.js prune`; check `/admin/health` largest sites |
| App container restarting | bad `.env` (e.g. `SESSION_SECRET` too short) | `docker logs nsd-app` shows the boot error |

## Security incident playbook

1. Suspend the site/user in Admin (instant, audited). 2. Export evidence: `docker exec nsd-app
tar czf - /var/lib/nsd/sites/<siteId> > evidence.tgz`. 3. Reclaim the subdomain if it was
brand-abusive. 4. Note the resolution on the abuse report. 5. If credentials may be compromised,
rotate `SESSION_SECRET` and force password resets for affected users (Admin → user → Log out
everywhere + ask them to use “Forgot password”).

## Capacity planning

KVM 1 (1 vCPU / 4 GB) comfortably serves ~200 req/s of static files. Upgrade triggers: sustained
load > 1.0, disk > 70%, or bandwidth > 2 TB/month. Next steps in order: KVM 2 → Cloudflare proxied
(cache HTML 60 s, assets 1 h) → object storage for releases → second app node behind Cloudflare
load balancing (rate-limit store to Redis at that point).
