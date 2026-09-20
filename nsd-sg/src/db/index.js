// SQLite connection + migrations + seed data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { seedRoadmap } from '../services/roadmap.js';
import { BLOCKED_SUBSTRINGS, setBlockedWords } from '../lib/subdomain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o750 });
  const file = config.isTest ? ':memory:' : path.join(config.dataDir, 'nsd.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

// Migrations: schema.sql is idempotent; numbered migrations in ./migrations/ run once each.
export function migrate(conn = getDb()) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  conn.exec(schema);

  const dir = path.join(__dirname, 'migrations');
  if (fs.existsSync(dir)) {
    const applied = new Set(conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const record = conn.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      conn.transaction(() => {
        conn.exec(sql);
        record.run(f);
      })();
    }
  }
  seedPlans(conn);
  seedReserved(conn);
  seedBlockedWords(conn);
  seedRoadmap(conn);
}

// Default plans. Admin can edit everything about them from the admin panel afterwards.
export const DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'Free',
    description: 'Host one site on your own .sg address. Free for 3 months, extendable.',
    price_cents_month: 0,
    trial_days: 90,
    is_public: 1,
    is_default: 1,
    sort_order: 10,
    limits: { max_sites: 1, max_storage_bytes: 100 * 1024 * 1024, max_file_bytes: 20 * 1024 * 1024, max_releases: 3, max_bandwidth_bytes_month: 5 * 1024 ** 3 },
    features: { branding_removable: false, custom_domains: false, version_history: true, analytics: false, priority_support: false },
  },
  {
    id: 'plus',
    name: 'Plus',
    description: 'Remove the NSD.SG footer, host more sites, keep more history.',
    price_cents_month: 900,
    trial_days: null,
    is_public: 1,
    is_default: 0,
    sort_order: 20,
    limits: { max_sites: 5, max_storage_bytes: 1024 ** 3, max_file_bytes: 50 * 1024 * 1024, max_releases: 10, max_bandwidth_bytes_month: 50 * 1024 ** 3 },
    features: { branding_removable: true, custom_domains: true, version_history: true, analytics: true, priority_support: true, hide_from_showcase: true },
  },
  {
    id: 'beta',
    name: 'Beta',
    description: 'For invited beta testers: 3 sites, no badge, own domain welcome. Free for 3 months, then S$6/month.',
    price_cents_month: 600,
    trial_days: 90,
    is_public: 0,
    is_default: 0,
    sort_order: 25,
    limits: { max_sites: 3, max_storage_bytes: 500 * 1024 * 1024, max_file_bytes: 30 * 1024 * 1024, max_releases: 5, max_bandwidth_bytes_month: 20 * 1024 ** 3 },
    features: { branding_removable: true, custom_domains: true, version_history: true, analytics: true, priority_support: true, hide_from_showcase: true },
  },
  {
    id: 'community',
    name: 'Community',
    description: 'For NASAR HQ members and invited partners. Free hosting with extended limits.',
    price_cents_month: 0,
    trial_days: null,
    is_public: 0,
    is_default: 0,
    sort_order: 30,
    limits: { max_sites: 3, max_storage_bytes: 500 * 1024 * 1024, max_file_bytes: 30 * 1024 * 1024, max_releases: 5, max_bandwidth_bytes_month: 20 * 1024 ** 3 },
    features: { branding_removable: false, custom_domains: false, version_history: true, analytics: true, priority_support: false, hide_from_showcase: true },
  },
];

function seedPlans(conn) {
  const insert = conn.prepare(`
    INSERT OR IGNORE INTO plans (id, name, description, price_cents_month, trial_days, is_public, is_default, limits_json, features_json, sort_order)
    VALUES (@id, @name, @description, @price_cents_month, @trial_days, @is_public, @is_default, @limits_json, @features_json, @sort_order)`);
  for (const p of DEFAULT_PLANS) {
    insert.run({ ...p, limits_json: JSON.stringify(p.limits), features_json: JSON.stringify(p.features) });
  }
}

