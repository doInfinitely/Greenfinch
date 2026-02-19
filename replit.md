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
- **Contact Relationship Verification**: Compares current employer data against AI-discovered companies to verify relationships, marks 'former' contacts, and triggers replacement searches when job changes are detected. Smart polling with exponential backoff for enrichment status.
- **Per-Service Rate Limiting**: Centralized `ServiceRateLimiter` (token bucket + concurrency) in `src/lib/rate-limiter.ts` with `withRetry` for 429 errors. Configs: Gemini 900 RPM/50 concurrent, Findymail 250 concurrent, Crustdata 14 RPM/5 concurrent, PDL Person 90 RPM/30 concurrent, PDL Company 90 RPM/30 concurrent. Property concurrency set to 15.
- **Gemini Timeout Fix**: `callGeminiWithTimeout` timeout only covers actual API call time (not queue wait). Internal error messages stripped from user-facing summaries via `stripInternalMessages()` regex fallback.

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