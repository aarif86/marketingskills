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
  // Bottom-left: the quietest corner on almost every page (back-to-top and chat buttons live bottom-right).
  // After a few seconds the words fold away and only the dot + "nsd.sg" chip stays; hover or tap unfolds it.
  const imp = (arr) => arr.map((x) => x + ' !important').join(';');
  const style = imp([
    'position:fixed', 'left:12px', 'bottom:calc(12px + env(safe-area-inset-bottom))', 'z-index:2147483647', 'display:inline-flex', 'align-items:center', 'gap:6px',
    'padding:6px 10px', 'border-radius:999px', 'background:rgba(17,17,20,.88)', 'color:#fff', 'font:500 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'text-decoration:none', 'letter-spacing:.01em', 'box-shadow:0 2px 12px rgba(0,0,0,.25)', 'backdrop-filter:blur(6px)', 'opacity:1', 'visibility:visible',
    'pointer-events:auto', 'transform:none', 'clip:auto', 'width:auto', 'height:auto', 'margin:0', 'max-width:calc(100vw - 24px)', 'overflow:hidden', 'white-space:nowrap',
  ]);
  const wordsStyle = imp(['display:inline-block', 'max-width:260px', 'overflow:hidden', 'transition:max-width .35s ease,opacity .25s ease', 'opacity:1', 'vertical-align:middle']);
  const chipStyle = imp(['display:inline-block', 'font-weight:600']);
  const short = esc(config.baseDomain);
  const badge = `<a id="${id}" href="${url}" rel="noopener" target="_blank" style="${style}" data-nsd="badge" aria-label="${text}">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7c5cff !important;flex:none !important"></span>` +
    `<span data-nsd-words style="${wordsStyle}">${text.replace(` · ${short}`, '').replace(` · ${short}`, '')} · </span><span style="${chipStyle}">${short}</span></a>`;
  const guard = `<script>(function(){var h=${JSON.stringify(badge)};var fold=null;function arm(e){if(e.getAttribute('data-nsd-armed'))return;e.setAttribute('data-nsd-armed','1');var w=e.querySelector('[data-nsd-words]');if(!w)return;` +
    `var close=function(){w.style.setProperty('max-width','0','important');w.style.setProperty('opacity','0','important');};var open=function(){w.style.setProperty('max-width','260px','important');w.style.setProperty('opacity','1','important');clearTimeout(fold);fold=setTimeout(close,3500);};` +
    `fold=setTimeout(close,4000);e.addEventListener('mouseenter',open);e.addEventListener('touchstart',open,{passive:true});e.addEventListener('focus',open);}` +
    `function ok(){var e=document.getElementById(${JSON.stringify(id)});if(!e||!document.body.contains(e)){var d=document.createElement('div');d.innerHTML=h;document.body.appendChild(d.firstChild);e=document.getElementById(${JSON.stringify(id)});}if(e)arm(e);}` +
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
