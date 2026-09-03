<!--
====================================================================
  CLAUDE_LOG — session-by-session record for the NSD.SG project
  Created: 3 Sep 2026, 06:51 SGT (session ran overnight 2 → 3 Sep)
  By Aarif Raziff

  One line per wrapped session, newest first. WIN lines carry a public
  version and a sensitivity. This file lives next to the HANDOVER files
  in nsd-sg/ so it travels with the repo (the remote build container has
  no memory directory of its own).
====================================================================
-->

# CLAUDE_LOG

- 2026-09-03 09:05 SGT | Nasar Digital | WIN | NSD.SG went live. Found the account has no VPS, re-platformed the v0.1.0 build onto Hostinger Cloud Startup managed Node.js (publisher adapter, lsnode entry shim, API subdomain provisioning, secrets outside the archive), moved nsd.sg to the aarif.sg account, deployed v0.2.0→0.2.2 through the Hostinger MCP and verified the whole tenant lifecycle on the live site (self-provisioned subdomain, badge, clean URLs, 404, suspend, rollback, delete). 38 tests. Code committed locally, not yet pushed. | HANDOVER_poc-hosting-platform_2026-09-03_v01.md
  Public: Took a multi-tenant static-hosting platform that had been designed for a dedicated server and got it running on ordinary managed shared hosting in one session — by deploying a probe first to measure what the runtime actually allows (process model, filesystem, entry-file rules), then writing a thin publisher layer that turns each site's state into a document root the host's web server serves directly. Verified end to end on the live domain: a new site created from the dashboard provisions its own subdomain via the host's API and is live with SSL within minutes.
  Sensitivity: Public

- 2026-09-03 06:51 SGT | Nasar Digital | WIN | Built the whole NSD.SG platform (static-site hosting on name.nsd.sg) from a blank brief in one session: Node/Fastify/SQLite app, tenant server with serve-time "Powered by NasarDigital" badge, hostile-ZIP-safe deploy engine with versions/rollback, dashboard + admin panel, Hostinger VPS deploy kit, 6 docs, 31 passing tests. Pushed to `claude/nsd-sg-platform-build-6u10hd`. Not deployed: the session had no Hostinger access.
  Public: Shipped a complete multi-tenant static hosting platform (upload → live on your own .sg subdomain) with a security-first design, admin tooling and a one-script VPS deployment, in a single AI-assisted session.
  Sensitivity: Public
