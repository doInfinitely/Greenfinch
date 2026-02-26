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
  geocodedLat: real('geocoded_lat'),
  geocodedLon: real('geocoded_lon'),
  
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
  isCurrentCustomer: boolean('is_current_customer').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  isActive: boolean('is_active').default(true),
}, (table) => ({
  propertyKeyIdx: uniqueIndex('idx_properties_property_key').on(table.propertyKey),
  cityStateIdx: index('idx_properties_city_state').on(table.city, table.state),
  assetCategoryIdx: index('idx_properties_asset_category').on(table.assetCategory),
  zipIdx: index('idx_properties_zip').on(table.zip),
  assetSubcategoryIdx: index('idx_properties_asset_subcategory').on(table.assetSubcategory),
  enrichmentStatusIdx: index('idx_properties_enrichment_status').on(table.enrichmentStatus),
  isActiveIdx: index('idx_properties_is_active').on(table.isActive),
  createdAtIdx: index('idx_properties_created_at').on(table.createdAt),
  regridOwnerIdx: index('idx_properties_regrid_owner').on(table.regridOwner),
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
  
  phoneExtension: text('phone_extension'),
  
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
  
  pdlRawResponse: json('pdl_raw_response'),
  crustdataRawResponse: json('crustdata_raw_response'),
  confidenceFlag: text('confidence_flag'),
  pdlFullName: text('pdl_full_name'),
  pdlWorkEmail: text('pdl_work_email'),
  pdlEmailsJson: json('pdl_emails_json'),
  pdlPersonalEmails: json('pdl_personal_emails'),
  pdlPhonesJson: json('pdl_phones_json'),
  pdlMobilePhone: text('pdl_mobile_phone'),
  pdlLinkedinUrl: text('pdl_linkedin_url'),
  pdlTitle: text('pdl_title'),
  pdlCompany: text('pdl_company'),
  pdlCompanyDomain: text('pdl_company_domain'),
  pdlTitleRole: text('pdl_title_role'),
  pdlTitleLevels: json('pdl_title_levels'),
  pdlTitleClass: text('pdl_title_class'),
  pdlTitleSubRole: text('pdl_title_sub_role'),
  pdlLocation: text('pdl_location'),
  pdlCity: text('pdl_city'),
  pdlState: text('pdl_state'),
  pdlAddressesJson: json('pdl_addresses_json'),
  pdlIndustry: text('pdl_industry'),
  pdlGender: text('pdl_gender'),
  pdlDatasetVersion: text('pdl_dataset_version'),
  crustdataTitle: text('crustdata_title'),
  crustdataCompany: text('crustdata_company'),
  crustdataCompanyDomain: text('crustdata_company_domain'),
  crustdataWorkEmail: text('crustdata_work_email'),
  crustdataLinkedinUrl: text('crustdata_linkedin_url'),
  crustdataLocation: text('crustdata_location'),
  crustdataPersonId: integer('crustdata_person_id'),
  crustdataEnriched: boolean('crustdata_enriched').default(false),
  crustdataEnrichedAt: timestamp('crustdata_enriched_at'),
  findymailVerified: boolean('findymail_verified'),
  findymailVerifyStatus: text('findymail_verify_status'),

  linkedinRejectedUrl: text('linkedin_rejected_url'),
  linkedinRejectedSource: text('linkedin_rejected_source'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('idx_contacts_email').on(table.normalizedEmail),
  nameDomainIdx: index('idx_contacts_name_domain').on(table.normalizedName, table.companyDomain),
  fullNameIdx: index('idx_contacts_full_name').on(table.fullName),
  employerNameIdx: index('idx_contacts_employer_name').on(table.employerName),
  linkedinUrlIdx: index('idx_contacts_linkedin_url').on(table.linkedinUrl),
  emailStatusIdx: index('idx_contacts_email_status').on(table.emailStatus),
  createdAtIdx: index('idx_contacts_created_at').on(table.createdAt),
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
  
  // PDL company identifier for parent/subsidiary resolution
  pdlCompanyId: text('pdl_company_id'),
  affiliatedPdlIds: json('affiliated_pdl_ids').$type<string[]>(),

  // Enrichment metadata - provider tracking for cascade (Apollo → EnrichLayer → PDL)
  providerId: text('provider_id'), // ID from the enrichment provider (e.g., Apollo org ID)
  enrichmentSource: text('enrichment_source'), // 'apollo', 'enrichlayer', 'pdl'
  enrichmentStatus: text('enrichment_status').default('pending'),
  lastEnrichedAt: timestamp('last_enriched_at'),
  rawEnrichmentJson: json('raw_enrichment_json'),
  
  pdlEnriched: boolean('pdl_enriched').default(false),
  pdlEnrichedAt: timestamp('pdl_enriched_at'),
  pdlDataVersion: text('pdl_data_version'),
  
  pdlRawResponse: json('pdl_raw_response'),
  crustdataRawResponse: json('crustdata_raw_response'),
  crustdataEnriched: boolean('crustdata_enriched').default(false),
  crustdataEnrichedAt: timestamp('crustdata_enriched_at'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  parentOrgIdx: index('idx_organizations_parent').on(table.parentOrgId),
  ultimateParentOrgIdx: index('idx_organizations_ultimate_parent').on(table.ultimateParentOrgId),
  pdlCompanyIdx: index('idx_organizations_pdl_company_id').on(table.pdlCompanyId),
  enrichmentStatusIdx: index('idx_organizations_enrichment_status').on(table.enrichmentStatus),
  createdAtIdx: index('idx_organizations_created_at').on(table.createdAt),
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
  relationshipStatus: text('relationship_status').default('active'),
  relationshipStatusReason: text('relationship_status_reason'),
  relationshipVerifiedAt: timestamp('relationship_verified_at'),
  discoveredAt: timestamp('discovered_at').defaultNow(),
}, (table) => ({
  propertyContactIdx: index('idx_property_contacts').on(table.propertyId, table.contactId),
  propertyContactUnique: uniqueIndex('property_contacts_property_id_contact_id_unique').on(table.propertyId, table.contactId),
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
}, (table) => ({
  contactOrgIdx: index('idx_contact_organizations').on(table.contactId, table.orgId),
  orgIdx: index('idx_contact_organizations_org').on(table.orgId),
}));

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

// Maps ALL DCAD account numbers to their GIS parcel ID and resolved parent property
// This enables Regrid tile parcelnumb → parent property resolution for accounts we didn't ingest as full properties
export const parcelnumbMapping = pgTable('parcelnumb_mapping', {
  accountNum: text('account_num').primaryKey(),
  gisParcelId: text('gis_parcel_id').notNull(),
  parentPropertyKey: text('parent_property_key'),
}, (table) => ({
  gisParcelIdx: index('idx_parcelnumb_gis_parcel').on(table.gisParcelId),
  parentPropIdx: index('idx_parcelnumb_parent_prop').on(table.parentPropertyKey),
}));

// Waitlist signups
export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  name: text('name'),
  company: text('company'),
  role: text('role'),
  industry: text('industry'),
  phone: text('phone'),
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

// Data issues reports
export const dataIssues = pgTable('data_issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id'), // Clerk user ID
  entityType: text('entity_type').notNull(), // 'contact' or 'property'
  contactId: uuid('contact_id').references(() => contacts.id),
  propertyId: uuid('property_id').references(() => properties.id),
  issueDescription: text('issue_description').notNull(),
  status: text('status').default('open'), // 'open', 'resolved', 'ignored'
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Relations
export const dataIssuesRelations = relations(dataIssues, ({ one }) => ({
  contact: one(contacts, {
    fields: [dataIssues.contactId],
    references: [contacts.id],
  }),
  property: one(properties, {
    fields: [dataIssues.propertyId],
    references: [properties.id],
  }),
}));

// Relations
export const propertiesRelations = relations(properties, ({ many }) => ({
  propertyContacts: many(propertyContacts),
  propertyOrganizations: many(propertyOrganizations),
  dataIssues: many(dataIssues),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  propertyContacts: many(propertyContacts),
  contactOrganizations: many(contactOrganizations),
  dataIssues: many(dataIssues),
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
  
  // Current customer flag - separate from won status, auto-set when won
  isCurrentCustomer: boolean('is_current_customer').default(false),
  
  // Last status change
  statusChangedAt: timestamp('status_changed_at').defaultNow(),
  statusChangedByUserId: uuid('status_changed_by_user_id').references(() => users.id),
  
  lostReason: text('lost_reason'),
  lostNotes: text('lost_notes'),
  disqualifiedReason: text('disqualified_reason'),
  disqualifiedNotes: text('disqualified_notes'),
  
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

// Potential duplicate contacts - flagged for admin review
export const potentialDuplicates = pgTable('potential_duplicates', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactIdA: uuid('contact_id_a').references(() => contacts.id).notNull(),
  contactIdB: uuid('contact_id_b').references(() => contacts.id).notNull(),
  matchType: text('match_type').notNull(), // 'name_domain' | 'name_employer'
  matchKey: text('match_key').notNull(),
  confidence: real('confidence').default(0.5),
  status: text('status').default('pending'), // 'pending' | 'merged' | 'dismissed'
  resolvedByUserId: text('resolved_by_user_id'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  statusIdx: index('idx_potential_duplicates_status').on(table.status),
  contactAIdx: index('idx_potential_duplicates_contact_a').on(table.contactIdA),
  contactBIdx: index('idx_potential_duplicates_contact_b').on(table.contactIdB),
}));

// Notifications - for @ mentions and action reminders
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkOrgId: text('clerk_org_id').notNull(),
  
  // Who receives the notification
  recipientUserId: uuid('recipient_user_id').references(() => users.id).notNull(),
  
  // Who triggered the notification (optional for system notifications)
  senderUserId: uuid('sender_user_id').references(() => users.id),
  
  // Notification type
  type: text('type').notNull(), // 'mention', 'action_due', 'action_assigned'
  
  // Related entities (optional)
  propertyId: uuid('property_id').references(() => properties.id),
  noteId: uuid('note_id').references(() => propertyNotes.id),
  actionId: uuid('action_id'), // Self-reference handled separately
  
  // Content
  title: text('title').notNull(),
  message: text('message'),
  
  // Status
  isRead: boolean('is_read').default(false),
  readAt: timestamp('read_at'),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  recipientIdx: index('idx_notifications_recipient').on(table.recipientUserId, table.isRead),
  orgIdx: index('idx_notifications_org').on(table.clerkOrgId),
  createdAtIdx: index('idx_notifications_created').on(table.createdAt),
}));

// Follow-up actions - tasks/reminders for opportunities
export const propertyActions = pgTable('property_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id).notNull(),
  clerkOrgId: text('clerk_org_id').notNull(),
  
  // Who created and who is assigned
  createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
  assignedToUserId: uuid('assigned_to_user_id').references(() => users.id).notNull(),
  
  // Action details
  actionType: text('action_type').notNull(), // 'follow_up', 'call', 'email', 'meeting', 'other'
  description: text('description'),
  
  // Due date
  dueAt: timestamp('due_at').notNull(),
  originalDueAt: timestamp('original_due_at'), // set on creation, preserved when due date changes
  
  // Status
  status: text('status').default('pending'), // 'pending', 'completed', 'cancelled'
  completionStatus: text('completion_status'), // 'completed_on_time', 'completed_overdue', 'rescheduled', 'cancelled'
  completedAt: timestamp('completed_at'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  propertyIdx: index('idx_property_actions_property').on(table.propertyId),
  assignedIdx: index('idx_property_actions_assigned').on(table.assignedToUserId, table.status),
  dueAtIdx: index('idx_property_actions_due').on(table.dueAt),
  orgIdx: index('idx_property_actions_org').on(table.clerkOrgId),
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
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type PropertyAction = typeof propertyActions.$inferSelect;
export type InsertPropertyAction = typeof propertyActions.$inferInsert;

// Admin audit log for tracking database operations
export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  userEmail: text('user_email'),
  action: text('action').notNull(), // 'query', 'clear_table', 'delete_rows', 'update', 'export'
  targetTable: text('target_table'),
  queryText: text('query_text'),
  rowsAffected: integer('rows_affected'),
  environment: text('environment').notNull().default('development'), // 'development' or 'production'
  success: boolean('success').default(true),
  errorMessage: text('error_message'),
  metadata: json('metadata'), // Additional context like filters, conditions
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdIdx: index('admin_audit_log_user_id_idx').on(table.userId),
  actionIdx: index('admin_audit_log_action_idx').on(table.action),
  createdAtIdx: index('admin_audit_log_created_at_idx').on(table.createdAt),
}));

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLog.$inferInsert;

// Ingestion settings for configurable ZIP codes and limits
export const ingestionSettings = pgTable('ingestion_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(), // 'zip_codes', 'default_limit', etc.
  value: json('value').notNull(), // JSON value for flexibility
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
});

