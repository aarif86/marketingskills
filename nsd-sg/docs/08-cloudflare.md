# Cloudflare in front of nsd.sg (free plan)

**Why:** when the Hostinger server is in maintenance, visitors currently get Hostinger's "Whoops! 500" page on
nsd.sg and on every customer site. With Cloudflare in front, they get a page in our words, and cached copies of
customer pages keep being served while the origin is down. Cost: S$0. Time: about an hour, mostly waiting on DNS.

## Before you start (5 min)

1. Deploy 0.12.4 or later and put these two lines in `nsd-data/.env`, then Deploy again (not Restart):
   ```
   TRUST_CLOUDFLARE=1
   DOMAIN_CNAME_TARGET=origin.nsd.sg
   ```
   The first makes the app read the real visitor IP behind Cloudflare (otherwise every visitor looks like
   Cloudflare and the rate limits would lock everyone out together). The second changes the custom-domain
   instructions so customers point `www` at `origin.nsd.sg` instead of `name.nsd.sg`; a CNAME to a proxied
   Cloudflare record from another domain is refused by Cloudflare on the free plan.
2. Have your registrar login ready (where nsd.sg was bought). You will change two nameservers there.
3. Note the server IP: `185.210.146.192`.

## Step 1 — Add the site to Cloudflare (10 min)

1. https://dash.cloudflare.com → Sign up (free) → **Add a domain** → `nsd.sg` → Free plan.
2. Cloudflare scans your existing DNS. Check the list against hPanel → DNS / Nameservers. Keep every MX / TXT
   record (email!). Then make the records below exist, exactly:

   | Type | Name | Content | Proxy |
   |---|---|---|---|
   | A | `@` | 185.210.146.192 | Proxied (orange) |
   | A | `www` | 185.210.146.192 | Proxied |
   | A | `*` | 185.210.146.192 | Proxied |
   | A | `origin` | 185.210.146.192 | **DNS only (grey)** |
   | MX / TXT | as scanned | unchanged | DNS only |

   The `*` record is what makes every new customer address resolve at once. `origin` is the un-proxied door
   for customers' own domains. If Cloudflare refuses to proxy the `*` record on the free plan, set it to DNS
   only for now; customer sites then bypass Cloudflare (no cached copies, but nothing breaks).
3. Cloudflare shows two nameservers (e.g. `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`). At your registrar,
   replace Hostinger's nameservers with those two. Propagation takes minutes to a few hours; the site keeps
   working throughout because the IP does not change.

## Step 2 — SSL (2 min)

Cloudflare → SSL/TLS → Overview → **Full** (not "Full (strict)" yet). Reason: a brand-new customer subdomain has
no certificate at Hostinger for its first 5–15 minutes; "Full" still proxies it, "strict" would show an error until
Hostinger's certificate lands. Also switch on **Always Use HTTPS** (SSL/TLS → Edge Certificates).

## Step 3 — Keep customer pages up during outages (5 min)

1. Caching → Configuration → **Always Online: On**.
2. Rules → Cache Rules → Create: name "Cache customer sites". When: Hostname *ends with* `.nsd.sg` AND Hostname
   *does not equal* `www.nsd.sg` AND Hostname *does not equal* `try.nsd.sg`. Then: **Eligible for cache**,
   Edge TTL 2 hours, Browser TTL "respect origin". Save.
   The dashboard (nsd.sg, www) is never cached: it is per-user. Test pages last 3 hours, so they are left alone.
3. Rules → Page Rules is not needed; the cache rule above does it.

Note: when a customer publishes a new version, Cloudflare may keep the old page for up to 2 hours. The app
already sends `Cache-Control` for HTML; if the delay bothers anyone, lower Edge TTL to 10 minutes.

## Step 4 — Your own maintenance page instead of "Whoops" (5 min)

Cloudflare → (your zone) → Custom Pages → **5XX Errors** → Custom page URL. Host the page on nsd.sg itself at
`https://nsd.sg/assets/maintenance.html` (added in 0.12.4; Cloudflare fetches and stores a copy, so it works even
when the origin is down). Preview, Publish. If the 5XX option is greyed out on your plan, the default Cloudflare
error page still beats Whoops and names Cloudflare, not Hostinger.

## Step 5 — Check (5 min)

- https://nsd.sg/healthz works; the padlock says "Cloudflare" or "Google Trust Services" in the certificate.
- https://aarif.nsd.sg loads; response headers include `cf-cache-status`.
- Admin → Audit log: your own login shows your real IP, not a 104.x / 172.x Cloudflare address.
- Make a test page from the home page: still works, still gets its link.

## What changes for customers' own domains

Their `www` CNAME target becomes `origin.nsd.sg` (the app tells them). Their bare domain A record stays
`185.210.146.192`. These requests bypass Cloudflare and hit Hostinger directly, which is fine.

## Rolling back

Registrar → put Hostinger's nameservers back. Everything returns to today's setup within an hour. Nothing in
the app depends on Cloudflare being there; `TRUST_CLOUDFLARE` and `DOMAIN_CNAME_TARGET` can stay set.
