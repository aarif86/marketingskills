// Time-sortable random identifiers (ULID-like, Crockford base32, 26 chars) and secure tokens.
import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId() {
  let time = Date.now();
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[time % 32] + out;
    time = Math.floor(time / 32);
  }
  const rand = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) out += ALPHABET[rand[i] % 32];
  return out;
}

// URL-safe random token for cookies / links. 32 bytes = 256 bits of entropy.
export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoAfterSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function isoAfterDays(days) {
  return isoAfterSeconds(days * 86400);
}
