-- 0.9.1: browser details on every audit row (not only sessions), for tying one person to several accounts.
ALTER TABLE audit_log ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
