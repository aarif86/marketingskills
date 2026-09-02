// Release engine. Every change to a site produces a new immutable release directory:
//   DATA_DIR/sites/<siteId>/releases/<releaseId>/<files>
// The site's `current_release_id` is the only pointer the serving layer follows, so publishing
// and rollback are single atomic DB updates. Unchanged files are hard-linked between releases,
// so a one-file edit costs one file of disk, not a full copy.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { sanitizeRelativePath } from '../lib/paths.js';
import { extractZip, ZipError } from './zip.js';

export class StorageError extends Error {}

const sitesRoot = () => path.join(config.dataDir, 'sites');
const tmpRoot = () => path.join(config.dataDir, 'tmp');

export function ensureStorageDirs() {
  fs.mkdirSync(sitesRoot(), { recursive: true, mode: 0o750 });
  fs.mkdirSync(tmpRoot(), { recursive: true, mode: 0o750 });
}

export function siteDir(siteId) {
  if (!/^[0-9A-Z]{26}$/.test(siteId)) throw new StorageError('bad site id');
  return path.join(sitesRoot(), siteId);
}

export function releaseDir(siteId, releaseId) {
  if (!/^[0-9A-Z]{26}$/.test(releaseId)) throw new StorageError('bad release id');
  return path.join(siteDir(siteId), 'releases', releaseId);
}

export function tempFile(prefix = 'upload') {
  ensureStorageDirs();
  return path.join(tmpRoot(), `${prefix}-${newId()}`);
}

// ---- reading ----------------------------------------------------------------

/** Flat list of files in a release: [{path, size}] sorted by path. */
export function listReleaseFiles(siteId, releaseId) {
  const root = releaseDir(siteId, releaseId);
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function walk(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), relPath);
      else if (ent.isFile()) out.push({ path: relPath, size: fs.statSync(path.join(dir, ent.name)).size });
    }
  })(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readReleaseFile(siteId, releaseId, relPath) {
  const r = sanitizeRelativePath(relPath);
  if (!r.ok) throw new StorageError(r.reason);
  const abs = resolveWithin(releaseDir(siteId, releaseId), r.path);
  if (!abs) throw new StorageError('not found');
  return fs.readFileSync(abs);
}

/** Resolve `rel` inside `root`, returning the absolute path only if it is a regular file inside root. */
export function resolveWithin(root, rel) {
  const abs = path.join(root, ...rel.split('/'));
  if (!abs.startsWith(root + path.sep)) return null;
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null; // symlinks are never followed
  return abs;
}

// ---- writing ----------------------------------------------------------------

function nextVersion(siteId) {
  const row = getDb().prepare('SELECT COALESCE(MAX(version), 0) AS v FROM releases WHERE site_id = ?').get(siteId);
  return row.v + 1;
}

/** Create a staging directory for a new release, optionally pre-populated by hard-linking the current release. */
function stageRelease(siteId, fromReleaseId) {
  const id = newId();
  const dir = releaseDir(siteId, id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  if (fromReleaseId) {
    const src = releaseDir(siteId, fromReleaseId);
    if (fs.existsSync(src)) linkTree(src, dir);
  }
  return { id, dir };
}

function linkTree(src, dst) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      linkTree(s, d);
    } else if (ent.isFile()) {
      try {
        fs.linkSync(s, d);
      } catch {
        fs.copyFileSync(s, d); // cross-device fallback
      }
    }
  }
}

function measure(dir) {
  let bytes = 0;
  let count = 0;
  (function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) { bytes += fs.statSync(p).size; count += 1; }
    }
  })(dir);
  return { bytes, count };
}

/** Sum of unique inode sizes across all retained releases (hard links counted once). */
function uniqueBytes(siteId) {
  const root = path.join(siteDir(siteId), 'releases');
  if (!fs.existsSync(root)) return 0;
  const seen = new Set();
  let bytes = 0;
  (function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) {
        const st = fs.statSync(p);
        if (!seen.has(st.ino)) { seen.add(st.ino); bytes += st.size; }
      }
    }
  })(root);
  return bytes;
}

