import { pgTable, uuid, text, timestamp, boolean, integer, real, json, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table for authentication (Clerk)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  replitId: text('replit_id').unique(),
  clerkId: text('clerk_id').unique(),
  email: text('email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  profileImageUrl: text('profile_image_url'),
  role: text('role').default('standard_user'),
  accountId: uuid('account_id'),
  isActive: boolean('is_active').default(true),
  
  // Company info for service provider linking
  companyName: text('company_name'),
  companyDomain: text('company_domain'),
  
  // Auto-linked service provider (matched by email domain)
  serviceProviderId: uuid('service_provider_id'),
  
  // Selected services the user's company provides (array of service category keys)
  selectedServices: json('selected_services'),
  
  // Settings completed flag
  settingsCompleted: boolean('settings_completed').default(false),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Sessions table for auth
export const sessions = pgTable('sessions', {
  sid: text('sid').primaryKey(),
  sess: json('sess').notNull(),
  expire: timestamp('expire').notNull(),
}, (table) => ({
  expireIdx: index('IDX_session_expire').on(table.expire),
}));

// Properties table - one record per physical property
export const properties = pgTable('properties', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyKey: text('property_key').unique().notNull(),
  sourceLlUuid: text('source_ll_uuid'),
  llStackUuid: text('ll_stack_uuid'),
  
  // Address fields
  regridAddress: text('regrid_address'),
  validatedAddress: text('validated_address'),
  validatedAddressConfidence: real('validated_address_confidence'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  county: text('county'),
  
  // Location
  lat: real('lat'),
  lon: real('lon'),
  geocodeConfidence: real('geocode_confidence'),
  
  // Physical characteristics
  lotSqft: integer('lot_sqft'),
  lotSqftConfidence: real('lot_sqft_confidence'),
  lotSqftSource: text('lot_sqft_source'),
  buildingSqft: integer('building_sqft'),
  buildingSqftConfidence: real('building_sqft_confidence'),
  buildingSqftSource: text('building_sqft_source'),
  yearBuilt: integer('year_built'),
  numFloors: integer('num_floors'),
  
  // AI-enriched physical characteristics (overrides when high confidence)
  aiLotAcres: real('ai_lot_acres'),
  aiLotAcresConfidence: real('ai_lot_acres_confidence'),
  aiLotAcresRationale: text('ai_lot_acres_rationale'),
  aiNetSqft: integer('ai_net_sqft'),
  aiNetSqftConfidence: real('ai_net_sqft_confidence'),
  aiNetSqftRationale: text('ai_net_sqft_rationale'),
  
  // Classification
  assetCategory: text('asset_category'),
  assetSubcategory: text('asset_subcategory'),
  categoryConfidence: real('category_confidence'),
  categoryRationale: text('category_rationale'),
  propertyClass: text('property_class'),
  propertyClassRationale: text('property_class_rationale'),
  
  // Names
  commonName: text('common_name'),
  commonNameConfidence: real('common_name_confidence'),
  containingPlace: text('containing_place'),
  containingPlaceType: text('containing_place_type'),
  
  // Ownership
  regridOwner: text('regrid_owner'),
  regridOwner2: text('regrid_owner2'),
  beneficialOwner: text('beneficial_owner'),
  beneficialOwnerConfidence: real('beneficial_owner_confidence'),
  beneficialOwnerType: text('beneficial_owner_type'),
  
  // Management
  managementType: text('management_type'),
  managementCompany: text('management_company'),
  managementCompanyDomain: text('management_company_domain'),
  managementConfidence: real('management_confidence'),
  
  // DCAD Appraisal Data
  dcadAccountNum: text('dcad_account_num'),
  dcadGisParcelId: text('dcad_gis_parcel_id'),
  dcadSptdCode: text('dcad_sptd_code'),
  dcadDivisionCd: text('dcad_division_cd'), // COM, RES
  dcadImprovVal: integer('dcad_improv_val'),
  dcadLandVal: integer('dcad_land_val'),
  dcadTotalVal: integer('dcad_total_val'),
  dcadCityJuris: text('dcad_city_juris'),
  dcadIsdJuris: text('dcad_isd_juris'),
  
  // DCAD Owner Info
  dcadBizName: text('dcad_biz_name'),
  dcadOwnerName1: text('dcad_owner_name1'),
  dcadOwnerName2: text('dcad_owner_name2'),
  dcadOwnerAddress: text('dcad_owner_address'),
  dcadOwnerCity: text('dcad_owner_city'),
  dcadOwnerState: text('dcad_owner_state'),
  dcadOwnerZip: text('dcad_owner_zip'),
  dcadOwnerPhone: text('dcad_owner_phone'),
  dcadDeedTransferDate: text('dcad_deed_transfer_date'),
  
  // DCAD Land Details
  dcadZoning: text('dcad_zoning'),
  dcadLandFrontDim: integer('dcad_land_front_dim'),
  dcadLandDepthDim: integer('dcad_land_depth_dim'),
  dcadLandArea: real('dcad_land_area'),
  dcadLandAreaUom: text('dcad_land_area_uom'),
  
  // DCAD Building Summary (aggregated from all buildings on parcel)
  dcadBuildingCount: integer('dcad_building_count'),
  dcadOldestYearBuilt: integer('dcad_oldest_year_built'),
  dcadNewestYearBuilt: integer('dcad_newest_year_built'),
  dcadTotalGrossBldgArea: integer('dcad_total_gross_bldg_area'),
  dcadTotalUnits: integer('dcad_total_units'),
  dcadRentableArea: integer('dcad_rentable_area'),
  dcadParkingSqft: integer('dcad_parking_sqft'),
  
  // Aggregated HVAC from buildings (most common types for filtering)
  dcadPrimaryAcType: text('dcad_primary_ac_type'),
  dcadPrimaryHeatingType: text('dcad_primary_heating_type'),
  
  // Building quality fields for class calculation
  dcadQualityGrade: text('dcad_quality_grade'),
  dcadConditionGrade: text('dcad_condition_grade'),
  
  // Calculated building class (A+/A/B/C/D) based on quality, condition, age, value
  calculatedBuildingClass: text('calculated_building_class'),
  buildingClassRationale: text('building_class_rationale'),
  
  // DCAD Buildings Array (all buildings on this parcel as JSONB)
  dcadBuildings: json('dcad_buildings'),
  
  // Raw data
  rawParcelsJson: json('raw_parcels_json'),
  enrichmentJson: json('enrichment_json'),
  mapboxPoiJson: json('mapbox_poi_json'),
  
  // Operational status from Mapbox POI
  operationalStatus: text('operational_status'),
  
  // Enrichment metadata
  propertyWebsite: text('property_website'),
  propertyPhone: text('property_phone'),
  propertyManagerWebsite: text('property_manager_website'),
  aiRationale: text('ai_rationale'),
  enrichmentSources: json('enrichment_sources'),
  
  // Parcel-level relationships (for complex properties with multiple accounts)
  isParentProperty: boolean('is_parent_property').default(false),
  parentPropertyKey: text('parent_property_key'),
  constituentAccountNums: json('constituent_account_nums'),
  constituentCount: integer('constituent_count').default(0),
  
  // Timestamps
  lastRegridUpdate: timestamp('last_regrid_update'),
  lastEnrichedAt: timestamp('last_enriched_at'),
  enrichmentStatus: text('enrichment_status').default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  isActive: boolean('is_active').default(true),
}, (table) => ({
  propertyKeyIdx: uniqueIndex('idx_properties_property_key').on(table.propertyKey),
  cityStateIdx: index('idx_properties_city_state').on(table.city, table.state),
  assetCategoryIdx: index('idx_properties_asset_category').on(table.assetCategory),
}));

// Contacts table
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name'),
  normalizedName: text('normalized_name'),
  nameConfidence: real('name_confidence'),
  contactType: text('contact_type'), // 'individual' or 'general' (office lines, main numbers)
  
  email: text('email'),
  normalizedEmail: text('normalized_email'),
  emailConfidence: real('email_confidence'),
  emailStatus: text('email_status'),
  emailValidatedAt: timestamp('email_validated_at'),
  emailSource: text('email_source'),
  emailValidationStatus: text('email_validation_status').default('pending'),
  emailValidationDetails: json('email_validation_details'),
  
  phone: text('phone'),
  normalizedPhone: text('normalized_phone'),
  phoneConfidence: real('phone_confidence'),
  phoneLabel: text('phone_label'),
  phoneSource: text('phone_source'),
  
  aiPhone: text('ai_phone'),
  aiPhoneLabel: text('ai_phone_label'),
  aiPhoneConfidence: real('ai_phone_confidence'),
  
  enrichmentPhoneWork: text('enrichment_phone_work'),
  enrichmentPhonePersonal: text('enrichment_phone_personal'),
  
  title: text('title'),
  titleConfidence: real('title_confidence'),
  companyDomain: text('company_domain'),
  employerName: text('employer_name'),
  
  linkedinUrl: text('linkedin_url'),
  linkedinConfidence: real('linkedin_confidence'),
  linkedinStatus: text('linkedin_status'),
  
  photoUrl: text('photo_url'),
  
  location: text('location'),
  
  // Store top 4 LinkedIn search results for alternative selection
  linkedinSearchResults: json('linkedin_search_results').$type<{
    name: string;
    title: string;
    url: string;
    company?: string;
    location?: string;
    confidence: number;
  }[]>(),
  linkedinFlagged: boolean('linkedin_flagged').default(false),
  
  source: text('source').default('ai'),
  contactRationale: text('contact_rationale'),
  needsReview: boolean('needs_review').default(false),
  reviewReason: text('review_reason'),
  
  pdlEnriched: boolean('pdl_enriched').default(false),
  pdlEnrichedAt: timestamp('pdl_enriched_at'),
  pdlEmployerMismatch: boolean('pdl_employer_mismatch').default(false),
  pdlEmployerName: text('pdl_employer_name'),
  pdlEmployerDomain: text('pdl_employer_domain'),
  
  // Provider tracking for enrichment cascade (Apollo → EnrichLayer → PDL)
  providerId: text('provider_id'), // ID from the enrichment provider (e.g., Apollo person ID)
  enrichmentSource: text('enrichment_source'), // 'apollo', 'enrichlayer', 'pdl', 'ai'
  enrichedAt: timestamp('enriched_at'),
  rawEnrichmentJson: json('raw_enrichment_json'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('idx_contacts_email').on(table.normalizedEmail),
  nameDomainIdx: index('idx_contacts_name_domain').on(table.normalizedName, table.companyDomain),
}));