export type IngestionSettings = typeof ingestionSettings.$inferSelect;
export type InsertIngestionSettings = typeof ingestionSettings.$inferInsert;

// Property views - tracks when users last viewed a property (for unread indicators)
export const propertyViews = pgTable('property_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  clerkOrgId: text('clerk_org_id').notNull(),
  lastViewedAt: timestamp('last_viewed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userPropertyIdx: uniqueIndex('idx_property_views_user_property').on(table.userId, table.propertyId, table.clerkOrgId),
  propertyIdx: index('idx_property_views_property').on(table.propertyId),
  userIdx: index('idx_property_views_user').on(table.userId),
}));

export type PropertyView = typeof propertyViews.$inferSelect;
export type InsertPropertyView = typeof propertyViews.$inferInsert;

// Pipeline stage history - tracks every stage transition with timing and context
export const pipelineStageHistory = pgTable('pipeline_stage_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').references(() => propertyPipeline.id).notNull(),
  propertyId: uuid('property_id').references(() => properties.id).notNull(),
  clerkOrgId: text('clerk_org_id').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),

  fromStage: text('from_stage'),
  toStage: text('to_stage').notNull(),

  outreachMethods: json('outreach_methods'), // e.g. ['email', 'phone', 'linkedin']
  successfulMethod: text('successful_method'), // which method worked (on active_opportunity transition)
  lossReasonCodeId: uuid('loss_reason_code_id'),

  transitionedAt: timestamp('transitioned_at').defaultNow().notNull(),
  durationInStageMs: integer('duration_in_stage_ms'), // time spent in fromStage
}, (table) => ({
  pipelineIdx: index('idx_stage_history_pipeline').on(table.pipelineId),
  propertyIdx: index('idx_stage_history_property').on(table.propertyId),
  orgIdx: index('idx_stage_history_org').on(table.clerkOrgId),
  toStageIdx: index('idx_stage_history_to_stage').on(table.toStage),
  transitionedAtIdx: index('idx_stage_history_transitioned_at').on(table.transitionedAt),
}));

