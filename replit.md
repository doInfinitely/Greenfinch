# greenfinch.ai - Commercial Property Prospecting Tool

## Overview
greenfinch.ai is an AI-native commercial real estate prospecting CRM designed to revolutionize commercial real estate prospecting. It aggregates parcel data, enriches properties using AI, and provides multi-source contact enrichment. The system offers property intelligence, validated contact information, pipeline management, and multi-view filtering to build a proprietary data flywheel. The architecture is designed for nationwide expansion, with an MVP targeting ZIP 75225 in Dallas, TX.

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
Built with Next.js 16 (App Router), Tailwind CSS v3, Drizzle ORM with PostgreSQL (Neon-backed), and runs on Node.js 20. Redis (Upstash) is used for distributed caching and locking.

### Core Design Principles
- **Modular Project Structure**: Code is organized by feature and concern. AI enrichment lives in `src/lib/ai/` with separate files for types, client, errors, parsers, helpers, and per-stage logic (`stages/classify.ts`, `stages/ownership.ts`, `stages/contacts.ts`, `stages/misc.ts`), orchestrated by `pipeline.ts` and re-exported via `index.ts`. All tunable parameters (temperatures, thinking levels, retry counts, back-off timings, confidence caps) are centralized in `config.ts`.
- **Data-Driven UI**: Interactive maps (Mapbox GL), dashboards, and detailed views.
- **Robust Authentication**: Clerk Auth with Role-Based Access Control (RBAC).
- **Multi-stage Enrichment Pipelines**:
    - **Contact Enrichment**: 5-stage cascade.
    - **Organization Enrichment**: 2-stage process.
    - **Property AI Enrichment**: Google Gemini AI via Vertex AI for property data and beneficial owner identification with search grounding.
