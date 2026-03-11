-- Sprint 4: Drop legacy lookup columns now that UUID FKs are populated

-- Drop propertyKey column and index from parcel_to_property (replaced by propertyId UUID FK)
DROP INDEX IF EXISTS "idx_parcel_property_key";--> statement-breakpoint
ALTER TABLE "parcel_to_property" DROP COLUMN IF EXISTS "property_key";--> statement-breakpoint

-- Make property_id NOT NULL now that it's the primary FK
ALTER TABLE "parcel_to_property" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint

-- Drop parentPropertyKey column and index from parcelnumb_mapping (replaced by parentPropertyId UUID FK)
DROP INDEX IF EXISTS "idx_parcelnumb_parent_prop";--> statement-breakpoint
ALTER TABLE "parcelnumb_mapping" DROP COLUMN IF EXISTS "parent_property_key";
