# Greenfinch.ai -- Comprehensive Project Report

**Prepared:** March 6, 2026
**Repository:** `Greenfinchai-v0`
**Branch:** `main`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Timeline & Milestones](#2-project-timeline--milestones)
3. [Architecture Overview](#3-architecture-overview)
4. [Technology Stack](#4-technology-stack)
5. [Data Model](#5-data-model)
6. [Feature Inventory](#6-feature-inventory)
7. [AI / Enrichment Pipeline (Core IP)](#7-ai--enrichment-pipeline-core-ip)
8. [External Integrations](#8-external-integrations)
9. [Codebase Statistics](#9-codebase-statistics)
10. [Recent Work -- March 2026 Enrichment Refactor](#10-recent-work----march-2026-enrichment-refactor)
11. [Current State & Next Steps](#11-current-state--next-steps)

---

## 1. Executive Summary

Greenfinch.ai is a **commercial real estate (CRE) prospecting platform** that gives sales representatives property intelligence and validated contact information for decision-makers at commercial properties. The platform:

- **Ingests** property and parcel data from county appraisal districts (DCAD and others) and Regrid parcel APIs
- **Enriches** each property through a multi-stage AI pipeline that classifies the asset, discovers ownership/management structures, and identifies decision-maker contacts
- **Validates** contacts through a cascade enrichment pipeline using multiple data providers (PDL, Hunter, Findymail, SerpAPI, browser-use)
- **Presents** results through an interactive map view, list view, CRM pipeline board, and detailed property/contact pages
- **Supports** multi-tenant organizations with Clerk-based authentication, role-based permissions, and team management

The codebase comprises **280 TypeScript files** totaling **64,225 lines of code**, with **89 API routes**, **37 pages**, and **38 database tables**. Development began on **January 14, 2026** and has progressed through **1,335 commits** over approximately 8 weeks.

---

## 2. Project Timeline & Milestones

### Development Window

| Metric | Value |
|--------|-------|
| **First Commit** | January 14, 2026 |
| **Latest Commit** | March 6, 2026 |
| **Total Duration** | ~51 days |
| **Total Commits** | 1,335 |
| **Total Insertions** | 495,208 lines |
| **Total Deletions** | 363,791 lines |
| **Net Lines Written** | ~131,417 lines |

### Monthly Commit Breakdown

| Month | Commits | Focus |
|-------|---------|-------|
| January 2026 | 595 | Foundation, data ingestion, initial AI pipeline, map UI |
| February 2026 | 723 | Enrichment cascade, admin tools, pipeline/CRM, cost tracking |
| March 2026 | 17 | Multi-LLM refactor, enrichment V2 pipeline, data quality |

### Busiest Development Days

| Date | Commits | Notes |
|------|---------|-------|
| Jan 30 | 120 | Deduplication, enrichment queue improvements |
| Feb 1 | 116 | Batch enrichment, circuit breakers |
| Jan 25 | 107 | LinkedIn search, mobile responsiveness |
| Feb 20 | 94 | Admin tools, pipeline UI |
| Jan 31 | 70 | Domain validation, cost tracking |
| Feb 19 | 69 | Street view, model configuration |
| Feb 18 | 68 | AI config UI, admin pages |

### Contributors

| Contributor | Commits |
|-------------|---------|
| greenfinch | 1,329 |
| cory-greenfinch | 5 |
| Remy Ochei | 1 |

### Key Milestones (Chronological)

| Date | Milestone |
|------|-----------|
| Jan 14 | Initial commit; Next.js project scaffolded |
| Jan 14 | Gemini AI integrated for property research |
| Jan 15 | Snowflake data ingestion pipeline connected |
| Jan 21 | Google Places API for location search |
| Jan 22 | Organization roles and ownership types defined |
| Jan 22 | LinkedIn profile search via Gemini |
| Jan 25 | Google Street View integration |
| Jan 25 | AI-powered building/lot square footage overrides |
| Jan 26 | Mobile responsiveness across application |
| Jan 30 | Duplicate contact prevention and cleanup |
| Jan 31 | Enrichment queue management and Redis integration |
| Feb 1 | Circuit breaker pattern for external API resilience |
| Feb 1 | AI enrichment code organized into modular stages |
| Feb 2 | Cost tracking for AI enrichment per property |
| Feb 3 | Batch enrichment with checkpoint-based resumption |
| Feb 17 | Vertex AI debug logs viewer |
| Feb 18 | Admin AI configuration page (runtime model switching) |
| Feb 19 | Organizations admin page |
| Feb 20 | Pipeline (Kanban) board for property prospecting |
| Feb 22 | Contact version history and enrichment comparison |
| Feb 23 | Notification system |
| Feb 24 | Street view with geocoding for accuracy |
| Mar 1 | AI prompt improvements for deed owners |
| Mar 2 | Website validation and organization linking improvements |
| Mar 3 | Admin merge tools for duplicate orgs |
| Mar 4 | System architecture documentation |
| Mar 5 | Grounding data storage and display; property status badges |
| Mar 6 | **Multi-LLM enrichment pipeline** (SerpAPI + browser-use) |

---

## 3. Architecture Overview

### High-Level System Diagram

```
 DATA SOURCES                    PROCESSING LAYER                   PRESENTATION LAYER
+------------------+       +----------------------------+       +----------------------+
| County Appraisal |       |   AI Enrichment Pipeline   |       |   Map View           |
| Districts (DCAD, |------>|   (3-Stage Orchestrator)   |------>|   (Mapbox / Google)  |
| Tarrant, etc.)   |       |                            |       +----------------------+
+------------------+       |  Stage 1: Classification   |       +----------------------+
                           |  Stage 2: Ownership        |       |   List View          |
+------------------+       |  Stage 3: Contacts         |       |   (Data Grid)        |
| Regrid Parcel    |------>|                            |------>+----------------------+
| APIs             |       +----------------------------+       +----------------------+
+------------------+              |          |                  |   Pipeline Board     |
                                  v          v                  |   (Kanban CRM)       |
                    +------------------+  +------------------+  +----------------------+
                    | Cascade          |  | Cascade          |  +----------------------+
                    | Enrichment V1    |  | Enrichment V2    |  |   Contact Detail     |
                    | (PDL/Crustdata)  |  | (SerpAPI/browser |  |   Property Detail    |
                    +------------------+  |  -use)           |  +----------------------+
                           |              +------------------+  +----------------------+
                           v                       |            |   Admin Panel        |
                    +----------------------------+  |            |   (AI Config, Merge, |
                    |      PostgreSQL (Neon)      |<+            |    Costs, Database)  |
                    |   38 tables via Drizzle ORM |             +----------------------+
                    +----------------------------+
                           |
                    +----------------------------+
                    |      Upstash Redis          |
                    |   Queue state, checkpoints, |
                    |   caching, locks            |
                    +----------------------------+
```

### Application Architecture

```
src/
  app/                          # Next.js 16 App Router
    api/                        # 89 API route handlers
      admin/                    # Admin-only endpoints (ingest, enrich, merge, config)
      properties/               # Property CRUD, GeoJSON, filtering, search
      contacts/                 # Contact CRUD, enrichment, LinkedIn, waterfall
      organizations/            # Organization CRUD, enrichment
      pipeline/                 # CRM pipeline board, activity, dashboard
      lists/                    # User-created property lists
      org/                      # Team management, invitations
      ...
    [pages]/                    # 37 page components
      dashboard/                # Map + List views
      property/[id]/            # Property detail
      contact/[id]/             # Contact detail
      pipeline/                 # Kanban board + dashboard
      admin/                    # Admin panel (10 sub-pages)
      ...
  components/                   # 57 React components
    ui/                         # 17 shadcn/ui primitives
    property/                   # Property-specific components (7)
    contact/                    # Contact-specific components (4)
    icons/                      # Custom icons
    ...                         # Shared components (29)
  lib/                          # Core business logic
    ai/                         # AI enrichment pipeline
      llm/                      # Multi-LLM abstraction layer
      stages/                   # Pipeline stages (classify, ownership, contacts)
    cad/                        # County appraisal data modules
    [45+ service modules]       # Enrichment, validation, dedup, etc.
```

---

## 4. Technology Stack

### Core Framework

| Layer | Technology | Notes |
|-------|------------|-------|
| **Framework** | Next.js 16 (App Router) | React 18, server/client components |
| **Language** | TypeScript 5.6.3 | Strict mode |
| **Runtime** | Node.js 20 | ES modules |
| **Database** | PostgreSQL (Neon) | Via Drizzle ORM |
| **ORM** | Drizzle ORM 0.39 | Schema-first, type-safe |
| **Styling** | Tailwind CSS 3.4 | With tailwindcss-animate |
| **Auth** | Clerk | SSO, org management, RBAC |
| **Caching** | Upstash Redis / ioredis | Queue state, locks, API cache |
| **Queue** | BullMQ | Background enrichment jobs |
| **Validation** | Zod 3.25 | Runtime schema validation |

### AI & LLM

| Provider | SDK | Usage |
|----------|-----|-------|
| **Google Gemini** | `@google/genai` 1.36 | Primary LLM (all 3 pipeline stages) |
| **OpenAI** | `openai` 6.16 | Alternative LLM provider |
| **Anthropic Claude** | `@anthropic-ai/sdk` 0.78 | Alternative LLM provider |
| **SerpAPI** | Custom client | Web search grounding for non-Gemini LLMs |
| **browser-use** | Custom HTTP client | Python microservice for LinkedIn scraping |

### Mapping & Geospatial

| Service | Package | Usage |
|---------|---------|-------|
| **Mapbox GL JS** | `mapbox-gl` 3.18 | Primary map renderer |
| **Google Maps** | `@googlemaps/js-api-loader` | Alternative maps, Street View, Geocoding |
| **deck.gl** | `@deck.gl/core` 9.2 | GeoJSON layers, data visualization |
| **Regrid** | Custom API client | Parcel boundary tiles |

### Data Enrichment Providers

| Provider | Module | Purpose |
|----------|--------|---------|
| **People Data Labs (PDL)** | `pdl.ts` | Person + company matching |
| **Crustdata** | `crustdata.ts` | Employment verification |
| **EnrichLayer** | `enrichlayer.ts` | Alternative company data |
| **Hunter.io** | `hunter.ts` | Email discovery |
| **Findymail** | `findymail.ts` | Email verification + discovery |
| **SerpAPI** | `serp.ts`, `serp-linkedin.ts` | Web search, LinkedIn profile search |
| **ZeroBounce** | `zerobounce.ts` | Email validation |

### UI Components

| Library | Usage |
|---------|-------|
| **Radix UI** | 22 primitives (dialog, dropdown, tabs, etc.) |
| **Lucide React** | Icon library |
| **Recharts** | Analytics dashboards |
| **Framer Motion** | Animations |
| **cmdk** | Command palette |
| **react-resizable-panels** | Split-pane layouts |
| **embla-carousel** | Carousel components |

---

## 5. Data Model

The database schema is defined in `src/lib/schema.ts` (1,315 lines) and contains **38 tables** managed by Drizzle ORM.

### Core Entity Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `properties` | Physical commercial properties | address, lat/lon, lot/bldg sqft, asset category, classification, ownership, management, DCAD data, enrichment status |
| `contacts` | People (decision-makers) | name, email, phone, title, employer, LinkedIn, PDL/Crustdata data, confidence flags |
| `organizations` | Companies/entities | name, domain, industry, employees, revenue, location, social profiles, enrichment data |
| `users` | Platform users (Clerk-linked) | email, role, organization, service provider link |
| `sessions` | Auth sessions | sid, session data, expiry |

### Relationship / Junction Tables

| Table | Relationship |
|-------|-------------|
| `property_contacts` | Property <-> Contact (with role, confidence, grounding data) |
| `property_organizations` | Property <-> Organization (with relationship type: owner/manager/tenant) |
| `contact_organizations` | Contact <-> Organization (with title, confidence) |
| `property_service_providers` | Property <-> Service Provider (with service type, status) |

### CRM & Pipeline Tables

| Table | Purpose |
|-------|---------|
| `property_pipeline` | Kanban pipeline stages per property per org |
| `pipeline_stage_history` | Stage transition audit trail |
| `property_notes` | User notes on properties |
| `property_activity` | Activity log per property |
| `property_actions` | Scheduled tasks/actions on properties |
| `property_views` | View count tracking |
| `property_flags` | User-flagged properties (with reason) |
| `user_lists` | Custom property lists |
| `list_items` | Items within lists |
| `notifications` | User notification system |

### Data Quality Tables

| Table | Purpose |
|-------|---------|
| `classification_cache` | Cached AI classification results |
| `potential_duplicates` | Flagged duplicate records for review |
| `data_issues` | Reported data quality issues |
| `contact_linkedin_flags` | Flagged incorrect LinkedIn profiles |
| `contact_snapshots` | Point-in-time contact data snapshots |
| `user_contact_versions` | User-specific contact overrides |
| `admin_audit_log` | Admin action audit trail |

### Enrichment & Cost Tables

| Table | Purpose |
|-------|---------|
| `enrichment_cost_events` | Per-call cost tracking for all providers |
| `loss_reason_codes` | Pipeline loss/rejection reasons |
| `ingestion_settings` | Admin-configurable ingestion parameters |

### County Appraisal Data (CAD) Tables

| Table | Purpose |
|-------|---------|
| `cad_downloads` | CAD file download tracking |
| `cad_account_info` | Property account details from CAD |
| `cad_appraisal_values` | Appraisal/assessment values |
| `cad_buildings` | Individual building records |
| `cad_land` | Land parcel details |

### Mapping Tables

| Table | Purpose |
|-------|---------|
| `parcel_to_property` | Maps parcel IDs to property records |
| `parcelnumb_mapping` | Maps parcel numbers across sources |
| `service_providers` | CRE service provider companies |
| `waitlist_signups` | Pre-launch waitlist |

### Entity-Relationship Summary

```
properties ----< property_contacts >---- contacts
     |                                       |
     +------< property_organizations >-- organizations --< contact_organizations >--+
     |
     +------< property_pipeline (per org)
     +------< property_notes
     +------< property_activity
     +------< property_actions
     +------< property_flags
     +------< property_views
     +------< property_service_providers >-- service_providers

users -----< notifications
  |
  +--------< user_lists ----< list_items

cad_account_info ----< cad_appraisal_values
                 ----< cad_buildings
                 ----< cad_land
```

---

## 6. Feature Inventory

### User-Facing Pages (37 total)

#### Property Discovery
| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/dashboard` | Main entry point |
| Map View | `/dashboard/map` | Interactive Mapbox map with parcel overlays, clustering, filters |
| List View | `/dashboard/list` | Sortable data grid with bulk actions |
| Property Detail | `/property/[id]` | Full property page with Street View, ownership, contacts, notes, activity |

#### Contact Management
| Page | Route | Description |
|------|-------|-------------|
| Contacts List | `/contacts` | All contacts with search, sort, bulk actions |
| Contact Detail | `/contact/[id]` | Full contact profile with enrichment data, version history |

#### Organization Views
| Page | Route | Description |
|------|-------|-------------|
| Organizations List | `/organizations` | All organizations with search |
| Organization Detail | `/organization/[id]` | Company profile with associated properties and contacts |

#### CRM Pipeline
| Page | Route | Description |
|------|-------|-------------|
| Pipeline Board | `/pipeline/board` | Kanban-style board (New Lead -> Qualified -> Contacted -> Proposal -> Won/Lost) |
| Pipeline Dashboard | `/pipeline/dashboard` | Analytics and pipeline metrics |

#### Lists & Organization
| Page | Route | Description |
|------|-------|-------------|
| My Lists | `/lists` | User-created property lists |
| List Detail | `/lists/[id]` | Individual list with items |
| Settings | `/settings` | User preferences, service provider selection |

#### Team Management
| Page | Route | Description |
|------|-------|-------------|
| Team | `/org-admin/team` | Team member management, invitations |
| Analytics | `/org-admin/analytics` | Organization-level usage analytics |

#### Admin Panel (10 pages)
| Page | Route | Description |
|------|-------|-------------|
| Admin Home | `/admin` | Dashboard with system stats, data ingestion, batch enrichment |
| AI Config | `/admin/ai-config` | Runtime LLM model/provider/temperature configuration per stage |
| Costs | `/admin/costs` | Enrichment cost tracking and analytics |
| Database | `/admin/database` | Direct database operations, export |
| Compare | `/admin/compare` | A/B enrichment pipeline comparison |
| Vertex Logs | `/admin/vertex-logs` | AI model call debug logs |
| Merge Contacts | `/admin/merge-contacts` | Duplicate contact resolution |
| Merge Orgs | `/admin/merge-orgs` | Duplicate organization resolution |
| Merge Properties | `/admin/merge-properties` | Duplicate property resolution |
| LinkedIn Overrides | `/admin/linkedin-overrides` | Manual LinkedIn URL corrections |
| Organizations | `/admin/organizations` | Clerk organization management |

#### Marketing & Public
| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Product landing page |
| Product | `/product` | Feature showcase |
| Pricing | `/pricing` | Pricing plans |
| FAQ | `/faq` | Frequently asked questions |
| Waitlist | `/waitlist` | Pre-launch signup |
| Support | `/support` | Support/help page |
| Docs | `/docs` | Documentation |

#### Auth
| Page | Route | Description |
|------|-------|-------------|
| Sign In | `/sign-in` | Clerk sign-in flow |
| Sign Up | `/sign-up` | Clerk sign-up flow |
| SSO Callbacks | `/sign-in/sso-callback`, `/sign-up/sso-callback` | SSO redirect handlers |

### API Routes (89 total)

#### Property APIs (16 routes)
- `GET /api/properties` -- List with filtering and pagination
- `GET /api/properties/[id]` -- Single property detail
- `GET /api/properties/geojson` -- GeoJSON for map rendering
- `GET /api/properties/search` -- Full-text property search
- `GET /api/properties/filter-options` -- Available filter values
- `GET /api/properties/views` -- Property view tracking
- `POST /api/properties/[id]/flag` -- Flag a property
- `POST /api/properties/[id]/notes` -- Add notes
- `GET /api/properties/[id]/activity` -- Activity log
- `POST /api/properties/[id]/actions` -- Create action items
- `POST /api/properties/[id]/pipeline` -- Pipeline stage management
- `POST /api/properties/[id]/customer` -- Mark as customer
- `GET /api/properties/[id]/geocode` -- Geocode address
- `GET /api/properties/[id]/streetview` -- Street View metadata
- `POST /api/properties/[id]/service-providers` -- Link service providers

#### Contact APIs (14 routes)
- `GET /api/contacts` -- List all contacts
- `GET /api/contacts/[id]` -- Single contact
- `POST /api/contacts/create` -- Create contact
- `GET /api/contacts/search` -- Search contacts
- `POST /api/contacts/associate` -- Link contact to property
- `POST /api/contacts/enrich` -- Trigger enrichment
- `POST /api/contacts/[id]/enrich` -- Enrich single contact
- `GET /api/contacts/[id]/versions` -- Version history
- `GET /api/contacts/[id]/linkedin` -- LinkedIn data
- `POST /api/contacts/[id]/linkedin/flag` -- Flag LinkedIn
- `GET /api/contacts/[id]/profile-photo` -- Profile photo
- `POST /api/contacts/[id]/waterfall-email` -- Waterfall email enrichment
- `POST /api/contacts/[id]/waterfall-phone` -- Waterfall phone enrichment

#### Admin APIs (26 routes)
- `POST /api/admin/ingest` -- Trigger data ingestion
- `POST /api/admin/enrich-batch` -- Start batch AI enrichment
- `GET /api/admin/enrich-status` -- Enrichment queue status
- `GET /api/admin/enrichment-costs` -- Cost analytics
- `GET /api/admin/stats` -- System statistics
- `GET /api/admin/vertex-logs` -- AI call logs
- `POST /api/admin/ai-config` -- Update AI configuration
- `POST /api/admin/merge-contacts` -- Merge duplicate contacts
- `POST /api/admin/merge-orgs` -- Merge duplicate organizations
- `POST /api/admin/merge-properties` -- Merge duplicate properties
- `GET /api/admin/potential-duplicates` -- List duplicates
- `POST /api/admin/linkedin-overrides` -- Override LinkedIn URLs
- `GET /api/admin/database` -- Database queries
- `GET /api/admin/database/export` -- Data export
- Plus organization management, comparison, and settings routes

#### Pipeline APIs (5 routes)
- `GET /api/pipeline/board` -- Pipeline board data
- `GET /api/pipeline/dashboard` -- Pipeline metrics
- `GET /api/pipeline/activity` -- Recent pipeline activity
- `PATCH /api/pipeline/[id]` -- Update pipeline stage
- `POST /api/pipeline/[id]/claim` -- Claim a pipeline item

#### Organization, List, Notification, and Other APIs (28 routes)
- Organization CRUD, enrichment, search
- User list management
- Notification system
- Team member management and invitations
- Waitlist, health check, typeahead, brand lookup
- Parcel resolution, Regrid tile proxy
- Webhook handlers (Apollo)
- User settings and auth

### UI Components (57 total)

#### Property Components (7)
- `ContactsSection` -- Contact list within property detail
- `OwnershipSection` -- Ownership and management display
- `PropertyAbout` -- Property description and details
- `PropertyHeader` -- Title, address, badges
- `PropertyStats` -- Key metrics (sqft, value, class)
- `GroundingDetail` -- AI grounding source display
- `FlagDialog` / `ServiceProviderDialog` -- Action dialogs

#### Contact Components (4)
- `ContactHeader` -- Name, photo, title
- `ContactInfo` -- Email, phone, LinkedIn details
- `ContactOrganizations` -- Associated companies
- `AssociatedProperties` -- Linked properties

#### Shared Components (29)
- `AppSidebar` -- Main navigation sidebar
- `Header` -- Top navigation bar
- `MapSearchBar` -- Address/property search
- `PropertyFilters` -- Advanced filtering panel
- `PropertyNotes` / `PropertyActivity` -- Timeline displays
- `EnrichmentQueuePopover` -- Live enrichment progress
- `NotificationBell` -- Notification center
- `PipelineStatus` -- Pipeline stage indicator
- `ContactStatusIcons` -- Enrichment quality indicators
- `ContactVersionHistory` -- Version diff viewer
- `StreetView` -- Google Street View embed
- `CustomerToggle` -- Customer status toggle
- `BulkActionBar` / `BulkAddToListModal` -- Bulk operations
- `AddContactModal` / `AddToListModal` -- Creation modals
- `DataIssueDialog` -- Data quality reporting
- `PermissionGate` -- Role-based UI gating
- Various skeletons, providers, landing page components

#### shadcn/ui Primitives (17)
- `alert-dialog`, `avatar`, `badge`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `select`, `skeleton`, `table`, `tabs`, `textarea`, `toast`, `tooltip`

---

## 7. AI / Enrichment Pipeline (Core IP)

The AI enrichment pipeline is the central intellectual property of Greenfinch. It consists of two major systems working in concert.

### 7.1 AI Enrichment Pipeline (3-Stage Orchestrator)

**Orchestrator:** `src/lib/ai/pipeline.ts`

The pipeline processes one property at a time through three sequential stages, with checkpoint-based resumption for fault tolerance.

```
                        +-----------------------+
                        |   Raw Property Data   |
                        |   (from CAD/Regrid)   |
                        +-----------+-----------+
                                    |
                                    v
                  +----------------------------------+
                  |  Stage 1: CLASSIFY & VERIFY      |
                  |  - Verify name, address, sqft    |
                  |  - Assign asset category/subcat  |
                  |  - Estimate CRE class (A/B/C/D)  |
                  |  - LLM + Web Search Grounding    |
                  +----------------+-----------------+
                                   |
                                   v
                  +----------------------------------+
                  |  Stage 2: OWNERSHIP & MGMT       |
                  |  - Discover beneficial owner     |
                  |  - LLC -> parent company lookup   |
                  |  - Property management company   |
                  |  - Domain validation cascade     |
                  |  - LLM + Web Search Grounding    |
                  +----------------+-----------------+
                                   |
                                   v
                  +----------------------------------+
                  |  Stage 3: CONTACT DISCOVERY      |
                  |  - Find ~3 decision-makers       |
                  |  - Names, titles, companies      |
                  |  - Email discovery during search  |
                  |  - Source URL validation          |
                  |  - Deduplication                  |
                  |  - LLM + Web Search Grounding    |
                  +----------------+-----------------+
                                   |
                                   v
                  +----------------------------------+
                  |  CHECKPOINT SAVED                |
                  |  (Redis / in-memory)             |
                  +----------------------------------+
```

**Key Features:**
- **Multi-LLM Support:** Provider-agnostic abstraction layer (`src/lib/ai/llm/`) supports Gemini, OpenAI, and Claude
- **Per-Stage Configuration:** Each stage can use a different LLM provider, model, temperature, thinking level, and timeout
- **Search Grounding:** Gemini uses native Google Search tools; OpenAI/Claude use SerpAPI-injected context
- **Checkpoint Resumption:** Failed runs save partial results; subsequent runs skip completed stages
- **Cost Tracking:** Every LLM call logs token usage and estimated cost to `enrichment_cost_events`
- **Retry Logic:** Each stage has configurable retry count with exponential/linear backoff
- **Circuit Breakers:** Prevent cascade failures when external services degrade

### 7.2 Cascade Enrichment Pipeline (Post-AI Contact/Org Enrichment)

After the AI pipeline discovers contacts, they flow through the cascade enrichment system for data validation and augmentation.

#### V1 Pipeline (`cascade-enrichment.ts`)

```
Contact Input
    |
    v
[1] Email Discovery
    Findymail Verify -> Findymail Find -> Hunter Find -> LinkedIn Reverse Email
    |
    v
[2] Person Match (PDL)
    Match by name + email + company -> employment data, LinkedIn, phones
    |
    v
[3] LinkedIn Discovery (SERP)
    Google Custom Search -> profile matching -> slug validation
    |
    v
[4] Employment Verification (Crustdata)
    Verify current employer matches (when PDL domain != input domain)
    |
    v
[5] Confidence Flag Assignment
    "verified" | "pdl_matched" | "unverified" | "email_only" | "no_match"
```

#### V2 Pipeline (`cascade-enrichment-v2.ts`) -- NEW

```
Contact Input
    |
    v
[1] Email Discovery (unchanged)
    Findymail + Hunter
    |
    v
[2] Person Match via SerpAPI + LLM (replaces PDL)
    Web search -> LLM extraction of person data
    |
    v
[3] LinkedIn Discovery via SERP (unchanged)
    |
    v
[4] Employment Verification via browser-use (replaces Crustdata)
    LinkedIn profile scraping via Python microservice
    |
    v
[5] Confidence Flag Assignment
```

**A/B Experiment System:** (`enrichment-experiments.ts`)
- Deterministic hash-based routing between V1 and V2
- Configurable traffic percentage (`ENRICHMENT_V2_PERCENTAGE`)
- Comparison mode for side-by-side result analysis

### 7.3 Enrichment Queue (`enrichment-queue.ts`)

The enrichment queue orchestrates batch processing of properties:

- **Redis-backed state management** for queue items, batch state, and rate limits
- **Concurrency control** via `p-limit` for parallel processing
- **Checkpoint persistence** in Redis for crash recovery
- **Lock-based batch exclusivity** to prevent duplicate processing
- **Automatic organization enrichment** for newly discovered companies
- **Deduplication** during contact creation (matching by email, name+domain, LinkedIn URL)

### 7.4 LLM Abstraction Layer (`src/lib/ai/llm/`)

| File | Purpose |
|------|---------|
| `types.ts` | Provider-agnostic interfaces (`LLMProvider`, `LLMResponse`, `LLMCallOptions`, `LLMProviderAdapter`) |
| `gemini-adapter.ts` | Wraps Google GenAI SDK with native search grounding |
| `openai-adapter.ts` | Wraps OpenAI SDK with SerpAPI grounding injection |
| `claude-adapter.ts` | Wraps Anthropic SDK with SerpAPI grounding injection |
| `serp-grounding.ts` | Shared SerpAPI search module for non-Gemini providers |
| `factory.ts` | `getLLMAdapter(provider?)` factory, reads from runtime config |

Available models by provider:

| Provider | Models |
|----------|--------|
| **Gemini** | gemini-3-flash-preview, gemini-3-pro-preview, gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-2.0-flash-lite |
| **OpenAI** | gpt-4o, gpt-4o-mini, o1, o3-mini |
| **Claude** | claude-opus-4, claude-sonnet-4 |

---

## 8. External Integrations

### AI / LLM Providers

| Service | Module(s) | Purpose |
|---------|-----------|---------|
| **Google Gemini** | `ai/client.ts`, `ai/llm/gemini-adapter.ts` | Primary LLM for all pipeline stages; native search grounding |
| **OpenAI** | `ai/llm/openai-adapter.ts` | Alternative LLM provider with SerpAPI grounding |
| **Anthropic Claude** | `ai/llm/claude-adapter.ts` | Alternative LLM provider with SerpAPI grounding |

### Data Enrichment Providers

| Service | Module | Purpose | Status |
|---------|--------|---------|--------|
| **People Data Labs (PDL)** | `pdl.ts` | Person matching, company enrichment | Active (V1) |
| **Crustdata** | `crustdata.ts` | Employment verification | Active (V1), being replaced by browser-use |
| **EnrichLayer** | `enrichlayer.ts` | Alternative company data | Active (V1), being deprecated |
| **Hunter.io** | `hunter.ts` | Email discovery by name + domain | Active (V1 + V2) |
| **Findymail** | `findymail.ts` | Email verification, email-by-name, LinkedIn reverse lookup | Active (V1 + V2) |
| **ZeroBounce** | `zerobounce.ts` | Email deliverability validation | Active |
| **SerpAPI** | `serp.ts`, `serp-linkedin.ts`, `serp-person-enrichment.ts`, `serp-company-enrichment.ts` | Web search, LinkedIn profile search, person/company research | Active (V2 primary) |

### Mapping & Geospatial

| Service | Module | Purpose |
|---------|--------|---------|
| **Mapbox** | Direct API + SDK | Map rendering, geocoding, tile service |
| **Google Maps** | `@googlemaps/js-api-loader` | Street View, Places API, geocoding |
| **Regrid** | `regrid.ts`, tile proxy | Parcel boundary data and vector tiles |

### Infrastructure

| Service | Module | Purpose |
|---------|--------|---------|
| **Clerk** | `auth.ts`, `@clerk/nextjs` | Authentication, SSO, organization management |
| **Upstash Redis** | `redis.ts` | Caching, queue state, distributed locks |
| **ioredis** | `redis.ts` (alternate) | Direct Redis connection for BullMQ |
| **BullMQ** | `bullmq-enrichment.ts` | Background job queue |
| **Neon PostgreSQL** | `db.ts` | Managed PostgreSQL database |

### Web Scraping

| Service | Module | Purpose |
|---------|--------|---------|
| **browser-use** | `browser-use.ts`, `browser-employment-verification.ts` | Python microservice for LinkedIn scraping, team page extraction |

---

## 9. Codebase Statistics

### File Counts

| Category | Count |
|----------|-------|
| TypeScript files (`.ts` + `.tsx`) | 280 |
| CSS files | 1 (140 lines) |
| API route files | 89 |
| Page components | 37 |
| React components | 57 |
| Library modules (`src/lib/`) | 45+ |
| Scripts (`scripts/`) | 27 |
| Schema tables | 38 |

### Lines of Code

| Metric | Lines |
|--------|-------|
| **Total TypeScript** | 64,225 |
| **Schema definition** | 1,315 |
| **CSS** | 140 |
| **Estimated total (incl. config, scripts)** | ~65,000+ |

### Git Statistics

| Metric | Value |
|--------|-------|
| Total commits | 1,335 |
| Total insertions | 495,208 |
| Total deletions | 363,791 |
| Net lines | ~131,417 |
| Average commits/day | ~26 |
| Peak day (Jan 30) | 120 commits |

### Dependency Count

| Category | Count |
|----------|-------|
| Production dependencies | 80 |
| Dev dependencies | 15 |
| Radix UI components | 22 |

---

## 10. Recent Work -- March 2026 Enrichment Refactor

The March 2026 sprint focused on a major enrichment system refactor to support multiple LLM providers and replace expensive data APIs with web search + AI extraction.

### March 2026 Commits (17 total)

| Commit | Description |
|--------|-------------|
| `7fc1012` | **Implement multi-LLM enrichment pipeline with SerpAPI + browser-use** |
| `f0e44c7` | Add property status and research badges to list views |
| `3dbf3de` | Improve AI enrichment by storing and displaying grounding data |
| `5d7c612` | Create detailed system architecture documentation |
| `49ea1d8` | Improve confidence scoring and job change detection logic |
| `2646492` | Improve AI contact scoring and grounding quality extraction |
| `4d7b55b` | Add tool to help admins merge duplicate organizations |
| `2cf6eff` | Improve data quality by cleaning contacts and normalizing names |
| `6c41f04` | Improve website validation and refine organization linking |
| `130e43d` | Ensure correct handling of People Data Labs API responses |
| `f6e5227` | Fix error when enriching contact emails with PDL data |
| `6c20f13` | Improve how AI handles organization roles and names |
| `a084780` | Update AI prompts to correctly identify deed owners and business names |

### Key Refactor Details

**Goal:** Decouple from Gemini-only AI and eliminate expensive per-API-call providers (PDL, Crustdata, EnrichLayer).

**Phase 1 -- LLM Abstraction Layer (Completed)**
- Created `src/lib/ai/llm/types.ts` with provider-agnostic interfaces
- Built three adapters: Gemini, OpenAI, Claude
- SerpAPI grounding module injects web search results into non-Gemini prompts
- Updated all pipeline stages to use `getLLMAdapter()` factory
- Extended runtime config with per-stage `provider` field

**Phase 2 -- Cascade Enrichment V2 (Completed)**
- Created `src/lib/cascade-enrichment-v2.ts` replacing PDL with SerpAPI + LLM extraction
- Created `src/lib/browser-employment-verification.ts` replacing Crustdata with browser-use LinkedIn scraping
- Created `src/lib/serp-person-enrichment.ts` and `src/lib/serp-company-enrichment.ts`
- A/B experiment system for gradual rollout (`enrichment-experiments.ts`)
- Comparison tooling for side-by-side analysis (`enrichment-comparison.ts`)

**Phase 3 -- Quality & Grounding (In Progress)**
- Storing grounding sources and citation metadata per contact-property relationship
- Displaying grounding quality in the UI
- Confidence scoring improvements for job change detection
- Admin merge tools for deduplication at scale

---

## 11. Current State & Next Steps

### Current State

The platform is **functional and deployed** (via Replit) with the following capabilities operational:

- **Data ingestion** from multiple Texas county appraisal districts (DCAD primary, with multi-county framework in `src/lib/cad/`)
- **AI enrichment** running on Gemini with fallback to OpenAI/Claude
- **Cascade enrichment** V1 (PDL/Crustdata) active; V2 (SerpAPI/browser-use) built and ready for A/B testing
- **Full CRM workflow** including pipeline board, notes, activity tracking, flagging
- **Team collaboration** with Clerk-based multi-tenant orgs and RBAC
- **Admin operations** including AI config, cost tracking, merge tools, database management
- **Map + List views** for property discovery with advanced filtering

### Likely Next Steps

Based on the enrichment refactor plan and recent commit trajectory:

1. **A/B Test V2 Pipeline** -- Gradually increase `ENRICHMENT_V2_PERCENTAGE` to validate SerpAPI + browser-use cascade against V1 baseline
2. **Deprecate Legacy Providers** -- Once V2 is validated, remove PDL, Crustdata, and EnrichLayer dependencies to reduce costs
3. **Multi-County Expansion** -- The `src/lib/cad/` module framework supports multiple county codes; expand beyond DCAD to other Texas counties and eventually other states
4. **browser-use Microservice Deployment** -- Deploy the Python browser-use service in production for LinkedIn scraping at scale
5. **Pipeline Analytics** -- Enhance the pipeline dashboard with conversion metrics, deal velocity, and revenue tracking
6. **Email Outreach Integration** -- The schema includes `OUTREACH_METHODS` and task completion tracking, suggesting planned outreach automation
7. **Service Provider Marketplace** -- The `service_providers` and `SERVICE_CATEGORIES` schema suggests a planned marketplace connecting property owners with CRE service providers
8. **Mobile App** -- Significant responsive design work already done; native mobile may follow

---

*Report generated on March 6, 2026. Repository: Greenfinchai-v0, Branch: main, Commit: 7fc1012.*