- **Asynchronous Processing**: Redis-based enrichment queue for background processing, distributed locking, and caching.
- **Performance Optimizations**: Cursor pagination, Redis-based rate limiting, client-side debouncing, and optimized PostgreSQL indexing.
- **UI/UX Standards**: Consistent navigation, clear actionable elements, opaque backgrounds for overlay UI, and responsive design.
- **Property Classification**: Uses Texas PTAD state property type codes for commercial and multifamily.
- **Parcel Aggregation**: Properties are aggregated by GIS_PARCEL_ID.
- **API Standards**: Standardized API response envelope `{ success, data, error, meta }`.
- **Contact Relationship Verification**: Uses `job_change_detected` status, compares employer data against AI-discovered companies, and checks PDL-sourced parent/subsidiary relationships.
- **Automatic Employer Org Enrichment**: Automatically finds or creates employer organization records and triggers PDL Company Enrich, ensuring rich company data.
- **Employer Org Enrichment Gating**: Prevents unnecessary PDL API calls by enriching employer organizations only when relevant to property ownership/management.
- **Per-Service Rate Limiting & Circuit Breaker**: Centralized `ServiceRateLimiter` with token bucket, concurrency control, and circuit breaker for external APIs.
- **Gemini Streaming**: All Gemini API calls use `generateContentStream` to bypass Node.js fetch timeout issues, with retry logic and timeout settings.
- **Domain Validation**: `src/lib/domain-validator.ts` validates domains/URLs returned by AI enrichment for DNS resolution, redirects, and content, rejecting parking services.
- **Enrichment Stage Checkpointing**: AI enrichment supports checkpoint-based resumption, saving partial results to prevent data loss.
- **Circuit-Breaker-Aware Batch Processing**: When Gemini circuit breaker trips during batch enrichment, the queue pauses (capped at 120s) and waits for reset instead of burning through items as instant failures. Pre-wave checks, per-item throttling, and the retry pass all respect breaker state.
- **Automatic Retry Pass**: Retryable failures are automatically reattempted with reduced concurrency. Retry delay dynamically adapts to circuit breaker reset timing.
- **Adaptive Concurrency**: Monitors error rates and circuit breaker state, adjusts concurrency dynamically.
- **BullMQ Job Queue**: Persistent job queue for robust background processing with automatic retries and metadata storage.
- **Contact Creation Locking**: Distributed Redis lock per contact identity (email or name+domain/employer) during `saveEnrichmentResults` prevents concurrent batch workers from creating duplicate contacts. Lock key uses strongest available identifier for deterministic keying.
- **Contact Auto-Merge in Enrichment**: `findExistingContactByIdentifiers` accepts `autoMergeNameMatches` option. During enrichment, name+domain and name+employer matches return the existing contact (auto-merge) instead of creating duplicates. Manual/admin flows still flag for review.
- **Organization Creation Locking**: `resolveOrganization` acquires a Redis lock (keyed on normalized domain or name) before the entire resolution flow, preventing concurrent creation of the same org by parallel workers.
- **Junction Table Unique Constraints**: `property_contacts(property_id, contact_id)`, `property_organizations(property_id, org_id)`, and `contact_organizations(contact_id, org_id)` have unique indexes to prevent duplicate links.
- **Batch Enrichment Filter**: All batch enrichment paths (legacy + BullMQ) always skip already-enriched properties, even when specific `propertyIds` or `propertyKeys` are provided. The `onlyUnenriched` option has been removed — filtering is always applied.
- **Batch Enrichment Access**: All authenticated users can run batch enrichment (capped at 100 properties for non-admins, unlimited for Greenfinch admins). Enrichment status and cancellation endpoints are also open to all authenticated users.
- **Batch Property Ingestion**: Properties are upserted in batches of 50 using INSERT ... ON CONFLICT DO UPDATE, reducing DB round-trips from ~3N to ~3*(N/50). Fallback to individual inserts on batch failure.
- **Phone Research Waterfall**: On-demand 4-step phone lookup cascade using multiple providers.
- **Map Marker Colors**: All property markers and clusters are solid green (#16a34a) with white stroke.
- **Parcel Resolution**: Uses a pre-computed client-side parcel index for instant hash lookup by `parcelnumb` and GIS parent resolution; no spatial proximity matching.
- **Map Viewport Persistence**: Map center/zoom saved to sessionStorage.
- **Street View Scoring**: Panorama selection prefers road-facing views.
- **"New" Filter**: Shows "New" (blue dot = unviewed properties) in the view status filter.
- **Enrichment Queue Links**: Queue items are clickable and linkable to property/contact/organization pages.
- **Gemini Geo-Biasing**: All search grounding calls pass property lat/lon via `toolConfig.retrievalConfig.latLng` for location-specific results.
- **Gemini Thinking Mode**: All Gemini calls use thinking mode. `thinkingLevel: 'HIGH'` for contact identification (Stage 3); `thinkingLevel: 'MEDIUM'` for ownership (Stage 2); `thinkingLevel: 'MINIMAL'` for all others. Default temperature is 1.0 (required for thinking mode); `cleanupAISummary` uses 0.1.
- **Gemini HTTP Timeout**: 120 seconds (`GEMINI_HTTP_TIMEOUT_MS = 120000`).
- **Retry Consolidation**: `callGeminiWithTimeout` is a single-attempt wrapper (no internal retries). Each stage owns its own retry count (typically 3). Centralized `isRetryableGeminiError()` classifies errors consistently.
- **Schema Validation**: Lightweight runtime validation (`validateStage1Schema`, `validateStage2Schema`, `validateStage3aSchema`) after `parseJsonResponse` — retries on schema violations in Stage 2 and 3a.
- **Contact Source Provenance**: Stage 3 prompt requires `src` (source URL) and optionally `email` per contact. Contacts without a source URL get `roleConfidence` capped at 0.4. AI-discovered emails are validated (anti-hallucination pattern check + DNS domain validation) before passing to downstream cascade enrichment.
- **Stage 3 Domain Validation**: All `companyDomain` values from Stage 3 are validated with `validateAndCleanDomain` before downstream enrichment.
- **Multi-Company Ownership**: Stage 2 returns arrays of owners and management companies (`additionalOwners`, `additionalManagementCompanies` on `OwnershipInfo`). All companies go through the same PDL → DNS → Gemini retry validation cascade. Primary (highest confidence) is written to singular DB columns; all companies are stored in `enrichment_json` and resolved as organizations.
- **Cross-Stage Company Validation**: After Stage 3, contact companies are checked against ALL known companies from Stage 2 (primary + additional owners/mgmt). Mismatches get `roleConfidence` downgraded.
- **No Stage 3b**: Stage 3b (per-contact Gemini email/phone lookup) was removed — it rarely returned useful data. Email/phone enrichment is handled entirely by the 5-stage cascade (Findymail, Hunter, PDL, SERP, Crustdata).
- **Centralized Pricing Config**: All external service costs are defined in `src/lib/pricing-config.ts` — a single file to update when any provider changes pricing. Covers Gemini (per-token input/output rates + search grounding), PDL (per-successful-call for person/company enrich), and all other enrichment providers (per-credit flat rates).
- **Search Grounding Cost Tracking**: Each Gemini call detects whether search grounding was used (via `groundingMetadata` in response candidates). Cost is $0.035/search for Gemini 3 models, $0.035/prompt for other models. Search grounding cost is included in `GeminiTokenUsage.searchGroundingCostUsd` and rolled into `computeGeminiCostUsd`. Cost summary logs and Vertex AI Debug page show per-call grounding status and aggregate grounding costs.
- **Gemini 3 Per-Query Pricing**: For gemini-3 models, search grounding is priced per query executed (one prompt may generate multiple `webSearchQueries`). Query count is extracted from `groundingMetadata.webSearchQueries` and multiplied by $0.035. For other models (e.g. gemini-2.5-flash), pricing is flat $0.035 per prompt regardless of query count.
- **Per-Stage Model Config**: Each enrichment stage can use a different Gemini model via `STAGE_MODELS` in `src/lib/ai/config.ts`. All stages default to `GEMINI_MODEL` from `constants.ts`. Change individual stages without affecting the rest of the pipeline.
- **Search Grounding Threshold**: `SEARCH_GROUNDING.DYNAMIC_THRESHOLD` in `src/lib/ai/config.ts` controls how aggressively search grounding triggers (0.0 = always search, 1.0 = never search). Applies when using `googleSearchRetrieval` with non-Gemini-3 models. Gemini 3 models use `googleSearch` which always searches.
- **Token-Based Cost Tracking**: All Gemini API calls capture `usageMetadata` (input/output/thinking/tool-use token counts) from streamed responses. `toolUsePromptTokenCount` (search grounding tokens) is included in input token costs. Thinking tokens are billed at the output rate. Costs are computed using Flash 3 Preview pricing ($0.50/1M input, $3.00/1M output). Token counts stored in `enrichment_cost_events` table. Costs page shows per-provider token breakdowns and per-property cost aggregation.

## External Dependencies
- **Snowflake**: Regrid parcel data ingestion.
- **Mapbox**: Interactive mapping, geocoding, POI enrichment.
- **Findymail**: Email finding, verification, reverse email lookup, phone lookup.
- **Hunter.io**: Email finding, organization domain enrichment.
- **People Data Labs (PDL)**: Primary person and company enrichment.
- **Crustdata**: Contact and company verification.
- **SerpAPI**: Google search-based LinkedIn profile discovery (fallback).
- **Apollo.io**: People match API for contact creation.
- **ZeroBounce**: Primary email validation.
- **LeadMagic**: Secondary email validation.
- **EnrichLayer**: LinkedIn-sourced company/contact data (currently unreachable).
- **Clerk Auth**: User authentication, organization management, RBAC.
- **Google Gemini via Vertex AI**: AI-based property enrichment (`gemini-3-flash-preview` with search grounding).
- **Upstash Redis**: Distributed caching and locking.
- **Logo.dev**: Company logo and brand data API.