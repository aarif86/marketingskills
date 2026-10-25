// `_redirects` support (the Netlify / Cloudflare Pages convention), kept deliberately small:
//
//   # from            to              status (default 301)
//   /old-page         /new-page       301
//   /blog/*           /posts/:splat   302
//   /gone             /               404     <- "this address is gone": shows the site's 404 page
//   /*                /index.html     200     <- single-page-app fallback
//
// Rules only apply when no file matches the request (files, clean URLs and folder indexes win), exactly like
// the Node server's candidate order and the generated .htaccess. Targets must be paths on the same site:
// redirects to other websites are refused at upload so an nsd.sg address can never be used as an open
// redirector for phishing (see docs/02-security-model.md).
export const REDIRECTS_FILE = '_redirects';
export const MAX_RULES = 200;
const STATUSES = new Set([200, 301, 302, 404]);
const FROM_RE = /^(?:\/[A-Za-z0-9/_.~!'(),;@&=+-]*)?(?:\/\*)?$/;
const TO_RE = /^\/[A-Za-z0-9/_.~!'(),;@&=+?:-]*$/;

/**
 * @returns {{ rules: Array<{from:string,to:string,status:number,splat:boolean,line:number}>, errors: string[] }}
 */
export function parseRedirects(text) {
  const rules = [];
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const n = i + 1;
    const parts = line.split(/\s+/);
    if (parts.length < 2) { errors.push(`line ${n}: write "from to [status]", e.g. "/old /new 301"`); return; }
    if (parts.length > 3) { errors.push(`line ${n}: too many parts. Only "from to [status]" is supported (no conditions or placeholders)`); return; }
    const [from, to, statusRaw] = parts;
    if (/^https?:\/\//i.test(from) || from.startsWith('//')) { errors.push(`line ${n}: "from" must be a path on this site, e.g. /old-page`); return; }
    if (/^https?:\/\//i.test(to) || to.startsWith('//')) { errors.push(`line ${n}: redirects to other websites are not allowed, only to pages on this site`); return; }
    if (from.includes(':') || (to.includes(':') && !to.includes(':splat'))) { errors.push(`line ${n}: placeholders like :slug are not supported; use /* in "from" and :splat in "to"`); return; }
    if (!from.startsWith('/') || !FROM_RE.test(from) || from.includes('..') || from.includes('//')) { errors.push(`line ${n}: "${from}" is not a valid path. Start with / and use * only at the end as /*`); return; }
    if (!TO_RE.test(to) || to.includes('..') || to.startsWith('//')) { errors.push(`line ${n}: "${to}" is not a valid path on this site`); return; }
    const status = statusRaw === undefined ? 301 : Number(statusRaw.replace(/!$/, ''));
    if (!STATUSES.has(status)) { errors.push(`line ${n}: status must be 200, 301, 302 or 404`); return; }
    const splat = from.endsWith('/*');
    if (!splat && to.includes(':splat')) { errors.push(`line ${n}: :splat needs "from" to end with /*`); return; }
    if (status === 200 && to.includes('?')) { errors.push(`line ${n}: a 200 rewrite must point at a file, without ?`); return; }
    rules.push({ from: splat ? from.slice(0, -2) : trimSlash(from), to, status, splat, line: n });
  });
  if (rules.length > MAX_RULES) errors.push(`more than ${MAX_RULES} rules; keep it under that`);
  return { rules, errors };
}

const trimSlash = (p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

/** First rule matching `pathname` (decoded, starts with /), or null. */
export function matchRedirect(rules, pathname) {
  const p = trimSlash(String(pathname ?? '/'));
  for (const r of rules) {
    if (r.splat) {
      const prefix = r.from; // '' for '/*'
      if (p === prefix || p.startsWith(prefix + '/') || prefix === '') {
        const rest = prefix === '' ? p.replace(/^\//, '') : p.slice(prefix.length + 1);
        return { to: r.to.replace(/:splat/g, rest), status: r.status, rule: r };
      }
    } else if (p === r.from) {
      return { to: r.to, status: r.status, rule: r };
    }
  }
  return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Apache/LiteSpeed RewriteRule lines for the generated .htaccess. Files, clean URLs and folder indexes still
 * win (same conditions on every rule), matching the Node server.
 */
export function htaccessRules(rules) {
  if (!rules.length) return [];
  const out = ['  # Rules from the site owner\'s _redirects file (same-site only).'];
  const conds = ['  RewriteCond %{REQUEST_FILENAME} !-f', '  RewriteCond %{REQUEST_FILENAME} !-d', '  RewriteCond %{REQUEST_FILENAME}.html !-f', '  RewriteCond %{REQUEST_FILENAME}/index.html !-f'];
  for (const r of rules) {
    const from = r.from.replace(/^\//, '');
    const pattern = r.splat ? `^${escapeRe(from)}${from ? '(?:/(.*))?' : '(.*)'}$` : `^${escapeRe(from)}/?$`;
    const target = r.splat ? r.to.replace(/:splat/g, '$1') : r.to;
    const flags = r.status === 200 ? '[L]' : r.status === 404 ? '[R=404,L]' : `[R=${r.status},L]`;
    out.push(...conds, `  RewriteRule ${pattern} ${r.status === 404 ? '-' : target} ${flags}`);
  }
  return out;
}

/** Validate a release directory's _redirects file; returns the error list (empty when fine or absent). */
export function redirectsProblems(text) {
  const { errors } = parseRedirects(text);
  return errors;
}
