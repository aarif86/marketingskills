<!--
====================================================================
  DOC 07 — NSD.SG on Hostinger managed hosting (Cloud Startup)
  Created: 3 Sep 2026, 07:40 SGT
  By Aarif Raziff

  Milestone log:
  [3 Sep 2026] — First version. Written while moving the platform from the
                 VPS design (docs/04) onto the existing Cloud Startup account
                 because no VPS exists. Facts below were verified with a probe
                 app deployed to nsd.sg, not assumed.

  Notes/mood: (not captured)
====================================================================
-->

# 07 · Running NSD.SG on Hostinger managed hosting

**Why this document exists.** Docs 01–04 assume a KVM VPS with Docker and Caddy. The account has no VPS; it has
two Cloud Startup plans. This is the deployment that actually runs: the Fastify app on Hostinger's managed Node.js
runtime, tenants served by LiteSpeed as ordinary subdomains. Nothing in docs 01–06 is wrong for a VPS; this is the
alternative path and it is the live one.

## The shape of it

```
https://nsd.sg  ──▶ LiteSpeed ──▶ lsnode (Unix socket) ──▶ server.cjs ──▶ src/start.js ──▶ Fastify app
                                                                                   │
                       DATA_DIR = ~/domains/nsd.sg/nsd-data/  (SQLite, releases/, tmp/, session-secret, .env)
                                                                                   │ syncSite() on every change
https://<name>.nsd.sg ──▶ LiteSpeed static vhost ──▶ ~/domains/nsd.sg/public_html/tenants/<name>/  (badge baked in)
```

- `src/publish/hostinger.js` is the new piece. It turns the DB's view of a site (release, status, branding,
  owner status/plan) into a document root and swaps it in atomically (`<name>.new` → rename). Release directories
  under `DATA_DIR/sites/…` stay pristine; versions and rollback work exactly as before.
- Badge enforcement moved from serve-time to publish-time. A tenant *can* strip it by editing files? No — files are
  regenerated from the pristine release on every publish, and the served copy is not user-writable. What remains is
  the same client-side caveat as before (JavaScript can remove DOM nodes); the ToS covers it.
- Subdomains are created through the Hostinger API (`POST /api/hosting/v1/accounts/{username}/websites/{domain}/subdomains`
  with `directory: tenants/<name>`). DNS records and the free SSL for each subdomain are handled by hPanel because
  nsd.sg uses Hostinger nameservers (artemis/hermes.dns-parking.com).
- Each tenant docroot gets a generated `.htaccess`: no indexes, no CGI/PHP, dotfiles denied, clean URLs, custom 404,
  security headers. Suspended sites get a single notice page for every path; empty sites a "coming soon" page.

## Verified runtime facts (probe, 3 Sep 2026)

| Fact | Value |
|---|---|
| Runtime | LiteSpeed `lsnode.js`, Node 22.18, `PassengerStartupFile server.cjs` written into `public_html/.htaccess` |
| Entry file | Must be **CommonJS**. lsnode `require()`s it; an ESM file with top-level `await` fails silently → 503. `server.cjs` does `import('./src/start.js')`. |
| listen() | Intercepted; port is ignored; the app is bound to `/usr/local/lsws/extapp-sock/nsd.sg:_.sock`. Must be called within **3 s** of start. |
| Process | Spawned on demand, **killed after 30 s idle** (`LSAPI_PGRP_MAX_IDLE=30`), 180 s max per request. In-memory state (rate limits, traffic buffer) is short-lived. |
| `HOME` at runtime | `/home/u162210766/domains/nsd.sg` (not the account home) — never derive paths from `os.homedir()`. |
| App root | `~/domains/nsd.sg/hbuilds/current/nodejs` → symlink to `hbuilds/versions/<build-uuid>`; old versions are pruned. Anything written there is lost on deploy. |
| `public_html` | Real directory, **persists across deploys** (only `.htaccess` is regenerated). Tenants live in `public_html/tenants/`. |
| Filesystem | Full read/write inside the account; hard links, atomic rename and better-sqlite3 (prebuilt binary) all work. |
| Outbound HTTPS | Allowed (developers.hostinger.com reachable from the app). |
| Proxy headers | `x-real-ip`, `x-forwarded-for`, `x-forwarded-proto`; remote address is 127.0.0.1 → `TRUST_PROXY=127.0.0.1`. |
| LSCache | Present (`x-lscache: 1`); the app sends `Cache-Control: private, no-store` on every platform response. |
| Hostinger probe | After each deploy Hostinger requests `/` on `grey-lobster-115902.hostingersite.com` — that host is in `PLATFORM_HOSTS` so it is not refused with 421. |
| Logs | Runtime stdout/stderr → `hbuilds/current/nodejs/console.log` (visible in hPanel); build logs via the API. |

