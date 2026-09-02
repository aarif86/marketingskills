// Path validation for uploaded files. Every path that enters the storage engine goes through here.
// Rules: relative, forward slashes, no '.', '..', no hidden segments, printable ASCII only,
// bounded depth and length, allowlisted extension.
import { config } from '../config.js';
import { isAllowedFileName } from './mime.js';

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._ ()@~-]{0,127}$/;

/**
 * Normalize a user/zip-provided path into a safe relative path.
 * Returns { ok: true, path } or { ok: false, reason }.
 */
export function sanitizeRelativePath(input, { stripPrefix = '' } = {}) {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid path' };
  let p = input.replace(/\\/g, '/');
  // Reject NUL, control characters and non-ASCII outright (avoids unicode normalization tricks).
  if (/[\x00-\x1f\x7f]/.test(p)) return { ok: false, reason: "control characters in path" };
  if (/[^\x20-\x7e]/.test(p)) return { ok: false, reason: 'non-ASCII characters in file name' };
  if (p.startsWith('/')) return { ok: false, reason: 'absolute path' };
  if (/^[A-Za-z]:/.test(p)) return { ok: false, reason: 'drive letter in path' };
  if (stripPrefix && p.startsWith(stripPrefix)) p = p.slice(stripPrefix.length);
  const parts = p.split('/').filter((s) => s !== '');
  if (parts.length === 0) return { ok: false, reason: 'empty path' };
  if (parts.length > config.limits.maxPathDepth) return { ok: false, reason: 'path too deep' };
  for (const seg of parts) {
    if (seg === '.' || seg === '..') return { ok: false, reason: 'relative segment in path' };
    if (seg.startsWith('.')) return { ok: false, reason: 'hidden files are not allowed' };
    if (!SEGMENT_RE.test(seg)) return { ok: false, reason: `invalid characters in "${seg}"` };
    if (seg.endsWith('.') || seg.endsWith(' ')) return { ok: false, reason: 'segment ends with dot or space' };
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(seg)) return { ok: false, reason: 'reserved device name' };
  }
  const clean = parts.join('/');
  if (clean.length > config.limits.maxPathLength) return { ok: false, reason: 'path too long' };
  if (!isAllowedFileName(clean)) return { ok: false, reason: `file type not allowed: ${clean.split('/').pop()}` };
  return { ok: true, path: clean };
}

// Paths that are ignored silently when extracting archives (OS junk).
export function isJunkPath(p) {
  const norm = p.replace(/\\/g, '/');
  return (
    norm.startsWith('__MACOSX/') ||
    norm.includes('/__MACOSX/') ||
    /(^|\/)\.DS_Store$/.test(norm) ||
    /(^|\/)Thumbs\.db$/i.test(norm) ||
    /(^|\/)desktop\.ini$/i.test(norm) ||
    /(^|\/)\.git(\/|$)/.test(norm) ||
    /(^|\/)node_modules\//.test(norm) ||
    /(^|\/)\.(env|gitignore|gitattributes|editorconfig|prettierrc|eslintrc)/.test(norm)
  );
}
