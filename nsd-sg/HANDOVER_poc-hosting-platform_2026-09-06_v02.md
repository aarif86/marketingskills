<!--
====================================================================
  HANDOVER — NSD.SG platform (poc-hosting-platform)
  Created: 6 Sep 2026, SGT
  By Aarif Raziff
  Version: v02 · Previous: HANDOVER_poc-hosting-platform_2026-09-03_v01.md

  Milestone log:
  [3 Sep 2026]   — v0.3.1 live (see v01).
  [3 Sep 2026]   — v0.4.x: improvement list shipped — HitPay API subscriptions
                   + webhook automation, Hostinger SMTP, promo codes + Beta
                   plan, showcase, badge page, vice-name watchdog, extension
                   reason dropdown, SSL-wait notice, custom-domain add-on copy.
  [3 Sep 2026]   — v0.5.0–0.5.1: Featurebase-style public roadmap + changelog;
                   HitPay webhook v1/v2 signatures with both salts, user
                   cancel, admin re-check/cancel/refund; first real S$6 test
                   charge went through.
  [3–6 Sep 2026] — v0.5.2–0.5.3: abandoned checkouts time out; feedback link
                   in dashboard nav with screenshot/PDF attachments; promo
                   comparison box + self-remove; extension "submitted" state.

  Notes/mood: "real case study for nsd.sg coming up on flow.nsd.sg"
====================================================================
-->

# HANDOVER · NSD.SG · 6 Sep 2026 · v02

**Project slug:** `poc-hosting-platform` · **Live:** https://nsd.sg (`/healthz` → 0.5.3) · roadmap https://nsd.sg/roadmap · changelog https://nsd.sg/changelog
**Repo / branch:** `aarif86/marketingskills` → `claude/nsd-sg-platform-build-6u10hd`, folder `nsd-sg/`. **15 local commits (0.2.0 → 0.5.3) still not pushed** — every session so far lacked repo authorisation (403). Patches `0001`–`0015` in `Downloads\nsd-deploy\patches\` (`git am *.patch`).
**Deploy target:** Hostinger Cloud Startup `u162210766`, managed Node.js (lsnode). **Status:** live; payments, email, promo, feedback all working; 41 tests green.

## What shipped since v01 (0.4.0 → 0.5.3)

**Payments (HitPay, Nasar Pte Ltd)** — `src/services/hitpay.js`. Upgrade creates a recurring-billing subscription through the API (`plan_id`, `customer_email`, `reference <userId>:<planId>:<rand>`, `start_date` = today SGT — `save_card` is not allowed with `plan_id`), redirects to HitPay's hosted page, and the webhook at `/billing/hitpay/webhook` activates the plan (`assignPlan paid:true`, never expires). Signatures: v2 `Hitpay-Signature` HMAC over the raw body **or** v1 form `hmac` over sorted key+value, tried against both `HITPAY_WEBHOOK_SALT` and `HITPAY_API_SALT` (Aarif mixed them up once; both now accepted). Cancel = DELETE at HitPay + 30-day grace then Free. Billing page self-reconciles pending checkouts by API on load; pending rows older than 2 h, or superseded by an activation/cancellation, become `abandoned` (0.5.2 — this was the "payment started 20 min ago" ghost banner). Admin: Re-check / Cancel / Refund (refund needs `last_payment_id`, recorded from webhooks only). Fallback `PAY_LINK_*` links if no API key. Beta users see "Keep Beta after your free period · S$6" rather than the S$9 Plus card.

**Email** — Hostinger SMTP (`smtp.hostinger.com:465`, `noreply@nsd.sg`). Hostinger rejects any sender other than the mailbox → `SMTP_FROM` defaults to `SMTP_USER`. Admin → System health → *Send test email*. Env precedence fixed in 0.4.3: real env > `nsd-data/.env` (operator) > archive `.env` (defaults) — before that the archive was overriding the operator file.

**Plans & promo** — Beta plan (3 sites, no badge, hide-from-showcase, 90 days free then S$6/mo, not public); promo codes (admin `/admin/promo`, user redeem on billing). 0.5.3: comparison table "Free vs Beta (you)" with **Remove promo code** (back to previous plan + previous expiry; code stays used — migration 004 stores `prev_plan_id/prev_expires_at/removed_at`). Extension requests: reason dropdown + ≥20-char note; after submitting, the form is replaced by "Free extension submitted on … we review within 3–5 working days" until admin grants (+90 on admin overview) or 14 days pass.

**Public product surface** — `/showcase` (Free listed, Plus/Beta can hide from Site settings), `/badge` demo, `/roadmap` (columns In progress / Planned / Shipped, votes, suggestions go to `under_review` hidden until admin publishes), `/changelog` (seeded 0.2.0 → 0.5.3; admin CRUD at `/admin/roadmap`). Nav: How it works · Showcase · Pricing · Roadmap · FAQ. Dashboard nav gained **Feedback** → `/roadmap#suggest`; suggestions accept up to 3 files (PNG/JPG/GIF/WebP/AVIF/SVG/PDF, 5 MB each) stored in `nsd-data/feedback/<item>/`, admin-only download (SVG forced to attachment).

**Safety / UX** — vice/abuse substrings blocked at signup with `security.blocked_name` audit ("watchdog"); reserved list extended; site page has claim → publish → open steps, Open-site button, 45-min SSL-wait notice for new subdomains; custom domain described as an add-on on top of Plus.

