CREATE TABLE "cancellation_surveys" (
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
--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "pending_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "pending_change_effective_at" timestamp;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_pending_tier_id_credit_tiers_id_fk" FOREIGN KEY ("pending_tier_id") REFERENCES "public"."credit_tiers"("id") ON DELETE no action ON UPDATE no action;