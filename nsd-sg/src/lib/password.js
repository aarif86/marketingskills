// Password hashing with Node's built-in scrypt (OWASP-recommended parameters).
// Format: scrypt$N$r$p$<salt b64>$<hash b64>. Parameters stored so they can be raised later.
import crypto from 'node:crypto';

const N = 2 ** 15; // CPU/memory cost (32768)
const r = 8;
const p = 1;
const KEYLEN = 64;

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, n, rr, pp, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scryptAsync(password.normalize('NFKC'), salt, { N: +n, r: +rr, p: +pp });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Returns true when the stored hash uses weaker parameters than the current defaults.
export function needsRehash(stored) {
  const [, n] = stored.split('$');
  return +n < N;
}

export function validatePasswordStrength(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (/^(.)\1+$/.test(password)) return 'Choose a less predictable password.';
  const common = ['password12', 'password123', '1234567890', 'qwertyuiop', 'iloveyou12', 'singapore1'];
  if (common.includes(password.toLowerCase())) return 'That password is too common.';
  return null;
}
