CREATE TABLE IF NOT EXISTS "territories" (
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
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "territories_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "territories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_territories_org" ON "territories" USING btree ("clerk_org_id");
CREATE INDEX IF NOT EXISTS "idx_territories_assigned_user" ON "territories" USING btree ("assigned_user_id");
CREATE INDEX IF NOT EXISTS "idx_territories_org_active" ON "territories" USING btree ("clerk_org_id", "is_active");
