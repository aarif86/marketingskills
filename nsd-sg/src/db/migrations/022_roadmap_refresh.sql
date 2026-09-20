-- Roadmap catch-up: what shipped this week, in plain words.
UPDATE roadmap_items SET status = 'shipped', shipped_at = COALESCE(shipped_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  title = 'Reminder emails before your free period ends', body = 'Emails 7 days and 1 day before, on the day, and before a site is removed. First extension is granted instantly.' WHERE id = 'rm-expiry-emails';
