import { pgTable, uuid, text, timestamp, boolean, integer, real, json, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table for Replit Auth
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  replitId: text('replit_id').unique(),
  email: text('email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  profileImageUrl: text('profile_image_url'),
  role: text('role').default('standard_user'),
  accountId: uuid('account_id'),
  isActive: boolean('is_active').default(true),
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
  buildingSqft: integer('building_sqft'),
  yearBuilt: integer('year_built'),
  numFloors: integer('num_floors'),
  
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
  
  // Raw data
  rawParcelsJson: json('raw_parcels_json'),
  enrichmentJson: json('enrichment_json'),
  mapboxPoiJson: json('mapbox_poi_json'),
  
  // Operational status from Mapbox POI
  operationalStatus: text('operational_status'),
  
  // Enrichment metadata
  propertyWebsite: text('property_website'),
  propertyManagerWebsite: text('property_manager_website'),
  aiRationale: text('ai_rationale'),
  
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
  
  title: text('title'),
  titleConfidence: real('title_confidence'),
  companyDomain: text('company_domain'),
  employerName: text('employer_name'),
  
  linkedinUrl: text('linkedin_url'),
  linkedinConfidence: real('linkedin_confidence'),
  linkedinStatus: text('linkedin_status'),
  
  source: text('source').default('ai'),
  contactRationale: text('contact_rationale'),
  needsReview: boolean('needs_review').default(false),
  reviewReason: text('review_reason'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('idx_contacts_email').on(table.normalizedEmail),
  nameDomainIdx: index('idx_contacts_name_domain').on(table.normalizedName, table.companyDomain),
}));

// Organizations table
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  domain: text('domain').unique(),
  orgType: text('org_type'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Junction: Property <-> Contact
export const propertyContacts = pgTable('property_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  role: text('role'),
  confidenceScore: real('confidence_score'),
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
