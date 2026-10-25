-- Showcase rule per plan: Free listed (no choice); promo, gift and beta listed unless the owner hides; paid hidden unless the owner shows.
UPDATE plans SET features_json = json_set(features_json, '$.showcase', 'always') WHERE id = 'free';
UPDATE plans SET features_json = json_set(features_json, '$.showcase', 'opt_in') WHERE id = 'plus';
UPDATE plans SET features_json = json_set(features_json, '$.showcase', 'opt_out', '$.hide_from_showcase', json('true')) WHERE id IN ('beta', 'community') OR (id NOT IN ('free', 'plus') AND is_public = 0 AND trial_days IS NOT NULL AND trial_days > 0);
