-- Honest Free-plan blurb (it is a name.nsd.sg address, not a .sg domain) and a pinned "New" pill on the home page.
UPDATE plans SET description = 'One site at your own nsd.sg address, as many pages as you like.', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'free';
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('home.pill', 'cl-0-13-24', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
