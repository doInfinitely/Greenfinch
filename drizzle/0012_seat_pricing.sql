ALTER TABLE "credit_tiers" ADD COLUMN "per_seat_price_usd" integer DEFAULT 0 NOT NULL;
ALTER TABLE "credit_tiers" ADD COLUMN "max_seats" integer;
