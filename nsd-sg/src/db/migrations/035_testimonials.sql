-- Quotes from real users, shown on the home page once admin adds them.
CREATE TABLE IF NOT EXISTS testimonials (
  id         TEXT PRIMARY KEY,
  quote      TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  shown      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