export type PipelineStageHistory = typeof pipelineStageHistory.$inferSelect;
export type InsertPipelineStageHistory = typeof pipelineStageHistory.$inferInsert;

// Loss reason codes - configurable per org with stage eligibility
export const lossReasonCodes = pgTable('loss_reason_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkOrgId: text('clerk_org_id'), // null = system default, set = org-specific
  code: text('code').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  eligibleFromStages: json('eligible_from_stages').notNull(), // e.g. ['active_opportunity', 'qualified']
  isActive: boolean('is_active').default(true),
  isSystemDefault: boolean('is_system_default').default(false),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  orgIdx: index('idx_loss_reason_codes_org').on(table.clerkOrgId),
  activeIdx: index('idx_loss_reason_codes_active').on(table.isActive),
}));

export type LossReasonCode = typeof lossReasonCodes.$inferSelect;
export type InsertLossReasonCode = typeof lossReasonCodes.$inferInsert;

// Enrichment cost tracking
export const ENRICHMENT_PROVIDERS = [
  'pdl',
  'apollo',
  'hunter',
  'findymail',
  'crustdata',
  'zerobounce',
  'gemini',
  'mapbox',
  'serp',
  'leadmagic',
  'enrichlayer',
] as const;

export type EnrichmentProvider = typeof ENRICHMENT_PROVIDERS[number];