// Organizations table (Clearbit-compatible schema for provider flexibility)
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  legalName: text('legal_name'),
  domain: text('domain').unique(),
  domainAliases: json('domain_aliases').$type<string[]>(),
  orgType: text('org_type'),
  
  // Description and classification
  description: text('description'),
  foundedYear: integer('founded_year'),
  
  // Industry/category (Clearbit schema)
  sector: text('sector'),
  industryGroup: text('industry_group'),
  industry: text('industry'),
  subIndustry: text('sub_industry'),
  gicsCode: text('gics_code'),
  sicCode: text('sic_code'),
  naicsCode: text('naics_code'),
  tags: json('tags').$type<string[]>(),
  
  // Company size and metrics
  employees: integer('employees'),
  employeesRange: text('employees_range'),
  estimatedAnnualRevenue: text('estimated_annual_revenue'),
  
  // Location
  location: text('location'),
  streetAddress: text('street_address'),
  city: text('city'),
  state: text('state'),
  stateCode: text('state_code'),
  postalCode: text('postal_code'),
  country: text('country'),
  countryCode: text('country_code'),
  lat: real('lat'),
  lng: real('lng'),
  
  // Social profiles
  linkedinHandle: text('linkedin_handle'),
  twitterHandle: text('twitter_handle'),
  facebookHandle: text('facebook_handle'),
  crunchbaseHandle: text('crunchbase_handle'),
  
  // Logo
  logoUrl: text('logo_url'),
  
  // Parent company relationships
  parentDomain: text('parent_domain'),
  parentOrgId: uuid('parent_org_id'),
  ultimateParentDomain: text('ultimate_parent_domain'),
  ultimateParentOrgId: uuid('ultimate_parent_org_id'),
  
  // Technology stack
  tech: json('tech').$type<string[]>(),
  techCategories: json('tech_categories').$type<string[]>(),
  
  // Contact info
  phoneNumbers: json('phone_numbers').$type<string[]>(),
  emailAddresses: json('email_addresses').$type<string[]>(),
  
  // Enrichment metadata - provider tracking for cascade (Apollo → EnrichLayer → PDL)
  providerId: text('provider_id'), // ID from the enrichment provider (e.g., Apollo org ID)
  enrichmentSource: text('enrichment_source'), // 'apollo', 'enrichlayer', 'pdl'
  enrichmentStatus: text('enrichment_status').default('pending'),
  lastEnrichedAt: timestamp('last_enriched_at'),
  rawEnrichmentJson: json('raw_enrichment_json'),
  
  pdlEnriched: boolean('pdl_enriched').default(false),
  pdlEnrichedAt: timestamp('pdl_enriched_at'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  parentOrgIdx: index('idx_organizations_parent').on(table.parentOrgId),
  ultimateParentOrgIdx: index('idx_organizations_ultimate_parent').on(table.ultimateParentOrgId),
}));

