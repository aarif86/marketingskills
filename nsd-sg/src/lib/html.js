// Tiny HTML helpers for server-rendered views. Everything interpolated into a page goes through esc().
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Template tag: html`<p>${userInput}</p>` escapes interpolations unless wrapped in raw().
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += renderValue(values[i]);
  });
  return new Raw(out);
}

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function raw(s) {
  return new Raw(String(s));
}

function renderValue(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(iso);
}
