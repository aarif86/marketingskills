-- 0.9.0: admin-managed blocked words (matched inside any name) + politically charged exact names.
CREATE TABLE IF NOT EXISTS blocked_words (
  word        TEXT PRIMARY KEY,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
