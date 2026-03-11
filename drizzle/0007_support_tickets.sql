CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_org_id" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "subject" text NOT NULL,
  "transcript" json NOT NULL,
  "user_summary" text,
  "ai_summary" text,
  "status" text DEFAULT 'open' NOT NULL,
  "priority" text DEFAULT 'medium',
  "assigned_to" uuid REFERENCES "users"("id"),
  "resolution" text,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_org" ON "support_tickets" USING btree ("clerk_org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_status" ON "support_tickets" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_user" ON "support_tickets" USING btree ("user_id");
