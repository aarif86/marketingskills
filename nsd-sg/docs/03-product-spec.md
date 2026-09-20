# 03 · Product specification

## Positioning

**Create your website with AI. Host it on your own .sg address.**

AI made building a website a 10-minute job. Getting it online is still where non-technical people
stall: git, build commands, DNS, `.vercel.app`. NSD.SG removes that step: upload → live on
`name.nsd.sg`. The bigger arc is **Create with AI → Deploy with NSD.SG → Grow with NasarDigital**.

Positioning notes:
* Lead with the *outcome* (“your site is live at a clean address”) not the technology.
* “.sg” is the differentiator against Vercel/Netlify/GitHub Pages — a local, trustworthy, short
  address — and the natural bridge to “want a real domain? we do that too”.
* Do not compete on developer features; say plainly “static sites only” and explain why that is
  a feature (fast, safe, cheap, what AI tools produce).

## User journeys

**Try it (no account, 0.8.0/0.8.1).** Home page → upload the .html file or paste the code (or drag it in; result opens in a new tab) → `/try/<id>` waits until the
preview answers, then shows the link and the live page in a frame. 3 free tries per person, then sign-up `try.nsd.sg/<id>/`, which
works for 3 hours. From there: “Keep it at my own address” → `/signup?preview=<id>` (the site name becomes
required and the page is moved to the new site as `index.html`), or, signed in, pick an existing site on the result
page or `/sites/new?preview=<id>`. The preview is deleted once kept or expired.

1. **Claim & publish (first run)** — Home → type a name in the hero → Signup (name pre-filled,
   availability checked live) → Dashboard flash “alice.nsd.sg is yours” → Site page → drop ZIP →
   progress bar → “Version 1 is live” → Open site.
2. **Update** — Site page → drop new ZIP (replace) or files/folders (merge) → new version →
   reload. Or: File list → ✕ delete one file → new version.
3. **Rollback** — Site page → Versions → Restore.
4. **Trial expiry** — 14-day banner → Plan & billing → “Request free extension” → admin grants
   (+90 days) or user chooses Plus (payment link by email until checkout is integrated).
5. **Abuse** — Visitor → `/report` → admin queue → suspend → owner sees reason on site page.
6. **Admin daily loop** — Overview: extension requests, upgrade requests, security events, new
   users, recent deploys → act inline.

## Custom domains (0.10.0)

`src/services/domains.js`. Plus/Beta only, two per site. Owner adds `mybusiness.sg` in Settings; the page shows a
TXT record (`_nsd-verify.<domain>` = `nsd-verify=<token>`) and a CNAME (`www` → `<name>.nsd.sg`), plus an A record
to `SERVER_IP` when set. "Check the records" resolves them (injectable resolver in tests): both found → `verified`;
then `active` at once on VPS/local (the app serves the hostname; Caddy `tls-ask` already allows it) or, on
Hostinger, after `addDomainToHosting()` succeeds. If the API refuses, the domain waits in Admin → System health with
the hPanel steps and a "Mark connected" button. Buying domains through Hostinger is not built.

## Publish from Claude: MCP endpoint (0.11.0)

`src/mcp/server.js`, zero dependencies, MCP streamable HTTP, stateless JSON-RPC (`initialize`, `ping`, `tools/list`,
`tools/call`; GET → 405). Auth: per-user API tokens (`api_tokens`, hashed, shown once, revocable, last-used) either
in the URL (`POST /mcp/<token>`, the form Claude Desktop / claude.ai custom connectors can use) or as
`Authorization: Bearer`. Rate limits per token: 60 calls/h, 20 publishes/h. Tools: `nsd_publish` (name + html or
files; creates the site through `createSite`, so plan limits, reserved names and blocked words apply; merges into an
existing site), `nsd_update` (replace all), `nsd_list_sites`, `nsd_get_site`, `nsd_delete_site` (id + confirm).
Quota and expiry errors are plain sentences carrying the upgrade URL. Dashboard page `/connect` issues tokens and
walks through adding the connector. Free trial is 30 days for new sign-ups (migration 018; existing users keep
their stamped expiry); dashboard warns at 7 and 1 days left.

## Pages

| Route | Who | Purpose |
|---|---|---|
| `/` | public | Hero, how it works, why, features, pricing, FAQ teaser, CTA |
| `/pricing`, `/faq`, `/terms`, `/privacy`, `/report` | public | Supporting pages |
| `/signup`, `/login`, `/forgot`, `/reset`, `/verify` | public | Auth |
| `/dashboard` | user | Site list, plan status, banners |
| `/sites/new`, `/sites/:id`, `/sites/:id/settings` | user | Site lifecycle |
| `/account` | user | Profile, password, sessions, delete |
| `/billing` | user | Plan, usage, extension, upgrade |
| `/admin`, `/admin/users[/:id]`, `/admin/sites[/:id]`, `/admin/plans`, `/admin/reserved`, `/admin/abuse`, `/admin/audit`, `/admin/health` | admin | Operations |
| `<name>.nsd.sg/*` | visitors | Tenant static site |

