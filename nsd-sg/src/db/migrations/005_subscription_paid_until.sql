-- Cancel keeps the plan until the end of the period already paid for (last charge + 1 month), not 30 days from cancel.
ALTER TABLE subscriptions ADD COLUMN last_paid_at TEXT;
