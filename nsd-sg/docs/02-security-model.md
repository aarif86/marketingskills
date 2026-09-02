# 02 · Security model

The platform lets strangers upload files that will be served under our domain. Every design
decision starts from the assumption that some of those strangers are hostile.

## Principles

1. **Static only, no interpreter in the request path.** Uploaded bytes are streamed to the
   browser. Nothing is executed server-side, ever. PHP, CGI, Node scripts, binaries and shell
   scripts are rejected at upload; even if one slipped through it would be served as an unknown
   type → 404.
2. **Allowlists, not denylists.** File extensions, content types, path characters, HTTP methods
   on tenant hosts, subdomain characters — each is an explicit allowlist (`src/lib/mime.js`,
   `src/lib/paths.js`, `src/lib/subdomain.js`).
3. **Validate at the boundary and again at use.** Paths are sanitised at upload and re-validated
   on every request; content types are decided from our table at serve time, never from the file.
4. **Least privilege everywhere.** Non-root container, read-only rootfs, dropped capabilities,
   single writable volume, `__Host-` cookies, admin routes 404 for non-admins.
5. **Everything security-relevant is audited** (`audit_log`), never deleted by the app.

## Threat matrix

| Threat | Control |
|---|---|
| Malicious HTML / JS / XSS on a tenant site | Each tenant is its own origin (`name.nsd.sg`). Script on one tenant cannot touch another tenant or the platform origin (`nsd.sg`). The platform sets a strict CSP (`script-src 'self'`) and never renders tenant content on its own origin: file previews are served as `text/plain` or as downloads. |
| Tenant JS stealing the dashboard session | Session cookie is `__Host-nsd_session` (Secure, Path=/, no Domain): a subdomain cannot read, set or overwrite it. Recommended: submit `nsd.sg` to the Public Suffix List. |
| Malicious file types (PHP, executables, archives) | Extension allowlist at upload (`isAllowedFileName`) and serve (`contentTypeFor`). Denied list is explicit for audit clarity. Bare names (no extension) rejected except harmless `CNAME`/`_headers`, which are never served. |
| MIME / extension spoofing (`shell.php.png`, `image.html`) | Last extension decides; served with `X-Content-Type-Options: nosniff` so browsers cannot re-interpret. HTML-in-SVG runs only in the tenant's own origin. |
| Directory / path traversal | `sanitizeRelativePath`: no `.`/`..` segments, no absolute paths, no drive letters, no hidden segments, ASCII-only, depth ≤ 12, length ≤ 512. Serve side re-parses the URL, rejects `..`, dot-segments, NUL and backslashes, then `resolveWithin` verifies the absolute path starts with the release root. |
| Symlink attacks | ZIP entries with symlink mode bits are rejected; `resolveWithin` uses `lstat` and only serves regular files; files are written with `wx` (never through an existing link). |
| Malicious ZIPs (traversal names, absolute names) | yauzl refuses them at parse time; surfaced as a user-facing error, nothing extracted. |
| ZIP bombs | Entry count cap (5 000), per-entry declared size vs. plan cap, total declared size vs. platform cap (256 MB) **and** actual inflated bytes counted during extraction; extraction aborts and the staging dir is deleted. Nested archives are not allowed file types. |
| Oversized uploads / resource exhaustion | Caddy caps request bodies (120 MB); Fastify multipart caps per-file, file count and parts; plan quotas cap storage per site; temp files cleaned every 10 min. |
| Bandwidth abuse | Per-IP token bucket on tenant hosts (1 200 req/min); per-site daily counters with monthly plan limits visible to admin; top-bandwidth list on the health page. Cloudflare in front adds free caching/DDoS absorption when needed. |
| Cross-user access / IDOR | Every site query in user routes goes through `getSiteForUser(id, userId)`; a wrong owner yields 404 (not 403) so ids do not leak. Integration tests cover read, upload, delete and settings across users. |
| Privilege escalation | `role` column; `requireAdmin` returns 404; self-demotion and removing the last admin are refused; role changes are `alert`-level audit events. |
| Authentication attacks | scrypt (N=2¹⁵) password hashing, NFKC-normalised; per-IP rate limits on login/signup/reset; per-account lockout after 8 failures (15 min); constant-time compare; dummy hash run for unknown emails; password change revokes all sessions; reset tokens are SHA-256 hashed at rest, single-use, 1 h TTL. |
| Session security | 256-bit random token, hashed in DB, 14-day TTL, HttpOnly, SameSite=Lax, Secure in prod, revocable per user (self-service and admin). |
| CSRF | SameSite=Lax + Origin/Referer host check + HMAC token bound to the session in every form and in multipart uploads. |
| Clickjacking / iframe abuse | Platform: `frame-ancestors 'none'`. Tenants: `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` unless the owner opts in. |
| Phishing pages / malware hosting | Reserved names (banks, government, big brands), blocked substrings (`singpass`, `paynow`, `login`, `verify`, …), public `/report` form with rate limit, admin abuse queue with one-click suspend, `451` page for suspended sites, `reclaim` (delete + reserve). |
| Malicious redirects | No server-side redirects from tenant content (HTML meta-refresh is client-side and confined to the tenant origin). Platform `next` parameter is whitelisted to same-origin relative paths. |
| Storage abuse | Plan quotas on sites, bytes per file, bytes per site, versions kept; unique-inode accounting so hard links are not double-counted; admin per-user overrides. |
| Automated signups | Rate limits (5 signups/IP/hour), email verification, admin visibility of unverified accounts. Add a CAPTCHA at the signup form if abuse warrants it (one template change). |
| Account takeover | Verification/reset links carry unguessable tokens; sessions listed with IP and UA; “sign out everywhere”; admin force-logout. |
| Host header attacks | Production refuses unknown hosts (421); tenant label must be exactly one DNS-safe label under the base domain. |
| Denial of service | Rate limits at app level; Caddy timeouts; container memory cap; HTTP/3 and gzip at the edge; static serving is O(1) per request. For volumetric attacks put Cloudflare (orange cloud) in front — no code change. |
| Supply chain | Six runtime dependencies, all mainstream (`fastify`, three official Fastify plugins, `better-sqlite3`, `yauzl`); `npm audit` clean at build time; lockfile committed. |

