-- Enrichment Refactor: Add V2 pipeline columns for SerpAPI + browser-use
-- Existing PDL/Crustdata columns are kept for data retention during transition.

-- Contacts: employment history from browser-use LinkedIn scraping
ALTER TABLE "contacts" ADD COLUMN "enrichment_experiences" jsonb;

-- Contacts: which enrichment providers contributed to this record
ALTER TABLE "contacts" ADD COLUMN "enrichment_providers_used" json;

-- Contacts: single raw data column for V2 pipeline results
ALTER TABLE "contacts" ADD COLUMN "enrichment_raw_data" jsonb;

-- Organizations: single raw data column for V2 pipeline results
ALTER TABLE "organizations" ADD COLUMN "enrichment_raw_data" jsonb;
