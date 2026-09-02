// Mandatory footer injection. Runs at the serving layer, so the uploaded HTML is irrelevant:
// whatever the user uploads, the badge is added to the response body on the way out.
//
// Enforcement layers (see docs/03-security-model.md "Branding"):
//  1. Injected server-side into every text/html response (cannot be removed by editing files).
//  2. Randomised element id + inline styles with !important, so CSS in the upload cannot target/hide it reliably.
//  3. A tiny guard script re-attaches the badge if page JavaScript removes it.
//  4. Terms of service + admin inspection for anyone who works around 2 and 3 (client-side JS is theirs by design).
import crypto from 'node:crypto';
import { config } from '../config.js';
import { esc } from '../lib/html.js';

export function brandingMarkup() {
  const id = 'n' + crypto.randomBytes(5).toString('hex');
  const text = esc(config.branding.text);
  const url = esc(config.branding.url);
  const style = [
    'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647', 'display:inline-flex', 'align-items:center', 'gap:6px',
    'padding:6px 10px', 'border-radius:999px', 'background:rgba(17,17,20,.88)', 'color:#fff', 'font:500 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'text-decoration:none', 'letter-spacing:.01em', 'box-shadow:0 2px 12px rgba(0,0,0,.25)', 'backdrop-filter:blur(6px)', 'opacity:1', 'visibility:visible',
    'pointer-events:auto', 'transform:none', 'clip:auto', 'width:auto', 'height:auto', 'margin:0',
  ].map((s) => s + ' !important').join(';');
  const badge = `<a id="${id}" href="${url}" rel="noopener" target="_blank" style="${style}" data-nsd="badge" aria-label="${text}">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7c5cff !important"></span>${text}</a>`;
  const guard = `<script>(function(){var h=${JSON.stringify(badge)};function ok(){var e=document.getElementById(${JSON.stringify(id)});if(!e||!document.body.contains(e)){var d=document.createElement('div');d.innerHTML=h;document.body.appendChild(d.firstChild);}}` +
    `if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',ok)}else{ok()}` +
    `try{new MutationObserver(function(){ok()}).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}setInterval(ok,3000)})();</script>`;
  return badge + guard;
}

const BODY_CLOSE_RE = /<\/body\s*>/i;
const HTML_CLOSE_RE = /<\/html\s*>/i;

/**
 * Insert the branding into an HTML document buffer. Works even when the document lacks </body>.
 */
export function injectBranding(htmlBuffer) {
  const html = htmlBuffer.toString('utf8');
  const markup = brandingMarkup();
  let out;
  if (BODY_CLOSE_RE.test(html)) out = html.replace(BODY_CLOSE_RE, (m) => `${markup}${m}`);
  else if (HTML_CLOSE_RE.test(html)) out = html.replace(HTML_CLOSE_RE, (m) => `${markup}${m}`);
  else out = html + markup;
  return Buffer.from(out, 'utf8');
}
