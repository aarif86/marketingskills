// Must be imported before any src module so config picks up the test environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nsd-test-'));
process.env.BASE_DOMAIN = 'nsd.test';
process.env.PLATFORM_HOSTS = 'nsd.test,www.nsd.test';
process.env.PUBLIC_SCHEME = 'http';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.ADMIN_EMAIL = 'admin@nsd.test';
process.env.ADMIN_PASSWORD = 'admin-password-123';
process.env.MAX_UPLOAD_BYTES = String(5 * 1024 * 1024);
process.env.MAX_ZIP_ENTRIES = '50';
process.env.MAX_ZIP_UNCOMPRESSED_BYTES = String(2 * 1024 * 1024);

export const dataDir = process.env.DATA_DIR;

export function cleanup() {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

// Build a multipart/form-data body by hand (no browser here).
export function multipart(fields, files) {
  const boundary = '----nsdtest' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`));
    parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export function cookiesFrom(res) {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

export function csrfFrom(body) {
  const m = String(body).match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}
