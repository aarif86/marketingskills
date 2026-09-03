ALTER TABLE promo_redemptions ADD COLUMN prev_plan_id TEXT;
ALTER TABLE promo_redemptions ADD COLUMN prev_expires_at TEXT;
ALTER TABLE promo_redemptions ADD COLUMN removed_at TEXT;
