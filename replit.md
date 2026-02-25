# greenfinch.ai - Commercial Property Prospecting Tool

## Overview
greenfinch.ai is an AI-native commercial real estate prospecting CRM. It aggregates parcel data from Dallas County (DCAD via Snowflake), enriches properties using Google Gemini AI (Vertex AI with search grounding), and provides multi-source contact enrichment through a 5-stage cascade pipeline. The system offers property intelligence, validated contact information, pipeline management, and multi-view filtering. Architecture is designed for nationwide expansion with MVP targeting ZIP 75225 in Dallas, TX.

## User Preferences
- Preferred communication style: Simple, everyday language
- Use only Standard Regrid fields (avoid Premium fields like zoning_type, zoning_subtype, homestead_exemption)
- Use Mapbox for maps with separate logic testing
- Use Clerk Auth for authentication (migrated from Replit Auth)
- Use zoning-only classification (rule-based, no AI) for commercial/multifamily detection
- Design for nationwide expansion (MVP scope: ZIP 75225 in Dallas, TX)
- Light mode only: Dark mode fully disabled; `tailwind.config.ts` has `darkMode: "class"` but `layout.tsx` force-removes `dark` class and forces `light`
- No changes to EnrichLayer integration until their site is back up (currently timing out)
- No confirmation dialogs for paid API calls — execute immediately
- Keep error/failure messages simple and user-friendly — no internal provider names or technical details

## System Architecture

### Framework and Core Technologies
- **Next.js 16** (App Router) with Turbopack
- **Tailwind CSS v3** for styling
- **Drizzle ORM** with PostgreSQL (Neon-backed)
- **Node.js 20** runtime
- **Upstash Redis** for distributed caching, locking, and rate limiting
- **BullMQ** for persistent job queue processing
- **Clerk Auth** for authentication and organization management

### Core Design Principles
- **Modular Project Structure**: Code organized by feature and concern
- **Data-Driven UI**: Interactive maps (Mapbox GL), dashboards, detail views
- **Robust Authentication**: Clerk Auth with Role-Based Access Control (RBAC)
- **Multi-stage Enrichment**: Contact, organization, and property AI enrichment
- **Asynchronous Processing**: Redis-based queue, distributed locking, caching
- **Performance Optimizations**: Cursor pagination, Redis rate limiting, client debouncing, optimized PostgreSQL indexing, in-memory domain validation cache, parallel DB queries, batch operations
- **Property Classification**: Texas PTAD state property type codes
- **Parcel Aggregation**: Properties aggregated by GIS_PARCEL_ID
- **API Standards**: Standardized response envelope `{ success, data, error, meta }`

## Project Structure

### Source Code Layout
```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── api/               # 84 API route files
│   │   ├── admin/         # Admin-only endpoints (ai-config, costs, database, ingest, etc.)
│   │   ├── contacts/      # Contact CRUD, enrichment, phone/email waterfall
│   │   ├── properties/    # Property CRUD, search, geojson, enrichment
│   │   ├── organizations/ # Organization CRUD, enrichment
│   │   ├── pipeline/      # Pipeline stage management
│   │   ├── lists/         # Custom list management
│   │   ├── webhooks/      # Apollo webhook receiver
│   │   └── ...            # Auth, config, notifications, analytics
│   ├── admin/             # Admin pages (10 pages)
│   ├── dashboard/         # Map and list views
│   ├── contact/           # Contact detail pages
│   ├── property/          # Property detail pages
│   ├── organization/      # Organization detail pages
│   ├── pipeline/          # Pipeline board and dashboard
│   ├── lists/             # Custom list pages
│   ├── org-admin/         # Organization admin (team, analytics)
│   └── ...                # Marketing pages (pricing, FAQ, etc.)
├── components/            # 26 active React components
│   ├── ui/                # shadcn/ui primitives (18 files)
│   ├── contact/           # Contact sub-components (5 files)
│   ├── property/          # Property sub-components (8 files)
│   └── icons/             # Custom icons
└── lib/                   # Core business logic (36 files + 13 AI files)
    └── ai/                # AI enrichment pipeline
        └── stages/        # Per-stage enrichment logic
```

### Core Library Modules (src/lib/)

#### Data Layer
- **schema.ts** — Complete Drizzle ORM database schema (50+ tables)
- **db.ts** — Database initialization with connection pooling
- **redis.ts** — Redis/Upstash client, cache utilities, distributed locks
- **postgres-queries.ts** — Direct SQL for complex queries (search, filtering, aggregation)

