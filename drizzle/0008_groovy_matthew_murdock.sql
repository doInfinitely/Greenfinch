CREATE TABLE "credit_action_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"display_name" text NOT NULL,
	"credit_cost" integer NOT NULL,
	"category" text DEFAULT 'enrichment' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "credit_action_costs_action_unique" UNIQUE("action")
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"current_balance" integer DEFAULT 0 NOT NULL,
	"rollover_balance" integer DEFAULT 0 NOT NULL,
	"purchased_balance" integer DEFAULT 0 NOT NULL,
	"rollover_cap" integer DEFAULT 0 NOT NULL,
	"last_allocation_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "credit_balances_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "credit_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"credits" integer NOT NULL,
	"price_usd" integer NOT NULL,
	"stripe_price_id" text,
	"stripe_product_id" text,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"monthly_credits" integer NOT NULL,
	"rollover_cap" integer NOT NULL,
	"monthly_price_usd" integer NOT NULL,
	"stripe_price_id" text,
	"stripe_product_id" text,
	"features" json,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "credit_tiers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"type" text NOT NULL,
	"action" text,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"pool" text,
	"entity_type" text,
	"entity_id" text,
	"user_id" text,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customer_status_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"flag_type" text NOT NULL,
	"competitor_name" text,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"tier_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "org_subscriptions_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"transcript" json NOT NULL,
	"user_summary" text,
	"ai_summary" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium',
	"assigned_to" uuid,
	"resolution" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "potential_duplicates" ALTER COLUMN "contact_id_a" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "potential_duplicates" ALTER COLUMN "contact_id_b" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "potential_duplicates" ADD COLUMN "entity_type" text DEFAULT 'contact' NOT NULL;--> statement-breakpoint
ALTER TABLE "potential_duplicates" ADD COLUMN "entity_id_a" uuid;--> statement-breakpoint
ALTER TABLE "potential_duplicates" ADD COLUMN "entity_id_b" uuid;--> statement-breakpoint
ALTER TABLE "customer_status_flags" ADD CONSTRAINT "customer_status_flags_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_status_flags" ADD CONSTRAINT "customer_status_flags_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_tier_id_credit_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."credit_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_org" ON "credit_transactions" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_created_at" ON "credit_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_action" ON "credit_transactions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_org_created" ON "credit_transactions" USING btree ("clerk_org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csf_org_property_flag" ON "customer_status_flags" USING btree ("clerk_org_id","property_id","flag_type");--> statement-breakpoint
CREATE INDEX "idx_csf_org_property" ON "customer_status_flags" USING btree ("clerk_org_id","property_id");--> statement-breakpoint
CREATE INDEX "idx_csf_flag_type" ON "customer_status_flags" USING btree ("flag_type");--> statement-breakpoint
CREATE INDEX "idx_org_subscriptions_stripe_customer" ON "org_subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_org" ON "support_tickets" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_status" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_user" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_potential_duplicates_entity_type" ON "potential_duplicates" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "idx_potential_duplicates_entity_ids" ON "potential_duplicates" USING btree ("entity_id_a","entity_id_b");