## Deploying

1. `deploy/hostinger/build-archive.sh` → `nsd-sg_<date>.zip` (package.json, lockfile, `server.cjs`, `src/`, and
   `deploy/hostinger/env.hostinger` as `.env`). No `node_modules`, no data, no secrets.
2. Upload through the Hostinger MCP (`hosting_deployJsApplication`, domain `nsd.sg`) or hPanel → Node.js →
   Deploy from archive. Hostinger runs `npm install` and restarts the app (≈60–90 s). **Use a fresh archive
   name each time** — the upload endpoint answers 500 when a file of the same name already sits in `public_html`
   (pass `removeArchive: true` so it is cleaned up).
3. Static assets are cached for a day under `/assets/x?v=<version>`: bump `package.json` version whenever CSS/JS changes.
4. Check `https://nsd.sg/healthz` (version + live site count) and `/admin/health` (Hostinger publisher block).

## Secrets and first boot

The archive carries no secrets. Put them in **`DATA_DIR/.env`**. In hPanel → Websites → nsd.sg → **File manager**, the
root you land on already shows `public_html`, `hbuilds` and `nsd-data` side by side: open `nsd-data/.env` (turn on
"show hidden files"). Do not go looking for a `domains/nsd.sg/` folder — you are already inside it. (Loaded via hPanel File
manager) — loaded after the archive's `.env`; real environment variables (hPanel → Node.js → Environment variables)
win over both:

```
HOSTINGER_API_TOKEN=…        # hPanel → Account → API tokens. Needed for self-serve subdomain creation.
GOOGLE_CLIENT_ID=…           # Google Cloud Console → Credentials → OAuth client (Web). Redirect URI https://nsd.sg/auth/google/callback
GOOGLE_CLIENT_SECRET=…       # "Continue with Google" stays hidden until both are set; restart (Redeploy) after adding.
ADMIN_PASSWORD=…             # optional; otherwise generated on first boot
SMTP_HOST=smtp.hostinger.com SMTP_PORT=465 SMTP_USER=noreply@nsd.sg SMTP_PASS=…
HITPAY_API_KEY=…             # HitPay → Developers → API keys. Enables API subscriptions + webhook activation.
HITPAY_WEBHOOK_SALT=…        # the salt shown for the webhook endpoint https://nsd.sg/billing/hitpay/webhook
HITPAY_PLAN_PLUS=<uuid>      # subscription plan ids from HitPay → Recurring → Plans (open the plan; id is in the URL)
HITPAY_PLAN_BETA=<uuid>
PAY_LINK_PLUS=… PAY_LINK_BETA=…   # fallback: plain recurring links used only when the API key is absent
```

The app is restarted with `hosting_restartNode_jsApplicationV1` (MCP) or hPanel → Websites → nsd.sg → **Redeploy**;
there is no separate restart button in the new hPanel.

- `SESSION_SECRET` is generated once into `DATA_DIR/session-secret` (mode 600) when not set.
- The first admin (`ADMIN_EMAIL`) is created on first boot. Without `ADMIN_PASSWORD` a random one is written to
  `DATA_DIR/initial-admin-password.txt` — sign in, change it, delete the file.

## Operations

