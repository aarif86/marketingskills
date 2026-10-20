-- Google sign-ups get a random password they never see. password_set = 0 means "no password chosen":
-- the account page offers "Set a password" (no current password asked) and account deletion asks only for DELETE.
ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1;
UPDATE users SET password_set = 0 WHERE google_sub IS NOT NULL
  AND id IN (SELECT target_id FROM audit_log WHERE action = 'auth.signup' AND details LIKE '%"via":"google"%')
  AND id NOT IN (SELECT target_id FROM audit_log WHERE action IN ('auth.password_reset', 'auth.password_changed'));