/** Commit a staged release: record it, point the site at it, prune old ones. */
function commitRelease({ siteId, releaseId, source, note, userId, maxReleases }) {
  const db = getDb();
  const dir = releaseDir(siteId, releaseId);
  const { bytes, count } = measure(dir);
  if (count === 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new StorageError('A site needs at least one file.');
  }
  const version = nextVersion(siteId);
  db.transaction(() => {
    db.prepare('INSERT INTO releases (id, site_id, version, source, file_count, size_bytes, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(releaseId, siteId, version, source, count, bytes, note ?? '', userId ?? null);
    db.prepare("UPDATE sites SET current_release_id = ?, status = CASE WHEN status = 'empty' THEN 'live' ELSE status END, storage_bytes = ?, last_deployed_at = ?, updated_at = ? WHERE id = ?")
      .run(releaseId, bytes, nowIso(), nowIso(), siteId);
  })();
  pruneReleases(siteId, maxReleases);
  db.prepare('UPDATE sites SET total_storage_bytes = ? WHERE id = ?').run(uniqueBytes(siteId), siteId);
  return { id: releaseId, version, bytes, count };
}

export function pruneReleases(siteId, keep) {
  const db = getDb();
  const site = db.prepare('SELECT current_release_id FROM sites WHERE id = ?').get(siteId);
  const rows = db.prepare('SELECT id FROM releases WHERE site_id = ? ORDER BY version DESC').all(siteId);
  const doomed = rows.slice(Math.max(keep, 1)).filter((r) => r.id !== site?.current_release_id);
  for (const r of doomed) {
    db.prepare('DELETE FROM releases WHERE id = ?').run(r.id);
    fs.rmSync(releaseDir(siteId, r.id), { recursive: true, force: true });
  }
  return doomed.length;
}

/**
 * Deploy a ZIP as a brand-new release (full replace).
 */
export async function deployZip({ site, zipPath, user, limits, note = 'ZIP upload' }) {
  ensureStorageDirs();
  const { id, dir } = stageRelease(site.id, null);
  try {
    const result = await extractZip(zipPath, dir, { maxFileBytes: limits.max_file_bytes, maxTotalBytes: limits.max_storage_bytes });
    const rel = commitRelease({ siteId: site.id, releaseId: id, source: 'zip', note, userId: user.id, maxReleases: limits.max_releases });
    return { ...rel, skipped: result.skipped, rejected: result.rejected, strippedPrefix: result.strippedPrefix };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (e instanceof ZipError) throw new StorageError(e.message);
    throw e;
  }
}

/**
 * Add/replace individual files on top of the current release.
 * @param {Array<{relPath:string, tmpPath:string, size:number}>} files
 */
export async function deployFiles({ site, files, user, limits, replaceAll = false, note = 'File upload' }) {
  ensureStorageDirs();
  const { id, dir } = stageRelease(site.id, replaceAll ? null : site.current_release_id);
  try {
    const dirReal = fs.realpathSync(dir);
    for (const f of files) {
      const r = sanitizeRelativePath(f.relPath);
      if (!r.ok) throw new StorageError(`${f.relPath}: ${r.reason}`);
      if (f.size > limits.max_file_bytes) throw new StorageError(`${r.path} exceeds the per-file limit.`);
      const target = path.join(dirReal, ...r.path.split('/'));
      if (!target.startsWith(dirReal + path.sep)) throw new StorageError('path escaped destination');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) fs.unlinkSync(target); // break the hard link before overwriting
      await pipeline(fs.createReadStream(f.tmpPath), fs.createWriteStream(target, { mode: 0o640 }));
    }
    const { bytes } = measure(dir);
    if (bytes > limits.max_storage_bytes) throw new StorageError('This upload would exceed your storage quota.');
    return commitRelease({ siteId: site.id, releaseId: id, source: replaceAll ? 'files' : 'edit', note, userId: user.id, maxReleases: limits.max_releases });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export function deleteFileFromSite({ site, relPath, user, limits }) {
  const r = sanitizeRelativePath(relPath);
  if (!r.ok) throw new StorageError(r.reason);
  if (!site.current_release_id) throw new StorageError('Nothing published yet.');
  const { id, dir } = stageRelease(site.id, site.current_release_id);
  try {
    const target = resolveWithin(fs.realpathSync(dir), r.path);
    if (!target) throw new StorageError('File not found.');
    fs.unlinkSync(target);
    // Remove now-empty parent directories.
    let parent = path.dirname(target);
    while (parent.startsWith(dir) && parent !== dir && fs.readdirSync(parent).length === 0) {
      fs.rmdirSync(parent);
      parent = path.dirname(parent);
    }
    return commitRelease({ siteId: site.id, releaseId: id, source: 'delete', note: `Deleted ${r.path}`, userId: user.id, maxReleases: limits.max_releases });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export function rollbackTo({ site, releaseId, user, limits }) {
  const db = getDb();
  const rel = db.prepare('SELECT * FROM releases WHERE id = ? AND site_id = ?').get(releaseId, site.id);
  if (!rel) throw new StorageError('Release not found.');
  const { id, dir } = stageRelease(site.id, releaseId);
  try {
    return commitRelease({ siteId: site.id, releaseId: id, source: 'rollback', note: `Rollback to v${rel.version}`, userId: user.id, maxReleases: limits.max_releases });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export function listReleases(siteId) {
  return getDb().prepare('SELECT * FROM releases WHERE site_id = ? ORDER BY version DESC').all(siteId);
}

export function deleteSiteStorage(siteId) {
  fs.rmSync(siteDir(siteId), { recursive: true, force: true });
}

/** Remove stale temp uploads (crashed requests). Run from the maintenance timer. */
export function cleanTemp(maxAgeMs = 3600_000) {
  const root = tmpRoot();
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(root)) {
    const p = path.join(root, f);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { force: true, recursive: true }); n++; }
    } catch { /* ignore */ }
  }
  return n;
}

export function diskUsage() {
  try {
    const st = fs.statfsSync(config.dataDir);
    return { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    return { totalBytes: 0, freeBytes: 0 };
  }
}