// Junction: Property <-> Contact
export const propertyContacts = pgTable('property_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  role: text('role'),
  confidenceScore: real('confidence_score'),
  relationshipConfidence: text('relationship_confidence').default('high'),
  relationshipNote: text('relationship_note'),
  discoveredAt: timestamp('discovered_at').defaultNow(),
}, (table) => ({
  propertyContactIdx: index('idx_property_contacts').on(table.propertyId, table.contactId),
}));

// Junction: Property <-> Organization
export const propertyOrganizations = pgTable('property_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id),
  orgId: uuid('org_id').references(() => organizations.id),
  role: text('role'),
}, (table) => ({
  propertyOrgIdx: index('idx_property_organizations').on(table.propertyId, table.orgId),
}));

// Junction: Contact <-> Organization
export const contactOrganizations = pgTable('contact_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').references(() => contacts.id),
  orgId: uuid('org_id').references(() => organizations.id),
  title: text('title'),
  isCurrent: boolean('is_current').default(true),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
});

// Classification cache - stores AI classifications by unique field combinations
export const classificationCache = pgTable('classification_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  fieldHash: text('field_hash').unique().notNull(),
  usecodes: json('usecodes'),
  usedescs: json('usedescs'),
  zoning: text('zoning'),
  zoningDescription: text('zoning_description'),
  category: text('category'),
  subcategory: text('subcategory'),
  confidence: real('confidence'),
  isCommercialMultifamily: boolean('is_commercial_multifamily').default(false),
  rawResponse: json('raw_response'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  fieldHashIdx: index('idx_classification_field_hash').on(table.fieldHash),
}));

