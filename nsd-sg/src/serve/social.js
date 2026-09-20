// Share previews (Open Graph / Twitter cards) for hosted pages. WhatsApp, Telegram, iMessage and LinkedIn read
// these tags to draw the little card under a link. AI-generated pages rarely carry them, so we add sensible
// defaults on the way out; a page that already has og:title is left exactly as it is.
import { esc } from '../lib/html.js';

const HEAD_OPEN_RE = /<head[^>]*>/i;
const HEAD_CLOSE_RE = /<\/head\s*>/i;

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();

export function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  return m ? decode(m[1]).slice(0, 120) : '';
}

export function pageDescription(html) {
  const s = String(html);
  const m = /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(s) || /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(s);
  if (m) return decode(m[1]).slice(0, 200);
  // First readable paragraph, tags stripped.
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(s);
  if (p) { const t = decode(p[1].replace(/<[^>]+>/g, '')); if (t.length >= 20) return t.slice(0, 200); }
  return '';
}

export function hasSocialTags(html) {
  return /property=["']og:title["']/i.test(String(html));
}

/** Build the tag block. `title`/`description` fall back to what the page says. */
export function socialTags(html, { url, siteName, image, title, description, type = 'website', plain = false }) {
  const t = title || pageTitle(html) || siteName;
  const d = description || pageDescription(html) || (plain ? `A page on ${siteName}.` : `A page on ${siteName}, made with AI and put online with NSD.SG.`);
  if (plain) image = '';
  const hasImage = /property=["']og:image["']/i.test(String(html));
  return [
    `<meta property="og:type" content="${esc(type)}">`,
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:title" content="${esc(t)}">`,
    `<meta property="og:description" content="${esc(d)}">`,
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    image && !hasImage ? `<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : '',
    `<meta name="twitter:card" content="${image && !hasImage ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(t)}">`,
    `<meta name="twitter:description" content="${esc(d)}">`,
    image && !hasImage ? `<meta name="twitter:image" content="${esc(image)}">` : '',
  ].filter(Boolean).join('');
}

/** Add share tags to an HTML document (Buffer or string) unless it already has og:title. Returns a Buffer.
 *  `plain: true` (paid plans / badge removed) means no NSD.SG image and no NSD.SG wording: the promise that removes the badge removes it from link previews too. */
export function injectSocial(htmlBuffer, opts) {
  const html = htmlBuffer.toString('utf8');
  if (hasSocialTags(html)) return Buffer.isBuffer(htmlBuffer) ? htmlBuffer : Buffer.from(html, 'utf8');
  const tags = socialTags(html, opts);
  let out;
  if (HEAD_OPEN_RE.test(html)) out = html.replace(HEAD_OPEN_RE, (m) => `${m}${tags}`);
  else if (HEAD_CLOSE_RE.test(html)) out = html.replace(HEAD_CLOSE_RE, (m) => `${tags}${m}`);
  else out = `${tags}${html}`;
  return Buffer.from(out, 'utf8');
}
