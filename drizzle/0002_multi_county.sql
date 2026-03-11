-- Multi-County Support: Add cadCountyCode column, prefix property keys with county code

-- Step 1: Add cad_county_code column
ALTER TABLE "properties" ADD COLUMN "cad_county_code" text;

-- Step 2: Backfill existing rows as DCAD
UPDATE "properties" SET "cad_county_code" = 'DCAD' WHERE "cad_county_code" IS NULL;

-- Step 3: Create index on cad_county_code
CREATE INDEX "idx_properties_cad_county_code" ON "properties" ("cad_county_code");

-- Step 4: Prefix existing DCAD property keys to prevent cross-county collisions
UPDATE "properties" SET "property_key" = 'DCAD-' || "property_key"
  WHERE "cad_county_code" = 'DCAD' AND "property_key" NOT LIKE '%-%';

UPDATE "properties" SET "parent_property_key" = 'DCAD-' || "parent_property_key"
  WHERE "parent_property_key" IS NOT NULL AND "parent_property_key" NOT LIKE '%-%';

UPDATE "parcel_to_property" SET "property_key" = 'DCAD-' || "property_key"
  WHERE "property_key" NOT LIKE '%-%';

UPDATE "parcelnumb_mapping" SET "parent_property_key" = 'DCAD-' || "parent_property_key"
  WHERE "parent_property_key" IS NOT NULL AND "parent_property_key" NOT LIKE '%-%';
