-- Revenue estimation columns
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "revenue_estimates" jsonb;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "revenue_estimate_total" integer;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "revenue_estimate_rationale" json;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "revenue_estimates_updated_at" timestamp;

-- Index on total for sorting
CREATE INDEX IF NOT EXISTS "idx_properties_revenue_estimate_total" ON "properties" ("revenue_estimate_total");

-- GIN index on JSONB for querying individual service estimates
CREATE INDEX IF NOT EXISTS "idx_properties_revenue_estimates_gin" ON "properties" USING GIN ("revenue_estimates");
