-- Hostinger publisher bookkeeping (see src/publish/hostinger.js).
ALTER TABLE sites ADD COLUMN hosting_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE sites ADD COLUMN hosting_error TEXT NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN hosting_synced_at TEXT;
