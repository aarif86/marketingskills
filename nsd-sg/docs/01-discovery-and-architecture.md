# 01 · Discovery report and architecture decision

_Date: 2026-09-02 · Author: platform build session_

## 1. What was actually discovered

The build environment for this session was a sandboxed cloud container attached to the
`aarif86/marketingskills` GitHub repository. It had **no Hostinger access of any kind**:

| Checked | Result |
|---|---|
| Hostinger API token in environment | none |
| SSH keys (`~/.ssh`) | empty |
| Hostinger / hPanel MCP connector | none installed |
| Outbound HTTPS to `nsd.sg`, `nasardigital.com`, `hostinger.com`, `developers.hostinger.com` | blocked by the session egress policy (HTTP 403 at the proxy) |
| DNS lookups for `nsd.sg` (including DNS-over-HTTPS) | blocked |
| Docker daemon | not running in the sandbox |
| Node 22, npm registry, Python 3.11 | available |

So the honest answer to “what infrastructure is currently available” is: **it could not be inspected
from here.** Nothing below assumes a specific Hostinger product; instead the platform was built to
run on the one Hostinger product that can host it securely, with a checklist to confirm the account
matches.

## 2. Hostinger product fit (what to verify in hPanel)

Hostinger sells three things that matter here:

| Product | Root access | Node.js long-running process | Reverse proxy you control | Wildcard subdomain + SSL | Verdict |
|---|---|---|---|---|---|
| **Shared / Business / Cloud web hosting** (hPanel, LiteSpeed, PHP) | no | no (only PHP, cron) | no | wildcard subdomain yes; wildcard SSL usually **no** | ✗ Cannot enforce the security model: no serving-layer control, uploaded files served by a shared LiteSpeed, PHP execution has to be disabled by `.htaccess` you do not fully control. Do not host user uploads here. |
| **KVM VPS** (KVM 1 / KVM 2, Ubuntu, root, Docker template available) | yes | yes | yes (Caddy) | yes (Caddy issues them) | ✓ **Target platform.** Everything in this repository is built for it. |
| **Domain + DNS** (`nsd.sg` registered at Hostinger, hPanel DNS zone) | – | – | – | wildcard `*` A record supported | ✓ Works. Optional: move DNS to Cloudflare for wildcard TLS via DNS-01 and free edge caching. |

**Action for you (10 minutes):** log in to hPanel and confirm
(a) whether a KVM VPS exists — if not, KVM 1 (1 vCPU, 4 GB, 50 GB NVMe, ~US$5–8/mo) is enough for
the first few thousand sites; (b) that `nsd.sg` is registered and its nameservers are Hostinger's
(`ns1.dns-parking.com` etc.) or Cloudflare's; (c) generate an API token under _Account → API_ if you
want the DNS script in `deploy/scripts/hostinger-dns.sh` to set records for you.

## 3. Recommended architecture