// Names nobody may register. Admin can add more from the panel.
export const RESERVED_SUBDOMAINS = [
  'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'sftp', 'ssh',
  'ns', 'ns1', 'ns2', 'dns', 'mx', 'autoconfig', 'autodiscover', 'webmail', 'cpanel', 'hpanel', 'whm',
  'static', 'cdn', 'assets', 'media', 'img', 'images', 'files', 'upload', 'uploads', 'download',
  'status', 'health', 'metrics', 'monitor', 'login', 'signup', 'register', 'auth', 'sso', 'oauth', 'account',
  'billing', 'pay', 'payment', 'payments', 'checkout', 'store', 'shop', 'support', 'help', 'docs', 'blog',
  'news', 'dev', 'test', 'try', 'staging', 'beta', 'alpha', 'demo', 'preview', 'sandbox', 'localhost',
  'nsd', 'nasar', 'nasardigital', 'nasarhq', 'hq', 'official', 'root', 'sys', 'system', 'internal',
  'abuse', 'security', 'postmaster', 'hostmaster', 'webmaster', 'noreply', 'no-reply',
  // ToS categories: adult, gambling, scams, impersonation, drugs, weapons, hate (exact names; substrings are blocked in lib/subdomain.js)
  'porn', 'porno', 'sex', 'xxx', 'adult', 'nude', 'nudes', 'escort', 'escorts', 'hentai', 'onlyfans', 'camgirl', 'stripper',
  'casino', 'gambling', 'betting', 'bet', 'bets', 'poker', 'jackpot', 'lottery', 'toto', '4d', 'slots', 'roulette', 'sportsbook',
  'scam', 'phishing', 'hack', 'hacker', 'malware', 'ransomware', 'crack', 'cracked', 'warez', 'torrent', 'piracy',
  'drugs', 'weed', 'cannabis', 'vape', 'vapes', 'cocaine', 'meth', 'guns', 'firearms', 'weapons',
  'singpass', 'paynow', 'cpf', 'iras', 'mom', 'ica', 'hdb', 'moh', 'moe', 'mha', 'spf', 'police', 'gov', 'govt', 'government',
  'dbs', 'posb', 'ocbc', 'uob', 'maybank', 'citibank', 'hsbc', 'grab', 'shopee', 'lazada', 'singtel', 'starhub', 'm1',
  'google', 'facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram', 'apple', 'microsoft', 'amazon', 'netflix', 'paypal',
  'gov', 'govsg', 'singpass', 'cpf', 'iras', 'mom', 'ica', 'police', 'spf', 'moh', 'moe', 'hdb',
  'dbs', 'posb', 'ocbc', 'uob', 'paynow', 'paylah', 'grab', 'shopee', 'lazada', 'singtel', 'starhub',
  'google', 'facebook', 'meta', 'instagram', 'apple', 'microsoft', 'amazon', 'paypal', 'stripe',
  'whatsapp', 'telegram', 'tiktok', 'youtube', 'netflix', 'x', 'twitter',
  'acme', 'letsencrypt', '_acme-challenge', 'wpad', 'isatap',
  // Politically charged names: exact matches only (country names inside other words are innocent).
  'israel', 'palestine', 'gaza', 'hamas', 'hezbollah', 'idf', 'zionist', 'taliban', 'alqaeda', 'isis',
];

// Words refused anywhere inside a name. Seeded once; admin adds/removes at /admin/reserved. These have no
// innocent use inside another word (unlike country names, which stay exact-match above).
export const SEED_BLOCKED_WORDS = [...BLOCKED_SUBSTRINGS, 'hamas', 'hezbollah', 'taliban', 'alqaeda', 'zionis'];

function seedBlockedWords(conn) {
  const insert = conn.prepare('INSERT OR IGNORE INTO blocked_words (word, reason) VALUES (?, ?)');
  conn.transaction((words) => { for (const w of words) insert.run(w, 'system'); })(SEED_BLOCKED_WORDS);
  loadBlockedWords(conn);
}

/** Push the table into the in-memory matcher used by every name check. Call after any admin change. */
export function loadBlockedWords(conn = getDb()) {
  setBlockedWords(conn.prepare('SELECT word FROM blocked_words').all().map((r) => r.word));
}

function seedReserved(conn) {
  const insert = conn.prepare('INSERT OR IGNORE INTO reserved_subdomains (name, reason) VALUES (?, ?)');
  const tx = conn.transaction((names) => {
    for (const n of names) insert.run(n, 'system');
  });
  tx(RESERVED_SUBDOMAINS);
}