- **Retry / repair:** `node src/cli.js sync-all` re-provisions pending subdomains and rebuilds every docroot.
  There is no shell on managed hosting, so schedule it as an hPanel cron (`hosting_createAccountCronJobV1`):
  `cd ~/domains/nsd.sg/hbuilds/current/nodejs && /opt/alt/alt-nodejs22/root/bin/node src/cli.js sync-all` hourly.
  Plan expiries (badge returning after the trial) are picked up by this run.
- **"Try it" previews (0.8.0):** anonymous pastes from the home page live at `try.nsd.sg/<id>/` for 3 hours. The
  `try` subdomain is provisioned once (first paste, or `sync-all`) with its docroot at `tenants/try/`; each preview
  is `tenants/try/<id>/index.html` with the preview bar, badge and noindex baked in, plus a raw copy in
  `nsd-data/try/<id>/` used when the visitor signs up and keeps it. Expired previews are removed by the app's
  10-minute maintenance timer while it is awake and by the hourly `sync-all` cron otherwise, so on managed hosting a
  preview can outlive its 3 hours by up to an hour. `try` is a reserved name. Caps: 1 MB per paste, 5 pastes per IP
  per hour, 2000 live previews in total. Like any new subdomain, the certificate for `try.nsd.sg` takes 5–15 min
  the first time; the result page (`/try/<id>`) polls `/try/<id>/status`, which HEAD-requests the preview URL from
  the app and only shows the link once LiteSpeed answers 200 over HTTPS (`previews.ready_at`). `/admin/health`
  shows whether the try host answers, lists live test pages with a Remove button, and has a set-up/repair button.
  Anonymous cap: 3 per person (signed `nsd_try` cookie, 24 h) and 10 per IP per day, then a sign-up page; signed-in
  users are not capped. Reachable test pages are listed (latest 12) at the bottom of `/showcase`, marked temporary.
  The result page embeds the live preview: platform CSP allows `frame-src` for `try.<domain>`, and the app-served
  preview answers `frame-ancestors 'self' <platform hosts>` (LiteSpeed-served previews set no frame header).
- **Readiness (0.9.4):** the site page polls `/sites/<id>/status`, which HEAD-requests `https://<name>.nsd.sg/` from
  the app (`src/lib/probe.js`) and, on the first 200, sets `sites.hosting_ready_at`; until then the page shows
  “Putting your site online…” with the steps and no Open button, and publish messages say “saved” rather than
  “online”. Same mechanism as test pages. Without the publisher (VPS/local) a site is ready at once.
- **Self-healing (0.9.6):** a site whose address is not confirmed (`hosting_ready_at` NULL) is re-provisioned by
  `repairSite()` (throttled: once a minute, 40/day) from three places: the owner's status poll, a 2-minute
  timer while the process is alive, and `sync-all`/`repair` on the cron. Admin has Repair now (site page),
  Repair all + Test Hostinger API (health), and gets one email per site still stuck after 30 min
  (`hosting_alerted_at`). Columns: hosting_attempts, hosting_last_attempt_at, hosting_alerted_at (migration 015).
- **Without an API token** the app still builds docroots; subdomains stay `pending` and must be created from the
  MCP (`hosting_createWebsiteSubdomainV1`, directory `tenants/<name>`) or hPanel. `/admin/health` lists them.
- **Backups:** `DATA_DIR` is the whole state (SQLite + releases). hPanel backups cover the account; for an off-box
  copy zip `nsd-data/` from the file manager or use the Hostinger backup API.
- **Limits to keep in mind:** LiteSpeed's request body limit must stay above `MAX_UPLOAD_BYTES` (100 MB works);
  the 180 s request cap bounds a single upload; the idle kill means the first request after a quiet spell pays a
  ~0.5 s cold start.

## What the VPS design keeps that this one does not

Serve-time badge injection, per-IP tenant rate limiting, the 451 status for suspended sites, the MIME allowlist at
serving time (LiteSpeed decides content types from extensions instead — the upload allowlist still bounds what can
exist), and per-site traffic counters (LiteSpeed serves the files; the app never sees tenant requests). Everything
else — auth, plans, ZIP hardening, releases/rollback, admin tooling — is unchanged.

*By Aarif Raziff · Technology with Integrity*
