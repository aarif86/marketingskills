-- A subscription started before the free period ends saves the card now and charges on starts_at (status 'scheduled').
ALTER TABLE subscriptions ADD COLUMN starts_at TEXT;
