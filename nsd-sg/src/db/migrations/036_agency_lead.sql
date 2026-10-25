-- Admin marks an account as a lead for NasarDigital (the funnel's bottom step).
ALTER TABLE users ADD COLUMN agency_lead_at TEXT;
ALTER TABLE users ADD COLUMN agency_lead_note TEXT NOT NULL DEFAULT '';
