# greenfinch.ai - Commercial Property Prospecting Tool

## Overview
greenfinch.ai is an AI-native commercial real estate prospecting CRM. It aggregates parcel data, enriches properties using AI, and provides multi-source contact enrichment. The system offers property intelligence, validated contact information, pipeline management, and multi-view filtering, aiming to build a proprietary data flywheel. The MVP targets ZIP 75225 in Dallas, TX, with an architecture designed for nationwide expansion.

## User Preferences
- Preferred communication style: Simple, everyday language
- Use only Standard Regrid fields (avoid Premium fields like zoning_type, zoning_subtype, homestead_exemption)
- Use Mapbox for maps with separate logic testing
- Use Clerk Auth for authentication (migrated from Replit Auth)
- Use zoning-only classification (rule-based, no AI) for commercial/multifamily detection
- Use Mapbox POI enrichment for category/subcategory assignment
- Design for nationwide expansion (MVP scope: ZIP 75225 in Dallas, TX)
- Light mode only: Dark mode is fully disabled; all `dark:` CSS classes removed from app code; `tailwind.config.ts` has `darkMode: "class"` but `layout.tsx` force-removes the `dark` class and forces `light` class on the HTML element
- No changes to EnrichLayer integration until their site is back up (currently timing out)

## System Architecture

### Framework
- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS v3
- **Database ORM**: Drizzle ORM with PostgreSQL (Neon-backed)
- **Runtime**: Node.js 20
- **State Management**: Redis (Upstash) for distributed caching/locking, with in-memory fallback

### Core Design Principles
- **Modular Project Structure**: Organized by feature and concern (`app/`, `components/`, `lib/`).
- **Data-Driven UI**: Interactive maps (Mapbox GL), dashboards, and detailed views for properties and contacts.
- **Robust Authentication**: Clerk Auth with Role-Based Access Control (RBAC) via Clerk Organizations, supporting legacy Replit Auth migration. Authentication checks are implemented per-route.
- **Multi-stage Enrichment Pipelines**:
    - **Contact Enrichment**: A 5-stage cascade (Findymail/Hunter email → PDL person → SERP LinkedIn fallback → Crustdata verification) with raw response storage and confidence flags.
    - **Organization Enrichment**: 2-stage (PDL Company → Crustdata Company).
    - **Property AI Enrichment**: Uses Google Gemini AI with search grounding for property data and beneficial owner identification.
- **Asynchronous Processing**: Non-blocking enrichment queue system with Redis for background processing, distributed locking, and caching.
- **Performance Optimizations**: Cursor pagination for APIs, Redis-based rate limiting, client-side debouncing, and optimized PostgreSQL indexing.
- **User Engagement Features**: In-app notification system supporting @mentions and follow-up action reminders. Unread property indicators provide visual cues for new properties.
- **Responsive Design**: UI components are designed to adapt for mobile and desktop, including swipe hints and flexible layouts.
- **UI/UX Standards**: Consistent navigation, clear actionable elements, and explicit opaque backgrounds for all overlay UI elements.
- **Property Classification**: Utilizes Texas PTAD state property type codes for commercial and multifamily classification.
- **Parcel Aggregation**: Properties are aggregated by GIS_PARCEL_ID to represent physical complexes.

## Key File Sizes (maintainability reference)
- `src/app/property/[id]/page.tsx` — 2,148 lines
- `src/app/contact/[id]/page.tsx` — 1,216 lines
- `src/lib/enrichment-queue.ts` — 1,006 lines
- `src/lib/schema.ts` — 983 lines (25+ tables)
- `src/components/MapView.tsx` — 936 lines
- `src/lib/cascade-enrichment.ts` — 693 lines
- `src/lib/pdl.ts` — 551 lines

## API Surface (71 routes total)

