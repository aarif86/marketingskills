-- Public showcase opt-out + promo codes.
ALTER TABLE sites ADD COLUMN listed INTEGER NOT NULL DEFAULT 1;
