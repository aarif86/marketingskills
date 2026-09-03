<!--
====================================================================
  HANDOVER — NSD.SG platform (poc-hosting-platform)
  Created: 3 Sep 2026, 09:05 SGT
  By Aarif Raziff
  Version: v01 · Previous: HANDOVER_2026-09-03.md (old-format, lives in the repo at nsd-sg/)

  Milestone log:
  [2–3 Sep 2026] — v0.1.0 born in a remote Claude Code session (VPS design,
                   nothing deployed; see previous handover).
  [3 Sep 2026]   — v0.2.0 → v0.2.3. Discovered the account has no VPS,
                   re-platformed onto Hostinger Cloud Startup managed
                   Node.js, moved nsd.sg to the aarif.sg account, deployed,
                   and verified every tenant lifecycle step on the live
                   site. NSD.SG IS LIVE.

  Notes/mood: "Over-engineered but fine"
====================================================================
-->

# HANDOVER · NSD.SG · 3 Sep 2026 · v01

**Project slug:** `poc-hosting-platform` · **Live:** https://nsd.sg (`/healthz` → version 0.2.3) · test tenant https://hello.nsd.sg
**Repo / branch:** `aarif86/marketingskills` → `claude/nsd-sg-platform-build-6u10hd`, folder `nsd-sg/` — 4 local commits this session (`76a88e9`, `c3dba9e`, `ed18a08`, + 0.2.3) **not pushed** (session lacked repo authorisation); patch series 0001–0004 in `Downloads\nsd-deploy\patches\` (`git am *.patch` on the branch).
**Deploy target:** Hostinger Cloud Startup, account `u162210766` (the one with aarif.sg), managed Node.js under LiteSpeed lsnode. **Status:** live, self-serve provisioning working, admin logged in, no SMTP yet.

## What shipped this session

**Discovery (with facts, not guesses)** — Hostinger MCP showed: no VPS subscription; two Cloud Startup + two Business plans; `nsd.sg` sat as an empty addon domain on `u268851212`. MCP config exposes only billing/domains/hosting tool groups. Decision: Path B, run on what he owns.

**Move** — deleted the empty `nsd.sg` website on `u268851212`, recreated it on order `200633189` (`u162210766`). DNS followed automatically (Hostinger NS).

**Probe before refactor** — a throwaway Fastify app was deployed five times to learn the runtime. Every finding is tabulated in `docs/07-hostinger-managed-hosting.md`. Headline: lsnode `require()`s the entry file → ESM + top-level `await` = silent 503 (this was the only reason the first deploys failed).

**Code (v0.2.x)**
- `src/publish/hostinger.js` — the new serving layer: rebuilds `public_html/tenants/<name>/` from the pristine release on every deploy/rollback/delete-file/suspend/unsuspend/branding/plan/user-status change; badge injected into HTML at publish time; generated `.htaccess` (no indexes/CGI/PHP, dotfiles denied, clean URLs, custom 404, headers); atomic `<name>.new` → rename swap; "coming soon" and "unavailable" pages; provisions/deprovisions subdomains via `POST/DELETE /api/hosting/v1/accounts/{username}/websites/{domain}/subdomains`; `syncAll` for cron; orphan-dir listing/removal; `envFileKeys` for the health page.
- `server.cjs` + `src/start.js` — CommonJS entry shim for lsnode; `src/server.js` keeps `npm start` for local/VPS.
- `src/config.js` — `TENANT_ROOT`, `PUBLIC_HTML`, `HOSTINGER_USERNAME/API_TOKEN/API_BASE`; `SESSION_SECRET` auto-generated into `DATA_DIR/session-secret`; `DATA_DIR/.env` loaded after the repo `.env`.
- `src/services/users.js` — first admin gets a generated password written to `DATA_DIR/initial-admin-password.txt` when `ADMIN_PASSWORD` is unset.
- `src/web/middleware.js` — `Cache-Control: private, no-store` on all platform responses (LSCache sits in front).
- Migration `001_hosting_state.sql` (hosting_state / hosting_error / hosting_synced_at); CLI `sync-all`, `sync-site`, `hosting`; admin System health: Hostinger publisher block, **Sync now**, orphan **remove**, secrets-file key names, server-disk stat relabelled (86% is the shared server, not our quota — warning now triggers only under 10 GB free), NSD.SG storage stat.
- Admin nav: links on their own row; stat cards no longer overflow.
- `deploy/hostinger/env.hostinger` (non-secret env shipped as `.env`) + `build-archive.sh`; README and `.env.example` updated; docs/07 written.
- Tests 31 → 38 (`test/hostinger.test.js`).

**Hostinger side** — subdomains `hello` (test user's site) created; `probe`/`demo` removed; hourly cron `17 * * * *` runs `sync-all` (uid `fjlf55G1fw`), log at `nsd-data/sync-all.log`.

**Live verification (all passed)** — badge on hello.nsd.sg; `/about` clean URL; custom 404 (badge injected there too); `/.htaccess` → 403; API token picked up after restart; `hello2` created from the dashboard → app created `hello2.nsd.sg` itself → DNS+SSL live in ~10 min → v1 upload, v2 upload, rollback to v1 → delete removed the subdomain from Hostinger; suspend shows the notice on every path, unsuspend restores; badge removed/restored via admin override.

**Same-session bugs fixed**
- `materialise()` wrote nested files to the top level — caught by the new test before deploy (walk passed the wrong `dst`).
- `syncSite` set `hosting_state='ready'` on its own, masking un-provisioned subdomains; now only provisioning sets `ready`.
- Orphan-removal form rendered an empty CSRF token (`h.csrf` vs `h.hosting.csrf`) → 403; regression test added.
- `package.json` `main` still pointed at `src/server.js`, so Hostinger auto-picked the ESM entry; set to `server.cjs`.
- Admin CSS didn't refresh after deploy — assets are cached a day under `?v=<version>`; version bumps are now mandatory for CSS/JS changes.
- Deploy upload API returns 500 if an archive of the same name already exists in `public_html` — use fresh names, `removeArchive: true`.

## Decisions (and why)

- **Managed hosting over VPS** — nothing to buy, nothing to babysit; the platform's audience is small. Cost: serve-time badge, per-IP tenant rate limits, 451 status, serve-time MIME allowlist, and tenant traffic counters are gone (documented in docs/07 "What the VPS design keeps").
- **Publish-time badge instead of upload-time rewriting** — releases stay pristine; the served copy is regenerated from them, so rollback/versions are untouched.
- **Secrets never in the archive** — `DATA_DIR/.env` + generated session secret/admin password, so deploys can be done from Claude without Claude ever seeing a token.
- **`demo` stays reserved** — it's on the platform's own reserved list by design; test site is `hello`.
- **Hourly cron rather than in-process timers** — the lsnode process dies after 30 s idle, so timers cannot be trusted.

## Open questions

1. **Transactional email** — SMTP unset; verification and reset mails are only logged. Titan Business email exists on the account (could be the SMTP relay), or Resend/SES.
2. **DNS** — stays on Hostinger for now (subdomain records + SSL come free with the API). Cloudflare later only if CDN/DDoS matters.
3. **Plus price / annual** — S$9 seeded; unchanged.
4. **Community plan invite codes** — still admin-assigned only.
5. **Tenant analytics** — LiteSpeed serves the files, so the app sees no tenant traffic; Hostinger's per-domain stats or a tiny beacon would be needed if this matters.

## PRIORITIZED PLAN FOR NEXT SESSION

1. **★ Push the code.** Start a session with `aarif86/marketingskills` attached (or `git am` the four patches) and push `claude/nsd-sg-platform-build-6u10hd`. Then decide: own repo for `nsd-sg/` (README says so). Depends on: repo access.
2. **SMTP** — pick provider, put `SMTP_*` in `nsd-data/.env`, restart, test signup verification + reset. Before any real user is invited.
3. **Delete the test user's `hello` site or keep it as the showcase** — either way decide; the `+test` account exists.
4. **Public Suffix List submission** for nsd.sg (cookie isolation between tenants) — weeks of lead time, start now.
5. **Uptime monitor** on `https://nsd.sg/healthz`; check `nsd-data/sync-all.log` after the first cron run.
6. **Backups** — hPanel backup covers the account; decide on an off-box copy of `nsd-data/`.
7. **Payments** (Stripe/HitPay) into `/billing/upgrade` — unchanged from the previous handover.
8. **Custom domains UI for Plus** — on managed hosting this becomes "add the custom domain as a Hostinger parked/addon domain pointing at the tenant folder"; API supports `hosting_createWebsiteParkedDomainV1`. Needs design.