```
                 ┌──────────────────────── Hostinger KVM VPS (Ubuntu + Docker) ────────────────────────┐
  nsd.sg  ──┐    │  ┌────────── Caddy ───────────┐        ┌──────────────── nsd-app (Node 22) ────────────────┐ │
  *.nsd.sg ─┼──► │  │ TLS (wildcard or on-demand) │ ─────► │ Host header router                                 │ │
  (DNS A →  │    │  │ HTTP/3, gzip, HSTS          │ :3000  │  ├─ nsd.sg / www  → platform (Fastify, SSR pages)  │ │
   VPS IP)  │    │  │ 120 MB body cap             │        │  └─ <name>.nsd.sg → tenant static server           │ │
            │    │  └─────────────────────────────┘        │       (allowlist MIME, path checks, badge inject)  │ │
            │    │                                          │ SQLite (WAL)   /var/lib/nsd/nsd.db                 │ │
            │    │                                          │ Releases       /var/lib/nsd/sites/<id>/releases/…  │ │
            │    │                                          └───────────────────────────────────────────────────┘ │
            │    │  nightly: sqlite backup + tar of sites → /var/backups/nsd (+ rclone off-box)                   │
            └──  └────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why this shape**

* **One VPS, one Node process, SQLite** — the whole platform is I/O-light (static files) and the
  data model is small. SQLite in WAL mode handles thousands of sites and hundreds of requests/second
  on a KVM 1 with no operational overhead. Postgres would add a service to run, back up and secure
  for zero benefit at this scale. If the day comes, the data layer is isolated in `src/db` and
  `src/services`.
* **Caddy in front** — automatic certificates (including wildcard via DNS-01), HTTP/3, sane TLS
  defaults, and a hard request-body cap before anything reaches Node.
* **Static-only tenants** — uploaded files are bytes on disk that Node streams with a content type
  chosen from an extension allowlist. There is no interpreter in the request path, so PHP/CGI/SSRF
  classes of attack do not exist. See `02-security-model.md` for the full threat model.
* **Immutable releases** — every publish creates a new directory; the DB pointer flips atomically;
  rollback is a pointer change; unchanged files are hard-linked so history is nearly free.
* **Docker Compose** — reproducible deploys, read-only root filesystem for the app container, no
  capabilities, memory cap. `deploy/systemd/nsd.service` is provided if you prefer no Docker.

**Why not shared hosting** — you would be trusting LiteSpeed's handling of arbitrary uploaded
`.htaccess`/`.php`/`.phtml` files in a directory you share with the platform itself, with no way
to inject the badge or to stop a tenant from serving `text/html` under an image name. The saving
is a few dollars a month; the exposure is the whole platform.

**Why not serverless / object storage yet** — S3-compatible storage + CDN is the right *second*
step when bandwidth costs exceed the VPS price. The release layout (`sites/<id>/releases/<id>/…`)
maps 1:1 to object keys, so that migration is a storage-adapter change, not a rewrite.

## 4. Tenant isolation (summary; details in 02)

1. **Origin isolation** — each site is its own browser origin (`name.nsd.sg`). Scripts on one
   tenant cannot read another tenant's DOM, storage or cookies.
2. **Platform cookie is `__Host-` prefixed** — browsers refuse to let a subdomain set or override
   it, which kills cookie-tossing attacks against the dashboard session. Recommended follow-up:
   submit `nsd.sg` to the Public Suffix List so browsers treat subdomains as unrelated sites.
3. **Filesystem** — files live under a directory named by a random 26-char id; every request path
   is re-validated, resolved with `lstat` (symlinks never followed) and checked to be inside the
   current release directory.
4. **Content** — extension allowlist at upload *and* at serve time; `X-Content-Type-Options:
   nosniff`; `frame-ancestors 'self'` by default.
5. **Process** — the app container runs as non-root, read-only rootfs, no capabilities, one
   writable volume. Node never `exec`s anything and never evaluates uploaded content.

## 5. Routing of `name.nsd.sg`

* DNS: `A @`, `A www`, `A *` → VPS IP (one wildcard record covers every future site).
* TLS: `TLS_MODE=wildcard` (Cloudflare DNS-01, one cert) or `TLS_MODE=ondemand` (Caddy asks the app
  `/internal/tls-ask?domain=…` and only issues certificates for subdomains that exist in the DB).
* App: `src/lib/subdomain.js#tenantFromHost` extracts exactly one label under the base domain;
  `src/serve/tenant.js` looks the site up (joined with owner status so a suspended user's sites go
  dark instantly), then serves the current release.
* Custom domains (future): `custom_domains` table already exists; the TLS-ask endpoint already
  answers for active custom hostnames; the router needs one extra lookup by full hostname.

## 6. Branding enforcement

