DROP INDEX "idx_parcel_property_key";--> statement-breakpoint
DROP INDEX "idx_parcelnumb_parent_prop";--> statement-breakpoint
ALTER TABLE "parcel_to_property" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_tiers" ADD COLUMN "seats_included" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "seat_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "cancellation_feedback" text;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "canceled_at" timestamp;--> statement-breakpoint
ALTER TABLE "parcel_to_property" DROP COLUMN "property_key";--> statement-breakpoint
ALTER TABLE "parcelnumb_mapping" DROP COLUMN "parent_property_key";