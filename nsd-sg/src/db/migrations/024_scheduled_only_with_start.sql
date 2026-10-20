-- 0.12.8 marked any unpaid HitPay checkout as 'scheduled' (HitPay reports 'scheduled' for every recurring billing that has not charged yet).
-- Only a checkout with a future start date is a real scheduled subscription; the rest were abandoned attempts.
UPDATE subscriptions SET status = 'abandoned', last_event = 'unpaid_checkout', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE status = 'scheduled' AND starts_at IS NULL;
