// The one place that decides what may be stored and how it is served.
// Uploaded files are NEVER served with a user-supplied content type.
// Anything not on this list is rejected at upload time.

export const ALLOWED_EXTENSIONS = new Map([
  // documents
  ['html', 'text/html; charset=utf-8'],
  ['htm', 'text/html; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'],
  ['mjs', 'text/javascript; charset=utf-8'],
  ['json', 'application/json; charset=utf-8'],
  ['map', 'application/json; charset=utf-8'],
  ['webmanifest', 'application/manifest+json; charset=utf-8'],
  ['txt', 'text/plain; charset=utf-8'],
  ['md', 'text/plain; charset=utf-8'],
  ['xml', 'application/xml; charset=utf-8'],
  ['csv', 'text/csv; charset=utf-8'],
  ['pdf', 'application/pdf'],
  ['vtt', 'text/vtt; charset=utf-8'],
  // images
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['svg', 'image/svg+xml'],
  ['ico', 'image/x-icon'],
  ['bmp', 'image/bmp'],
  // fonts
  ['woff', 'font/woff'],
  ['woff2', 'font/woff2'],
  ['ttf', 'font/ttf'],
  ['otf', 'font/otf'],
  ['eot', 'application/vnd.ms-fontobject'],
  // media
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['wav', 'audio/wav'],
  ['m4a', 'audio/mp4'],
  // binary data that is harmless when served as download-ish types
  ['wasm', 'application/wasm'],
  ['glb', 'model/gltf-binary'],
  ['gltf', 'model/gltf+json'],
]);

// Explicitly rejected even though the allowlist would already block them; listed for audit messages.
export const DANGEROUS_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'php7', 'phtml', 'phar', 'cgi', 'pl', 'py', 'rb', 'sh', 'bash', 'zsh',
  'exe', 'dll', 'so', 'bat', 'cmd', 'com', 'msi', 'scr', 'jar', 'war', 'asp', 'aspx', 'jsp', 'jspx',
  'htaccess', 'htpasswd', 'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'apk', 'ipa',
]);

// Files that may exist at the root without an extension.
export const ALLOWED_BARE_NAMES = new Map([
  ['_headers', null], // ignored, never served
  ['CNAME', null], // ignored, never served
]);

export const HTML_EXTENSIONS = new Set(['html', 'htm']);

export function extensionOf(name) {
  const base = name.split('/').pop();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function contentTypeFor(name) {
  return ALLOWED_EXTENSIONS.get(extensionOf(name)) ?? null;
}

export function isAllowedFileName(name) {
  const ext = extensionOf(name);
  if (!ext) return ALLOWED_BARE_NAMES.has(name.split('/').pop());
  if (DANGEROUS_EXTENSIONS.has(ext)) return false;
  return ALLOWED_EXTENSIONS.has(ext);
}

// Long-lived caching for fingerprinted assets, short for HTML (which we may inject into).
export function cacheControlFor(name) {
  const ext = extensionOf(name);
  if (HTML_EXTENSIONS.has(ext) || ext === 'json' || ext === 'webmanifest' || ext === 'xml' || ext === 'txt') {
    return 'public, max-age=60, must-revalidate';
  }
  return 'public, max-age=3600, stale-while-revalidate=86400';
}
