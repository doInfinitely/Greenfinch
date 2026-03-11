-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add entity-generic columns to potential_duplicates
ALTER TABLE potential_duplicates ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'contact';
ALTER TABLE potential_duplicates ADD COLUMN IF NOT EXISTS entity_id_a uuid;
ALTER TABLE potential_duplicates ADD COLUMN IF NOT EXISTS entity_id_b uuid;

-- Backfill existing rows
UPDATE potential_duplicates
SET entity_id_a = contact_id_a, entity_id_b = contact_id_b
WHERE entity_id_a IS NULL;

-- Make contact FKs nullable for non-contact entity types
ALTER TABLE potential_duplicates ALTER COLUMN contact_id_a DROP NOT NULL;
ALTER TABLE potential_duplicates ALTER COLUMN contact_id_b DROP NOT NULL;

-- GIN trigram indexes for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_contacts_normalized_name_trgm ON contacts USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm ON organizations USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_properties_validated_address_trgm ON properties USING gin (validated_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_properties_regrid_address_trgm ON properties USING gin (regrid_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_properties_dcad_owner_name1_trgm ON properties USING gin (dcad_owner_name1 gin_trgm_ops);

-- Index for entity-generic duplicate lookups
CREATE INDEX IF NOT EXISTS idx_potential_duplicates_entity_type ON potential_duplicates (entity_type);
CREATE INDEX IF NOT EXISTS idx_potential_duplicates_entity_ids ON potential_duplicates (entity_id_a, entity_id_b);
