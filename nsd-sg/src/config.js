// Central configuration. Read once at boot; everything else imports from here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency). Real env vars always win.
function loadDotEnv() {
  const candidates = [process.env.NSD_ENV_FILE, path.join(__dirname, '..', '.env')].filter(Boolean);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadDotEnv();

const env = (key, fallback) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};
const int = (key, fallback) => {
  const v = parseInt(env(key, ''), 10);
  return Number.isFinite(v) ? v : fallback;
};

const NODE_ENV = env('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

const baseDomain = env('BASE_DOMAIN', 'nsd.sg').toLowerCase();
const sessionSecret = env('SESSION_SECRET', isProd ? '' : 'dev-only-secret-not-for-production-use-please-change');
if (isProd && (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith('change-me'))) {
  throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production');
}

export const config = Object.freeze({
  env: NODE_ENV,
  isProd,
  isTest,
  host: env('HOST', '127.0.0.1'),
  port: int('PORT', 3000),
  baseDomain,
  platformHosts: env('PLATFORM_HOSTS', `${baseDomain},www.${baseDomain}`)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  publicScheme: env('PUBLIC_SCHEME', isProd ? 'https' : 'http'),
  dataDir: path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data'))),
  sessionSecret,
  sessionCookieName: isProd ? '__Host-nsd_session' : 'nsd_session',
  sessionTtlSeconds: int('SESSION_TTL_SECONDS', 60 * 60 * 24 * 14),
  trustProxy: env('TRUST_PROXY', ''),
  admin: {
    email: env('ADMIN_EMAIL', ''),
    password: env('ADMIN_PASSWORD', ''),
    name: env('ADMIN_NAME', 'NSD Admin'),
  },
  limits: {
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 100 * 1024 * 1024),
    maxZipEntries: int('MAX_ZIP_ENTRIES', 5000),
    maxZipUncompressedBytes: int('MAX_ZIP_UNCOMPRESSED_BYTES', 256 * 1024 * 1024),
    maxFilesPerUpload: int('MAX_FILES_PER_UPLOAD', 200),
    maxPathDepth: 12,
    maxPathLength: 512,
  },
  branding: {
    text: env('BRANDING_TEXT', 'Powered by NasarDigital · nsd.sg'),
    url: env('BRANDING_URL', `https://${baseDomain}`),
    partnerUrl: env('BRANDING_PARTNER_URL', 'https://nasardigital.com'),
  },
  smtp: {
    host: env('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('SMTP_FROM', `NSD.SG <no-reply@${baseDomain}>`),
  },
  tlsAskToken: env('TLS_ASK_TOKEN', ''),
  version: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version,
  rootDir: path.join(__dirname, '..'),
});

export function publicUrlForSubdomain(subdomain) {
  return `${config.publicScheme}://${subdomain}.${config.baseDomain}`;
}

export function platformUrl(p = '/') {
  return `${config.publicScheme}://${config.platformHosts[0]}${p}`;
}