export const ENRICHMENT_PROVIDER_LABELS: Record<EnrichmentProvider, string> = {
  pdl: 'People Data Labs',
  apollo: 'Apollo.io',
  hunter: 'Hunter.io',
  findymail: 'Findymail',
  crustdata: 'Crustdata',
  zerobounce: 'ZeroBounce',
  gemini: 'Google Gemini',
  mapbox: 'Mapbox',
  serp: 'SerpAPI',
  leadmagic: 'LeadMagic',
  enrichlayer: 'EnrichLayer',
};

export const enrichmentCostEvents = pgTable('enrichment_cost_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  endpoint: text('endpoint').notNull(),
  creditsUsed: real('credits_used').default(1),
  estimatedCostUsd: real('estimated_cost_usd'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  thinkingTokens: integer('thinking_tokens'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  triggeredBy: text('triggered_by'),
  clerkOrgId: text('clerk_org_id'),
  statusCode: integer('status_code'),
  success: boolean('success').default(true),
  errorMessage: text('error_message'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  providerIdx: index('idx_enrichment_cost_provider').on(table.provider),
  createdAtIdx: index('idx_enrichment_cost_created_at').on(table.createdAt),
  entityIdx: index('idx_enrichment_cost_entity').on(table.entityType, table.entityId),
  triggeredByIdx: index('idx_enrichment_cost_triggered_by').on(table.triggeredBy),
}));

export type EnrichmentCostEvent = typeof enrichmentCostEvents.$inferSelect;
export type InsertEnrichmentCostEvent = typeof enrichmentCostEvents.$inferInsert;

// Contact Snapshots table - stores version history of contact data changes
export const contactSnapshots = pgTable('contact_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull(),
  version: integer('version').notNull().default(1),
  snapshotData: json('snapshot_data').$type<{
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    employerName?: string | null;
    companyDomain?: string | null;
    linkedinUrl?: string | null;
    location?: string | null;
    photoUrl?: string | null;
    emailValidationStatus?: string | null;
    phoneSource?: string | null;
    enrichmentPhoneWork?: string | null;
    enrichmentPhonePersonal?: string | null;
  }>().notNull(),
  changes: json('changes').$type<{
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }[]>(),
  changeType: text('change_type').notNull().default('research'),
  triggeredBy: text('triggered_by'),
  isCanonical: boolean('is_canonical').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  contactIdx: index('idx_contact_snapshots_contact').on(table.contactId),
  contactVersionIdx: uniqueIndex('idx_contact_snapshots_contact_version').on(table.contactId, table.version),
}));

