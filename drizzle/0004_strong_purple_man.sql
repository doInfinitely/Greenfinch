-- Epic 11: Persistent UUIDs + schema updates

-- New territories table
CREATE TABLE "territories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#16a34a' NOT NULL,
	"type" text NOT NULL,
	"definition" jsonb NOT NULL,
	"assigned_user_id" uuid,
	"assigned_clerk_user_id" text,
	"created_by_user_id" uuid,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

-- Drop old PK on parcelnumb_mapping (account_num was the PK)
ALTER TABLE "parcelnumb_mapping" DROP CONSTRAINT "parcelnumb_mapping_pkey";--> statement-breakpoint

-- New columns on contacts/organizations (enrichment raw data)
ALTER TABLE "contacts" ADD COLUMN "enrichment_experiences" jsonb;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "enrichment_providers_used" json;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "enrichment_raw_data" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "enrichment_raw_data" jsonb;--> statement-breakpoint

-- Epic 11: UUID FK columns on lookup tables
ALTER TABLE "parcel_to_property" ADD COLUMN "property_id" uuid;--> statement-breakpoint
ALTER TABLE "parcelnumb_mapping" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "parcelnumb_mapping" ADD COLUMN "county" text DEFAULT 'DCAD' NOT NULL;--> statement-breakpoint
ALTER TABLE "parcelnumb_mapping" ADD COLUMN "parent_property_id" uuid;--> statement-breakpoint

-- Multi-county support
ALTER TABLE "properties" ADD COLUMN "cad_county_code" text;--> statement-breakpoint

-- Territory FKs and indexes
ALTER TABLE "territories" ADD CONSTRAINT "territories_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territories" ADD CONSTRAINT "territories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_territories_org" ON "territories" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_territories_assigned_user" ON "territories" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "idx_territories_org_active" ON "territories" USING btree ("clerk_org_id","is_active");--> statement-breakpoint

-- Epic 11: FK constraints on lookup tables
ALTER TABLE "parcel_to_property" ADD CONSTRAINT "parcel_to_property_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelnumb_mapping" ADD CONSTRAINT "parcelnumb_mapping_parent_property_id_properties_id_fk" FOREIGN KEY ("parent_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Epic 11: New indexes
CREATE INDEX "idx_parcel_property_id" ON "parcel_to_property" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_parcelnumb_parent_prop_id" ON "parcelnumb_mapping" USING btree ("parent_property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_parcelnumb_county_account" ON "parcelnumb_mapping" USING btree ("county","account_num");--> statement-breakpoint
CREATE INDEX "idx_properties_cad_county_code" ON "properties" USING btree ("cad_county_code");--> statement-breakpoint

-- Epic 11: Multi-county compound index on properties
CREATE UNIQUE INDEX "idx_properties_county_property_key" ON "properties" USING btree ("county","property_key");