**Same-session bugs (cause → fix)** — hPanel "restart" does not reload `.env` → always redeploy after editing secrets. Plan IDs pasted with `<>` from the docs template → note in docs. HitPay 422 "save_card true disallows plan_id" → `start_date` instead. Webhooks rejected for hours → salt mix-up + v1 form format; fixed by accepting both. Stale pending subscription rows → abandon/timeout logic. Schema.sql must not declare columns a migration adds (duplicate-column crash on fresh DB) — keep new columns in the migration only.

## Open questions

1. **Refund of the S$6 test charge** — do it in the HitPay dashboard; the admin Refund button only works for charges whose webhook recorded a payment id (that one predates the salt fix).
2. **Webhook acceptance after the salt fix** — not yet confirmed end-to-end. Check `/admin/audit?q=hitpay` for `hitpay.webhook` vs `webhook_rejected` after the next event (the refund will trigger one).
3. **Google sign-in** — deferred (needs an OAuth client in Google Cloud; Aarif to create, paste client id/secret into `nsd-data/.env`).
4. **flow.nsd.sg** — Aarif's note: a real case study for nsd.sg is coming there. Nothing built yet; decide whether it is a tenant site on the platform (dogfooding, best story) or a separate page.

## PRIORITIZED PLAN FOR NEXT SESSION

1. **★ Push the code.** Attach `aarif86/marketingskills` to the session (or `git am` patches 0001–0015 locally) and push the branch; then split `nsd-sg/` into its own repo. Depends on: repo access. Carried from v01.
2. **Verify HitPay end-to-end once more** with the corrected salts: fresh Beta checkout on the test account → plan flips without reload → cancel → refund via admin. Close open questions 1–2.
3. **flow.nsd.sg case study** — build as a tenant on the platform so the showcase and changelog tell the story.
4. **Demo video** ("ChatGPT → NSD.SG in 60 s") — script + screen recording; the home page has a placeholder slot. Carried from the improvement list.
5. **Expiry emails** (day-76 warning, expiry, grace) — SMTP now works; hourly `sync-all` is the natural place. Carried from v01.
6. **Public Suffix List submission** for nsd.sg — weeks of lead time. Carried.
7. **Uptime monitor** on `/healthz`; check `nsd-data/sync-all.log`. Carried.
8. **Google sign-in** once the OAuth client exists.

## Second-pass backlog

- Custom-domain flow for Plus (Hostinger parked/addon domain API) — copy already promises "you buy the domain, we connect it".
- Admin decline for extension requests (currently grant-only; the form returns after 14 days).
- Attachment cleanup when a suggestion is deleted is done; add a size cap per user if abuse appears.
- CAPTCHA on signup if bots appear; community invite codes; delete `nsd-data/w.txt`.
- Replace deprecated `disableRequestLogging` before Fastify 6.

## Quick reference

- **Deploy:** `deploy/hostinger/build-archive.sh nsd-sg-<ver>.zip` → `C:\Users\aarif\Downloads\nsd-deploy\` (unique name) → MCP `hosting_deployJsApplication` domain `nsd.sg`, `removeArchive: true` → ~2 min → `https://nsd.sg/healthz?r=<n>` (WebFetch caches 15 min; add a query string). Bump `package.json` version for any CSS/JS change; add a changelog seed entry per release (`SEED_CHANGELOG`, `INSERT OR IGNORE`).
- **Secrets:** `~/domains/nsd.sg/nsd-data/.env` (hPanel File manager, hidden files on). Keys in use: `HOSTINGER_API_TOKEN`, `SMTP_HOST/PORT/USER/PASS`, `SMTP_FROM=NSD.SG <noreply@nsd.sg>`, `HITPAY_API_KEY`, `HITPAY_WEBHOOK_SALT`, `HITPAY_API_SALT`, `HITPAY_PLAN_PLUS`, `HITPAY_PLAN_BETA`, `PAY_LINK_*`. **Redeploy after editing — restart does not reload it.** No `<>` around values.
- **Accounts:** admin aarif.raziff@gmail.com; test user aarif.raziff+test@gmail.com (site `hello`, on Beta via promo, subscription cancelled 3 Sep with grace to 3 Oct).
- **Diagnostics:** `/admin/health` (Hostinger, HitPay key/plans check, test email, sync now), `/admin/audit?q=hitpay`, `/admin/users/<id>` (subscriptions table with Re-check/Cancel/Refund), `/admin/roadmap` (ideas waiting + 📎 attachments).
- **Local run for screenshots:** `NODE_ENV=production DATA_DIR=/tmp/nsd-local TENANT_ROOT=/tmp/nsd-local/tenants PORT=3123 PLATFORM_HOSTS=nsd.sg,localhost ADMIN_EMAIL=… ADMIN_PASSWORD=… setsid node server.cjs`; Playwright at `/opt/node-tools/node_modules/playwright`, chromium `/opt/pw-browsers/chromium`. The cloud container cannot reach nsd.sg directly (proxy 403) — use WebFetch.
- **Gotchas:** CommonJS entry; listen within 3 s; process dies after 30 s idle; app dir replaced on deploy, `public_html`/`nsd-data` persist; archive names unique; Hostinger probes `grey-lobster-115902.hostingersite.com`; reserved names include `demo`; `requireAdmin` answers 404 (not 302) to non-admins.

## Parked ideas

- NSD.SG → NasarDigital as one funnel with two front doors; NASAR HQ members free via `community` plan.
- CLI/API deploy token (`nsd deploy ./dist`).
- Aarif on beta testers: "highly recommend to put card on file" — done via HitPay plan checkout; annual pricing still undecided.
- Tenant analytics need a beacon (LiteSpeed serves files; app sees no tenant traffic).

*By Aarif Raziff · Technology with Integrity*
