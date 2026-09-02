# 05 · Business model recommendation

## Short answer

Run NSD.SG as **Model E (lead generation for NasarDigital) with Model C/D bolted on as a small
paid tier** — i.e. free hosting with a badge, a single S$9/month “Plus” tier that removes the badge
and adds custom domains, and a deliberate, human hand-off to NasarDigital services. Do **not**
build the 3-month-then-pay treadmill (Model B) as the core; keep the 3-month free period as a
*conversation trigger*, not as a paywall.

## Evaluating the options

| Model | Revenue | Acquisition | Cost/abuse exposure | Verdict |
|---|---|---|---|---|
| A · Completely free | none direct | strongest (zero friction, viral badge) | highest (free forever attracts abuse) | Too pure. Needs a pressure valve. |
| B · Free 3 months then fee | small MRR, high churn | good, then a cliff | moderate | Cliff kills goodwill; the people who leave at month 3 are exactly the ones you wanted as future agency clients. |
| C · Free + paid badge removal | small MRR | good | moderate | Good as *one* feature of the paid tier, weak alone (many users don't mind the badge). |
| D · Free + paid features | modest MRR | good | moderate | Right shape; keep the feature list short. |
| E · Lead gen for NasarDigital | large ticket (S$2–20k projects) | good | moderate | The real prize. NSD.SG's job is to create warm, qualified conversations. |

**Why E wins economically.** Hosting revenue at S$9/month needs ~100 paying users just to cover a
few hours of your time per month. One NasarDigital website project pays more than a year of that
MRR. NSD.SG's unit economics only make sense as a funnel: cost ≈ S$20/month + support time;
value = a steady stream of people who (a) already have a site, (b) have shown they care enough to
publish it, (c) are in Singapore, and (d) now trust your brand because it hosted them for free.

## The recommended plan structure (already seeded)

| Plan | Price | Sites | Storage | Badge | Custom domain | Expiry |
|---|---|---|---|---|---|---|
| **Free** (default) | S$0 | 1 | 100 MB | shown | no | 90 days, extendable on request |
| **Plus** | S$9/mo (or S$90/yr) | 5 | 1 GB | removed | yes | none |
| **Community** (NASAR HQ, invite-only) | S$0 | 3 | 500 MB | shown | no | none |

Adjust freely in `/admin/plans` — no code change. Consider a **Founding** plan (first 100 users,
Plus features free for a year) as a launch lever: it creates advocates and testimonials.

## How the 3-month period should work

* Day 76 (14 days before expiry): banner + email. Copy is *not* “pay or lose your site”; it is
  “Your free period is ending — extend for free, go Plus, or let's talk about a real domain and a
  proper site.” The **extension is granted generously** (one click for you in Admin → Overview).
* The point of the touch-point is the reply. Every extension request is a warm lead: you see
  what they built, their email, and their note. Reply personally, always.
* Expired + no extension for 30 days → site keeps serving with badge for another 60 days, then
  “coming soon” page, then deletion after notice (do this manually at first; automate later).

## Answering the specific concerns

* **Customer acquisition.** The badge on every free site is the acquisition engine
  (`Powered by NasarDigital · nsd.sg` on hundreds of Singapore pages). Add: a “Made with AI, hosted
  on NSD.SG” showcase page; a Telegram/WhatsApp community; short videos “ChatGPT → NSD.SG in 60 s”.
* **Conversion rates.** Free→Plus on comparable products is 2–5%. Free→agency conversation is the
  metric that matters; target 10–15% of extension requests turning into a call.
* **Hosting/storage/bandwidth cost.** ~S$20/month fixed for the first few thousand sites. Static
  sites average 2–5 MB; 1 000 sites ≈ 5 GB; bandwidth is negligible on a VPS plan.
* **Support cost.** The biggest real cost. Mitigate with: the FAQ (written), clear upload error
  messages (built), a “needs `index.html`” warning (built), and a weekly office-hours slot instead of
  ad-hoc chat.
* **Abuse.** Free subdomain hosting *will* attract phishing. Budget 30 minutes/week for the abuse
  queue. The reserved/blocked names, one-click suspend, and reclaim tools are built.
* **Free users who never convert.** They are still useful: they carry the badge, they are a
  showcase, and their cost is cents. Cap their limits (done) rather than evicting them.
* **Willingness to pay / perceived value.** S$9 is below the pain threshold for badge removal +
  custom domain; more important is that Plus is *positioned* as “your site looks fully yours”.
* **Upsell ladder.** Free → Plus (S$9) → Domain + setup (S$150–300 one-off via NasarDigital) →
  Professional site / SEO / automation (S$2k+). Each step is one email away and the dashboard
  already links to it.
* **NSD.SG ↔ NasarDigital.** Keep NSD.SG's brand light and product-like; make NasarDigital the
  “grown-up” brand that appears at every upgrade moment. Same team, two front doors.

## KPIs to watch (all available in Admin today)

Signups/week · sites that publish within 24 h (activation) · extension requests · upgrade
requests · abuse reports per 100 sites · storage and bandwidth top-10. Add a weekly 10-minute
review of `/admin` and you have a working funnel dashboard without building analytics.
