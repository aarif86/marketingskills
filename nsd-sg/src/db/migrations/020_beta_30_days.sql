-- Beta also 30 days (no users on it yet, so the boundary is set early).
UPDATE plans SET trial_days = 30, description = 'For invited beta testers: 3 sites, no badge, your own domain. Free for 30 days, then S$6/month.', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'beta' AND trial_days = 90;
