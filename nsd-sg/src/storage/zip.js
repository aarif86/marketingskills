// Safe ZIP extraction.
// Threats handled: zip bombs (entry count, per-entry and total uncompressed caps enforced while inflating,
// not from the header), path traversal, absolute paths, symlinks, nested archives, disallowed types,
// OS junk, and a single wrapping folder (common when exporting from macOS / AI tools).
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { config } from '../config.js';
import { sanitizeRelativePath, isJunkPath } from '../lib/paths.js';

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function readEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on('entry', (e) => {
      entries.push(e);
      if (entries.length > config.limits.maxZipEntries) {
        zip.close();
        reject(new ZipError(`Archive has more than ${config.limits.maxZipEntries} entries.`));
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

function openStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))));
}

export class ZipError extends Error {}

/**
 * Plan an extraction: validates every entry and returns the list of files to write.
 * Detects a single top-level wrapper directory and strips it.
 * @returns {{ files: Array<{entry, relPath, size}>, skipped: string[], rejected: Array<{path, reason}>, totalBytes:number }}
 */
function planEntries(entries, maxFileBytes) {
  const candidates = [];
  const skipped = [];
  const rejected = [];
  for (const e of entries) {
    const name = e.fileName;
    if (name.endsWith('/')) continue; // directory entry
    if (isJunkPath(name)) { skipped.push(name); continue; }
    const mode = (e.externalFileAttributes >>> 16) & 0xffff;
    if ((mode & S_IFMT) === S_IFLNK) { rejected.push({ path: name, reason: 'symlinks are not allowed' }); continue; }
    if (e.uncompressedSize > maxFileBytes) { rejected.push({ path: name, reason: 'file exceeds the per-file size limit' }); continue; }
    if (e.compressionMethod !== 0 && e.compressionMethod !== 8) { rejected.push({ path: name, reason: 'unsupported compression method' }); continue; }
    candidates.push(e);
  }
  // Wrapper folder detection: every candidate starts with the same `xyz/` prefix.
  let prefix = '';
  if (candidates.length) {
    const first = candidates[0].fileName.replace(/\\/g, '/');
    const slash = first.indexOf('/');
    if (slash > 0) {
      const p = first.slice(0, slash + 1);
      if (candidates.every((c) => c.fileName.replace(/\\/g, '/').startsWith(p))) prefix = p;
    }
  }
  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const e of candidates) {
    const r = sanitizeRelativePath(e.fileName, { stripPrefix: prefix });
    if (!r.ok) { rejected.push({ path: e.fileName, reason: r.reason }); continue; }
    if (seen.has(r.path.toLowerCase())) { rejected.push({ path: e.fileName, reason: 'duplicate path (case-insensitive)' }); continue; }
    seen.add(r.path.toLowerCase());
    totalBytes += e.uncompressedSize;
    if (totalBytes > config.limits.maxZipUncompressedBytes) throw new ZipError('Archive expands beyond the platform limit.');
    files.push({ entry: e, relPath: r.path, size: e.uncompressedSize });
  }
  return { files, skipped, rejected, totalBytes, strippedPrefix: prefix };
}

// Counts bytes as they flow and aborts the moment the declared size is exceeded (bomb protection).
function byteGuard(limit, label) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) return cb(new ZipError(`${label} expanded beyond its declared size.`));
      cb(null, chunk);
    },
  });
}

/**
 * Extract `zipPath` into `destDir` (must already exist and be empty or partially populated).
 * @param {object} opts
 * @param {number} opts.maxFileBytes   per-file cap from the user's plan
 * @param {number} opts.maxTotalBytes  remaining quota
 * @returns {Promise<{written: Array<{path,size}>, skipped: string[], rejected: Array<{path,reason}>, bytes: number}>}
 */
export async function extractZip(zipPath, destDir, { maxFileBytes, maxTotalBytes }) {
  const zip = await openZip(zipPath);
  try {
    const entries = await readEntries(zip);
    const plan = planEntries(entries, maxFileBytes);
    if (plan.files.length === 0) {
      throw new ZipError(plan.rejected.length ? `No usable files in archive. First problem: ${plan.rejected[0].path} — ${plan.rejected[0].reason}` : 'The archive contains no website files.');
    }
    if (plan.totalBytes > maxTotalBytes) {
      throw new ZipError('This upload would exceed your storage quota.');
    }
    const destReal = fs.realpathSync(destDir);
    const written = [];
    let bytes = 0;
    for (const f of plan.files) {
      const target = path.join(destReal, ...f.relPath.split('/'));
      if (!target.startsWith(destReal + path.sep)) throw new ZipError('path escaped destination'); // belt and braces
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const src = await openStream(zip, f.entry);
      await pipeline(src, byteGuard(f.size, f.relPath), fs.createWriteStream(target, { flags: 'wx', mode: 0o640 }));
      const st = fs.statSync(target);
      bytes += st.size;
      written.push({ path: f.relPath, size: st.size });
    }
    return { written, skipped: plan.skipped, rejected: plan.rejected, bytes, strippedPrefix: plan.strippedPrefix };
  } catch (e) {
    if (e instanceof ZipError) throw e;
    // yauzl refuses archives with traversal/absolute entry names or lying size headers; surface that as a user error.
    if (!e.code) throw new ZipError(`The archive was rejected as invalid or unsafe (${e.message}).`);
    throw e;
  } finally {
    zip.close();
  }
}
