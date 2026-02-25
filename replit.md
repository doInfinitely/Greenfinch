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
- **AI Enrichment Pipeline**: A 3-stage Gemini pipeline (classify → ownership → contacts) with configurable models, temperatures, timeouts, and retries per stage. Includes replacement search with exponential backoff for retries.
- **Contact Enrichment Cascade**: A 5-stage cascade using multiple external providers (PDL → Crustdata → Findymail/Hunter → SERP → Email validation) for comprehensive contact information.
- **Domain Validation**: Utilizes an in-memory cache with a 5-minute TTL to prevent redundant HTTP fetches.
- **Deduplication**: Automatic merging of contacts during enrichment, managed with distributed Redis locking.
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