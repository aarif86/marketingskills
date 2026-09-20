-- 0.9.6: self-healing provisioning. How often we retried creating the subdomain, when, and whether admin was told.
ALTER TABLE sites ADD COLUMN hosting_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN hosting_last_attempt_at TEXT;
ALTER TABLE sites ADD COLUMN hosting_alerted_at TEXT;