## API / form endpoints

| Method + path | Auth | Notes |
|---|---|---|
| `GET /api/availability?name=` | public | `{available, reason, url}` |
| `POST /signup`, `/login`, `/logout`, `/forgot`, `/reset`, `/resend-verification` | – / user | Rate-limited |
| `POST /report` | public | Rate-limited, creates `abuse_reports` |
| `POST /sites` | user | Create site |
| `POST /sites/:id/upload` | user | Multipart. One `.zip` → full replace. Files → `mode=merge|replace`. Returns JSON when `Accept: application/json`. |
| `POST /sites/:id/files/delete` | user | `path` |
| `GET /sites/:id/files/view?path=` | user | Inert preview (text/plain or attachment) |
| `POST /sites/:id/rollback` | user | `release_id` |
| `POST /sites/:id/settings`, `/sites/:id/delete` | user | `confirm=<subdomain>` for delete |
| `POST /account/profile`, `/account/password`, `/account/sessions/revoke`, `/account/delete` | user | |
| `POST /billing/extend`, `/billing/upgrade` | user | Records `plan_events` |
| `POST /admin/users/:id/action` | admin | `action ∈ suspend|disable|activate|plan|extend|never_expire|overrides|notes|role|logout_all|verify_email` |
| `POST /admin/sites/:id/action` | admin | `action ∈ suspend|unsuspend|branding|rename|transfer|delete|reserve_and_delete` |
| `POST /admin/plans`, `/admin/reserved`, `/admin/abuse/:id` | admin | |
| `GET /healthz` | public | JSON health |
| `GET /internal/tls-ask?domain=&token=` | Caddy | 200 only for known hostnames |

All POSTs require the `_csrf` field (or `x-csrf-token` header) and a same-origin `Origin`.

## Entities

* **plans** — id, name, price, trial_days, public/default flags, `limits_json`
  (`max_sites, max_storage_bytes, max_file_bytes, max_releases, max_bandwidth_bytes_month`),
  `features_json` (`branding_removable, custom_domains, version_history, analytics, priority_support`).
* **users** — email, name, scrypt hash, role (`user|admin`), status
  (`active|suspended|disabled|pending`), plan + start/expiry, `overrides_json` (per-user limit and
  feature overrides incl. `branding_removed`), lockout fields, admin notes.
* **sites** — owner, subdomain (unique), title, status (`empty|live|suspended|deleted`),
  `current_release_id`, `branding_removed` (site override), `allow_framing`, storage counters.
* **releases** — immutable versions per site with source, counts, note, author.
* **sessions**, **tokens** — hashed identifiers only.
* **reserved_subdomains**, **abuse_reports**, **audit_log**, **site_traffic_daily**,
  **plan_events**, **custom_domains** (future).

## Permissions

| Capability | User | Admin |
|---|---|---|
| Own sites CRUD, upload, rollback | ✓ (owner only) | ✓ (any) |
| Rename subdomain | ✗ | ✓ |
| Remove badge | ✗ (plan feature) | ✓ (per user / per site) |
| Change plan / extend | request only | ✓ |
| Suspend/disable users, sites | ✗ | ✓ |
| Reserved names, plans editor, audit, health | ✗ | ✓ |
| Promote/demote admins | ✗ | ✓ (not self; not last admin) |

## Plan system (no hardcoding)

Every entitlement is evaluated by `entitlementsFor(user)` = plan limits ⊕ user overrides, plus
expiry. A “NASAR HQ / Community” account is simply `plan_id = 'community'` (seeded, private,
never expires, 3 sites, 500 MB) or any plan you create in `/admin/plans`. Founders, beta testers
and partners are the same mechanism. Per-user overrides handle one-off exceptions (e.g. one
community member gets the badge removed) without creating a plan per person.

## Upload semantics

* **ZIP** → new release from scratch (replace). Single wrapping folder is stripped. Junk
  (`__MACOSX`, `.DS_Store`, `node_modules`, `.git`) is skipped silently; disallowed types are
  reported back by name.
* **Files / folders (merge)** → new release = current release + uploaded files (overwrites same
  paths). Folder structure comes from the browser (`webkitRelativePath` / dropped directory
  entries); a single top-level folder is stripped client-side.
* **Files (replace)** → new release from scratch containing only the uploaded files.
* **Delete** → new release without the file. **Rollback** → new release copied from an old one
  (history stays linear; nothing is ever mutated in place).
* Retention: plan `max_releases`; the current release is never pruned.

## Future features (schema/hooks already in place)

* **Custom domains** — `custom_domains` table; TLS-ask already answers; add hostname lookup in
  the router and a TXT-verification UI.
* **Payments** — `/billing/upgrade` records intent; drop a Stripe/HitPay checkout in that handler
  and call `assignPlan` on webhook.
* **Analytics** — `site_traffic_daily` counters exist; add paths/referrers if desired.
* **Teams / API tokens / CLI deploy** — sessions table generalises to tokens with a `kind` column.
* **Object storage + CDN** — release layout maps to object keys.
