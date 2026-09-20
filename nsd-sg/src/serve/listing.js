// Old-school "Index of /" page for sites (or folders) without an index.html, in NSD.SG branding.
// Someone who uploads two PDFs and nothing else still gets a page that works: a clean list of their files.
import fs from 'node:fs';
import path from 'node:path';
import { esc, formatBytes } from '../lib/html.js';

const ICON = { pdf: '📕', html: '📄', htm: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', avif: '🖼️', mp4: '🎬', webm: '🎬', mov: '🎬', mp3: '🎧', wav: '🎧', ogg: '🎧', zip: '🗜️', css: '🎨', js: '⚙️', json: '⚙️', txt: '📝', md: '📝', csv: '📊', woff: '🔤', woff2: '🔤', ttf: '🔤', otf: '🔤' };
const iconFor = (name, isDir) => (isDir ? '📁' : ICON[name.split('.').pop().toLowerCase()] ?? '📎');

/** Read one directory of a release/docroot: folders first, then files, hidden entries skipped. */
export function readListing(absDir) {
  const out = [];
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name.startsWith('_nsd-')) continue;
    if (ent.isDirectory()) out.push({ name: ent.name, isDir: true, size: 0 });
    else if (ent.isFile()) out.push({ name: ent.name, isDir: false, size: fs.statSync(path.join(absDir, ent.name)).size });
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : a.isDir ? -1 : 1));
}

/**
 * @param {{ host:string, dir:string, entries:Array<{name:string,isDir:boolean,size:number}> }} p  dir is '' for the root or 'docs/sub'
 */
export function listingPage({ host, dir, entries }) {
  const crumbs = dir ? dir.split('/') : [];
  const trail = [`<a href="/">${esc(host)}</a>`].concat(crumbs.map((c, i) => `<a href="/${crumbs.slice(0, i + 1).map(encodeURIComponent).join('/')}/">${esc(c)}</a>`)).join('<span class="sep">/</span>');
  const rows = entries.map((e) => {
    const href = encodeURIComponent(e.name) + (e.isDir ? '/' : '');
    return `<li><a href="${href}"><span class="ic">${iconFor(e.name, e.isDir)}</span><span class="nm">${esc(e.name)}${e.isDir ? '/' : ''}</span><span class="sz">${e.isDir ? '' : formatBytes(e.size)}</span></a></li>`;
  }).join('');
  const total = entries.filter((e) => !e.isDir).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(dir ? `${dir} · ${host}` : host)}</title><meta name="description" content="${esc(`${total} file${total === 1 ? '' : 's'} on ${host}`)}">
<style>:root{--bg:#0f1014;--bg2:#15161c;--line:rgba(255,255,255,.08);--text:#f2f2f5;--muted:#8f909c;--accent:#a78bfa}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",Roboto,system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:clamp(40px,8vw,96px) 20px 120px}
.mark{font-weight:800;letter-spacing:.08em;font-size:.95rem;color:#fff;margin-bottom:40px;display:inline-block}.mark b{color:var(--accent)}
h1{font-size:clamp(1.4rem,3.5vw,2rem);letter-spacing:-.02em;margin:0 0 6px;overflow-wrap:anywhere}h1 a{color:inherit;text-decoration:none}h1 .sep{color:var(--muted);margin:0 8px;font-weight:400}
p.lead{color:var(--muted);margin:0 0 28px}
ul{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:18px;background:var(--bg2);overflow:hidden}
li+li{border-top:1px solid var(--line)}li a{display:grid;grid-template-columns:32px 1fr auto;gap:14px;align-items:center;padding:16px 20px;color:var(--text);text-decoration:none;transition:background .15s}li a:hover{background:rgba(255,255,255,.04)}
.ic{font-size:1.2rem;text-align:center}.nm{overflow-wrap:anywhere}.sz{color:var(--muted);font-size:.85rem;white-space:nowrap}
.empty{padding:32px 20px;color:var(--muted);text-align:center}
footer{margin-top:40px;color:var(--muted);font-size:.85rem}footer a{color:var(--accent);text-decoration:none}</style></head>
<body><main><div class="mark">NSD<b>.SG</b></div>
<h1>${trail}</h1><p class="lead">${total} file${total === 1 ? '' : 's'}${entries.some((e) => e.isDir) ? ` · ${entries.filter((e) => e.isDir).length} folder${entries.filter((e) => e.isDir).length === 1 ? '' : 's'}` : ''}</p>
${entries.length ? `<ul>${dir ? `<li><a href="../"><span class="ic">↩︎</span><span class="nm">Back</span><span class="sz"></span></a></li>` : ''}${rows}</ul>` : `<div class="empty">Nothing here yet.</div>`}
<footer>This is a list of the files on ${esc(host)}. The owner has not added a home page yet.</footer>
</main></body></html>`;
}
