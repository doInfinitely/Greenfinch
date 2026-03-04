# greenfinch.ai - System Architecture & Data Pipeline

> Technical reference for engineers inheriting or extending the greenfinch.ai platform.
> Last updated: March 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Ingestion Pipeline](#2-data-ingestion-pipeline)
3. [Property Classification](#3-property-classification)
4. [AI Enrichment Pipeline](#4-ai-enrichment-pipeline)
5. [Contact Discovery & Cascade Enrichment](#5-contact-discovery--cascade-enrichment)
6. [Organization Resolution & Linking](#6-organization-resolution--linking)
7. [Email & Domain Validation](#7-email--domain-validation)
8. [Deduplication & Data Quality](#8-deduplication--data-quality)
9. [Job Change Detection](#9-job-change-detection)
10. [Queue Infrastructure & Rate Limiting](#10-queue-infrastructure--rate-limiting)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Pipeline Management (CRM)](#12-pipeline-management-crm)
13. [Frontend Architecture](#13-frontend-architecture)
14. [External Services Reference](#14-external-services-reference)
15. [Key Files Reference](#15-key-files-reference)

---

## 1. System Overview

greenfinch.ai is an AI-native commercial real estate prospecting CRM. It ingests property tax assessment data from the Dallas Central Appraisal District (DCAD) via Snowflake, enriches it with AI-driven research using Google Gemini, validates and discovers contact information through a multi-provider cascade, and presents everything through an interactive map-based dashboard.

### High-Level Data Flow

```
Snowflake (DCAD + Regrid)
    │
    ▼
┌─────────────────────┐
│  Data Ingestion      │  Filter by SPTD code, resolve parent parcels,
│  (dcad-ingestion.ts) │  upsert to PostgreSQL
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  AI Enrichment       │  3-stage Gemini pipeline:
│  (ai/pipeline.ts)    │  Classify → Ownership → Contacts
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Save & Resolve      │  Create/link orgs, save contacts,
│  (enrichment-queue)  │  deduplicate records
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Cascade Enrichment  │  5-stage provider waterfall:
│  (cascade-enrich)    │  PDL → Crustdata → Findymail → SERP → Validate
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Job Change Detection│  Compare AI employer vs. cascade employer,
│  & Role Verification │  flag stale relationships
└────────┬────────────┘
         │
         ▼
    PostgreSQL (Neon)
    + Redis (Upstash)
         │
         ▼
    Next.js Frontend
    (Map, Detail, CRM)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Database | PostgreSQL (Neon) via Drizzle ORM |
| Cache/Queue | Upstash Redis, BullMQ |
| AI | Google Gemini (2.0 Flash/Pro) via Vertex AI |
| Auth | Clerk (organization-scoped, RBAC) |
| Maps | Mapbox GL JS |
| Styling | Tailwind CSS v3, shadcn/ui |
| Runtime | Node.js 20 |

---

## 2. Data Ingestion Pipeline

### Source Data

Properties are sourced from two datasets joined in Snowflake:

**DCAD Tables (2025 Dataset):**
- `ACCOUNT_INFO` (ai): Core account metadata, `GIS_PARCEL_ID`, owner names
- `ACCOUNT_APPRL_YEAR` (aa): Appraisal values, `SPTD_CODE` (property classification)
- `COM_DETAIL` (cd): Granular building details (sqft, year built, quality/condition grades, HVAC)
- `TAXABLE_OBJECT` (tob): Junction between accounts and building details
- `LAND` (l): Lot dimensions, front footage

**Regrid Tables:**
- `TX_DALLAS` from the Nationwide Parcel Data schema: GIS coordinates (`lat`, `lon`), parcel geometry, `ll_uuid`

### Ingestion Process

The ingestion is orchestrated by `runMultiZipIngestion()` in `src/lib/dcad-ingestion.ts`:

1. **Query Snowflake**: For each target ZIP code, execute a complex JOIN across DCAD + Regrid tables, filtered to `INCLUDED_SPTD_CODES` (commercial/multifamily/industrial only).

2. **Aggregate Buildings**: A single tax account (parcel) may have multiple buildings. Snowflake's `ARRAY_AGG` + `OBJECT_CONSTRUCT` groups building details from `COM_DETAIL` into a JSON array per account.

3. **Extract Characteristics**:
   - **Square Footage**: Priority hierarchy: `dcad_land` > `regrid` for lots; `dcad_com_detail` (Net Lease Area) > `regrid` for buildings
   - **Building Class**: Calculated via `calculateBuildingClass()` from quality grade, condition grade, year built, and appraised values
   - **HVAC**: Primary AC/heating type identified by largest building area on the parcel

4. **Upsert to PostgreSQL**: Properties are inserted/updated in the `properties` table using `property_key` (the DCAD account number) as the unique identifier.

### Parent Property Resolution (GIS_PARCEL_ID)

Complex commercial sites often span multiple DCAD tax accounts on a single physical parcel. The system aggregates these using `GIS_PARCEL_ID`:

1. **Group by GIS_PARCEL_ID**: All accounts sharing the same `GIS_PARCEL_ID` are grouped together.
2. **Identify Parent**: The account where `ACCOUNT_NUM === GIS_PARCEL_ID` is designated the parent. It gets `is_parent_property = true`.
3. **Link Constituents**: Child accounts store the parent's key in `parent_property_key`. The parent stores the list of children in `constituent_account_nums`.
4. **Missing Parent Fetch**: If a constituent is ingested but its parent wasn't in the ZIP code batch, `ingestParentAccounts()` specifically fetches and ingests the missing parent from Snowflake.
5. **Parcel Number Mapping**: `buildParcelnumbMapping()` populates the `parcelnumb_mapping` table, which maps any DCAD account number to its `gis_parcel_id` and resolved `parent_property_key`. This enables fast lookups when a user clicks a parcel on the Mapbox map.

### Key Files
- `src/lib/dcad-ingestion.ts` - Ingestion orchestrator
- `src/lib/snowflake.ts` - Snowflake connection and query builder
- `src/lib/building-class.ts` - Building class calculation
- `src/lib/property-classifications.ts` - SPTD code definitions and inclusion rules
- `src/app/api/admin/ingest/route.ts` - Admin API endpoint for triggering ingestion

---

## 3. Property Classification

### SPTD Codes

SPTD (State Property Tax Division) codes are Texas Comptroller classification codes indicating a property's primary use:

| Code | Description | Included? |
|------|------------|-----------|
| `F10` | Commercial Improvements | Yes |
| `F20` | Industrial Improvements | Yes |
| `B11` | Apartments (5+ units) | Yes |
| `A11` | Single Family Residences | No |
| `A12`-`A20` | Other Residential | No |
| `B12` | Duplexes | No |
| `C11`-`C14` | Vacant Land | No |

Only properties with `INCLUDED_SPTD_CODES` are ingested and enriched.

### Two-Tier Taxonomy

After ingestion, properties receive fine-grained classification through the AI pipeline:

**Top-Level Categories:**
- Multifamily, Office, Retail, Industrial, Hospitality, Healthcare, Mixed Use, Special Purpose

**Example Subcategories:**
- Multifamily: Apartment Complex, Senior Living, Student Housing
- Retail: Shopping Center, Restaurant/Food Service, Standalone Retail
- Industrial: Warehouse/Distribution, Manufacturing, Self-Storage, Data Center

### Classification Pipeline

1. **Ingestion (Rule-Based)**: SPTD codes bucket properties into broad groups: `commercial`, `industrial`, or `multifamily`.
2. **AI Enrichment (Stage 1)**: Gemini verifies and refines the classification using web search, assigning a specific `category` + `subcategory` from the `ASSET_CATEGORIES` taxonomy.
3. **Property Class (Hybrid)**: Initial estimate from DCAD quality grades (Excellent→A, Good→B, etc.), then AI can override based on web research showing recent renovations or changes.

### Key Files
- `src/lib/property-classifications.ts` - SPTD code mappings and inclusion rules
- `src/lib/constants.ts` - `ASSET_CATEGORIES` taxonomy
- `src/lib/building-class.ts` - Quality grade to building class calculation
- `src/lib/ai/stages/classify.ts` - AI classification logic

---

## 4. AI Enrichment Pipeline

The AI enrichment pipeline is a 3-stage sequential process using Google Gemini with search grounding. It is orchestrated by `src/lib/ai/pipeline.ts` and uses checkpoint-based resumption — if a stage fails, the pipeline can restart from the point of failure.

### Stage 1: Classify & Verify

**File**: `src/lib/ai/stages/classify.ts`

**Goal**: Verify physical attributes (name, address, sqft, acreage) and assign a category/subcategory from the taxonomy.

**Process**:
- Sends raw DCAD/Snowflake data (address, owner, quality grade) to Gemini with Google Search grounding
- Gemini searches the web to verify current property details
- Returns: property name, canonical address, category, subcategory, property class, physical measurements
- Fallback: If AI can't determine property class, falls back to DCAD quality grade mapping

### Stage 2: Ownership & Management

**File**: `src/lib/ai/stages/ownership.ts`

**Goal**: Identify the beneficial owner (the real entity behind the deed LLC), the property management company, a property marketing website, and a phone number.

**Process**:
- Prompt explicitly warns Gemini that the deed owner and PM company are usually different entities
- Uses search grounding to trace LLC ownership chains and find marketing websites
- Post-AI validation cascade:
  1. **PDL Company Enrich**: Authoritative domain lookup for identified companies
  2. **DNS/Website Validation**: Checks if discovered URLs are active and relevant
  3. **Domain Retry**: If no valid domain found, triggers a dedicated Gemini call (`retryFindPropertyWebsite`)
- Name normalization: `normalizeOwnerName()` title-cases names, preserves corporate suffixes, strips AI editorial commentary

**Outputs**: Beneficial owner(s) with type classification (REIT, Private Equity, Family Office, etc.), management company(ies), property website, phone number.

### Stage 3: Contact Discovery

**File**: `src/lib/ai/stages/contacts.ts`

**Goal**: Find up to 3 key decision-makers (Property Managers, Facilities Directors, Asset Managers, Owners).

**Process**:
- Uses companies identified in Stage 2 as search targets
- Searches company websites, LinkedIn, and property listings
- Prioritizes local property-level staff over corporate executives
- Quality filters:
  - Placeholder contacts rejected (e.g., "General Manager (Open Position)")
  - Hashed LinkedIn member IDs (`ACw...`) rejected
  - Constructed emails (firstname@company.com) cleared when no grounding sources exist
  - Domain validation on all company domains and email domains

**Composite Confidence Scoring**:

Rather than relying solely on Gemini's self-assessed confidence (`rc`), the system computes a composite score:

| Signal | Weight |
|--------|--------|
| Gemini's `rc` value | 30% of rc |
| Has grounded source URL | +0.20 |
| Grounding quality (from `groundingSupports`) | +0.10 to +0.20 |
| Company matches known ownership/management entity | +0.15 |
| Has validated (non-hallucinated) email | +0.10 |

**Safety caps**:
- `NO_SOURCE_URL_CAP` (0.4): Contacts without a source URL are capped at 40%
- `COMPANY_MISMATCH_CAP` (0.5): Contacts whose company doesn't match any known entity are capped at 50%
- Floor: 0.05 (no contact ever shows 0%)

### Models & Configuration

Models are configurable per-stage via `src/lib/ai/config.ts` (driven by `runtime-config.ts`):

| Stage | Typical Model | Thinking Level |
|-------|--------------|----------------|
| Stage 1 (Classify) | Gemini 2.0 Flash | Low |
| Stage 2 (Ownership) | Gemini 2.0 Flash | Low |
| Stage 3 (Contacts) | Gemini 2.0 Flash | Medium |

All stages use `googleSearch: {}` as a grounding tool. Stages 1 and 2 also pass `latLng` coordinates to improve local search relevance.

### Retries, Timeouts, and Error Handling

- **Retries**: Each stage has configurable retry limits in `RETRIES` config. Stage 1 uses exponential backoff; Stages 2-3 use linear backoff.
- **Timeouts**: Managed by `withTimeout()` wrapper. Default HTTP timeout is 120 seconds; per-stage timeouts are configurable.
- **Checkpoints**: Failures produce an `EnrichmentStageError` containing the current `EnrichmentStageCheckpoint`. The queue saves partial progress so retries skip completed stages.

### Cost Tracking

Every Gemini API call is tracked in the `enrichment_cost_events` table via `src/lib/cost-tracker.ts`:
- Token usage: prompt, response, and thinking tokens (extracted from `usageMetadata`)
- Grounding cost: per-query pricing (varies between Gemini 2.0 and 3.0)
- Console summary: `GEMINI COST SUMMARY` printed after each property's enrichment

### Key Files
- `src/lib/ai/pipeline.ts` - Pipeline orchestrator
- `src/lib/ai/stages/classify.ts` - Stage 1
- `src/lib/ai/stages/ownership.ts` - Stage 2
- `src/lib/ai/stages/contacts.ts` - Stage 3
- `src/lib/ai/client.ts` - Gemini client, rate limiting, streaming
- `src/lib/ai/parsers.ts` - JSON extraction, grounding source/quality extraction
- `src/lib/ai/config.ts` - Model selection, temperatures, timeouts, confidence thresholds
- `src/lib/ai/types.ts` - All pipeline type definitions
- `src/lib/cost-tracker.ts` - Cost event persistence

---

## 5. Contact Discovery & Cascade Enrichment

After the AI pipeline discovers contacts (Stage 3), they go through a 5-stage cascade enrichment to validate emails, find phone numbers, discover LinkedIn profiles, and verify current employment.

### Cascade Stages

#### Stage 1: Input Validation
- Ensures the contact has a valid full name (first + last)
- If only a first name is provided, attempts PDL resolution to find the last name
- If unresolvable, pipeline stops with `insufficient_input`

#### Stage 2: Email & LinkedIn Discovery (Waterfall)
Providers are tried in sequence until an email is found:

1. **Findymail**: `findEmailByName(name, domain)` - primary email finder. Also captures LinkedIn URL if returned.
2. **Hunter.io**: `findEmailHunter(name, domain)` - fallback email finder. Results are cross-verified with Findymail for deliverability.
3. **Findymail Reverse**: `findLinkedInByEmail(email)` - if email found but no LinkedIn URL, attempts reverse lookup.

All LinkedIn URLs are validated through `validateLinkedInSlug()` to ensure the profile slug matches the contact's name.

#### Stage 3: Person Enrichment (PDL)
- **Provider**: People Data Labs
- **Method**: `enrichPersonPDL()` using name, email, domain, and location
- **Returns**: Full profile including work/personal emails, phone numbers (mobile/work), job title, seniority, company details, LinkedIn URL
- Uses likelihood-based matching. If the PDL company domain doesn't match the input domain, triggers Stage 4.

#### Stage 3.5: LinkedIn Discovery Fallback (SERP)
- **Provider**: SerpApi (Google Search)
- **Method**: Targeted search: `site:linkedin.com/in/ "Name" "Company" near "City, State"`
- Triggered only if no LinkedIn URL was found in previous stages
- Results ranked by confidence based on name and company mention in snippets

#### Stage 4: Verification (Crustdata)
- **Provider**: Crustdata
- **Method**: `enrichPersonCrustdata()` using LinkedIn URL or name+company
- **Purpose**: Real-time verification of current employment
- **Returns**: Current title, company, full employment history (`experiences` array)
- Called when PDL has no match, or when PDL domain differs from input domain

#### Stage 5: Email Validation
- **Primary**: ZeroBounce (`/validate` API)
- **Status mapping**: ZeroBounce statuses → `valid`, `invalid`, `catch-all`, `unknown`
- **Caching**: Two-tier (Redis → in-memory Map) to avoid redundant API calls
- **Fallback**: Findymail verification for cross-checking

### Result Merging
- Verified emails (Stage 2) take precedence
- PDL is the primary profile data source
- Crustdata overrides employment fields (title, company) if a job change is detected
- Raw responses (`pdlRaw`, `crustdataRaw`) preserved for audit

### Key Files
- `src/lib/cascade-enrichment.ts` - Main cascade orchestrator
- `src/lib/pdl.ts` - PDL person and company enrichment
- `src/lib/crustdata.ts` - Crustdata person enrichment
- `src/lib/findymail.ts` - Email finding, verification, reverse lookup, phone lookup
- `src/lib/hunter.ts` - Hunter.io email finding
- `src/lib/serp-linkedin.ts` - SERP-based LinkedIn discovery
- `src/lib/linkedin-validation.ts` - LinkedIn slug validation
- `src/lib/zerobounce.ts` - Email validation

---

## 6. Organization Resolution & Linking

When the AI identifies companies (owners, PMs) or the cascade enrichment discovers employer information, the system resolves them to canonical organization records.

### Resolution Process (`resolveOrganization`)

**File**: `src/lib/organization-enrichment.ts`

1. **Local Match**: Check the `organizations` table for an existing record by PDL Company ID or normalized domain.
2. **External Resolution (PDL)**: If no local match, call PDL Company Enrichment API with name, domain, and location.
3. **Cross-Reference**: If PDL returns a result, check again for a local match using the newly discovered PDL ID or website (prevents duplicates).
4. **Create/Update**: Match found → update with enriched PDL data. No match → create new organization record.
5. **Concurrency Control**: Redis locks (`org:resolve:{identifier}`) prevent duplicate creation during parallel enrichment.

### Linking Rules

**Property-Organization Links** (`property_organizations` table):
- Only ownership-stage entities create property links: beneficial owners, management companies, and additional owners/PMs identified in Stage 2.
- Each link has a `role` (e.g., `owner`, `property_manager`) and is subject to the `uq_property_org_role` unique constraint.

**Contact-Organization Links** (`contact_organizations` table):
- Contact employer companies are enriched and linked to the contact via `ensureEmployerOrgEnriched()`.
- These do NOT create `property_organizations` links — a contact's employer being enriched does not substantiate a direct property relationship.

### Organization Enrichment Cascade

Organizations themselves can be enriched through a PDL → Crustdata cascade:
- `enrichOrganizationByDomain()` triggers enrichment for a specific domain
- PDL Company API provides: description, industry, employee count, location, social handles
- Crustdata provides fallback company data

### Manual Merge

Admin tool at `/admin/merge-orgs` supports:
- **Fuzzy suggestions**: Jaccard similarity on tokenized, normalized org names (threshold 0.5+)
- **Manual search+merge**: Find any two orgs and merge them
- **Safe merge function**: `mergeOrganizationPair()` runs in a DB transaction, handles `uq_property_org_role` unique constraint conflicts by detecting and deleting duplicate links before reassignment

### Key Files
- `src/lib/organization-enrichment.ts` - Core resolution and enrichment logic
- `src/lib/enrichment-queue.ts` - `saveEnrichmentResults()` creates org links
- `src/lib/deduplication.ts` - `mergeOrganizationPair()` safe merge function
- `src/app/api/admin/merge-orgs/` - Merge API endpoints
- `src/app/admin/merge-orgs/page.tsx` - Admin merge UI

---

## 7. Email & Domain Validation

### Email Validation Providers

| Provider | Role | Notes |
|----------|------|-------|
| ZeroBounce | Primary validation | Maps to `valid`, `invalid`, `catch-all`, `unknown` |
| Findymail | Discovery + verification | Cross-checks Hunter.io results |
| LeadMagic | Legacy (archived) | Superseded by ZeroBounce |

### Domain Validation

**File**: `src/lib/domain-validator.ts`

Domain validation goes beyond DNS checks:

1. **DNS Resolution**: Verify the domain resolves and the server responds.
2. **Parking Detection**: Check against known parking domains (sedoparking.com, godaddy.com, etc.) and scan for parking indicators ("domain for sale", "related searches").
3. **Content Relevance** (property websites only):
   - Check for not-found indicators ("listing no longer available", "404 not found")
   - Extract property identifiers from name and address
   - Verify the page content mentions the property name, street name, or city
   - Reject irrelevant listings (e.g., a Trulia page for a property in a different state)
4. **Caching**: In-memory cache with 5-minute TTL to prevent redundant HTTP fetches during batch operations.

### Key Files
- `src/lib/zerobounce.ts` - ZeroBounce validation
- `src/lib/findymail.ts` - Findymail verification
- `src/lib/domain-validator.ts` - Domain validation with content relevance checking

---

## 8. Deduplication & Data Quality

### Contact Deduplication

**File**: `src/lib/deduplication.ts`

The system uses a two-tier approach:

**Auto-Merge (High Confidence)**:
- Matching `normalizedEmail` (case-insensitive, trimmed)
- Matching LinkedIn profile slug (extracted from URL)
- Matching Crustdata Person ID

**Potential Duplicate (Admin Review)**:
- Same `normalizedName` + `normalizedDomain` → flagged in `potential_duplicates` table
- Same `normalizedName` + `employerName` → flagged for review

**Merge Priority** (which record to keep):
1. Records with `emailValidationStatus === 'valid'` preferred
2. Records with an Apollo `providerId` preferred
3. Most recently enriched record wins

**Merge Process** (`mergeContacts`):
- Reassigns all FK references: `propertyContacts`, `contactOrganizations`, `listItems`, `contactLinkedinFlags`, `dataIssues`
- Handles unique constraint conflicts by deleting duplicate links
- Deletes the merged contact record

### Name Normalization

**File**: `src/lib/normalization.ts`

`normalizeOwnerName()` processes raw names from DCAD and AI:
- Title-cases words while preserving corporate suffixes (LLC, LP, Inc)
- Strips AI editorial commentary (e.g., "Company Name (manages the property)")
- Prevents raw DCAD all-caps names from being stored

### Data Quality Filters

- **Placeholder Contacts**: Rejected during Stage 3 parsing (e.g., "General Manager (Open Position)", "TBD", "Vacant")
- **Hashed LinkedIn IDs**: `ACw...` member IDs from PDL Free plan are rejected by `validateLinkedInSlug()` so the cascade tries to find real profile URLs
- **Constructed Emails**: `firstname@company.com` patterns cleared when no grounding sources exist (likely AI hallucination)

### Key Files
- `src/lib/deduplication.ts` - Auto-merge, potential duplicate flagging, merge functions
- `src/lib/normalization.ts` - Name normalization
- `src/lib/linkedin-validation.ts` - LinkedIn slug validation

---

## 9. Job Change Detection

### How It Works

After cascade enrichment discovers a contact's current employment (via PDL/Crustdata), the system compares it against the AI-identified employer:

**File**: `src/lib/enrichment-queue.ts` (role verification section)

1. **Compare Companies**: Check if the cascade-enriched company name/domain matches the AI-identified company.
2. **Escape Hatches** (prevent false positives):
   - **Affiliated companies**: `areCompaniesAffiliated()` checks for parent/subsidiary relationships
   - **Volunteer/board roles**: PDL titles containing "volunteer", "board member", "trustee" are skipped
   - **Title match**: If the enriched title matches the existing title, PDL company may be a parent/subsidiary
   - **Crustdata employment history**: Explicitly checks if the AI company appears in `past_employers`
3. **Flag**: If a genuine mismatch is detected, `property_contacts.relationshipStatus` is set to `job_change_detected` with a detailed reason.
4. **Replacement Search**: Optionally triggers an AI-powered search for a replacement contact at the property.

### UI Display

Contacts with `relationshipStatus === 'job_change_detected'` or `'former'` display:
- "May have changed jobs" badge (amber)
- Dimmed appearance in the contacts list
- The `relationshipStatusReason` is available on the contact detail page

### Key Files
- `src/lib/enrichment-queue.ts` - Job change detection logic (search for `jobChangeDetected`)
- `src/lib/ai/stages/misc.ts` - Replacement contact search
- `src/components/property/ContactsSection.tsx` - UI badge rendering

---

## 10. Queue Infrastructure & Rate Limiting

### BullMQ Queue

**File**: `src/lib/bullmq-enrichment.ts`

- Queue name: `gf-enrichment`
- Backed by Upstash Redis
- Exponential backoff: 5s initial delay, up to 3 attempts
- Lock duration: 600s (accommodates long-running AI operations)
- Batch tracking: Progress, success/failure counts stored in Redis under `gf:batch:[id]`

**Fallback**: If Redis is not fully configured for BullMQ, the system falls back to a wave-based in-memory processing system in `src/lib/enrichment-queue.ts`.

### Rate Limiting

**File**: `src/lib/rate-limiter.ts`

Each external service has a `ServiceRateLimiter` combining:
- **Token Bucket**: Per-minute rate limiting
- **p-limit**: Concurrency limiting
- **Circuit Breaker**: Monitors for failures (429s, 5xx, timeouts)
  - `OPEN` state: Immediately fails requests for `resetTimeoutMs`
  - `HALF_OPEN`: Tests if service recovered before closing

| Service | Rate Limit | Concurrency |
|---------|-----------|-------------|
| Gemini | 200/min | 15 |
| PDL | 90/min | 30 |
| Crustdata | 14/min | 5 |

### Adaptive Concurrency

The enrichment queue features an `AdaptiveConcurrencyController` that dynamically adjusts concurrency based on real-time success/failure rates of jobs.

### Cross-Tab Sync (Frontend)

**File**: `src/contexts/EnrichmentQueueContext.tsx`

Uses the Web BroadcastChannel API (`greenfinch_enrichment_queue` channel) to synchronize enrichment queue state across browser tabs without redundant polling.

### Key Files
- `src/lib/bullmq-enrichment.ts` - Production queue
- `src/lib/enrichment-queue.ts` - Fallback queue, result saving, adaptive concurrency
- `src/lib/rate-limiter.ts` - Token bucket, circuit breaker
- `src/lib/redis.ts` - Upstash Redis abstraction
- `src/contexts/EnrichmentQueueContext.tsx` - Frontend queue state

---

## 11. Authentication & Authorization

### Clerk Integration

**File**: `src/lib/auth.ts`

- **Middleware** (`middleware.ts`): Uses `clerkMiddleware` to protect routes. `/dashboard`, `/property`, `/admin` routes require authentication.
- **User Sync**: `getOrCreateUser()` bridges Clerk and the internal PostgreSQL `users` table. On login, checks for matching `clerkId`, attempts email-based migration, or creates a new record.
- **Service Provider Linking**: During user creation, the email domain is checked against the `service_providers` table for auto-linking.

### Roles

| Role | Access Level |
|------|-------------|
| `standard_user` | View and manage properties/contacts |
| `team_manager` | Middle-tier management |
| `account_admin` | Administrative access for their organization |
| `system_admin` | Full global access (internal Greenfinch admins) |

### Permissions

**File**: `src/lib/permissions.ts`

Permissions are mapped to Clerk organization roles:
- `org:admin`: Full access including `admin:ingest`, `admin:enrich`, `data:export`
- `org:member`: Read/write for properties, contacts, lists. No admin or export.

Internal admin access (Greenfinch team) is controlled by checking membership in the `greenfinch` organization slug with `org:admin` role.

### Key Files
- `src/lib/auth.ts` - Authentication helpers, user sync, role checking
- `src/lib/permissions.ts` - Permission definitions
- `middleware.ts` - Route protection
- `src/components/PermissionGate.tsx` - Client-side RBAC component

---

## 12. Pipeline Management (CRM)

The pipeline system tracks the sales lifecycle of properties, scoped per organization.

### Pipeline Stages

| # | Stage | Description |
|---|-------|-------------|
| 1 | `new` | Freshly discovered, not yet worked |
| 2 | `qualified` | Meets criteria; deal value assigned |
| 3 | `attempted_contact` | Outreach begun (phone, email, LinkedIn) |
| 4 | `active_opportunity` | Two-way communication established |
| 5 | `won` | Deal closed; property owner is a customer |
| 6 | `lost` | Sales process ended without deal (requires `lost_reason`) |
| 7 | `disqualified` | Property found to be a poor fit (reversible) |

### Data Model

**`property_pipeline` table**:
- Links `propertyId` to `clerkOrgId` (each organization tracks the same physical property independently)
- Tracks: `status`, `ownerId` (assigned rep), `dealValue`, `statusChangedAt`

**`pipeline_stage_history` table**:
- Records every stage transition: `fromStage`, `toStage`, `durationInStageMs`
- Enables sales velocity reporting

**`property_activity` table**:
- Audit trail of all property interactions (views, notes, enrichments, stage changes)

### Key Files
- `src/lib/schema.ts` - `PIPELINE_STATUSES`, `property_pipeline`, `pipeline_stage_history`
- `src/app/pipeline/` - Pipeline dashboard and Kanban board
- `src/app/api/properties/[id]/pipeline/route.ts` - Pipeline API

---

## 13. Frontend Architecture

### App Structure (Next.js App Router)

```
src/app/
├── page.tsx                    # Landing page
├── pricing/, product/, faq/    # Marketing pages
├── sign-in/, sign-up/          # Clerk auth pages
├── dashboard/
│   ├── map/page.tsx            # Interactive map (primary exploration)
│   └── list/page.tsx           # Tabular property view
├── property/[id]/page.tsx      # Property detail
├── contacts/page.tsx           # Contact list (CRM)
├── contact/[id]/page.tsx       # Contact profile
├── organizations/              # Organization management
├── pipeline/                   # Sales pipeline (Kanban + dashboard)
├── admin/                      # Admin tools
│   ├── page.tsx                # Data admin dashboard
│   ├── ai-config/              # AI model configuration
│   ├── database/               # Ingestion settings
│   ├── costs/                  # API cost tracking
│   ├── merge-contacts/         # Contact dedup admin
│   ├── merge-orgs/             # Organization merge admin
│   ├── merge-properties/       # Property merge admin
│   └── vertex-logs/            # Gemini debug logs
└── api/                        # Route Handlers
    ├── properties/             # Property CRUD, search, geojson
    ├── contacts/               # Contact CRUD, enrichment
    ├── organizations/          # Org search
    ├── admin/                  # Ingestion, batch enrichment, merge
    └── tiles/regrid/           # Map tile proxy
```

### Key UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DashboardMap` | `src/map/DashboardMap.ts` | Mapbox GL map implementation |
| `MapSearchBar` | `src/components/MapSearchBar.tsx` | Address/property search |
| `PropertyFilters` | `src/components/PropertyFilters.tsx` | Server-side filtering |
| `PropertyHeader` | `src/components/property/PropertyHeader.tsx` | Property detail header |
| `ContactsSection` | `src/components/property/ContactsSection.tsx` | Property contacts list |
| `OwnershipSection` | `src/components/property/OwnershipSection.tsx` | Owner/management display |
| `AppSidebar` | `src/components/AppSidebar.tsx` | Main navigation |
| `PermissionGate` | `src/components/PermissionGate.tsx` | Role-based UI gating |

### Design Constraints
- **Light mode only**: Dark mode fully disabled. `tailwind.config.ts` has `darkMode: "class"` but `layout.tsx` force-removes `dark` class.
- **No confirmation dialogs** for paid API calls (execute immediately).
- **Simple error messages**: No internal provider names or technical details exposed to users.

---

## 14. External Services Reference

| Service | Purpose | Key File | Rate Limit |
|---------|---------|----------|------------|
| **Snowflake** | DCAD + Regrid data source | `src/lib/snowflake.ts` | N/A |
| **Google Gemini** | AI enrichment (3 stages) | `src/lib/ai/client.ts` | 200/min, 15 concurrent |
| **People Data Labs** | Person + company enrichment | `src/lib/pdl.ts` | 90/min, 30 concurrent |
| **Crustdata** | Employment verification | `src/lib/crustdata.ts` | 14/min, 5 concurrent |
| **Findymail** | Email finding, verification, reverse lookup, phone | `src/lib/findymail.ts` | - |
| **Hunter.io** | Email finding, org domain enrichment | `src/lib/hunter.ts` | - |
| **ZeroBounce** | Email validation | `src/lib/zerobounce.ts` | - |
| **SerpApi** | Google search for LinkedIn profiles | `src/lib/serp-linkedin.ts` | - |
| **Apollo.io** | People Match API for contact creation | `src/lib/apollo.ts` | - |
| **Mapbox** | Interactive maps, geocoding | `src/map/DashboardMap.ts` | - |
| **Clerk** | Auth, org management, RBAC | `src/lib/auth.ts` | - |
| **Upstash Redis** | Caching, locking, rate limiting, queues | `src/lib/redis.ts` | - |
| **Logo.dev** | Company logos | - | - |
| **Google Street View** | Property street-level imagery | Street view API | - |

---

## 15. Key Files Reference

### Data Pipeline
| File | Purpose |
|------|---------|
| `src/lib/dcad-ingestion.ts` | Snowflake ingestion orchestrator |
| `src/lib/snowflake.ts` | Snowflake connection and queries |
| `src/lib/property-classifications.ts` | SPTD codes and inclusion rules |
| `src/lib/building-class.ts` | Building class calculation |

### AI Enrichment
| File | Purpose |
|------|---------|
| `src/lib/ai/pipeline.ts` | 3-stage pipeline orchestrator |
| `src/lib/ai/stages/classify.ts` | Stage 1: Classification |
| `src/lib/ai/stages/ownership.ts` | Stage 2: Ownership |
| `src/lib/ai/stages/contacts.ts` | Stage 3: Contacts |
| `src/lib/ai/client.ts` | Gemini client, streaming, rate limiting |
| `src/lib/ai/parsers.ts` | Response parsing, grounding extraction |
| `src/lib/ai/config.ts` | Models, temperatures, thresholds |
| `src/lib/ai/types.ts` | Type definitions |

### Contact Enrichment
| File | Purpose |
|------|---------|
| `src/lib/cascade-enrichment.ts` | 5-stage cascade orchestrator |
| `src/lib/pdl.ts` | PDL person/company enrichment |
| `src/lib/crustdata.ts` | Crustdata verification |
| `src/lib/findymail.ts` | Email finding/verification |
| `src/lib/hunter.ts` | Hunter.io email finding |
| `src/lib/serp-linkedin.ts` | SERP LinkedIn discovery |
| `src/lib/zerobounce.ts` | Email validation |

### Data Quality
| File | Purpose |
|------|---------|
| `src/lib/deduplication.ts` | Contact/org dedup and merge |
| `src/lib/normalization.ts` | Name normalization |
| `src/lib/domain-validator.ts` | Domain/website validation |
| `src/lib/linkedin-validation.ts` | LinkedIn slug validation |
| `src/lib/organization-enrichment.ts` | Org resolution and enrichment |

### Infrastructure
| File | Purpose |
|------|---------|
| `src/lib/enrichment-queue.ts` | Queue management, result saving, job change detection |
| `src/lib/bullmq-enrichment.ts` | BullMQ production queue |
| `src/lib/rate-limiter.ts` | Rate limiting and circuit breaking |
| `src/lib/redis.ts` | Redis abstraction |
| `src/lib/cost-tracker.ts` | API cost tracking |
| `src/lib/schema.ts` | Database schema (Drizzle ORM) |
| `src/lib/db.ts` | Database connection |

### Auth & Permissions
| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | Clerk integration, user sync, role checking |
| `src/lib/permissions.ts` | Permission definitions |
| `middleware.ts` | Route protection |
