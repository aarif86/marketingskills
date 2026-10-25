-- Plus: 20 versions, ZIP export, honest description. Every non-free plan can download its site as a ZIP.
UPDATE plans SET limits_json = json_set(limits_json, '$.max_releases', 20), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'plus' AND json_extract(limits_json, '$.max_releases') < 20;
UPDATE plans SET description = 'Your own address at nsd.sg, no badge, up to 5 sites, 20 versions, help first in line.', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'plus';
UPDATE plans SET features_json = json_set(features_json, '$.export_zip', json('true')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id != 'free';
