-- Evidence upgrades: legal hold per account, visitor logging per site, upload IP per version, raw visit log.
ALTER TABLE users ADD COLUMN legal_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN log_visitors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE releases ADD COLUMN ip TEXT NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS site_visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT NOT NULL,                           -- no FK: rows must outlive the site row
  subdomain   TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  method      TEXT NOT NULL DEFAULT '',
  path        TEXT NOT NULL DEFAULT '',
  referer     TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT ''                 -- live | suspended | dormant
);
CREATE INDEX IF NOT EXISTS idx_site_visits_site ON site_visits(site_id, at);
