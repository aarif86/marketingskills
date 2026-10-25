// Visit beacon for hosted sites. On Hostinger the app never serves tenant pages (LiteSpeed does), so the only way
// to know a page was viewed is for the page to say so: one tiny image request back to the platform, no cookies,
// no fingerprinting, counted per site per day. Injected next to the badge at publish time.
const BODY_CLOSE_RE = /<\/body\s*>/i;

export function beaconScript({ label, origin }) {
  const safeLabel = String(label).replace(/[^a-z0-9-]/g, '');
  return `<script data-nsd="v">(function(){try{var i=new Image(1,1);i.src=${JSON.stringify(`${origin}/_v/${safeLabel}`)}+'?p='+encodeURIComponent(location.pathname)+'&r='+encodeURIComponent((document.referrer||'').split('/')[2]||'')+'&_='+Date.now();}catch(e){}})();</script>`;
}

export function injectBeacon(htmlBuffer, opts) {
  const html = htmlBuffer.toString('utf8');
  if (html.includes('data-nsd="v"')) return Buffer.isBuffer(htmlBuffer) ? htmlBuffer : Buffer.from(html, 'utf8');
  const tag = beaconScript(opts);
  const out = BODY_CLOSE_RE.test(html) ? html.replace(BODY_CLOSE_RE, (m) => `${tag}${m}`) : `${html}${tag}`;
  return Buffer.from(out, 'utf8');
}