#### Ingestion & Classification
- **dcad-ingestion.ts** — DCAD commercial property ingestion from Snowflake
- **snowflake.ts** — Snowflake data warehouse connection and queries
- **property-classifications.ts** — PTAD code mapping for commercial/multifamily
- **building-class.ts** — Building quality classification (A+, A, B, C, D)

#### AI Enrichment Pipeline (src/lib/ai/)
- **pipeline.ts** — Main `runFocusedEnrichment()` orchestration
- **client.ts** — Gemini API streaming, token counting, timeout management
- **config.ts** — Per-stage model, temperature, timeout, retry configuration
- **runtime-config.ts** — Admin-editable runtime config with file persistence
- **stages/classify.ts** — Stage 1: Property classification
- **stages/ownership.ts** — Stage 2: Ownership identification
- **stages/contacts.ts** — Stage 3: Contact discovery
- **stages/misc.ts** — Replacement search (with retry + exponential backoff), summary cleanup
- **errors.ts** — Custom error types (RetryableGeminiError, etc.)
- **parsers.ts** — JSON response parsing, grounded source extraction
- **helpers.ts** — HTML stripping, coordinate validation
- **types.ts** — Enrichment result type definitions

#### Contact Enrichment
- **cascade-enrichment.ts** — 5-stage cascade: PDL → Crustdata → Findymail/Hunter → SERP → Email validation
- **enrichment-queue.ts** — Main enrichment orchestration engine (batch processing, checkpointing, progress)
- **bullmq-enrichment.ts** — BullMQ worker for distributed enrichment jobs
- **deduplication.ts** — Duplicate detection and contact/organization/property merging

#### External Provider Integrations
- **pdl.ts** — People Data Labs (primary person + company enrichment)
- **findymail.ts** — Email finding, verification, reverse email lookup
- **hunter.ts** — Hunter.io email finding, company enrichment
- **crustdata.ts** — Person/company verification (fallback)
- **serp-linkedin.ts** — SerpAPI LinkedIn profile discovery (fallback)
- **enrichlayer.ts** — EnrichLayer integration (currently unreachable — paused)
- **zerobounce.ts** — ZeroBounce email validation
- **regrid.ts** — Regrid parcel data typeahead/lookup

#### Domain & Validation
- **domain-validator.ts** — Domain validation with parking detection and 5-minute in-memory cache
- **linkedin-validation.ts** — LinkedIn URL slug validation against contact names
- **nicknames.ts** — Carlton Northern nickname dataset (~1300 entries, bidirectional)
- **normalization.ts** — Text normalization (addresses, names, domains, cities)
- **phone-format.ts** — Phone number formatting and validation

#### Organization Management
- **organization-enrichment.ts** — Organization resolution, affiliated company discovery (parallelized with pLimit)

#### Infrastructure
- **auth.ts** — Clerk authentication, session management, admin access control
- **permissions.ts** — RBAC role/permission definitions
- **rate-limit.ts** — HTTP request-level rate limiting (sliding window)
- **rate-limiter.ts** — Service-level rate limiting (token bucket + circuit breaker per provider)
- **cost-tracker.ts** — Enrichment cost logging for billing/analytics
- **pricing-config.ts** — Centralized external service cost definitions
- **bullmq-connection.ts** — BullMQ Redis connection config
- **api-response.ts** — Standardized API response helpers
- **constants.ts** — Application-wide constants (categories, thresholds, models)
- **utils.ts** — UI/formatting utilities (classnames, currency, lot size)

### Admin Pages
- `/admin` — System admin dashboard
- `/admin/ai-config` — Per-stage Gemini model/temperature/timeout/retry configuration
- `/admin/costs` — Enrichment cost analytics
- `/admin/database` — Database management tools
- `/admin/linkedin-overrides` — Review/approve/dismiss rejected LinkedIn URLs
- `/admin/merge-contacts` — Manual contact merge with search and swap-direction
- `/admin/merge-properties` — Manual property merge with junction table re-linking
- `/admin/organizations` — Cross-org management (create orgs, invite users)
- `/admin/compare` — Data comparison tools
- `/admin/vertex-logs` — Vertex AI log viewer

## Key Behaviors

