// Central configuration. Read once at boot; everything else imports from here.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency). Real env vars always win.
function loadDotEnv() {
  const candidates = [process.env.NSD_ENV_FILE, path.join(__dirname, '..', '.env')].filter(Boolean);
  // Second pass: DATA_DIR/.env holds operator secrets on managed hosting (never inside the build archive).
  const fromData = () => (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.env') : null);
  const fromFiles = new Set(); // keys that came from a file (not the real environment)
  for (const file of candidates.concat(() => fromData())) {
    const resolved = typeof file === 'function' ? file() : file; // DATA_DIR may come from an earlier file
    if (!resolved || !fs.existsSync(resolved)) continue;
    const isOperatorFile = typeof file === 'function'; // DATA_DIR/.env overrides the archive's defaults
    for (const raw of fs.readFileSync(resolved, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || (isOperatorFile && fromFiles.has(key))) { process.env[key] = val; fromFiles.add(key); }
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
const dataDir = path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data')));

// SESSION_SECRET: from the environment, or generated once and kept in DATA_DIR/session-secret (mode 600).
// The file lives outside any document root. Managed hosts (Hostinger) have no shell to run `openssl rand`,
// so this keeps the secret stable across deploys without shipping it inside the build archive.
function resolveSessionSecret() {
  const fromEnv = env('SESSION_SECRET', '');
  if (fromEnv && !fromEnv.startsWith('change-me')) return fromEnv;
  if (!isProd) return 'dev-only-secret-not-for-production-use-please-change';
  const file = path.join(dataDir, 'session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* create below */ }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(file, generated + '\n', { mode: 0o600 });
  return generated;
}
const sessionSecret = resolveSessionSecret();
if (isProd && (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith('change-me'))) {
  throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production');
}

// Hostinger managed hosting: tenants are served by LiteSpeed from TENANT_ROOT/<label>, not by this process.
// Leave TENANT_ROOT empty for the VPS/Caddy deployment where the app serves *.BASE_DOMAIN itself.
const tenantRoot = env('TENANT_ROOT', '');

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
  dataDir,
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
    from: env('SMTP_FROM', `NSD.SG <${env('SMTP_USER', `no-reply@${baseDomain}`)}>`), // Hostinger rejects senders other than the mailbox
  },
  tlsAskToken: env('TLS_ASK_TOKEN', ''),
  // HitPay (or any) hosted payment links per plan id: PAY_LINK_PLUS, PAY_LINK_BETA, ... Upgrade buttons open them.
  hitpay: {
    apiKey: env('HITPAY_API_KEY', ''),
    webhookSalt: env('HITPAY_WEBHOOK_SALT', ''),
    apiSalt: env('HITPAY_API_SALT', ''), // salt shown next to the API key: used by the older form-encoded webhooks (hmac field)
    apiBase: env('HITPAY_API_BASE', env('HITPAY_SANDBOX', '') === '1' ? 'https://api.sandbox.hit-pay.com' : 'https://api.hit-pay.com'),
    // HITPAY_PLAN_PLUS / HITPAY_PLAN_BETA = subscription plan UUIDs from the HitPay dashboard
    plans: Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('HITPAY_PLAN_') && v).map(([k, v]) => [k.slice(12).toLowerCase(), v])),
  },
  payLinks: Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('PAY_LINK_') && v).map(([k, v]) => [k.slice(9).toLowerCase(), v])),
  hostinger: {
    tenantRoot: tenantRoot ? path.resolve(tenantRoot) : '',
    publicHtml: path.resolve(env('PUBLIC_HTML', tenantRoot ? path.dirname(path.resolve(tenantRoot)) : path.join(__dirname, '..', 'data', 'public_html'))),
    username: env('HOSTINGER_USERNAME', ''),
    apiToken: env('HOSTINGER_API_TOKEN', ''),
    apiBase: env('HOSTINGER_API_BASE', 'https://developers.hostinger.com'),
  },
  version: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version,
  rootDir: path.join(__dirname, '..'),
});

export function publicUrlForSubdomain(subdomain) {
  return `${config.publicScheme}://${subdomain}.${config.baseDomain}`;
}

export function platformUrl(p = '/') {
  return `${config.publicScheme}://${config.platformHosts[0]}${p}`;
}
