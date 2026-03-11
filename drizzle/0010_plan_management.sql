-- Add pending downgrade tracking to org_subscriptions
ALTER TABLE "org_subscriptions" ADD COLUMN "pending_tier_id" uuid REFERENCES "credit_tiers"("id");
ALTER TABLE "org_subscriptions" ADD COLUMN "pending_change_effective_at" timestamp;

-- Cancellation surveys table
CREATE TABLE IF NOT EXISTS "cancellation_surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_org_id" text NOT NULL,
  "reason" text NOT NULL,
  "feedback" text,
  "retention_offer_shown" boolean DEFAULT false,
  "retention_offer_accepted" boolean DEFAULT false,
  "retention_offer_type" text,
  "outcome" text NOT NULL,
  "canceled_by_user_id" text,
  "created_at" timestamp DEFAULT now()
);
