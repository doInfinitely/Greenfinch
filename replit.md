# greenfinch.ai - Commercial Property Prospecting Tool

## Overview
greenfinch.ai is an AI-native commercial real estate prospecting CRM. It aggregates parcel data, enriches properties using AI, and provides multi-source contact enrichment. The system offers property intelligence, validated contact information, pipeline management, and multi-view filtering, aiming to build a proprietary data flywheel. The MVP targets ZIP 75225 in Dallas, TX, with an architecture designed for nationwide expansion. The project's ambition is to build a scalable, data-driven platform that revolutionizes commercial real estate prospecting.

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
- No confirmation dialogs for paid API calls (phone lookup, contact research, etc.) — just execute immediately
- Keep error/failure messages simple and user-friendly — don't list internal provider names or technical details

## System Architecture

### Framework and Core Technologies
The project is built with Next.js 16 (App Router), Tailwind CSS v3, Drizzle ORM with PostgreSQL (Neon-backed), and runs on Node.js 20. Redis (Upstash) is used for distributed caching and locking.

### Core Design Principles
- **Modular Project Structure**: Code is organized by feature and concern.
- **Data-Driven UI**: Interactive maps (Mapbox GL), dashboards, and detailed views for properties and contacts.
- **Robust Authentication**: Clerk Auth with Role-Based Access Control (RBAC) via Clerk Organizations, with per-route authentication checks.
- **Multi-stage Enrichment Pipelines**:
    - **Contact Enrichment**: A 5-stage cascade for comprehensive contact data.
    - **Organization Enrichment**: 2-stage process for company information.
    - **Property AI Enrichment**: Utilizes Google Gemini AI for property data and beneficial owner identification with search grounding.
