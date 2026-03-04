# greenfinch.ai - Commercial Property Prospecting Tool

## Overview
greenfinch.ai is an AI-native commercial real estate prospecting CRM designed for nationwide expansion. It aggregates and enriches commercial property data, provides validated contact information, and offers tools for pipeline management and multi-view filtering. The platform leverages AI for property and contact enrichment, aiming to streamline commercial real estate prospecting.

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

### Technical Implementations
- **AI Enrichment Pipeline**: A 3-stage Gemini pipeline (classify → ownership → contacts) with configurable models, temperatures, timeouts, and retries per stage. Includes replacement search with exponential backoff for retries. Stage 3 contact confidence uses a composite scoring formula blending Gemini's self-assessed `rc` (30% weight) with objective signals: source URL (+0.2), grounding quality (+0.1–0.2), company match (+0.15), validated email (+0.1). Capped by NO_SOURCE_URL_CAP (0.4) and COMPANY_MISMATCH_CAP (0.5) as safety bounds. Floored at 0.05 (no contact shows 0%). Grounding quality extracted from Gemini's `groundingSupports` per-claim confidence scores.
- **Contact Enrichment Cascade**: A 5-stage cascade using multiple external providers (PDL → Crustdata → Findymail/Hunter → SERP → Email validation) for comprehensive contact information.
- **Street View**: Address-based panorama lookup via Google Street View Metadata API (`streetview_pano_id` cached per property). Uses the same panorama Google Maps shows for an address. Falls back to lat/lon radius search if metadata API fails. Properties geocoded via Google Maps Geocoding API (`geocoded_lat`/`geocoded_lon`). Heading computed from panorama position toward parcel centroid (not geocoded point). Uses `NEAREST` preference and `OUTDOOR` source.
- **Domain Validation**: Utilizes an in-memory cache with a 5-minute TTL to prevent redundant HTTP fetches. Property website validation includes content-based relevance checking — fetches the page and verifies it mentions the property's street name, city, or property name before accepting.
- **Org Linking**: Only ownership-stage entities (owner, PM) create `property_organizations` links. Contact employer companies are enriched and linked to the contact but don't create property-org relationships without substantiation.
- **Name Normalization**: Owner/mgmt names from AI enrichment are normalized via `normalizeOwnerName()` (title-case with corporate suffix preservation, AI editorial commentary stripping) to prevent raw DCAD all-caps names or verbose AI annotations from being stored.
- **Contact Quality Filters**: Placeholder contacts (e.g. "General Manager (Open Position)") are rejected during Stage 3 parsing. Hashed LinkedIn member IDs (ACw... URLs) are rejected by `validateLinkedInSlug()` so the cascade tries to find real profile URLs instead.
- **Deduplication**: Automatic merging of contacts during enrichment, managed with distributed Redis locking. Manual org merge tool at `/admin/merge-orgs` with fuzzy name match suggestions (Jaccard similarity on tokenized names) and manual search+merge. `mergeOrganizationPair()` runs in a DB transaction, safely handles `uq_property_org_role` constraint conflicts by detecting and deleting duplicate links before reassignment.
- **Authentication & Authorization**: Implemented with Clerk Auth, supporting organization-scoped sessions and role-based access control.

## External Dependencies
- **Snowflake**: For Regrid parcel data ingestion.
- **Mapbox**: For interactive mapping and geocoding functionalities.
- **Findymail**: Provides email finding, verification, reverse email lookup, and phone lookup.
- **Hunter.io**: Used for email finding and organization domain enrichment.
- **People Data Labs (PDL)**: The primary service for person and company enrichment.
- **Crustdata**: For contact and company verification, acting as a fallback.
- **SerpAPI**: Enables Google search-based LinkedIn profile discovery as a fallback.
- **Apollo.io**: Used for its People Match API to facilitate contact creation.
- **ZeroBounce**: The primary service for email validation.
- **LeadMagic**: Provides secondary email validation.
- **EnrichLayer**: Intended for LinkedIn-sourced company/contact data (currently unreachable).
- **Clerk Auth**: Handles user authentication, organization management, and role-based access control.
- **Google Gemini via Vertex AI**: Powers AI-based property enrichment, including search grounding.
- **Upstash Redis**: Utilized for distributed caching, locking, and rate limiting mechanisms.
- **Logo.dev**: Provides company logo and brand data.