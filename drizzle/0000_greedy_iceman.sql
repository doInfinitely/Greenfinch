CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"action" text NOT NULL,
	"target_table" text,
	"query_text" text,
	"rows_affected" integer,
	"environment" text DEFAULT 'development' NOT NULL,
	"success" boolean DEFAULT true,
	"error_message" text,
	"metadata" json,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cad_account_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_code" text NOT NULL,
	"account_num" text NOT NULL,
	"appraisal_year" integer NOT NULL,
	"gis_parcel_id" text,
	"division_cd" text,
	"biz_name" text,
	"owner_name1" text,
	"owner_name2" text,
	"owner_address_line1" text,
	"owner_city" text,
	"owner_state" text,
	"owner_zipcode" text,
	"phone_num" text,
	"deed_txfr_date" text,
	"legal_1" text,
	"legal_2" text,
	"legal_3" text,
	"legal_4" text,
	"property_address" text,
	"property_city" text,
	"property_zipcode" text,
	"download_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cad_appraisal_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_code" text NOT NULL,
	"account_num" text NOT NULL,
	"appraisal_year" integer NOT NULL,
	"sptd_code" text,
	"ptad_code" text,
	"improv_val" real,
	"land_val" real,
	"total_val" real,
	"city_juris_desc" text,
	"isd_juris_desc" text,
	"download_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cad_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_code" text NOT NULL,
	"account_num" text NOT NULL,
	"tax_obj_id" text,
	"appraisal_year" integer NOT NULL,
	"property_name" text,
	"bldg_class_desc" text,
	"bldg_class_cd" text,
	"year_built" integer,
	"remodel_year" integer,
	"gross_bldg_area" real,
	"num_stories" real,
	"num_units" integer,
	"net_lease_area" real,
	"construction_type" text,
	"foundation_type" text,
	"heating_type" text,
	"ac_type" text,
	"quality_grade" text,
	"condition_grade" text,
	"download_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cad_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_code" text NOT NULL,
	"appraisal_year" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rows_imported" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cad_land" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_code" text NOT NULL,
	"account_num" text NOT NULL,
	"appraisal_year" integer NOT NULL,
	"land_type_cd" text,
	"zoning_desc" text,
	"front_dim" real,
	"depth_dim" real,
	"land_area" real,
	"land_area_uom" text,
	"cost_per_uom" real,
	"download_id" uuid
);
--> statement-breakpoint
CREATE TABLE "classification_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_hash" text NOT NULL,
	"usecodes" json,
	"usedescs" json,
	"zoning" text,
	"zoning_description" text,
	"category" text,
	"subcategory" text,
	"confidence" real,
	"is_commercial_multifamily" boolean DEFAULT false,
	"raw_response" json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "classification_cache_field_hash_unique" UNIQUE("field_hash")
);
--> statement-breakpoint
CREATE TABLE "contact_linkedin_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"original_linkedin_url" text,
	"selected_alternative_index" integer,
	"selected_linkedin_url" text,
	"status" text DEFAULT 'pending',
	"flagged_by_user_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"org_id" uuid,
	"title" text,
	"is_current" boolean DEFAULT true,
	"started_at" timestamp,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "contact_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"snapshot_data" json NOT NULL,
	"changes" json,
	"change_type" text DEFAULT 'research' NOT NULL,
	"triggered_by" text,
	"is_canonical" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text,
	"normalized_name" text,
	"name_confidence" real,
	"contact_type" text,
	"email" text,
	"normalized_email" text,
	"email_confidence" real,
	"email_status" text,
	"email_validated_at" timestamp,
	"email_source" text,
	"email_validation_status" text DEFAULT 'pending',
	"email_validation_details" json,
	"phone" text,
	"normalized_phone" text,
	"phone_confidence" real,
	"phone_label" text,
	"phone_source" text,
	"ai_phone" text,
	"ai_phone_label" text,
	"ai_phone_confidence" real,
	"phone_extension" text,
	"enrichment_phone_work" text,
	"enrichment_phone_personal" text,
	"title" text,
	"title_confidence" real,
	"company_domain" text,
	"employer_name" text,
	"linkedin_url" text,
	"linkedin_confidence" real,
	"linkedin_status" text,
	"photo_url" text,
	"location" text,
	"linkedin_search_results" json,
	"linkedin_flagged" boolean DEFAULT false,
	"source" text DEFAULT 'ai',
	"contact_rationale" text,
	"needs_review" boolean DEFAULT false,
	"review_reason" text,
	"pdl_enriched" boolean DEFAULT false,
	"pdl_enriched_at" timestamp,
	"pdl_employer_mismatch" boolean DEFAULT false,
	"pdl_employer_name" text,
	"pdl_employer_domain" text,
	"provider_id" text,
	"enrichment_source" text,
	"enriched_at" timestamp,
	"raw_enrichment_json" json,
	"pdl_raw_response" json,
	"crustdata_raw_response" json,
	"confidence_flag" text,
	"pdl_full_name" text,
	"pdl_work_email" text,
	"pdl_emails_json" json,
	"pdl_personal_emails" json,
	"pdl_phones_json" json,
	"pdl_mobile_phone" text,
	"pdl_linkedin_url" text,
	"pdl_title" text,
	"pdl_company" text,
	"pdl_company_domain" text,
	"pdl_title_role" text,
	"pdl_title_levels" json,
	"pdl_title_class" text,
	"pdl_title_sub_role" text,
	"pdl_location" text,
	"pdl_city" text,
	"pdl_state" text,
	"pdl_addresses_json" json,
	"pdl_industry" text,
	"pdl_gender" text,
	"pdl_dataset_version" text,
	"crustdata_title" text,
	"crustdata_company" text,
	"crustdata_company_domain" text,
	"crustdata_work_email" text,
	"crustdata_linkedin_url" text,
	"crustdata_location" text,
	"crustdata_person_id" integer,
	"crustdata_enriched" boolean DEFAULT false,
	"crustdata_enriched_at" timestamp,
	"findymail_verified" boolean,
	"findymail_verify_status" text,
	"linkedin_rejected_url" text,
	"linkedin_rejected_source" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"entity_type" text NOT NULL,
	"contact_id" uuid,
	"property_id" uuid,
	"issue_description" text NOT NULL,
	"status" text DEFAULT 'open',
	"resolution_note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enrichment_cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"credits_used" real DEFAULT 1,
	"estimated_cost_usd" real,
	"input_tokens" integer,
	"output_tokens" integer,
	"thinking_tokens" integer,
	"entity_type" text,
	"entity_id" text,
	"triggered_by" text,
	"clerk_org_id" text,
	"status_code" integer,
	"success" boolean DEFAULT true,
	"error_message" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" json NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now(),
	"updated_by_user_id" uuid,
	CONSTRAINT "ingestion_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid,
	"item_id" uuid,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "loss_reason_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"eligible_from_stages" json NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_system_default" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"type" text NOT NULL,
	"property_id" uuid,
	"note_id" uuid,
	"action_id" uuid,
	"title" text NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"legal_name" text,
	"domain" text,
	"domain_aliases" json,
	"org_type" text,
	"description" text,
	"founded_year" integer,
	"sector" text,
	"industry_group" text,
	"industry" text,
	"sub_industry" text,
	"gics_code" text,
	"sic_code" text,
	"naics_code" text,
	"tags" json,
	"employees" integer,
	"employees_range" text,
	"estimated_annual_revenue" text,
	"location" text,
	"street_address" text,
	"city" text,
	"state" text,
	"state_code" text,
	"postal_code" text,
	"country" text,
	"country_code" text,
	"lat" real,
	"lng" real,
	"linkedin_handle" text,
	"twitter_handle" text,
	"facebook_handle" text,
	"crunchbase_handle" text,
	"logo_url" text,
	"parent_domain" text,
	"parent_org_id" uuid,
	"ultimate_parent_domain" text,
	"ultimate_parent_org_id" uuid,
	"tech" json,
	"tech_categories" json,
	"phone_numbers" json,
	"email_addresses" json,
	"pdl_company_id" text,
	"affiliated_pdl_ids" json,
	"provider_id" text,
	"enrichment_source" text,
	"enrichment_status" text DEFAULT 'pending',
	"last_enriched_at" timestamp,
	"raw_enrichment_json" json,
	"pdl_enriched" boolean DEFAULT false,
	"pdl_enriched_at" timestamp,
	"pdl_data_version" text,
	"pdl_raw_response" json,
	"crustdata_raw_response" json,
	"crustdata_enriched" boolean DEFAULT false,
	"crustdata_enriched_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "parcel_to_property" (
	"ll_uuid" text PRIMARY KEY NOT NULL,
	"property_key" text NOT NULL,
	"ll_stack_uuid" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parcelnumb_mapping" (
	"account_num" text PRIMARY KEY NOT NULL,
	"gis_parcel_id" text NOT NULL,
	"parent_property_key" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"outreach_methods" json,
	"successful_method" text,
	"loss_reason_code_id" uuid,
	"transitioned_at" timestamp DEFAULT now() NOT NULL,
	"duration_in_stage_ms" integer
);
--> statement-breakpoint
CREATE TABLE "potential_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id_a" uuid NOT NULL,
	"contact_id_b" uuid NOT NULL,
	"match_type" text NOT NULL,
	"match_key" text NOT NULL,
	"confidence" real DEFAULT 0.5,
	"status" text DEFAULT 'pending',
	"resolved_by_user_id" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_key" text NOT NULL,
	"source_ll_uuid" text,
	"ll_stack_uuid" text,
	"regrid_address" text,
	"validated_address" text,
	"validated_address_confidence" real,
	"city" text,
	"state" text,
	"zip" text,
	"county" text,
	"lat" real,
	"lon" real,
	"geocode_confidence" real,
	"geocoded_lat" real,
	"geocoded_lon" real,
	"streetview_pano_id" text,
	"lot_sqft" integer,
	"lot_sqft_confidence" real,
	"lot_sqft_source" text,
	"building_sqft" integer,
	"building_sqft_confidence" real,
	"building_sqft_source" text,
	"year_built" integer,
	"num_floors" integer,
	"ai_lot_acres" real,
	"ai_lot_acres_confidence" real,
	"ai_lot_acres_rationale" text,
	"ai_net_sqft" integer,
	"ai_net_sqft_confidence" real,
	"ai_net_sqft_rationale" text,
	"asset_category" text,
	"asset_subcategory" text,
	"category_confidence" real,
	"category_rationale" text,
	"property_class" text,
	"property_class_confidence" real,
	"property_class_rationale" text,
	"common_name" text,
	"common_name_confidence" real,
	"containing_place" text,
	"containing_place_type" text,
	"regrid_owner" text,
	"regrid_owner2" text,
	"beneficial_owner" text,
	"beneficial_owner_confidence" real,
	"beneficial_owner_type" text,
	"beneficial_owner_domain" text,
	"management_type" text,
	"management_company" text,
	"management_company_domain" text,
	"management_confidence" real,
	"dcad_account_num" text,
	"dcad_gis_parcel_id" text,
	"dcad_sptd_code" text,
	"dcad_division_cd" text,
	"dcad_improv_val" integer,
	"dcad_land_val" integer,
	"dcad_total_val" integer,
	"dcad_city_juris" text,
	"dcad_isd_juris" text,
	"dcad_biz_name" text,
	"dcad_owner_name1" text,
	"dcad_owner_name2" text,
	"dcad_owner_address" text,
	"dcad_owner_city" text,
	"dcad_owner_state" text,
	"dcad_owner_zip" text,
	"dcad_owner_phone" text,
	"dcad_deed_transfer_date" text,
	"dcad_zoning" text,
	"dcad_land_front_dim" integer,
	"dcad_land_depth_dim" integer,
	"dcad_land_area" real,
	"dcad_land_area_uom" text,
	"dcad_building_count" integer,
	"dcad_oldest_year_built" integer,
	"dcad_newest_year_built" integer,
	"dcad_total_gross_bldg_area" integer,
	"dcad_total_units" integer,
	"dcad_rentable_area" integer,
	"dcad_parking_sqft" integer,
	"dcad_primary_ac_type" text,
	"dcad_primary_heating_type" text,
	"dcad_quality_grade" text,
	"dcad_condition_grade" text,
	"calculated_building_class" text,
	"building_class_rationale" text,
	"dcad_buildings" json,
	"raw_parcels_json" json,
	"enrichment_json" json,
	"mapbox_poi_json" json,
	"operational_status" text,
	"property_website" text,
	"property_phone" text,
	"property_manager_website" text,
	"ai_rationale" text,
	"enrichment_sources" json,
	"is_parent_property" boolean DEFAULT false,
	"parent_property_key" text,
	"constituent_account_nums" json,
	"constituent_count" integer DEFAULT 0,
	"last_regrid_update" timestamp,
	"last_enriched_at" timestamp,
	"enrichment_status" text DEFAULT 'pending',
	"is_current_customer" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true,
	CONSTRAINT "properties_property_key_unique" UNIQUE("property_key")
);
--> statement-breakpoint
CREATE TABLE "property_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"assigned_to_user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"description" text,
	"due_at" timestamp NOT NULL,
	"original_due_at" timestamp,
	"status" text DEFAULT 'pending',
	"completion_status" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"contact_id" uuid,
	"role" text,
	"confidence_score" real,
	"relationship_confidence" text DEFAULT 'high',
	"relationship_note" text,
	"relationship_status" text DEFAULT 'active',
	"relationship_status_reason" text,
	"relationship_verified_at" timestamp,
	"discovered_at" timestamp DEFAULT now(),
	"ai_grounding" jsonb
);
--> statement-breakpoint
CREATE TABLE "property_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"flag_type" text NOT NULL,
	"suggested_organization_id" uuid,
	"suggested_organization_name" text,
	"reason" text,
	"comments" text,
	"status" text DEFAULT 'pending',
	"flagged_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"org_id" uuid,
	"role" text,
	"ai_grounding" jsonb,
	CONSTRAINT "uq_property_org_role" UNIQUE("property_id","org_id","role")
);
--> statement-breakpoint
CREATE TABLE "property_pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"owner_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"deal_value" integer,
	"is_current_customer" boolean DEFAULT false,
	"status_changed_at" timestamp DEFAULT now(),
	"status_changed_by_user_id" uuid,
	"lost_reason" text,
	"lost_notes" text,
	"disqualified_reason" text,
	"disqualified_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"service_provider_id" uuid,
	"service_category" text NOT NULL,
	"status" text DEFAULT 'suggested',
	"confidence" real,
	"suggested_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"clerk_org_id" text NOT NULL,
	"last_viewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"services_offered" json,
	"linkedin_url" text,
	"website" text,
	"phone" text,
	"city" text,
	"state" text,
	"enrichment_status" text DEFAULT 'pending',
	"enrichment_json" json,
	"last_enriched_at" timestamp,
	"is_user_company" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "service_providers_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_contact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"viewing_version" integer NOT NULL,
	"has_unseen_update" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"list_name" text,
	"list_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replit_id" text,
	"clerk_id" text,
	"email" text,
	"first_name" text,
	"last_name" text,
	"profile_image_url" text,
	"role" text DEFAULT 'standard_user',
	"account_id" uuid,
	"is_active" boolean DEFAULT true,
	"company_name" text,
	"company_domain" text,
	"service_provider_id" uuid,
	"selected_services" json,
	"settings_completed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_replit_id_unique" UNIQUE("replit_id"),
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"company" text,
	"role" text,
	"industry" text,
	"phone" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_linkedin_flags" ADD CONSTRAINT "contact_linkedin_flags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_linkedin_flags" ADD CONSTRAINT "contact_linkedin_flags_flagged_by_user_id_users_id_fk" FOREIGN KEY ("flagged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_organizations" ADD CONSTRAINT "contact_organizations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_organizations" ADD CONSTRAINT "contact_organizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_settings" ADD CONSTRAINT "ingestion_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_user_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."user_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_note_id_property_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."property_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_pipeline_id_property_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."property_pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "potential_duplicates" ADD CONSTRAINT "potential_duplicates_contact_id_a_contacts_id_fk" FOREIGN KEY ("contact_id_a") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "potential_duplicates" ADD CONSTRAINT "potential_duplicates_contact_id_b_contacts_id_fk" FOREIGN KEY ("contact_id_b") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_actions" ADD CONSTRAINT "property_actions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_actions" ADD CONSTRAINT "property_actions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_actions" ADD CONSTRAINT "property_actions_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_activity" ADD CONSTRAINT "property_activity_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_activity" ADD CONSTRAINT "property_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_flags" ADD CONSTRAINT "property_flags_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_flags" ADD CONSTRAINT "property_flags_suggested_organization_id_organizations_id_fk" FOREIGN KEY ("suggested_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_flags" ADD CONSTRAINT "property_flags_flagged_by_user_id_users_id_fk" FOREIGN KEY ("flagged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_flags" ADD CONSTRAINT "property_flags_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_notes" ADD CONSTRAINT "property_notes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_notes" ADD CONSTRAINT "property_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_organizations" ADD CONSTRAINT "property_organizations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_organizations" ADD CONSTRAINT "property_organizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_pipeline" ADD CONSTRAINT "property_pipeline_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_pipeline" ADD CONSTRAINT "property_pipeline_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_pipeline" ADD CONSTRAINT "property_pipeline_status_changed_by_user_id_users_id_fk" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_providers" ADD CONSTRAINT "property_service_providers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_providers" ADD CONSTRAINT "property_service_providers_service_provider_id_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."service_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_providers" ADD CONSTRAINT "property_service_providers_suggested_by_user_id_users_id_fk" FOREIGN KEY ("suggested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_providers" ADD CONSTRAINT "property_service_providers_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_views" ADD CONSTRAINT "property_views_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_views" ADD CONSTRAINT "property_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lists" ADD CONSTRAINT "user_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_user_id_idx" ON "admin_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_action_idx" ON "admin_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cad_account_info_uniq" ON "cad_account_info" USING btree ("county_code","account_num","appraisal_year");--> statement-breakpoint
CREATE INDEX "cad_account_info_zip_idx" ON "cad_account_info" USING btree ("property_zipcode");--> statement-breakpoint
CREATE INDEX "cad_account_info_gis_parcel_idx" ON "cad_account_info" USING btree ("gis_parcel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cad_appraisal_values_uniq" ON "cad_appraisal_values" USING btree ("county_code","account_num","appraisal_year");--> statement-breakpoint
CREATE INDEX "cad_appraisal_values_ptad_idx" ON "cad_appraisal_values" USING btree ("ptad_code");--> statement-breakpoint
CREATE INDEX "cad_buildings_account_idx" ON "cad_buildings" USING btree ("county_code","account_num");--> statement-breakpoint
CREATE INDEX "cad_downloads_county_year_idx" ON "cad_downloads" USING btree ("county_code","appraisal_year");--> statement-breakpoint
CREATE INDEX "cad_land_account_idx" ON "cad_land" USING btree ("county_code","account_num","appraisal_year");--> statement-breakpoint
CREATE INDEX "idx_classification_field_hash" ON "classification_cache" USING btree ("field_hash");--> statement-breakpoint
CREATE INDEX "idx_contact_linkedin_flags" ON "contact_linkedin_flags" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_contact_organizations" ON "contact_organizations" USING btree ("contact_id","org_id");--> statement-breakpoint
CREATE INDEX "idx_contact_organizations_org" ON "contact_organizations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_contact_snapshots_contact" ON "contact_snapshots" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contact_snapshots_contact_version" ON "contact_snapshots" USING btree ("contact_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contacts_email" ON "contacts" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "idx_contacts_name_domain" ON "contacts" USING btree ("normalized_name","company_domain");--> statement-breakpoint
CREATE INDEX "idx_contacts_full_name" ON "contacts" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "idx_contacts_employer_name" ON "contacts" USING btree ("employer_name");--> statement-breakpoint
CREATE INDEX "idx_contacts_linkedin_url" ON "contacts" USING btree ("linkedin_url");--> statement-breakpoint
CREATE INDEX "idx_contacts_email_status" ON "contacts" USING btree ("email_status");--> statement-breakpoint
CREATE INDEX "idx_contacts_created_at" ON "contacts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_enrichment_cost_provider" ON "enrichment_cost_events" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_enrichment_cost_created_at" ON "enrichment_cost_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_enrichment_cost_entity" ON "enrichment_cost_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_enrichment_cost_triggered_by" ON "enrichment_cost_events" USING btree ("triggered_by");--> statement-breakpoint
CREATE INDEX "idx_loss_reason_codes_org" ON "loss_reason_codes" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_loss_reason_codes_active" ON "loss_reason_codes" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_notifications_recipient" ON "notifications" USING btree ("recipient_user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_notifications_org" ON "notifications" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_created" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_organizations_parent" ON "organizations" USING btree ("parent_org_id");--> statement-breakpoint
CREATE INDEX "idx_organizations_ultimate_parent" ON "organizations" USING btree ("ultimate_parent_org_id");--> statement-breakpoint
CREATE INDEX "idx_organizations_pdl_company_id" ON "organizations" USING btree ("pdl_company_id");--> statement-breakpoint
CREATE INDEX "idx_organizations_enrichment_status" ON "organizations" USING btree ("enrichment_status");--> statement-breakpoint
CREATE INDEX "idx_organizations_created_at" ON "organizations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_parcel_property_key" ON "parcel_to_property" USING btree ("property_key");--> statement-breakpoint
CREATE INDEX "idx_parcelnumb_gis_parcel" ON "parcelnumb_mapping" USING btree ("gis_parcel_id");--> statement-breakpoint
CREATE INDEX "idx_parcelnumb_parent_prop" ON "parcelnumb_mapping" USING btree ("parent_property_key");--> statement-breakpoint
CREATE INDEX "idx_stage_history_pipeline" ON "pipeline_stage_history" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "idx_stage_history_property" ON "pipeline_stage_history" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_stage_history_org" ON "pipeline_stage_history" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_stage_history_to_stage" ON "pipeline_stage_history" USING btree ("to_stage");--> statement-breakpoint
CREATE INDEX "idx_stage_history_transitioned_at" ON "pipeline_stage_history" USING btree ("transitioned_at");--> statement-breakpoint
CREATE INDEX "idx_potential_duplicates_status" ON "potential_duplicates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_potential_duplicates_contact_a" ON "potential_duplicates" USING btree ("contact_id_a");--> statement-breakpoint
CREATE INDEX "idx_potential_duplicates_contact_b" ON "potential_duplicates" USING btree ("contact_id_b");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_properties_property_key" ON "properties" USING btree ("property_key");--> statement-breakpoint
CREATE INDEX "idx_properties_city_state" ON "properties" USING btree ("city","state");--> statement-breakpoint
CREATE INDEX "idx_properties_asset_category" ON "properties" USING btree ("asset_category");--> statement-breakpoint
CREATE INDEX "idx_properties_zip" ON "properties" USING btree ("zip");--> statement-breakpoint
CREATE INDEX "idx_properties_asset_subcategory" ON "properties" USING btree ("asset_subcategory");--> statement-breakpoint
CREATE INDEX "idx_properties_enrichment_status" ON "properties" USING btree ("enrichment_status");--> statement-breakpoint
CREATE INDEX "idx_properties_is_active" ON "properties" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_properties_created_at" ON "properties" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_properties_regrid_owner" ON "properties" USING btree ("regrid_owner");--> statement-breakpoint
CREATE INDEX "idx_property_actions_property" ON "property_actions" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_property_actions_assigned" ON "property_actions" USING btree ("assigned_to_user_id","status");--> statement-breakpoint
CREATE INDEX "idx_property_actions_due" ON "property_actions" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "idx_property_actions_org" ON "property_actions" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_property_activity_org_property" ON "property_activity" USING btree ("clerk_org_id","property_id");--> statement-breakpoint
CREATE INDEX "idx_property_activity_user" ON "property_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_property_activity_created" ON "property_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_property_contacts" ON "property_contacts" USING btree ("property_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_contacts_property_id_contact_id_unique" ON "property_contacts" USING btree ("property_id","contact_id");--> statement-breakpoint
CREATE INDEX "idx_property_flags_property" ON "property_flags" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_property_flags_status" ON "property_flags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_property_notes_org_property" ON "property_notes" USING btree ("clerk_org_id","property_id");--> statement-breakpoint
CREATE INDEX "idx_property_notes_user" ON "property_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_property_organizations" ON "property_organizations" USING btree ("property_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_property_pipeline_org_property" ON "property_pipeline" USING btree ("clerk_org_id","property_id");--> statement-breakpoint
CREATE INDEX "idx_property_pipeline_status" ON "property_pipeline" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_property_pipeline_org" ON "property_pipeline" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_property_pipeline_owner" ON "property_pipeline" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_property_service_providers" ON "property_service_providers" USING btree ("property_id","service_category");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_property_views_user_property" ON "property_views" USING btree ("user_id","property_id","clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_property_views_property" ON "property_views" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_property_views_user" ON "property_views" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_service_providers_domain" ON "service_providers" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_service_providers_name" ON "service_providers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_contact_versions_user_contact" ON "user_contact_versions" USING btree ("user_id","contact_id");--> statement-breakpoint
CREATE INDEX "idx_user_contact_versions_contact" ON "user_contact_versions" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_waitlist_email" ON "waitlist_signups" USING btree ("email");