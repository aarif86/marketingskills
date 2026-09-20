-- v0.6 brief B2: per-user API tokens for the MCP endpoint. Only the hash is stored; the token is shown once.
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  token_hash    TEXT NOT NULL UNIQUE,
  last_used_at  TEXT,
  last_ip       TEXT NOT NULL DEFAULT '',
  calls         INTEGER NOT NULL DEFAULT 0,
  revoked_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