The badge is injected into every `text/html` response by `src/serve/branding.js` **at serve time**.
Editing uploaded HTML cannot remove it. Layers: server-side injection → randomised element id and
`!important` inline styles → a guard script that re-inserts the badge if page JS removes it →
Terms of Service and admin inspection. Removal is a per-plan feature flag, a per-user admin
override, or a per-site admin override; the serving layer evaluates all three on every HTML
request. See 02 for the honest limits of client-side enforcement.

## 7. Database and storage

SQLite (better-sqlite3, WAL, foreign keys). Tables: `plans`, `users`, `sessions`, `tokens`,
`reserved_subdomains`, `sites`, `releases`, `custom_domains`, `audit_log`, `abuse_reports`,
`site_traffic_daily`, `plan_events`. Schema in `src/db/schema.sql`; it is idempotent and numbered
migrations go in `src/db/migrations/`. Files on the Docker volume `nsd-data` (`/var/lib/nsd`).

## 8. MVP scope (built)

* Marketing site: home, pricing, FAQ, terms, privacy, abuse report.
* Auth: signup with optional site claim, login with lockout, logout, email verification, password reset, session list/revoke, account delete.
* Sites: create (syntax + reserved + taken + plan-limit checks), ZIP upload (replace), file/folder upload (merge), drag-and-drop with folder walking, file manager with view/delete, version history and rollback, settings, delete.
* Tenant serving: clean URLs, directory index, custom 404, security headers, badge injection, suspension pages, traffic counters.
* Plans: data-driven, free 90-day trial, extension requests, admin grant, upgrade intent capture (payment provider slot).
* Admin: overview, users (status/plan/extend/overrides/role/notes/sessions), sites (suspend/branding/rename/transfer/delete/reclaim), plans editor, reserved names, abuse queue, audit log, health.
* Ops: Docker/Caddy stack, VPS bootstrap script, backup/restore, DNS script, CLI, health endpoint, tests.

**Deliberately not in MVP:** online payments (Stripe/HitPay), custom-domain UI, per-site analytics dashboards beyond counters, team accounts, API tokens, CDN/object storage.

## 9. Operating cost

| Item | Monthly (SGD, approx.) |
|---|---|
| Hostinger KVM 1 or 2 | 7–15 |
| Domain `nsd.sg` renewal (amortised) | 4–6 |
| Cloudflare free plan (optional DNS/CDN) | 0 |
| Off-box backup storage (Backblaze B2, 50 GB) | 0–1 |
| Transactional email (Resend / SES, low volume) | 0–2 |
| **Total** | **≈ 12–25** |

Bandwidth on Hostinger VPS plans is generous (multi-TB) and static sites are tiny; the realistic
cost drivers are your support time and abuse handling, not hosting.

## 10. Risks to know before launch

1. **Phishing is the #1 abuse case for free subdomain hosting.** Reserved names and the blocked
   substring list help; the abuse queue and one-click suspend are the real defence. Expect reports
   within weeks of launch; answer them the same day or the domain reputation of `nsd.sg` suffers.
2. **Wildcard TLS via Let's Encrypt on-demand mode has rate limits.** Fine for the first ~50 new
   sites/week; switch to wildcard mode (Cloudflare DNS) before growth.
3. **Client-side badge removal is not fully preventable** — a determined user can strip DOM nodes
   with their own JavaScript. The design makes it deliberate and detectable (ToS breach → suspend).
4. **Single VPS = single point of failure.** Backups mitigate data loss; a second VPS + DNS
   failover is the upgrade path. Uptime monitoring on `/healthz` is a must from day one.
5. **Email deliverability** — verification and reset mails need proper SPF/DKIM; use a
   transactional provider rather than raw SMTP from the VPS IP.
6. **Public Suffix List** — until `nsd.sg` is on the PSL, a tenant page can set a `Domain=nsd.sg`
   cookie that browsers send to the platform. The `__Host-` session cookie is immune, but submit to
   the PSL anyway (free, takes a few weeks).
