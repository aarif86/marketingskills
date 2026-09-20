-- 0.10.0: self-serve custom domains. Checks are recorded so the settings page can say exactly what is missing.
ALTER TABLE custom_domains ADD COLUMN last_checked_at TEXT;
ALTER TABLE custom_domains ADD COLUMN check_note TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_domains ADD COLUMN owner_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_domains ADD COLUMN dns_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_domains ADD COLUMN host_note TEXT NOT NULL DEFAULT '';
