ALTER TABLE "users" ADD COLUMN "onboarding_progress" jsonb DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN "territory_zip_codes" json;
