-- 0.9.4: the site page waits until name.<baseDomain> really answers over HTTPS before calling the site online.
ALTER TABLE sites ADD COLUMN hosting_ready_at TEXT;