export type ContactSnapshot = typeof contactSnapshots.$inferSelect;
export type InsertContactSnapshot = typeof contactSnapshots.$inferInsert;

// User Contact Versions table - tracks which version each user is viewing
export const userContactVersions = pgTable('user_contact_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  viewingVersion: integer('viewing_version').notNull(),
  hasUnseenUpdate: boolean('has_unseen_update').default(false),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userContactIdx: uniqueIndex('idx_user_contact_versions_user_contact').on(table.userId, table.contactId),
  contactIdx: index('idx_user_contact_versions_contact').on(table.contactId),
}));

export type UserContactVersion = typeof userContactVersions.$inferSelect;
export type InsertUserContactVersion = typeof userContactVersions.$inferInsert;

// Outreach method constants
export const OUTREACH_METHODS = [
  'email',
  'phone',
  'linkedin',
  'in_person',
  'lunch_and_learn',
  'direct_mail',
  'referral',
  'other',
] as const;

export type OutreachMethod = typeof OUTREACH_METHODS[number];

export const OUTREACH_METHOD_LABELS: Record<OutreachMethod, string> = {
  email: 'Email',
  phone: 'Phone Call',
  linkedin: 'LinkedIn',
  in_person: 'In-Person Visit',
  lunch_and_learn: 'Lunch & Learn Invitation',
  direct_mail: 'Direct Mail',
  referral: 'Referral',
  other: 'Other',
};

// Task completion status constants
export const TASK_COMPLETION_STATUSES = [
  'pending',
  'completed_on_time',
  'completed_overdue',
  'rescheduled',
  'cancelled',
] as const;

export type TaskCompletionStatus = typeof TASK_COMPLETION_STATUSES[number];
