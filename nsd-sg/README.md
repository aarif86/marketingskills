# NSD.SG

**Create your website with AI. Host it on your own .sg address.**

Upload the files an AI tool generated → live at `https://name.nsd.sg` in under a minute. Static
hosting for non-technical people, with a mandatory "Powered by NasarDigital · nsd.sg" badge on free
plans, a data-driven plan system, and a full admin panel.

> This directory is a self-contained application. It lives in the `marketingskills` repository for
> now because that is where the build session was attached; move it to its own repository
> (`nasardigital/nsd-sg`) when convenient — nothing depends on the parent folder.

## Quick start (local)

```bash
cd nsd-sg
npm install
cp .env.example .env               # dev defaults work as-is; set ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                        # http://localhost:3000
```

Locally the platform answers on `localhost`; tenant sites need a Host header
(`curl -H 'Host: alice.nsd.sg' http://localhost:3000/`) or an `/etc/hosts` entry such as
`127.0.0.1 alice.nsd.sg nsd.sg` together with `PLATFORM_HOSTS=nsd.sg,localhost`.

```bash
npm test                           # unit + integration (in-memory DB, temp data dir)
node src/cli.js                    # operator commands: migrate, make-admin, set-plan, plans, prune, stats
```

## Layout

```
src/
  server.js          Fastify app; Host-header router (platform vs tenant)
  config.js          env → config (validated)
  cli.js             operator CLI
  db/                schema.sql (idempotent), migrations/, seed plans + reserved names
  lib/               ids, password (scrypt), subdomain rules, mime allowlist, path sanitiser,
                     rate limiter, audit, mailer (zero-dep SMTP), html templating
  services/          users (auth/sessions/tokens), sites, plans (entitlements)
  storage/           releases (immutable versions, hard-link CoW, rollback, prune), zip (safe extraction)
  serve/             tenant static server + branding injection
  web/               middleware (session/CSRF/headers), routes/, views/ (server-rendered), public/
deploy/              Dockerfile, docker-compose.yml, caddy/ (wildcard + on-demand TLS), scripts/, systemd/
docs/                01 discovery+architecture · 02 security · 03 product spec · 04 Hostinger deploy ·
                     05 business model · 06 operations
test/                node:test suites incl. hostile-ZIP fixtures and cross-tenant checks
```

## Production

See `docs/04-deployment-hostinger.md`. In short: Hostinger KVM VPS → `bash deploy/scripts/setup-vps.sh`
→ edit `.env` → run again. DNS: `A @`, `A www`, `A *` → VPS IP.

## Security

Read `docs/02-security-model.md` before changing anything in `src/storage`, `src/serve` or
`src/lib/{mime,paths,subdomain}.js`. The short version: tenants are static-only, isolated by origin
and filesystem, served through allowlists, and the badge is injected at the serving layer.

## Licence

Proprietary — © NasarDigital.
