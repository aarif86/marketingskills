-- 0.8.1: the result page waits until the preview really answers on try.<baseDomain> before showing the link.
ALTER TABLE previews ADD COLUMN ready_at TEXT;
