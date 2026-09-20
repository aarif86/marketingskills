-- v0.6 brief A1: new Free sign-ups get 30 days. Existing users keep the expiry stamped at sign-up (nothing here touches users).
UPDATE plans SET trial_days = 30, description = 'Host one site on your own .sg address. Free for 30 days; ask for more time or upgrade.', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'free' AND trial_days = 90;
