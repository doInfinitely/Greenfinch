# greenfinch.ai Technical Architecture

## Overview

greenfinch.ai is a commercial real estate prospecting platform that provides sales representatives with property intelligence and validated contact information for commercial property decision-makers. The platform aggregates data from multiple sources, enriches it with AI and third-party APIs, and presents it through interactive maps and list views.

**Last Updated:** February 2026

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Data Sources & Ingestion](#2-data-sources--ingestion)
3. [Database Schema](#3-database-schema)
4. [External API Integrations](#4-external-api-integrations)
5. [Enrichment Pipeline](#5-enrichment-pipeline)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Caching & Performance](#8-caching--performance)
9. [Infrastructure](#9-infrastructure)

---

## 1. System Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
├─────────────────┬─────────────────┬─────────────────┬──────────────────────┤
│  CAD Staging    │   Regrid APIs   │   County Data   │   Mapbox/Google      │
│  (PostgreSQL)   │   (runtime)     │   (downloaded)  │   (POI/Places/Maps)  │
└────────┬────────┴────────┬────────┴────────┬────────┴──────────┬───────────┘
         │                 │                 │                   │
         ▼                 ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROCESSING LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Parcel Aggregation (by GIS_PARCEL_ID)                                    │
│  • AI Classification (Gemini with Search Grounding)                          │
│  • Contact Discovery & Validation                                            │
│  • Organization Enrichment                                                   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         POSTGRESQL DATABASE                                  │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────┤
│  properties  │   contacts   │ organizations│   pipeline   │   lists/notes  │
└──────┬───────┴──────────────┴──────────────┴──────────────┴────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WEB APPLICATION                                    │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────┤
│  Map View    │  List View   │  Pipeline    │  Contacts    │  Admin Panel   │
│  (Mapbox/    │  (Data Grid) │  (Kanban)    │  (CRM)       │  (DB Ops)      │
│  Google Maps)│              │              │              │                │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) |
| **Runtime** | Node.js 20 |
| **Database** | PostgreSQL (Neon-backed via Replit) |
| **ORM** | Drizzle ORM |
| **Styling** | Tailwind CSS v3 |
| **Maps** | Mapbox GL JS (primary), Google Maps (alternative) |
| **AI** | Google Gemini (gemini-3.0-flash with Search Grounding) |
| **Auth** | Clerk |
| **Caching** | Upstash Redis |

---

## 2. Data Sources & Ingestion

### 2.1 Primary Data: County Appraisal Districts

County appraisal district data (DCAD, TCAD, etc.) is the primary source for property information, downloaded from county websites and loaded into PostgreSQL staging tables.

**CAD Staging Tables:**
- `cad_account_info` - Core account metadata, GIS parcel IDs, owner names, coordinates
- `cad_appraisal_values` - Appraisal values, SPTD codes
- `cad_buildings` - Building details (sqft, year built, quality/condition grades, HVAC)
- `cad_land` - Lot dimensions, front footage
- `cad_downloads` - Tracks download history and data freshness

**Ingestion Flow:**
```
County Website → Download ZIP → Load to staging tables → Filter by SPTD Codes
→ Aggregate by GIS_PARCEL_ID → Calculate Building Class → Normalize Addresses
→ Upsert to PostgreSQL properties table
```

**Key Fields Ingested:**
- Physical: lot size, building area, year built, floors, HVAC types
- Valuation: improvement value, land value, total value
- Owner: business name, owner names, mailing address, phone
- Classification: SPTD code, division code, zoning

### 2.2 Runtime Data: Regrid APIs

Used for real-time parcel lookup and map tiles.

| API | Endpoint | Purpose |
|-----|----------|---------|
| **Typeahead** | `/api/v2/parcels/typeahead` | Address autocomplete search |
| **Point Lookup** | `/api/v2/parcels/point` | Get parcel by coordinates |
| **Tile Server** | `tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt` | Parcel boundary vectors |

### 2.3 Parcel Resolution

The system handles mismatches between Regrid parcel numbers and DCAD account numbers using progressive prefix matching:

```
1. Exact match on propertyKey (normalized parcelnumb)
2. Match on ll_uuid via parcel_to_property lookup
3. Progressive prefix matching (13→10 chars) preferring parent properties
   (properties with more trailing zeros = parent/main property)
```

---

## 3. Database Schema

All tables are defined in `src/lib/schema.ts` using Drizzle ORM.

> **Note:** This section provides an illustrative overview of key tables and columns. The authoritative source for all table definitions, column types, and constraints is `src/lib/schema.ts`. Additional utility tables, indexes, and relations not covered here may exist in the schema file.

### 3.1 Core Tables

#### `properties` - One record per physical property

> **Illustrative subset only.** The complete schema is defined in `src/lib/schema.ts` and should be referenced for all implementation details.

**Identity & Location:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `propertyKey` | text | Unique identifier (DCAD account or GIS parcel ID) |
| `sourceLlUuid` | text | Regrid ll_uuid for API lookups |
| `llStackUuid` | text | Stack identifier for grouped parcels |
| `regridAddress` | text | Raw address from Regrid |
| `validatedAddress` | text | AI-validated canonical address |
| `validatedAddressConfidence` | real | Confidence score 0-1 |
| `city`, `state`, `zip`, `county` | text | Location fields |
| `lat`, `lon` | real | Coordinates |
| `geocodeConfidence` | real | Geocoding accuracy |

**Physical Characteristics:**
| Column | Type | Description |
|--------|------|-------------|
| `lotSqft` | integer | Lot size in square feet |
| `lotSqftConfidence` | real | Data confidence |
| `lotSqftSource` | text | Source of lot data |
| `buildingSqft` | integer | Building area |
| `buildingSqftConfidence` | real | Data confidence |
| `buildingSqftSource` | text | Source of building data |
| `yearBuilt` | integer | Construction year |
| `numFloors` | integer | Number of floors |
| `aiLotAcres` | real | AI-enriched lot size (acres) |
| `aiLotAcresConfidence` | real | AI confidence |
| `aiLotAcresRationale` | text | AI reasoning for lot calculation |
| `aiNetSqft` | integer | AI-enriched net rentable area |
| `aiNetSqftConfidence` | real | AI confidence |
| `aiNetSqftRationale` | text | AI reasoning for sqft calculation |

**Classification:**
| Column | Type | Description |
|--------|------|-------------|
| `assetCategory` | text | Office, Retail, Industrial, etc. |
| `assetSubcategory` | text | More specific (e.g., Shopping Center) |
| `categoryConfidence` | real | Classification confidence |
| `categoryRationale` | text | AI reasoning |
| `propertyClass` | text | Quality class (A+, A, B, C, D) |
| `propertyClassRationale` | text | Class determination reasoning |
| `calculatedBuildingClass` | text | Algorithmically calculated class |
| `buildingClassRationale` | text | Calculation reasoning |

**Names & Identity:**
| Column | Type | Description |
|--------|------|-------------|
| `commonName` | text | Property name (e.g., "NorthPark Mall") |
| `commonNameConfidence` | real | Name confidence |
| `containingPlace` | text | Parent location name |
| `containingPlaceType` | text | Type of containing place |

**Ownership & Management:**
| Column | Type | Description |
|--------|------|-------------|
| `regridOwner` | text | Owner from Regrid |
| `regridOwner2` | text | Secondary owner |
| `beneficialOwner` | text | Actual beneficial owner entity |
| `beneficialOwnerConfidence` | real | Confidence score |
| `beneficialOwnerType` | text | REIT, Private Equity, etc. |
| `managementType` | text | Management structure type |
| `managementCompany` | text | Property manager name |
| `managementCompanyDomain` | text | Manager website domain |
| `managementConfidence` | real | Management identification confidence |

**DCAD Data (Dallas County):**
| Column | Type | Description |
|--------|------|-------------|
| `dcadAccountNum` | text | DCAD account number |
| `dcadGisParcelId` | text | GIS parcel identifier |
| `dcadSptdCode` | text | State property type code |
| `dcadDivisionCd` | text | COM or RES division |
| `dcadImprovVal`, `dcadLandVal`, `dcadTotalVal` | integer | Appraisal values |
| `dcadCityJuris`, `dcadIsdJuris` | text | City and ISD jurisdictions |
| `dcadBizName` | text | Business name on record |
| `dcadOwnerName1`, `dcadOwnerName2` | text | Owner names |
| `dcadOwnerAddress`, `dcadOwnerCity`, `dcadOwnerState`, `dcadOwnerZip` | text | Owner mailing address |
| `dcadOwnerPhone` | text | Owner phone |
| `dcadDeedTransferDate` | text | Last deed transfer date |
| `dcadZoning` | text | Zoning code |
| `dcadLandFrontDim`, `dcadLandDepthDim` | integer | Land dimensions |
| `dcadLandArea`, `dcadLandAreaUom` | real/text | Land area with unit of measure |
| `dcadBuildingCount` | integer | Number of buildings |
| `dcadOldestYearBuilt`, `dcadNewestYearBuilt` | integer | Year built range |
| `dcadTotalGrossBldgArea` | integer | Total building area |
| `dcadTotalUnits` | integer | Total unit count |
| `dcadRentableArea` | integer | Net rentable area |
| `dcadParkingSqft` | integer | Parking area |
| `dcadPrimaryAcType`, `dcadPrimaryHeatingType` | text | HVAC types |
| `dcadQualityGrade`, `dcadConditionGrade` | text | Building quality grades |
| `dcadBuildings` | json | Array of all building details |

**Enrichment & Metadata:**
| Column | Type | Description |
|--------|------|-------------|
| `enrichmentStatus` | text | pending/enriched/failed |
| `enrichmentSources` | json | Array of data sources used |
| `enrichmentJson` | json | Full AI enrichment response |
| `mapboxPoiJson` | json | Mapbox POI data |
| `operationalStatus` | text | open/closed/temporarily_closed |
| `rawParcelsJson` | json | Original parcel data |
| `propertyWebsite`, `propertyPhone` | text | Property contact info |
| `propertyManagerWebsite` | text | Property manager website |
| `aiRationale` | text | AI enrichment reasoning |
| `isParentProperty` | boolean | True if aggregated parent |
| `parentPropertyKey` | text | Parent property reference |
| `constituentAccountNums` | json | Child account numbers |
| `constituentCount` | integer | Number of child records |
| `lastRegridUpdate` | timestamp | Last Regrid data update |
| `lastEnrichedAt` | timestamp | Last enrichment time |
| `isCurrentCustomer` | boolean | Flag for existing customers |
| `isActive` | boolean | Active/deleted flag |
| `createdAt`, `updatedAt` | timestamp | Record timestamps |

#### `contacts` - Individuals with property relationships

> **Illustrative subset only.** See `src/lib/schema.ts` for complete definition.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `fullName`, `normalizedName` | text | Name fields |
| `nameConfidence` | real | Name accuracy confidence |
| `contactType` | text | 'individual' or 'general' (office lines) |
| `email`, `normalizedEmail` | text | Email fields |
| `emailConfidence` | real | Email confidence |
| `emailStatus` | text | Validation status |
| `emailValidatedAt` | timestamp | When validated |
| `emailSource` | text | Source of email |
| `emailValidationStatus` | text | pending/valid/invalid |
| `emailValidationDetails` | json | Full validation response |
| `phone`, `normalizedPhone` | text | Phone fields |
| `phoneConfidence` | real | Phone confidence |
| `phoneLabel` | text | direct_work/office/personal/mobile |
| `phoneSource` | text | Source of phone |
| `aiPhone`, `aiPhoneLabel`, `aiPhoneConfidence` | text/real | AI-discovered phone |
| `enrichmentPhoneWork`, `enrichmentPhonePersonal` | text | Enriched phones |
| `title`, `titleConfidence` | text/real | Job title |
| `companyDomain`, `employerName` | text | Company association |
| `linkedinUrl`, `linkedinConfidence`, `linkedinStatus` | text/real | LinkedIn profile |
| `photoUrl` | text | Profile photo URL |
| `location` | text | City, State |
| `linkedinSearchResults` | json | Top 4 LinkedIn matches |
| `linkedinFlagged` | boolean | Flagged for review |
| `source` | text | ai/manual/import |
| `contactRationale` | text | Why discovered |
| `needsReview`, `reviewReason` | boolean/text | Review flags |
| `providerId` | text | ID from enrichment provider |
| `enrichmentSource` | text | apollo/enrichlayer/pdl/ai |
| `enrichedAt` | timestamp | When enriched |
| `rawEnrichmentJson` | json | Full provider response |
| `pdlEnriched`, `pdlEnrichedAt` | boolean/timestamp | PDL status |
| `pdlEmployerMismatch`, `pdlEmployerName`, `pdlEmployerDomain` | boolean/text | PDL employer data |

#### `organizations` - Companies and entities

> **Illustrative subset only.** See `src/lib/schema.ts` for complete definition.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name`, `legalName` | text | Company names |
| `domain` | text | Primary web domain (unique) |
| `domainAliases` | json | Alternative domains |
| `orgType` | text | Organization type |
| `description` | text | Company description |
| `foundedYear` | integer | Year founded |
| `sector`, `industryGroup`, `industry`, `subIndustry` | text | Industry classification |
| `gicsCode`, `sicCode`, `naicsCode` | text | Industry codes |
| `tags` | json | Company tags |
| `employees`, `employeesRange` | integer/text | Employee count |
| `estimatedAnnualRevenue` | text | Revenue estimate |
| `location`, `streetAddress`, `city`, `state`, `country` | text | Location fields |
| `lat`, `lng` | real | Coordinates |
| `linkedinHandle`, `twitterHandle`, `facebookHandle`, `crunchbaseHandle` | text | Social profiles |
| `logoUrl` | text | Company logo |
| `parentDomain`, `parentOrgId` | text/UUID | Parent company |
| `ultimateParentDomain`, `ultimateParentOrgId` | text/UUID | Ultimate parent |
| `tech`, `techCategories` | json | Technology stack |
| `phoneNumbers`, `emailAddresses` | json | Contact info arrays |
| `providerId`, `enrichmentSource` | text | Provider tracking |
| `enrichmentStatus`, `lastEnrichedAt` | text/timestamp | Enrichment status |
| `rawEnrichmentJson` | json | Full provider response |
| `pdlEnriched`, `pdlEnrichedAt` | boolean/timestamp | PDL status |

### 3.2 Relationship Tables (Junction Tables)

| Table | Columns | Purpose |
|-------|---------|---------|
| `property_contacts` | propertyId, contactId, role, confidenceScore, relationshipConfidence, relationshipNote | Links properties to contacts with roles |
| `property_organizations` | propertyId, orgId, role | Links properties to organizations |
| `contact_organizations` | contactId, orgId, title, isCurrent, startedAt, endedAt | Employment relationships |

### 3.3 Pipeline & CRM Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `property_pipeline` | propertyId, clerkOrgId, ownerId, status, dealValue, isCurrentCustomer | Org-scoped property sales pipeline |
| `property_notes` | propertyId, clerkOrgId, userId, content | User notes on properties |
| `property_activity` | propertyId, clerkOrgId, userId, activityType, previousValue, newValue | Audit trail |
| `property_actions` | propertyId, clerkOrgId, createdByUserId, assignedToUserId, actionType, dueAt, status | Follow-up tasks |
| `notifications` | clerkOrgId, recipientUserId, type, propertyId, title, message, isRead | Mentions and alerts |

### 3.4 User & Auth Tables

| Table | Purpose |
|-------|---------|
| `users` | Clerk user records with roles, company info, service provider links |
| `sessions` | Auth session storage |

### 3.5 Service Provider Tables

| Table | Purpose |
|-------|---------|
| `service_providers` | Companies that provide facilities services (landscaping, HVAC, etc.) |
| `property_service_providers` | Links properties to service providers by service category |

### 3.6 Flagging & Review Tables

| Table | Purpose |
|-------|---------|
| `property_flags` | User-submitted corrections for property/management info |
| `contact_linkedin_flags` | Flagged incorrect LinkedIn profiles with alternatives |

### 3.7 Supporting Tables

| Table | Purpose |
|-------|---------|
| `user_lists` | User-created saved lists |
| `list_items` | Items in user lists (properties or contacts) |
| `parcel_to_property` | ll_uuid → propertyKey lookup for tile click resolution |
| `classification_cache` | Cached AI classifications by field hash |
| `waitlist_signups` | Beta waitlist submissions |
| `ingestion_settings` | Configurable ZIP codes and limits |
| `admin_audit_log` | Database operation audit trail |

---

## 4. External API Integrations

All API integrations are implemented in `src/lib/` with corresponding TypeScript modules.

> **Status Definitions:**
> - **Implemented**: Module exists with complete integration code
> - **Fallback**: Secondary provider used when primary fails
> - **Legacy**: Historical implementation, may be deprecated or inactive

### 4.1 Contact & Company Enrichment APIs

| Provider | Module | Status | Purpose | Secret Key |
|----------|--------|--------|---------|------------|
| **Apollo.io** | `apollo.ts` | Implemented | Primary person/company enrichment, waterfall phone/email | `APOLLO_API_KEY` |
| **ZeroBounce** | `zerobounce.ts` | Implemented | Primary email validation (1hr cache) | `ZEROBOUNCE_API_KEY` |
| **EnrichLayer** | `enrichlayer.ts` | Implemented | LinkedIn profile enrichment, company lookup (20 req/min) | `ENRICHLAYER_API_KEY` |
| **PDL** | `pdl.ts` | Implemented | Fallback person/company enrichment | `PEOPLEDATALABS_API_KEY` |
| **Hunter.io** | `hunter.ts` | Implemented | Email finder by name+domain, company enrichment | `HUNTER_API_KEY` |
| **Findymail** | `findymail.ts` | Implemented | Email finding and verification | `FINDYMAIL_API_KEY` |
| **NeverBounce** | `neverbounce.ts` | Fallback | Secondary email validation | `NEVERBOUNCE_API_KEY` |
| **LeadMagic** | `leadmagic.ts` | Legacy | Email validation (superseded by ZeroBounce) | `LEADMAGIC_API_KEY` |

**Usage in Cascade (per `cascade-enrichment.ts`):**
- Contact enrichment: ZeroBounce → SERP LinkedIn → Apollo → EnrichLayer → PDL
- Organization enrichment: Apollo → EnrichLayer → PDL
- Email discovery: Hunter.io, Findymail (used in AI enrichment)

### 4.2 Mapping & Location APIs

| Provider | Module | Purpose | Secret Key |
|----------|--------|---------|------------|
| **Mapbox GL** | `src/map/DashboardMap.ts` (client) | Primary interactive maps, property markers, clusters | `MAPBOX_API_KEY` |
| **Mapbox Searchbox API** | `mapbox-poi.ts` | POI enrichment, category mapping (24hr Redis cache) | `MAPBOX_API_KEY` |
| **Google Maps** | `src/map/GoogleMap.ts`, `GoogleMapCanvas.tsx` | Alternative map provider with Deck.gl overlay | `GOOGLE_MAPS_API_KEY` |
| **Google Places** | `google-places.ts` | Common name lookup (24hr Redis cache, 100ms throttle) | `GOOGLE_MAPS_API_KEY` |
| **Regrid Tiles** | `regrid.ts` | Vector parcel boundaries at `tiles.regrid.com` | `REGRID_API_KEY` |
| **Regrid Typeahead** | `regrid.ts` | Address autocomplete search | `REGRID_API_KEY` |
| **Regrid Point** | `regrid.ts`, `/api/geocode/reverse` | Parcel lookup by coordinates (reverse geocoding) | `REGRID_API_KEY` |

### 4.3 AI & Intelligence APIs

| Provider | Module | Purpose | Secret Key |
|----------|--------|---------|------------|
| **Google Gemini** | `ai-enrichment.ts` | Property classification, contact discovery, beneficial owner research (with Search Grounding) | `GOOGLE_GENAI_API_KEY` or `AI_INTEGRATIONS_GEMINI_API_KEY` |

**Model Used:** `gemini-2.0-flash` with Search Grounding enabled for real-time web search during enrichment.

### 4.4 Data Sources

County appraisal data is downloaded directly from county websites and loaded into PostgreSQL staging tables. No external data warehouse is required.

### 4.5 API Integration Summary Table

| Provider | Type | Status | Cached | Rate Limited | Files |
|----------|------|--------|--------|--------------|-------|
| Apollo.io | Enrichment | Implemented | No | No | `apollo.ts` |
| ZeroBounce | Validation | Implemented | 1hr Redis | No | `zerobounce.ts` |
| EnrichLayer | Enrichment | Implemented | No | 20 req/min | `enrichlayer.ts` |
| PDL | Enrichment | Implemented | No | No | `pdl.ts` |
| Hunter.io | Email Find | Implemented | No | No | `hunter.ts` |
| Findymail | Email Find | Implemented | No | No | `findymail.ts` |
| NeverBounce | Validation | Fallback | No | No | `neverbounce.ts` |
| LeadMagic | Validation | Legacy | No | No | `leadmagic.ts` |
| Mapbox GL/Searchbox | Maps/POI | Implemented | 24hr Redis (POI) | No | `DashboardMap.ts`, `mapbox-poi.ts` |
| Google Maps/Places | Maps/Names | Implemented | 24hr Redis (Places) | 100ms throttle | `GoogleMap.ts`, `google-places.ts` |
| Regrid | Parcels | Implemented | No | No | `regrid.ts`, `/api/geocode/reverse` |
| Gemini | AI | Implemented | No | Concurrency=5 | `ai-enrichment.ts` |
| CAD Staging | Data | Implemented | No | No | `cad/query.ts`, `dcad-ingestion.ts` |

---

## 5. Enrichment Pipeline

### 5.1 Property Enrichment Flow

```
Property Ingestion
       │
       ▼
┌──────────────────┐
│ Mapbox POI Check │ ──→ Category, Subcategory, Operational Status
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Google Places    │ ──→ Common Name (fallback)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Gemini AI        │ ──→ Classification, Ownership Research,
│ (Search Grounded)│     Contact Discovery, Management Co
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Building Class   │ ──→ A+/A/B/C/D based on quality, age, value
│ Calculation      │
└──────────────────┘
```

### 5.2 Contact Enrichment Cascade

The system uses a multi-provider cascade approach as defined in `src/lib/cascade-enrichment.ts`.

**Cascade Order:** ZeroBounce → SERP LinkedIn → Apollo → EnrichLayer → PDL

```
Input: Contact name + company domain (+ optional email)
                │
                ▼
┌───────────────────────────────────┐
│ 1. ZeroBounce Email Validation    │
│    (if email provided)            │ ──→ Validate existing email
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ 2. SERP LinkedIn Search           │
│    (name + company context)       │ ──→ Find LinkedIn profile URL
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ 3. Apollo Person Match            │ ──→ Email, phone, LinkedIn, photo
│    (name + domain)                │     Waterfall phone/email async
└─────────────────┬─────────────────┘
                  │ (if not found or incomplete)
                  ▼
┌───────────────────────────────────┐
│ 4. EnrichLayer LinkedIn Lookup    │ ──→ LinkedIn profile enrichment,
│    (from LinkedIn URL or search)  │     work email, phone
└─────────────────┬─────────────────┘
                  │ (if not found or incomplete)
                  ▼
┌───────────────────────────────────┐
│ 5. PDL Person Search              │ ──→ Email, LinkedIn, company
│    (name + domain + location)     │     (fallback provider)
└───────────────────────────────────┘
```

**Early Exit Conditions:**
- Valid email + LinkedIn URL found → Stop cascade
- Email status = "valid" from ZeroBounce → Accept email and continue for other data
- Provider tracks are stored in `enrichmentSource` field

**Provider Tracking:**
- Each enriched contact stores `providerId` and `enrichmentSource` (apollo/enrichlayer/pdl/ai)
- Raw provider responses stored in `rawEnrichmentJson` for audit/debugging

### 5.3 Organization Enrichment Cascade

```
Input: Company domain
          │
          ▼
┌─────────────────────┐
│ 1. Apollo Company   │ ──→ Name, industry, employees, social profiles
└─────────┬───────────┘
          │ (if not found)
          ▼
┌─────────────────────┐
│ 2. EnrichLayer      │ ──→ LinkedIn company data, size estimate
└─────────┬───────────┘
          │ (if not found)
          ▼
┌─────────────────────┐
│ 3. PDL Company      │ ──→ Industry, location, founding year
└─────────────────────┘
```

### 5.4 Email Validation Rules

| Status | Action |
|--------|--------|
| `valid` | Accept and store |
| `invalid` | Reject, mark invalid |
| `catch-all` | Treat as invalid (unreliable) |
| `unknown` | Store with warning flag |

**Personal Email Handling:** If email domain is a personal provider (gmail, yahoo, etc.), trigger additional business email enrichment.

---

## 6. Authentication & Authorization

### 6.1 Clerk Authentication

- **Provider:** Clerk SDK with Next.js proxy
- **Session:** JWT-based with Clerk middleware
- **Legacy Migration:** Automatic migration from old Replit Auth users

### 6.2 Role-Based Access Control

| Role | Permissions |
|------|-------------|
| `admin` | Full access, database operations, user management |
| `manager` | Team management, pipeline oversight |
| `standard_user` | Property access, contact enrichment, pipeline updates |
| `viewer` | Read-only access |

### 6.3 Organization Scoping

- Pipeline data is scoped by `clerkOrgId`
- Each org has isolated pipeline stages, notes, and activity
- Properties are shared; pipeline state is org-specific

---

## 7. Frontend Architecture

### 7.1 Page Structure

```
/app                    # Landing page
/app/dashboard          # Main property dashboard (map + list)
/app/properties/[id]    # Property detail page
/app/contacts           # Contact list
/app/contacts/[id]      # Contact detail page
/app/organizations      # Organization list
/app/organizations/[id] # Organization detail page
/app/pipeline           # Kanban pipeline board
/app/lists              # User saved lists
/app/admin/*            # Admin panels (database, enrichment, settings)
```

### 7.2 Key Components

| Component | Purpose |
|-----------|---------|
| `DashboardMap` | Mapbox GL controller with property layers |
| `GoogleMap` | Google Maps controller with Deck.gl overlay (alternative) |
| `PropertyList` | Virtualized property data grid |
| `PropertyFilters` | Category, subcategory, size, class filters |
| `PipelineBoard` | Kanban board with drag-drop |
| `ContactCard` | Contact display with enrichment actions |
| `EnrichmentQueue` | Background enrichment progress display |

### 7.3 Map Features

- **Regrid Parcel Tiles:** Vector tiles showing parcel boundaries
- **Property Markers:** Clustered markers for imported properties
- **Click Resolution:** Progressive prefix matching for parcel→property lookup
- **Search:** Mapbox Search Box with location markers
- **Tooltips:** Property info on hover (with Regrid fallback for unimported parcels)

---

## 8. Caching & Performance

### 8.1 Redis Caching (Upstash)

| Cache Type | TTL | Key Prefix |
|------------|-----|------------|
| ZeroBounce validation | 1 hour | `gf:cache:zerobounce:` |
| Mapbox POI | 24 hours | `gf:cache:mapbox_poi:` |
| Google Places | 24 hours | `gf:cache:gplaces:` |
| Rate limits | 60 seconds | `gf:ratelimit:` |
| Enrichment locks | 5 minutes | `gf:lock:` |

### 8.2 In-Memory Fallback

When Redis is unavailable, the system falls back to in-memory Maps with the same TTL logic.

### 8.3 Rate Limiting

- **Enrichment endpoints:** 20 req/min per user
- **Validation endpoints:** 100 req/min per user
- **Pattern:** Fixed window with Redis-backed counters

### 8.4 Database Optimization

- **Connection Pool:** max=20, idle timeout=30s, connect timeout=5s
- **Indexes:** On propertyKey, zip, category, enrichmentStatus
- **Cursor Pagination:** Base64 cursors for stable pagination on large datasets
- **Batch Fetching:** N+1 prevention via `inArray()` batch queries

---

## 9. Infrastructure

### 9.1 Environment

- **Platform:** Replit
- **Database:** PostgreSQL (Neon-backed, encrypted)
- **Cache:** Upstash Redis
- **Deployment:** Replit Deployments with auto-publish

### 9.2 Environment Variables

**Required Secrets:**
```
APOLLO_API_KEY
ZEROBOUNCE_API_KEY
FINDYMAIL_API_KEY
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
MAPBOX_API_KEY
REGRID_API_KEY
GOOGLE_GENAI_API_KEY (or AI_INTEGRATIONS_GEMINI_API_KEY)
DATABASE_URL (auto-populated)
```

**Optional Secrets:**
```
HUNTER_API_KEY
NEVERBOUNCE_API_KEY
ENRICHLAYER_API_KEY
PEOPLEDATALABS_API_KEY
LEADMAGIC_API_KEY
GOOGLE_MAPS_API_KEY
```

### 9.3 Workflows

| Workflow | Command | Purpose |
|----------|---------|---------|
| Start application | `npm run dev` | Run Next.js dev server on port 5000 |

---

## Appendix A: API Provider Summary

| Provider | Type | Primary Use | Cost Model |
|----------|------|-------------|------------|
| Apollo.io | Contact/Company | Person enrichment, waterfall | Credits |
| ZeroBounce | Email | Primary validation | Credits |
| NeverBounce | Email | Fallback validation | Credits |
| Findymail | Email | Email discovery | Credits |
| Hunter.io | Email/Company | Email finder | Credits |
| EnrichLayer | Contact | LinkedIn enrichment | Credits |
| PDL | Contact/Company | Fallback enrichment | Credits |
| Mapbox | Maps | Tiles, POI, search | API calls |
| Regrid | Parcel Data | Tiles, typeahead | API calls |
| Google Places | Location | Common names | API calls |
| Google Gemini | AI | Classification, research | Tokens |
| CAD Staging | Data | County appraisal data (local PostgreSQL) | N/A |

---

## Appendix B: Data Model Relationships

```
┌──────────────────────────────────────────────────────────────────┐
│                         PROPERTIES                                │
│  (physical commercial properties)                                 │
└──────────────┬───────────────────────────────────┬───────────────┘
               │                                   │
    property_contacts                    property_organizations
               │                                   │
               ▼                                   ▼
┌──────────────────────┐                ┌──────────────────────┐
│       CONTACTS       │                │    ORGANIZATIONS     │
│  (people)            │                │  (companies)         │
└──────────┬───────────┘                └───────────┬──────────┘
           │                                        │
           └──────── contact_organizations ─────────┘
                         (employment)
```

---

## Appendix C: Pipeline Status Flow

```
NEW → QUALIFIED → ATTEMPTED_CONTACT → ACTIVE_OPPORTUNITY → WON
  │                                                         │
  └──────────────────────────────────────────────────────────┘
                              │
                    DISQUALIFIED (reversible)
                              │
                           LOST
```