// Parcel to Property lookup - maps ll_uuid to property_key for tile click resolution
export const parcelToProperty = pgTable('parcel_to_property', {
  llUuid: text('ll_uuid').primaryKey(),
  propertyKey: text('property_key').notNull(),
  llStackUuid: text('ll_stack_uuid'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  propertyKeyIdx: index('idx_parcel_property_key').on(table.propertyKey),
}));

// Waitlist signups
export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  name: text('name'),
  company: text('company'),
  role: text('role'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('idx_waitlist_email').on(table.email),
}));

// User lists for saved properties/contacts
export const userLists = pgTable('user_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  listName: text('list_name'),
  listType: text('list_type'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const listItems = pgTable('list_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  listId: uuid('list_id').references(() => userLists.id),
  itemId: uuid('item_id'),
  addedAt: timestamp('added_at').defaultNow(),
});

// Relations
export const propertiesRelations = relations(properties, ({ many }) => ({
  propertyContacts: many(propertyContacts),
  propertyOrganizations: many(propertyOrganizations),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  propertyContacts: many(propertyContacts),
  contactOrganizations: many(contactOrganizations),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  propertyOrganizations: many(propertyOrganizations),
  contactOrganizations: many(contactOrganizations),
}));

// Service categories - top 15 by spend for commercial properties and HOAs
export const SERVICE_CATEGORIES = [
  'landscaping',           // Landscaping & Grounds (~15-25%)
  'janitorial',            // Janitorial & Cleaning (~10-20%)
  'hvac',                  // HVAC (~8-15%)
  'security',              // Security Services (~5-12%)
  'waste_management',      // Waste Management (~3-8%)
  'elevator',              // Elevator/Escalator (~3-6%)
  'roofing',               // Roofing (~2-5%)
  'plumbing',              // Plumbing (~2-5%)
  'electrical',            // Electrical (~2-5%)
  'fire_protection',       // Fire Protection & Life Safety (~2-4%)
  'parking_pavement',      // Parking & Pavement (~2-4%)
  'pest_control',          // Pest Control (~1-3%)
  'window_cleaning',       // Window Cleaning (~1-2%)
  'snow_ice_removal',      // Snow & Ice Removal (~1-3%)
  'pool_water_features',   // Pool & Water Features (~1-2%)
] as const;

export const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  landscaping: 'Landscaping & Grounds',
  janitorial: 'Janitorial & Cleaning',
  hvac: 'HVAC',
  security: 'Security Services',
  waste_management: 'Waste Management',
  elevator: 'Elevator/Escalator',
  roofing: 'Roofing',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  fire_protection: 'Fire Protection & Life Safety',
  parking_pavement: 'Parking & Pavement',
  pest_control: 'Pest Control',
  window_cleaning: 'Window Cleaning',
  snow_ice_removal: 'Snow & Ice Removal',
  pool_water_features: 'Pool & Water Features',
};