## Second-pass backlog

- Expiry automation (day-76 email, grace, auto "coming soon") — `sync-all` already re-applies the badge when a trial expires; the emails need SMTP first.
- Community invite codes; Founding plan.
- CAPTCHA on signup if bots appear.
- Replace deprecated `disableRequestLogging` before Fastify 6.
- Delete leftover `nsd-data/w.txt` (probe artefact, harmless).
- Consider `hosting_toggleWebsiteCacheV1` off for nsd.sg if any stale-page issue appears (app already sends no-store).

## Quick reference

- **Deploy:** `cd nsd-sg && deploy/hostinger/build-archive.sh nsd-sg-<ver>.zip` → copy into `C:\Users\aarif\Downloads\nsd-deploy\` (unique name) → Hostinger MCP `hosting_deployJsApplication` domain `nsd.sg`, `removeArchive: true` → ~90 s → `https://nsd.sg/healthz`. Bump `package.json` version whenever CSS/JS changes.
- **Secrets:** `~/domains/nsd.sg/nsd-data/.env` on the server (hPanel File manager → `..` from public_html → `nsd-data`; show hidden files). Currently holds `HOSTINGER_API_TOKEN`. Read at process start — restart the app (MCP `hosting_restartNode_jsApplicationV1` or a deploy) after editing.
- **Admin:** https://nsd.sg/admin — aarif.raziff@gmail.com; password changed by Aarif on 3 Sep; `initial-admin-password.txt` deleted.
- **Test user:** aarif.raziff+test@gmail.com, site `hello`.
- **Logs:** runtime → hPanel Node.js logs (`hbuilds/current/nodejs/console.log`); cron → `nsd-data/sync-all.log`; build → `hosting_getNodeJSBuildLogsV1`.
- **Repair:** admin → System health → *Sync now*; or wait for the hourly cron.
- **Gotchas:** CommonJS entry only; listen within 3 s; process dies after 30 s idle (no in-memory state); `HOME` ≠ account home; app dir is replaced on deploy, `public_html` and `nsd-data` persist; deploy archive names must be unique; Hostinger probes `grey-lobster-115902.hostingersite.com` after each deploy (in `PLATFORM_HOSTS`); reserved names include `demo`, `test`, `admin`, `www`.
- **Handover files** for this project now live in `Claude Projects\poc-hosting-platform\`; the v0.1.0 one is still in the repo at `nsd-sg/HANDOVER_2026-09-03.md`.

## Parked ideas

- "NSD.SG → NasarDigital" as one funnel with two front doors (from previous handover).
- NASAR HQ members get NSD.SG free — the `community` plan; nothing hardcoded.
- CLI/API deploy token (`nsd deploy ./dist`) for technical users.
- Showcase page of hosted sites; "ChatGPT → NSD.SG in 60 s" video.
- Custom domains on managed hosting via Hostinger parked domains (see plan item 8).

*By Aarif Raziff · Technology with Integrity*
