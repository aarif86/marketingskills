-- NSD.SG database schema (SQLite, WAL mode). Applied by src/db/migrate.js.
-- Every statement is idempotent so re-running is safe.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Plans are data, not code. Limits/features live in JSON so new plan types
-- (community, founding, beta, agency) never require a deploy.
CREATE TABLE IF NOT EXISTS plans (
  id                  TEXT PRIMARY KEY,               -- 'free', 'pro', 'community'
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  price_cents_month   INTEGER NOT NULL DEFAULT 0,     -- SGD cents
  trial_days          INTEGER,                        -- NULL = no expiry
  is_public           INTEGER NOT NULL DEFAULT 1,     -- shown on pricing page
  is_default          INTEGER NOT NULL DEFAULT 0,     -- assigned on signup
  limits_json         TEXT NOT NULL DEFAULT '{}',     -- {max_sites, max_storage_bytes, max_file_bytes, max_releases, max_bandwidth_bytes_month}
  features_json       TEXT NOT NULL DEFAULT '{}',     -- {branding_removable, custom_domains, analytics, version_history, priority_support}
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,               -- ulid-ish random id
  email               TEXT NOT NULL UNIQUE,           -- lower-cased
  name                TEXT NOT NULL DEFAULT '',
  password_hash       TEXT NOT NULL,                  -- scrypt$N$r$p$salt$hash
  role                TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','disabled','pending')),
  email_verified_at   TEXT,
  plan_id             TEXT NOT NULL REFERENCES plans(id),
  plan_started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  plan_expires_at     TEXT,                           -- NULL = never
  overrides_json      TEXT NOT NULL DEFAULT '{}',     -- admin per-user overrides: {branding_removed, max_sites, max_storage_bytes,...}
  notes               TEXT NOT NULL DEFAULT '',       -- admin-only notes
  last_login_at       TEXT,
  last_login_ip       TEXT,
  failed_logins       INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,                     -- sha256 of the cookie token
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- One-time tokens: email verification, password reset, plan extension links.
CREATE TABLE IF NOT EXISTS tokens (
  id          TEXT PRIMARY KEY,                       -- sha256 of the raw token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,                          -- 'verify_email' | 'reset_password'
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS reserved_subdomains (
  name        TEXT PRIMARY KEY,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subdomain           TEXT NOT NULL UNIQUE,           -- 'aarif' -> aarif.nsd.sg
  title               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty','live','suspended','deleted')),
  current_release_id  TEXT,                           -- FK to releases.id (nullable; set after first deploy)
  branding_removed    INTEGER NOT NULL DEFAULT 0,     -- admin per-site override (plan can also remove)
  allow_framing       INTEGER NOT NULL DEFAULT 0,     -- allow the site to be embedded in iframes elsewhere
  storage_bytes       INTEGER NOT NULL DEFAULT 0,     -- bytes of current release
  total_storage_bytes INTEGER NOT NULL DEFAULT 0,     -- bytes across retained releases (unique files)
  suspended_reason    TEXT NOT NULL DEFAULT '',
  last_deployed_at    TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);

-- Immutable snapshots. A deploy creates a new release; rollback re-points current_release_id.
CREATE TABLE IF NOT EXISTS releases (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,                     -- monotonically increasing per site
  source        TEXT NOT NULL,                        -- 'zip' | 'files' | 'edit' | 'delete' | 'rollback' | 'initial'
  file_count    INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, version)
);
CREATE INDEX IF NOT EXISTS idx_releases_site ON releases(site_id, version DESC);

-- Custom domains (future feature; schema ready, UI gated by plan feature flag)
CREATE TABLE IF NOT EXISTS custom_domains (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname      TEXT NOT NULL UNIQUE,                 -- 'www.client.sg'
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','active','disabled')),
  verify_token  TEXT NOT NULL,                        -- expected TXT record value
  verified_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_domains_site ON custom_domains(site_id);

-- Every security-relevant action. Never deleted by the app.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id    TEXT,                                   -- user id or NULL for system/anonymous
  actor_role  TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,                          -- 'auth.login', 'site.create', 'admin.user.suspend' ...
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  details     TEXT NOT NULL DEFAULT '{}',
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','alert'))
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity, at DESC);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id            TEXT PRIMARY KEY,
  site_id       TEXT REFERENCES sites(id) ON DELETE SET NULL,
  subdomain     TEXT NOT NULL,
  reporter_email TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,                        -- phishing | malware | copyright | spam | other
  details       TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  resolution    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_abuse_status ON abuse_reports(status, created_at DESC);

-- Daily per-site traffic counters (cheap analytics + bandwidth abuse detection).
CREATE TABLE IF NOT EXISTS site_traffic_daily (
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,                          -- YYYY-MM-DD (UTC)
  requests    INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day)
);

-- Plan lifecycle events (extension requests, upgrades, admin overrides). Billing hooks attach here later.
CREATE TABLE IF NOT EXISTS plan_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                          -- 'extension_requested' | 'extension_granted' | 'plan_changed' | 'payment' ...
  from_plan   TEXT,
  to_plan     TEXT,
  details     TEXT NOT NULL DEFAULT '{}',
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_events_user ON plan_events(user_id, created_at DESC);

-- Promo codes: redeeming assigns the plan (trial from the plan's trial_days). Created in admin.
CREATE TABLE IF NOT EXISTS promo_codes (
  code        TEXT PRIMARY KEY,                       -- upper-case
  plan_id     TEXT NOT NULL REFERENCES plans(id),
  max_uses    INTEGER NOT NULL DEFAULT 1,
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS promo_redemptions (
  code        TEXT NOT NULL REFERENCES promo_codes(code),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (code, user_id)
);

-- HitPay recurring-billing subscriptions created through the API (one row per checkout attempt).
CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,                     -- HitPay recurring_billing id
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id       TEXT NOT NULL REFERENCES plans(id),
  status        TEXT NOT NULL DEFAULT 'pending',      -- pending | active | canceled | failed | abandoned
  reference     TEXT NOT NULL,
  last_event    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- Public roadmap + changelog (Featurebase-style). Items are edited in admin; users vote and suggest.
CREATE TABLE IF NOT EXISTS roadmap_items (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('under_review','planned','in_progress','shipped','declined')),
  category    TEXT NOT NULL DEFAULT 'platform',   -- platform | dashboard | billing | admin | design
  is_public   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  suggested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  shipped_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS roadmap_votes (
  item_id     TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (item_id, user_id)
);
CREATE TABLE IF NOT EXISTS changelog (
  id           TEXT PRIMARY KEY,
  version      TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',            -- plain text; blank line = paragraph, lines starting with "- " = bullets
  tags         TEXT NOT NULL DEFAULT '',            -- comma list: new, improved, fixed
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
