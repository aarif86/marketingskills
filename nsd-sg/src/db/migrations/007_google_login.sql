-- Sign in with Google (0.6.0): store the Google account id; mark the roadmap item shipped.
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
UPDATE roadmap_items SET status = 'shipped', shipped_at = '2026-09-20T14:00:00Z' WHERE id = 'rm-google-login';