export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

// Service providers table - companies that provide facilities services
export const serviceProviders = pgTable('service_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  domain: text('domain').unique(),
  
  // Services offered (array of service category keys)
  servicesOffered: json('services_offered').$type<ServiceCategory[]>(),
  
  // Company info
  linkedinUrl: text('linkedin_url'),
  website: text('website'),
  phone: text('phone'),
  
  // Location
  city: text('city'),
  state: text('state'),
  
  // Enrichment
  enrichmentStatus: text('enrichment_status').default('pending'),
  enrichmentJson: json('enrichment_json'),
  lastEnrichedAt: timestamp('last_enriched_at'),
  
  // Metadata
  isUserCompany: boolean('is_user_company').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  domainIdx: uniqueIndex('idx_service_providers_domain').on(table.domain),
  nameIdx: index('idx_service_providers_name').on(table.name),
}));

// Property service providers - tracks which provider serves which property for each service
export const propertyServiceProviders = pgTable('property_service_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id),
  serviceProviderId: uuid('service_provider_id').references(() => serviceProviders.id),
  serviceCategory: text('service_category').notNull(), // One of SERVICE_CATEGORIES
  
  // Status and confidence
  status: text('status').default('suggested'), // suggested, confirmed, flagged
  confidence: real('confidence'),
  
  // Who suggested/confirmed
  suggestedByUserId: uuid('suggested_by_user_id').references(() => users.id),
  confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),
  
  // Notes
  notes: text('notes'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  propertyServiceIdx: index('idx_property_service_providers').on(table.propertyId, table.serviceCategory),
}));

// Property flags - for flagging incorrect property/management info
export const propertyFlags = pgTable('property_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id),
  
  // What's being flagged
  flagType: text('flag_type').notNull(), // 'property_info', 'management_company', 'owner', 'other'
  
  // Suggested correction
  suggestedOrganizationId: uuid('suggested_organization_id').references(() => organizations.id),
  suggestedOrganizationName: text('suggested_organization_name'), // For new orgs not in system
  
  // User feedback
  reason: text('reason'),
  comments: text('comments'),
  
  // Status
  status: text('status').default('pending'), // pending, reviewed, resolved, dismissed
  
  // Who flagged
  flaggedByUserId: uuid('flagged_by_user_id').references(() => users.id),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  propertyFlagIdx: index('idx_property_flags_property').on(table.propertyId),
  statusIdx: index('idx_property_flags_status').on(table.status),
}));

// Pipeline statuses enum
export const PIPELINE_STATUSES = [
  'new',               // Fresh, not yet worked
  'qualified',         // Meets criteria, deal value set
  'attempted_contact', // Outreach started (call, email, LinkedIn)
  'active_opportunity',// In contact, sales process ongoing
  'won',               // Deal closed won
  'lost',              // Deal closed lost
  'disqualified',      // Doesn't meet criteria (reversible)
] as const;

