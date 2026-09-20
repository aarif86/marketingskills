-- "Try it" previews: anonymous pastes served at try.<baseDomain>/<id>/ for 3 hours.
CREATE TABLE IF NOT EXISTS previews (
  id              TEXT PRIMARY KEY,
  ip              TEXT NOT NULL DEFAULT '',
  bytes           INTEGER NOT NULL DEFAULT 0,
  error           TEXT NOT NULL DEFAULT '',
  claimed_site_id TEXT,
  claimed_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_previews_expires ON previews(expires_at);
INSERT OR IGNORE INTO reserved_subdomains (name, reason) VALUES ('try', 'system');
