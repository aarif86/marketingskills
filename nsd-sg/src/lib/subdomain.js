// Subdomain rules. A subdomain becomes a public hostname, so the rules are strict:
// DNS label syntax, no look-alike/abuse patterns, and a reserved list checked in the DB.

export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 40;

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// Substrings that are common phishing bait when used as a hostname.
const BLOCKED_SUBSTRINGS = [
  'singpass', 'paynow', 'govsg', 'gov-sg', 'bank', 'wallet', 'crypto', 'verify', 'secure-login',
  'account-update', 'password', 'signin', 'sign-in', 'login', 'appleid', 'icloud', 'paypal', 'dbs-', 'ocbc-', 'uob-',
];

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
  for (const s of BLOCKED_SUBSTRINGS) {
    if (name.includes(s)) return 'That name is not available.';
  }
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
