-- Epic 17 + 07: Seat-based licensing and plan management

-- Add seats_included to credit tiers
ALTER TABLE credit_tiers ADD COLUMN seats_included INTEGER DEFAULT 1 NOT NULL;

-- Add seat_count to org subscriptions
ALTER TABLE org_subscriptions ADD COLUMN seat_count INTEGER DEFAULT 1 NOT NULL;

-- Add cancellation tracking to org subscriptions (Epic 07)
ALTER TABLE org_subscriptions ADD COLUMN cancellation_reason TEXT;
ALTER TABLE org_subscriptions ADD COLUMN cancellation_feedback TEXT;
ALTER TABLE org_subscriptions ADD COLUMN canceled_at TIMESTAMP;
