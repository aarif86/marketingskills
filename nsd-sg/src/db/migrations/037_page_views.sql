-- First-party page views for the platform's public pages. No personal data: counts per day/hour/path/referrer/device.
CREATE TABLE IF NOT EXISTS page_views (
  day      TEXT NOT NULL,
  hour     INTEGER NOT NULL,
  path     TEXT NOT NULL,
  ref_host TEXT NOT NULL DEFAULT '',
  device   TEXT NOT NULL DEFAULT '',
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, path, ref_host, device)
);
CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views(day);
