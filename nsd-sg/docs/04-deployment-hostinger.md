# 04 · Deployment on Hostinger (step by step)

Target: Hostinger **KVM VPS** running Ubuntu 22.04/24.04. Total time ≈ 30 minutes.

## 0. Prerequisites

* `nsd.sg` registered (Hostinger or elsewhere) and you can edit its DNS zone.
* A KVM VPS (KVM 1 is enough to start). When ordering, pick the plain Ubuntu image or the
  “Docker” template — the setup script installs Docker if it is missing.
* Your SSH public key added to the VPS in hPanel (SSH → key-only auth).

## 1. DNS

Point the domain at the VPS IP with three A records (TTL 300):

| Name | Type | Value |
|---|---|---|
| `@` | A | `<VPS IP>` |
| `www` | A | `<VPS IP>` |
| `*` | A | `<VPS IP>` |

Either in hPanel → Domains → nsd.sg → DNS / Nameservers, or with the API helper:

```bash
export HOSTINGER_API_TOKEN=...      # hPanel → Account → API
bash deploy/scripts/hostinger-dns.sh nsd.sg <VPS IP>
```

**Wildcard TLS option (recommended once you pass ~50 sites/week):** move the zone to Cloudflare
(free): add the site in Cloudflare, copy the three A records, set Hostinger's nameservers to the two
Cloudflare ones, create an API token with `Zone → DNS → Edit` on `nsd.sg`, and set
`TLS_MODE=wildcard` + `CLOUDFLARE_API_TOKEN` in `.env`. Keep records **DNS-only (grey cloud)**
at first; switch to proxied later if you want Cloudflare's cache/DDoS in front.

## 2. Provision the VPS

```bash
ssh root@<VPS IP>
curl -fsSL https://raw.githubusercontent.com/aarif86/marketingskills/claude/nsd-sg-platform-build-6u10hd/nsd-sg/deploy/scripts/setup-vps.sh -o setup-vps.sh
REPO_BRANCH=claude/nsd-sg-platform-build-6u10hd bash setup-vps.sh   # first run: installs Docker, ufw, fail2ban, clones, writes .env, then stops
nano /opt/nsd/nsd-sg/.env                                            # set ADMIN_EMAIL, ADMIN_PASSWORD, SMTP_*, TLS_MODE
REPO_BRANCH=claude/nsd-sg-platform-build-6u10hd bash setup-vps.sh   # second run: builds and starts the stack, installs cron
```

(Once the code is merged to `main`, drop the `REPO_BRANCH=` prefix.)

What the script does: apt updates + unattended-upgrades, Docker, `ufw` (22/80/443), `fail2ban`,
clone to `/opt/nsd`, generate `SESSION_SECRET` and `TLS_ASK_TOKEN`, `docker compose up -d --build`,
nightly backup cron at 03:15 SGT-ish (UTC), weekly prune.

## 3. Verify

```bash
curl -sI https://nsd.sg/healthz            # 200, JSON
curl -sI https://anything.nsd.sg/          # 404 "There is no site here yet"
docker compose -f /opt/nsd/nsd-sg/deploy/docker-compose.yml logs --tail 50
```

Log in at `https://nsd.sg/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, open `/admin/health`.

## 4. Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `BASE_DOMAIN` | ✓ | `nsd.sg` |
| `PLATFORM_HOSTS` | ✓ | `nsd.sg,www.nsd.sg` |
| `SESSION_SECRET` | ✓ | ≥32 random chars (`openssl rand -hex 48`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | first boot | Bootstrap admin (only used when no admin exists) |
| `DATA_DIR` | ✓ | `/var/lib/nsd` in the container (volume `nsd-data`) |
| `TRUST_PROXY` | ✓ | `true` in Compose (internal network), `127.0.0.1` under systemd |
| `MAX_UPLOAD_BYTES`, `MAX_ZIP_ENTRIES`, `MAX_ZIP_UNCOMPRESSED_BYTES` | – | Platform-wide hard caps (plans cap below these) |
| `BRANDING_TEXT`, `BRANDING_URL`, `BRANDING_PARTNER_URL` | – | Badge text/links |
| `SMTP_HOST/PORT/USER/PASS/FROM` | recommended | Transactional email; blank = log to stdout |
| `TLS_ASK_TOKEN` | on-demand mode | Shared secret Caddy sends to `/internal/tls-ask` |
| `TLS_MODE` | ✓ | `ondemand` or `wildcard` |
| `ACME_EMAIL` | ✓ | Let's Encrypt contact |
| `CLOUDFLARE_API_TOKEN` | wildcard mode | DNS-01 |

## 5. Updating the application

```bash
cd /opt/nsd && git pull
cd nsd-sg && docker compose -f deploy/docker-compose.yml up -d --build app
```

Migrations run automatically at boot (`src/db/index.js`). Zero-downtime is not needed at this
scale: the restart takes ~2 s and Caddy retries.

## 6. Without Docker (alternative)

Install Node 22 (`curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install nodejs`)
and Caddy (`apt install caddy`; for wildcard mode download a Caddy build with the Cloudflare
module from caddyserver.com/download), create user `nsd`, `npm ci --omit=dev` in
`/opt/nsd/nsd-sg`, install `deploy/systemd/nsd.service`, and adapt `deploy/caddy/Caddyfile`
(`reverse_proxy 127.0.0.1:3000`, ask URL `http://127.0.0.1:3000/internal/tls-ask`).

## 7. Shared hosting (not supported)

If the account turns out to be shared/Business hosting only, do **not** deploy user uploads
there. Options: (a) add a KVM 1 VPS (≈S$7/mo) — the platform is designed for it; (b) as a
stop-gap, host only the marketing site on shared hosting and keep signups as a waitlist.
