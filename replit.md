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
- **Modular Project Structure**: Code is organized by feature and concern, with AI enrichment logic centralized and tunable parameters in `config.ts`.
- **Data-Driven UI**: Interactive maps (Mapbox GL), dashboards, and detailed views.
- **Robust Authentication**: Clerk Auth with Role-Based Access Control (RBAC).
- **Multi-stage Enrichment Pipelines**: Includes contact, organization, and property AI enrichment (Google Gemini via Vertex AI).
- **Asynchronous Processing**: Redis-based enrichment queue for background processing, distributed locking, and caching.
- **Performance Optimizations**: Cursor pagination, Redis-based rate limiting, client-side debouncing, and optimized PostgreSQL indexing.
- **UI/UX Standards**: Consistent navigation, clear actionable elements, opaque backgrounds for overlay UI, and responsive design.
- **Property Classification**: Uses Texas PTAD state property type codes for commercial and multifamily.
- **Parcel Aggregation**: Properties are aggregated by GIS_PARCEL_ID.
- **API Standards**: Standardized API response envelope `{ success, data, error, meta }`.
- **Contact Relationship Verification**: Uses `job_change_detected` status and employer data validation.
- **Automatic Employer Org Enrichment**: Automatically finds or creates employer organization records and triggers PDL Company Enrich.
- **Per-Service Rate Limiting & Circuit Breaker**: Centralized `ServiceRateLimiter` for external APIs.
- **Gemini Streaming**: All Gemini API calls use `generateContentStream` with retry logic and timeout settings.
- **Domain Validation**: Validates domains/URLs returned by AI enrichment.
- **Enrichment Stage Checkpointing**: AI enrichment supports checkpoint-based resumption.
- **Circuit-Breaker-Aware Batch Processing**: Queue pauses when Gemini circuit breaker trips during batch enrichment.
- **Automatic Retry Pass**: Retryable failures are automatically reattempted with reduced concurrency.
- **Adaptive Concurrency**: Monitors error rates and circuit breaker state to dynamically adjust concurrency.
- **BullMQ Job Queue**: Persistent job queue for robust background processing.
- **Contact Creation Locking**: Distributed Redis lock per contact identity prevents duplicate contacts during batch processing.
- **Contact Auto-Merge in Enrichment**: Automatically merges contacts during enrichment to prevent duplicates.
- **Organization Creation Locking**: Redis lock prevents concurrent creation of the same organization.
- **Junction Table Unique Constraints**: Ensures unique links between properties, contacts, and organizations.
- **Batch Enrichment Filter**: Always skips already-enriched properties.
- **Batch Enrichment Access**: All authenticated users can run batch enrichment (capped for non-admins).
- **Batch Property Ingestion**: Properties are upserted in batches for efficiency.
- **Phone Research Waterfall**: 4-step phone lookup cascade using multiple providers.
- **Map Marker Colors**: All property markers and clusters are solid green (#16a34a) with white stroke.
- **Parcel Resolution**: Uses a pre-computed client-side parcel index for instant hash lookup.
- **Map Viewport Persistence**: Map center/zoom saved to sessionStorage.
- **Street View Scoring**: Panorama selection prefers road-facing views.
- **"New" Filter**: Shows "New" (blue dot = unviewed properties) in the view status filter.
- **Enrichment Queue Links**: Queue items are clickable and linkable to property/contact/organization pages.
- **Gemini Geo-Biasing**: All search grounding calls pass property lat/lon.
- **Gemini Thinking Mode**: Thinking mode sent to models that support it, with temperature auto-enforced.
- **Gemini HTTP Timeout**: Configured at 120 seconds.
- **Retry Consolidation**: Centralized error classification and retry logic for Gemini.
- **Schema Validation**: Lightweight runtime validation after JSON parsing, with retries on schema violations.
- **Contact Source Provenance**: Stage 3 prompt requires `src` (source URL) and optionally `email`.
- **Stage 3 Domain Validation**: All `companyDomain` values from Stage 3 are validated.
- **Multi-Company Ownership**: Stage 2 returns arrays of owners and management companies.
- **Cross-Stage Company Validation**: Contact companies are checked against known companies from Stage 2.
- **Centralized Pricing Config**: All external service costs are defined in `src/lib/pricing-config.ts`.
- **Search Grounding Cost Tracking**: Tracks cost for Gemini search grounding.
- **Gemini 3 Per-Query Pricing**: For gemini-3 models, search grounding is priced per query executed.
- **Per-Stage Model Config**: Each enrichment stage can use a different Gemini model, configurable via admin UI.
- **Per-Stage Temperature**: Each stage has its own configurable temperature.
- **Available Models**: Configured in `runtime-config.ts`.
- **Runtime Config Persistence**: Config stored at `/tmp/ai-stage-config.json` with file mtime-based cache invalidation.
- **Token-Based Cost Tracking**: All Gemini API calls capture `usageMetadata` for token counts and cost calculation.

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
- **Google Gemini via Vertex AI**: AI-based property enrichment.
- **Upstash Redis**: Distributed caching and locking.
- **Logo.dev**: Company logo and brand data API.