### Enrichment Pipeline
- **AI Enrichment**: 3-stage Gemini pipeline (classify → ownership → contacts) with per-stage model/temperature/timeout config
- **Replacement Search**: Searches for replacement contacts when job changes detected; retries up to 3x with exponential backoff (2s → 4s → 8s) on 429/timeout/503 errors
- **Domain Validation**: In-memory cache with 5-min TTL prevents redundant HTTP fetches; transient errors (timeout, connection refused) are not cached
- **Affiliated Companies**: Batch pre-checks existing orgs via single inArray query, then parallelizes PDL lookups with pLimit(4)
- **Contact Deduplication**: Automatic merge during enrichment with distributed Redis locking per contact identity
- **LinkedIn Validation**: Nickname-aware slug matching; rejected URLs stored for admin review

### Performance Optimizations
- **Domain Validation Cache**: 5-minute in-memory cache eliminates duplicate domain fetches within enrichment runs
- **Parallel DB Queries**: Notifications API runs count + list queries via Promise.all
- **Batch Updates**: Notification mark-read and duplicate resolution use inArray batch operations
- **Batch Contact Fetch**: Potential duplicates API fetches all contacts in single inArray query (was N+1)
- **Parallel ZIP Counts**: Admin ingest endpoint runs all ZIP count queries in parallel
- **Runtime Config Persistence**: AI stage config stored at `process.cwd()/ai-stage-config.json` (workspace-persistent, not /tmp)

### Authentication & Access Control
- Clerk Auth with organization-scoped sessions
- greenfinch admin check: `orgSlug === 'greenfinch' && orgRole === 'org:admin'`
- `AdminOnly` component in `src/components/PermissionGate.tsx`
- Non-greenfinch org admins use `/org-admin/team` for their own org

### UI Conventions
- Light mode only (dark mode fully disabled)
- Map markers: solid green (#16a34a) with white stroke
- Map viewport persisted to sessionStorage
- "New" filter shows unviewed properties (blue dot)
- Enrichment queue items are clickable/linkable
- Pipeline board: Undo/redo buttons for stage moves (session-only, max 20 history entries)
- Pipeline board: "Show Lost"/"Hide Lost" toggle button text
- Property list: Sortable by lot size, building sqft, contacts (via `sortBy`/`sortDir` query params)
- Map sidebar: Client-side sorting by name, lot size, or building sqft
- Street View: Progressive radius retry (50→150→500m expanded, 300→800→1500m banner) on no imagery
- Street View expanded: Desktop shows mini-map with pegman for location navigation
- Contacts list: Avatar, Properties count column, dedicated LinkedIn column, no LinkedIn icon next to name
- Bulk "Add to List": Available on property detail ContactsSection and organization detail contacts

## External Dependencies
- **Snowflake**: Regrid parcel data ingestion
- **Mapbox**: Interactive mapping, geocoding
- **Findymail**: Email finding, verification, reverse email lookup, phone lookup
- **Hunter.io**: Email finding, organization domain enrichment
- **People Data Labs (PDL)**: Primary person and company enrichment
- **Crustdata**: Contact and company verification
- **SerpAPI**: Google search-based LinkedIn profile discovery (fallback)
- **Apollo.io**: People match API for contact creation
- **ZeroBounce**: Primary email validation
- **LeadMagic**: Secondary email validation
- **EnrichLayer**: LinkedIn-sourced company/contact data (currently unreachable)
- **Clerk Auth**: User authentication, organization management, RBAC
- **Google Gemini via Vertex AI**: AI-based property enrichment (search grounding)
- **Upstash Redis**: Distributed caching, locking, rate limiting
- **Logo.dev**: Company logo and brand data API

## Dead Code Cleanup (completed)
The following were removed during codebase cleanup:
- **Deleted files**: `mapbox-poi.ts`, `zoning-classification.ts` (zero imports)
- **Deleted components**: `AdminBadge`, `EnrichmentModal`, `FilterBar`, `MapView`, `PropertyList` (never used)
- **Deleted API routes**: `test-enrichment`, `flush-queue`, `cleanup-duplicates`, `deduplicate`, `discover-columns`, `parcelnumb-mapping`, `geocode/reverse`, `properties/by-parcel/[llUuid]` (orphaned)
- **Deleted functions**: Unused auth utilities (8), unused Redis queue functions (5), unused normalization functions (2), unused postgres query functions (2), unused findymail function (1), unused BullMQ lifecycle functions (3)
- **De-exported**: Internal-only functions in dcad-ingestion (7), deduplication (3), enrichlayer (5), enrichment-queue (1) — kept as module-private