### Routes WITH authentication (25 routes)
These routes call `requireSession()`, `getAuth()`, or `auth()`:
- `/api/admin/deduplicate`
- `/api/contacts/[id]` (GET/PATCH/DELETE)
- `/api/contacts/[id]/enrich`, `/api/contacts/[id]/waterfall-email`, `/api/contacts/[id]/waterfall-phone`
- `/api/notifications`
- `/api/org-admin/analytics`
- `/api/org/members`, `/api/org/members/[id]`, `/api/org/members/[id]/role`
- `/api/org/invitations`, `/api/org/invitations/[id]`
- `/api/org/team`
- `/api/pipeline/board`, `/api/pipeline/dashboard`, `/api/pipeline/[id]`, `/api/pipeline/[id]/claim`, `/api/pipeline/activity`
- `/api/properties/[id]/actions`, `/api/properties/[id]/activity`, `/api/properties/[id]/customer`, `/api/properties/[id]/notes`, `/api/properties/[id]/pipeline`
- `/api/properties/search`
- `/api/properties/views`

### Routes WITHOUT authentication (46 routes)
These routes have NO auth check — any unauthenticated request succeeds:
- **Admin (11 unprotected!)**: `/api/admin/enrich-batch`, `/api/admin/enrich-status`, `/api/admin/ingest`, `/api/admin/stats`, `/api/admin/test-enrichment`, `/api/admin/discover-columns`, `/api/admin/compare/*` (3), `/api/admin/database`, `/api/admin/database/export`, `/api/admin/ingestion-settings`
- **Auth/Config**: `/api/auth/user`, `/api/config`
- **Contacts**: `/api/contacts` (list), `/api/contacts/search`, `/api/contacts/create`, `/api/contacts/associate`, `/api/contacts/enrich`, `/api/contacts/[id]/linkedin`, `/api/contacts/[id]/linkedin/flag`, `/api/contacts/[id]/profile-photo`
- **Properties**: `/api/properties` (list), `/api/properties/geojson`, `/api/properties/filter-options`, `/api/properties/by-parcel/*`, `/api/properties/[id]`, `/api/properties/[id]/flag`, `/api/properties/[id]/service-providers`
- **Enrichment**: `/api/enrich` (property AI enrichment)
- **Other**: `/api/geocode/reverse`, `/api/lists/*` (3), `/api/organizations/*` (5), `/api/parcels/resolve`, `/api/service-providers/search`, `/api/tiles/regrid/*`, `/api/typeahead`, `/api/user/settings`, `/api/waitlist`, `/api/webhooks/apollo`

## External Dependencies
- **Snowflake**: Regrid parcel data ingestion.
- **Mapbox**: Interactive mapping, geocoding, POI enrichment.
- **Findymail**: Email finding, verification, reverse email lookup, phone lookup.
- **Hunter.io**: Email finding, organization domain enrichment.
- **People Data Labs (PDL)**: Primary person and company enrichment. Returns `mobile_phone` (personal) and `phone_numbers` array (work phones extracted).
- **Crustdata**: Contact and company verification layer.
- **SerpAPI**: Google search-based LinkedIn profile discovery (fallback).
- **Apollo.io**: People match API for contact creation.
- **ZeroBounce**: Primary email validation.
- **LeadMagic**: Secondary email validation.
- **EnrichLayer**: LinkedIn-sourced company/contact data (currently unreachable — do not modify).
- **Clerk Auth**: User authentication, organization management, RBAC.
- **Google Gemini**: AI-based property enrichment (`gemini-3-flash-preview` with search grounding).
- **Upstash Redis**: Distributed caching and locking.

## Known Issues & Technical Debt (Feb 2026 Audit)

### CRITICAL — Security
- **AUTH-1**: 46 of 71 API routes have no authentication. All 11 admin routes (batch enrichment, database export, ingestion) are completely unprotected. No global Next.js `middleware.ts` exists for Clerk auth enforcement.
  - **Fix**: Add `src/middleware.ts` with Clerk's `clerkMiddleware()` to protect all `/api/*` routes, with explicit public exceptions only for `/api/auth/user`, `/api/config`, `/api/waitlist`, and `/api/webhooks/*`.

### HIGH — Performance & Scalability
- **PERF-1**: Large monolithic page components (property page 2,148 lines, contact page 1,216 lines). Difficult to maintain and review.
  - **Fix**: Extract into focused sub-components.
- **PERF-2**: Client-side GeoJSON clustering loads all property coordinates. Will degrade on mobile with thousands of properties beyond Dallas MVP.
  - **Fix**: Server-side clustering via PostGIS or Mapbox vector tiles.