## Branding enforcement: what is and is not possible

The badge is added to the HTML **as it leaves the server**. That defeats the obvious attack
(edit `index.html`). CSS-based hiding is defeated by a randomised id and inline `!important`
styles; simple DOM removal is defeated by a MutationObserver guard.

What cannot be defeated technically: the site owner controls JavaScript running in their own
origin. A determined user can remove any element. The platform treats that as a Terms of Service
breach: admins can open any site, see the served HTML, and suspend or reclaim it. This is the same
posture Blogspot, Carrd and WordPress.com take.

## Hardening checklist for launch

- [ ] `SESSION_SECRET` is 48+ random bytes; `.env` is mode 600.
- [ ] Admin password is unique and long; enable 2FA on the Hostinger account itself.
- [ ] `TRUST_PROXY` matches the Caddy network only (Compose sets `true` on an internal network).
- [ ] Cloudflare or Hostinger DNS has `A *`; on-demand TLS ask endpoint has `TLS_ASK_TOKEN`.
- [ ] `nsd.sg` submitted to the Public Suffix List.
- [ ] Uptime monitor on `https://nsd.sg/healthz`.
- [ ] Backups verified by an actual restore into a scratch volume.
- [ ] SPF/DKIM/DMARC for the sending domain of transactional email.
- [ ] Abuse mailbox (`abuse@nsd.sg`) exists and is read.
- [ ] `ufw` and `fail2ban` enabled (done by `setup-vps.sh`); SSH key-only auth.
