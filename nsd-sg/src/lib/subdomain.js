// Subdomain rules. A subdomain becomes a public hostname, so the rules are strict:
// DNS label syntax, no look-alike/abuse patterns, and a reserved list checked in the DB.

export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 40;

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// Substrings that are common phishing bait when used as a hostname.
// Also the ToS categories (adult, gambling, scams, malware, drugs, weapons, hate). Matched as substrings, so
// "freeporn" and "casino88" are refused too. Short words that are common inside innocent names are NOT here
// (e.g. "bet" would block "alphabet"); those live in the exact-match reserved list instead.
export const BLOCKED_SUBSTRINGS = [
  'singpass', 'paynow', 'govsg', 'gov-sg', 'bank', 'wallet', 'crypto', 'verify', 'secure-login',
  'account-update', 'password', 'signin', 'sign-in', 'login', 'appleid', 'icloud', 'paypal', 'dbs-', 'ocbc-', 'uob-',
  'porn', 'xxx', 'sexy', 'sex-', '-sex', 'nude', 'escort', 'hentai', 'onlyfans', 'fetish', 'milf', 'camgirl', 'hooker', 'brothel',
  'casino', 'gambl', 'betting', 'jackpot', 'lottery', 'toto4d', '4dtoto', 'sportsbook', 'slots88', 'baccarat', 'roulette',
  'phish', 'scam', 'malware', 'ransom', 'hacker', 'hacking', 'warez', 'torrent', 'crack', 'keygen', 'carding', 'cvv',
  'cocaine', 'heroin', 'cannabis', 'marijuana', 'weed-', '-weed', 'ganja', 'vape', 'ketamine', 'ecstasy',
  'firearm', 'weapon', 'explosive', 'bomb', 'terror', 'jihad', 'isis-', 'nazi', 'hitler', 'kkk',
  'nigger', 'chink', 'keling', 'apu-neh',
  'official-', '-official', 'support-', 'helpdesk', 'customer-service', 'giveaway', 'airdrop', 'free-money', 'get-rich', 'forex-signal',
];

/** Which blocked term (if any) a name contains. Used by the registration watchdog to log attempts. */
// Live list: seeded from BLOCKED_SUBSTRINGS, then replaced by the blocked_words table (admin edits it at /admin/reserved).
let liveBlocked = BLOCKED_SUBSTRINGS.slice();
export function setBlockedWords(words) {
  const clean = [...new Set((words ?? []).map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
  liveBlocked = clean.length ? clean : BLOCKED_SUBSTRINGS.slice();
}
export function blockedWords() { return liveBlocked.slice(); }

export function blockedTermIn(name) {
  const n = String(name ?? '').toLowerCase();
  return liveBlocked.find((s) => n.includes(s)) ?? null;
}

export function normalizeSubdomain(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/**
 * Returns null when valid, otherwise a human-readable reason.
 * Does not check reserved/taken — see services/sites.js for the DB-backed checks.
 */
export function validateSubdomainSyntax(name) {
  if (!name) return 'Choose a name for your site.';
  if (name.length < SUBDOMAIN_MIN) return `Use at least ${SUBDOMAIN_MIN} characters.`;
  if (name.length > SUBDOMAIN_MAX) return `Use at most ${SUBDOMAIN_MAX} characters.`;
  if (!LABEL_RE.test(name)) return 'Use only lowercase letters, numbers and hyphens. It must start and end with a letter or number.';
  if (name.includes('--')) return 'Consecutive hyphens are not allowed.';
  if (/^xn--/.test(name)) return 'Punycode names are not allowed.';
  if (/^\d+$/.test(name)) return 'Names cannot be numbers only.';
  if (blockedTermIn(name)) return 'That name is not available.';
  return null;
}

// Extract the tenant label from a request Host header, or null when the host is not a tenant.
export function tenantFromHost(hostHeader, baseDomain, platformHosts) {
  if (!hostHeader) return null;
  let host = String(hostHeader).toLowerCase();
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (platformHosts.includes(host)) return null;
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null; // only one level deep
  if (!LABEL_RE.test(label) && label.length < SUBDOMAIN_MIN) return null;
  return label;
}