- **PERF-3**: Property page uses `setTimeout` at 15s/30s for delayed re-fetch after background cascade enrichment. Fragile timing.
  - **Fix**: Server-sent events or polling with completion detection.

### MEDIUM — Data Quality & Enrichment
- **DATA-1**: No centralized enrichment cost tracking or daily spend cap across all paid APIs.
- **DATA-2**: Rate limiting falls back to in-memory when Redis unavailable, meaning limits reset on restart.

### MEDIUM — UX
- **UX-1**: No accessibility (a11y) patterns. No aria labels, keyboard navigation, or screen reader support.
- **UX-2**: No loading skeletons on property/contact detail pages.

### MEDIUM — Code Quality
- **CODE-1**: No test coverage anywhere in the project. Enrichment pipeline logic would benefit most.
- **CODE-2**: Inconsistent API response patterns. No shared response envelope or error format.
- **CODE-3**: Dual ID system (Clerk ID vs DB UUID) for user references across pipeline, notes, actions.

### LOW — Infrastructure
- **INFRA-1**: No `/api/health` endpoint for monitoring database/Redis connectivity.

## Remediation Plan (Feb 2026)

### Phase 0 — Quick Wins (Complete)
- [x] **PERF-3**: Replace setTimeout re-fetch with polling-based refresh after enrichment
- [x] **UX-2**: Add loading skeletons to property and contact detail pages
- [x] **INFRA-1**: Add `/api/health` endpoint for database/Redis monitoring

### Phase 1 — Maintainability (Complete)
- [x] **PERF-1**: Break up large monolithic page components into sub-components
  - Property page: Extracted PropertyHeader, PropertyStats, PropertyAbout, OwnershipSection, ContactsSection, FlagDialog, ServiceProviderDialog into `src/components/property/`
  - Contact page: Extracted ContactHeader, ContactInfo, AssociatedProperties, ContactOrganizations into `src/components/contact/`
  - Shared types defined in respective `types.ts` files

### Phase 2 — Platform Hardening (Complete)
- [x] **DATA-1**: Add enrichment cost tracking table and admin dashboard
  - New `enrichment_cost_events` table in schema with provider, endpoint, cost, entity tracking
  - `src/lib/cost-tracker.ts` with fire-and-forget logging helper
  - Instrumented all paid API modules: PDL, Apollo, Hunter, Findymail, Crustdata, Gemini AI
  - Admin API at `/api/admin/enrichment-costs` with aggregates by provider, daily/weekly/monthly trends
  - Admin dashboard page at `/admin/costs` with spend cards, provider breakdown, trend table, recent events
- [x] **DATA-2**: Make rate limiting require Redis (no in-memory fallback for expensive endpoints)
  - `checkRateLimit()` now auto-detects expensive routes (enrich, waterfall, linkedin) and requires Redis
  - Returns 503 with clear error if Redis is unavailable for expensive endpoints
  - Standard endpoints (search, list) keep in-memory fallback behavior
- [x] **CODE-2**: Standardize API response envelope `{ success, data, error, meta }`
  - Created `src/lib/api-response.ts` with `apiSuccess()`, `apiError()`, `apiNotFound()`, `apiBadRequest()`, `apiUnauthorized()` helpers
  - Migrated waterfall-email and waterfall-phone routes as initial adoption
  - Remaining 70 routes can be migrated incrementally without breaking changes

### Phase 3 — Quality & Polish
- [ ] **UX-1**: Add accessibility (aria labels, keyboard navigation, semantic headings)
- [ ] **CODE-1**: Add test coverage for cascade enrichment and key API routes

### Deferred
- **PERF-2**: Server-side map clustering (defer until scaling beyond Dallas MVP)
- **CODE-3**: Dual ID unification (large migration, plan separately)

## Future Exploration

### Refactor to use Clerk IDs everywhere
Currently the system uses separate database user IDs (`dbUserId`) alongside Clerk user IDs for certain operations like pipeline owner assignments. Consider refactoring to use Clerk IDs consistently across all operations for simpler ID handling.

### Admin CSV Enrichment Page (PDL Integration)
Build an admin-only page that allows bulk person enrichment via CSV upload with PDL API.

### Server-Side Map Clustering
Implement PostGIS-based server-side clustering as property data scales beyond Dallas MVP.
