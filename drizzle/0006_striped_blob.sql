CREATE TABLE "org_credit_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"plan_name" text DEFAULT 'starter',
	"monthly_credits" real DEFAULT 1000,
	"billing_period_start" timestamp,
	"billing_period_end" timestamp,
	"rollover_credits" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "org_credit_allocations_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
DROP INDEX "idx_properties_county_property_key";--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "revenue_estimates" jsonb;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "revenue_estimate_total" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "revenue_estimate_rationale" json;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "revenue_estimates_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "walkthrough_state" jsonb DEFAULT '{"completedTours":[],"dismissedTooltips":[],"skippedAll":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_progress" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "territory_zip_codes" json;--> statement-breakpoint
CREATE INDEX "idx_enrichment_cost_org_created" ON "enrichment_cost_events" USING btree ("clerk_org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_properties_lat_lon" ON "properties" USING btree ("lat","lon");