- **Asynchronous Processing**: Non-blocking enrichment queue system with Redis for background processing, distributed locking, and caching.
- **Performance Optimizations**: Cursor pagination for APIs, Redis-based rate limiting, client-side debouncing, and optimized PostgreSQL indexing.
- **User Engagement Features**: In-app notifications, @mentions, follow-up reminders, and unread property indicators.
- **Responsive Design**: UI components adapt for mobile and desktop.
- **UI/UX Standards**: Consistent navigation, clear actionable elements, and opaque backgrounds for overlay UI.
- **Property Classification**: Uses Texas PTAD state property type codes for commercial and multifamily.
- **Parcel Aggregation**: Properties are aggregated by GIS_PARCEL_ID.
- **API Standards**: Standardized API response envelope `{ success, data, error, meta }` with helpers for consistency.
- **AI Enrichment Pipeline Refinements**: Split contact discovery, restructured ownership identification, source quality scoring, compact Stage 1 prompts, and contact deduplication.
- **Contact Relationship Verification**: Compares current employer data against AI-discovered companies to verify relationships. Uses `job_change_detected` status (displayed as "May have changed jobs") instead of definitive "former" marking. Checks PDL-sourced parent/subsidiary relationships (`affiliated_profiles`) before flagging — if the "new" company is an affiliate of the original, no flag is raised. Organizations store `pdl_company_id` and `affiliated_pdl_ids` for relationship lookups via `areCompaniesAffiliated()`. Affiliated companies auto-resolved (up to 8) when an org is enriched. Triggers replacement searches when job changes are detected. Smart polling with exponential backoff for enrichment status.
- **Per-Service Rate Limiting**: Centralized `ServiceRateLimiter` (token bucket + concurrency + circuit breaker) in `src/lib/rate-limiter.ts` with `withRetry` for 429 errors. Configs: Gemini 900 RPM/50 concurrent, Findymail 250 concurrent, Crustdata 14 RPM/5 concurrent, PDL Person 90 RPM/30 concurrent, PDL Company 90 RPM/30 concurrent. Property concurrency set to 15.
- **Circuit Breaker**: Per-service circuit breaker in `ServiceRateLimiter` (CLOSED → OPEN after N failures in rolling window → HALF_OPEN after cooldown → test call). Configs: Gemini/Findymail/PDL 5 failures/30s cooldown, Crustdata 3 failures/60s cooldown. Only counts 429, 5xx, timeouts, connection errors. Exponential backoff on repeated HALF_OPEN failures.
- **Gemini Timeout Fix**: `callGeminiWithTimeout` timeout only covers actual API call time (not queue wait). Internal error messages stripped from user-facing summaries via `stripInternalMessages()` regex fallback. Uses SDK-native `httpOptions.timeout` at 280s (under the ~300s system TCP socket limit) with `AbortController` and `SERVER_TIMEOUT_HEADER` — no more `Promise.race` for timeout control.
- **Enrichment Stage Checkpointing**: AI enrichment (`runFocusedEnrichment`) supports checkpoint-based resumption. Each stage (classification, ownership, contacts) saves checkpoint data on failure via `EnrichmentStageError`. Partial results (classification/ownership) saved to DB with `enrichmentStatus: 'partial'` so work isn't lost. Checkpoints stored in Redis (or in-memory fallback).
- **Automatic Retry Pass**: After main batch completes, retryable failures are automatically retried with reduced concurrency (1/3 of normal) after a 10-second delay. Properties failing 3+ times become non-retryable. Circuit breaker errors always marked retryable.
- **Adaptive Concurrency**: `AdaptiveConcurrencyController` monitors error rates over a sliding window. When error rate ≥ 40%, concurrency reduced by 40% (min 3). When error rate ≤ 10%, concurrency increased by 2 (up to original). Adjustments throttled to every 30 seconds. Items throttled with 2-5s delay when error rate is high.
- **Batch Summary/Report**: `/api/admin/enrich-status` returns failure breakdown by stage and service, retryable vs permanent error counts, and per-service circuit breaker state (CLOSED/OPEN/HALF_OPEN).
- **BullMQ Job Queue**: Persistent job queue using BullMQ + ioredis over Upstash Redis TCP connection. Jobs survive workflow/process restarts. Automatic 3-attempt retry with exponential backoff. Batch metadata stored in Redis with 2h TTL. Legacy in-process batch engine retained as fallback (pass `useLegacy=true`). Worker concurrency matches batch request. Worker `lockDuration=600s` and `stalledInterval=300s` to accommodate long Gemini API calls (up to 280s+ with search grounding). Files: `src/lib/bullmq-connection.ts` (config), `src/lib/bullmq-enrichment.ts` (queue/worker/batch management). Requires `UPSTASH_REDIS_HOST`, `UPSTASH_REDIS_PORT`, `UPSTASH_REDIS_PASSWORD` secrets for TCP connection.
- **Phone Research Waterfall**: On-demand 4-step phone lookup triggered via "Find Phone" button (not during automatic enrichment). Cascade: Findymail phone by LinkedIn → PDL person enrichment → Hunter email-finder phone → EnrichLayer LinkedIn profile phone. Stops at first success. Route: `/api/contacts/[id]/waterfall-phone`.
- **Map Marker Colors**: All property markers and clusters are solid green (#16a34a) with white stroke for visibility on satellite. No pipeline-stage coloring on the map.
- **Parcel Resolution**: NEVER use spatial proximity matching or marker-based resolution. Property markers are visual-only indicators — they must NEVER be used for click handling, hover resolution, or property lookup. Only the actual parcel polygon under the cursor is used for resolution. Uses a **pre-computed client-side parcel index** (`/api/parcels/parcel-index`) loaded once on map init, mapping every `property_key` (= Regrid parcelnumb) to its resolved parent property via `dcad_gis_parcel_id`. Hover/click does instant hash lookup by parcelnumb — no API calls. Display name priority: `common_name` (AI-determined) → `dcad_biz_name` → address. Child properties resolve to GIS parent; orphans (parent not in DB) use their own name. No fuzzy/prefix matching — exact match only. 150ms hover debounce prevents rapid mousemove flooding. If no match is found, show Regrid address only (never owner names). `/api/parcels/resolve` simplified to exact parcelnumb match with GIS parent resolution.
- **Map Viewport Persistence**: Map center/zoom saved to sessionStorage when navigating to a property. Restored on return so user doesn't lose their place.
- **Street View Scoring**: Panorama selection uses multi-candidate scoring to prefer road-facing views over alleyways/parking lots. Scores based on description keywords, link count, and distance.
- **"New" Filter**: The view status filter shows "New" (blue dot = unviewed properties) instead of "Viewed", matching the app's visual language where blue dots indicate new/unviewed items.
- **Enrichment Queue Links**: Queue items are always clickable/linkable to their property/contact/organization page, regardless of status (in-progress, failed, completed).
- **Test credentials**: Clerk login with username `admin`, password `Me@tballH@mmy`.

## External Dependencies
- **Snowflake**: Regrid parcel data ingestion.
- **Mapbox**: Interactive mapping, geocoding, POI enrichment.
- **Findymail**: Email finding, verification, reverse email lookup, phone lookup.
- **Hunter.io**: Email finding, organization domain enrichment.
- **People Data Labs (PDL)**: Primary person and company enrichment (min_likelihood=6 for person matches).
- **Crustdata**: Contact and company verification.
- **SerpAPI**: Google search-based LinkedIn profile discovery (fallback).
- **Apollo.io**: People match API for contact creation.
- **ZeroBounce**: Primary email validation.
- **LeadMagic**: Secondary email validation.
- **EnrichLayer**: LinkedIn-sourced company/contact data (currently unreachable).
- **Clerk Auth**: User authentication, organization management, RBAC.
- **Google Gemini**: AI-based property enrichment (`gemini-3-flash-preview` with search grounding).
- **Upstash Redis**: Distributed caching and locking.
- **Logo.dev**: Company logo and brand data API (describe endpoint for logo, blurhash, brand colors, social links). API route: `/api/brand/[domain]`. Requires `LOGO_DEV_SECRET_KEY` secret.

## Planned Fixes
- [ ] **ENRICHLAYER-1**: EnrichLayer profile photo API call is failing (site currently timing out). When their service is restored: add a 10s fetch timeout with `AbortController` to `getProfilePicture()` and all other EnrichLayer functions in `src/lib/enrichlayer.ts`, add a circuit breaker to skip calls after repeated failures, and ensure the contact detail page and enrichment queue gracefully handle the timeout without blocking other operations.

## Deferred
- **PERF-2**: Server-side map clustering (defer until scaling beyond Dallas MVP)
- **CODE-3**: Dual ID unification (large migration, plan separately)