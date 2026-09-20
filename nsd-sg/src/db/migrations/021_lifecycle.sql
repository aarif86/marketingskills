-- 0.12.0: plan lifecycle. Which reminder went to whom, for which expiry date (a new date resets the set).
CREATE TABLE IF NOT EXISTS plan_notices (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,           -- expiring_7 | expiring_1 | expired | dormant | delete_warning | deleted
  ref       TEXT NOT NULL,           -- the plan_expires_at the notice was about
  sent_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, kind, ref)
);
-- Public plan rows: description text and the showcase flag that the first seed did not carry.
UPDATE plans SET description = 'Host one site on your own .sg address.' WHERE id = 'free';
UPDATE plans SET description = 'Your own domain name, no badge, up to 5 sites.',
  features_json = json_set(features_json, '$.hide_from_showcase', json('true'), '$.custom_domains', json('true'), '$.branding_removable', json('true')) WHERE id = 'plus';
UPDATE plans SET features_json = json_set(features_json, '$.hide_from_showcase', json('true'), '$.custom_domains', json('true'), '$.branding_removable', json('true')) WHERE id = 'beta';