export type PipelineStatus = typeof PIPELINE_STATUSES[number];

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  new: 'New',
  qualified: 'Qualified',
  attempted_contact: 'Attempted Contact',
  active_opportunity: 'Active Opportunity',
  won: 'Won',
  lost: 'Lost',
  disqualified: 'Disqualified',
};

// Property pipeline - tracks status at org level (org_id + property_id = unique)
export const propertyPipeline = pgTable('property_pipeline', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id).notNull(),
  clerkOrgId: text('clerk_org_id').notNull(), // Clerk organization ID
  
  // Owner - the user responsible for this opportunity
  ownerId: uuid('owner_id').references(() => users.id),
  
  // Pipeline status
  status: text('status').default('new').notNull(), // One of PIPELINE_STATUSES
  
  // Deal value (required when qualifying, must be > 1)
  dealValue: integer('deal_value'),
  
  // Last status change
  statusChangedAt: timestamp('status_changed_at').defaultNow(),
  statusChangedByUserId: uuid('status_changed_by_user_id').references(() => users.id),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  orgPropertyIdx: uniqueIndex('idx_property_pipeline_org_property').on(table.clerkOrgId, table.propertyId),
  statusIdx: index('idx_property_pipeline_status').on(table.status),
  orgIdx: index('idx_property_pipeline_org').on(table.clerkOrgId),
  ownerIdx: index('idx_property_pipeline_owner').on(table.ownerId),
}));

// Property notes - notes with user attribution at org level
export const propertyNotes = pgTable('property_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id).notNull(),
  clerkOrgId: text('clerk_org_id').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  
  content: text('content').notNull(),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  orgPropertyIdx: index('idx_property_notes_org_property').on(table.clerkOrgId, table.propertyId),
  userIdx: index('idx_property_notes_user').on(table.userId),
}));

// Property activity - tracks who did what for audit trail
export const propertyActivity = pgTable('property_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id).notNull(),
  clerkOrgId: text('clerk_org_id').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  
  // Activity type
  activityType: text('activity_type').notNull(), // 'status_change', 'note_added', 'deal_value_updated', 'qualified', 'disqualified', 'requalified'
  
  // Previous and new values for tracking changes
  previousValue: text('previous_value'),
  newValue: text('new_value'),
  
  // Additional context
  metadata: json('metadata'),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  orgPropertyIdx: index('idx_property_activity_org_property').on(table.clerkOrgId, table.propertyId),
  userIdx: index('idx_property_activity_user').on(table.userId),
  createdAtIdx: index('idx_property_activity_created').on(table.createdAt),
}));

// Contact LinkedIn flags - for flagging incorrect LinkedIn profiles
export const contactLinkedinFlags = pgTable('contact_linkedin_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').references(() => contacts.id),
  
  // Original LinkedIn URL that was flagged
  originalLinkedinUrl: text('original_linkedin_url'),
  
  // Selected alternative (if user picked one)
  selectedAlternativeIndex: integer('selected_alternative_index'), // 0-3 in alternatives array
  selectedLinkedinUrl: text('selected_linkedin_url'),
  
  // Status
  status: text('status').default('pending'), // pending, resolved, dismissed
  
  // Who flagged
  flaggedByUserId: uuid('flagged_by_user_id').references(() => users.id),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  contactFlagIdx: index('idx_contact_linkedin_flags').on(table.contactId),
}));

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Property = typeof properties.$inferSelect;
export type InsertProperty = typeof properties.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type InsertWaitlistSignup = typeof waitlistSignups.$inferInsert;
export type ServiceProvider = typeof serviceProviders.$inferSelect;
export type InsertServiceProvider = typeof serviceProviders.$inferInsert;
export type PropertyServiceProvider = typeof propertyServiceProviders.$inferSelect;
export type PropertyFlag = typeof propertyFlags.$inferSelect;
export type ContactLinkedinFlag = typeof contactLinkedinFlags.$inferSelect;
export type PropertyPipeline = typeof propertyPipeline.$inferSelect;
export type InsertPropertyPipeline = typeof propertyPipeline.$inferInsert;
export type PropertyNote = typeof propertyNotes.$inferSelect;
export type InsertPropertyNote = typeof propertyNotes.$inferInsert;
export type PropertyActivity = typeof propertyActivity.$inferSelect;
export type InsertPropertyActivity = typeof propertyActivity.$inferInsert;
