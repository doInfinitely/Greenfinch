# Greenfinch - Commercial Property Prospecting Tool

## Overview
Greenfinch is a commercial property prospecting tool designed to provide sales representatives with detailed commercial property information and validated contact details for decision-makers. It integrates Regrid parcel data, Mapbox POI enrichment, and email validation through LeadMagic, all presented on interactive maps. The platform aims to streamline commercial real estate prospecting, with a comprehensive, data-driven approach for nationwide expansion, starting with an MVP focused on a specific Dallas ZIP code.

## Current Data Status (ZIP 75225 MVP)
- **171 commercial properties** fully enriched with decision-maker information
- **949 contacts** discovered (names, titles, emails, phones, LinkedIn profiles)
- **459 organizations** identified (management companies, owners, leaseholders)
- **Property categories**: 145 Retail, 26 Multifamily
- **Contact relationship types**: Property Manager, Facilities Manager, Owner, Leasing, Other
- **Organization relationship types**: Support multiple roles per organization (e.g., same company can be Owner + Property Manager)

## User Preferences
- Preferred communication style: Simple, everyday language
- Use only Standard Regrid fields (avoid Premium fields like zoning_type, zoning_subtype, homestead_exemption)
- Use Mapbox for maps with separate logic testing
- Use Replit Auth for authentication
- Use zoning-only classification (rule-based, no AI) for commercial/multifamily detection
- Use Mapbox POI enrichment for category/subcategory assignment
- Design for nationwide expansion (MVP scope: ZIP 75225 in Dallas, TX)

## System Architecture

### Framework
- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS v3
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Runtime**: Node.js 20

### Project Structure
The project uses a standard Next.js structure with `/src/app` for API routes and UI pages, `/src/components` for reusable React components, and `/src/lib` for backend logic, database interactions, and utility functions. Key areas include API endpoints for data management, an admin dashboard for data processes, and a user interface for property search, contact, and list management.

### Data Sources
- **Snowflake**: Used for ingesting Regrid parcel data into PostgreSQL.
- **PostgreSQL**: The primary operational database, storing enriched property records, contacts, organizations, and user-generated lists. The schema includes `users`, `sessions`, `properties`, `contacts`, `organizations`, and various linking tables.

### Authentication System
- **Clerk Auth**: Implements authentication using Clerk SDK with Next.js proxy for route protection.
- **Migration Support**: Legacy Replit Auth users are automatically migrated to Clerk by matching email addresses on first login.
- **Role-Based Access Control**: Uses Clerk Organizations for role management with the following structure:
  - **Internal Organization**: `greenfinch` slug for internal team members
  - **Roles**: `org:super_admin`, `org:admin`, `org:support`, `org:member`, `org:viewer`
  - **Permissions**: Defined in `src/lib/permissions.ts` including `admin:ingest`, `admin:enrich`, `data:read/write/delete`, etc.
  - **Route Protection**: `/admin/*` routes require admin role in greenfinch org, `/internal/*` requires greenfinch org membership
  - **Components**: `PermissionGate`, `AdminOnly`, `InternalOnly`, `AdminBadge` for UI-level access control

### UI/UX Decisions
- **Interactive Maps**: Utilizes Mapbox for displaying property data, clusters, and interactive elements.
- **Dashboard**: Features a tab-based interface for map and list views, with synchronized property lists and a search bar.
- **Property Details**: Dedicated pages for detailed property information, contacts, and organizations. Account Owner section is hidden when beneficial owner has been enriched.
- **Clickable Records**: Contact and organization cards/rows are fully clickable (no "View Details" links) for better mobile UX. Chevron indicators show navigable items. Links (email, domain, LinkedIn) work independently via stopPropagation.
- **Property Filters**: Collapsible filter panel with sections for:
  - Size filters (lot sqft range, net building sqft range)
  - Category/subcategory selection
  - Building class (A+/A/B/C/D)
  - HVAC types (AC type, heating type)
  - Linked records (organization/contact search with autocomplete)

### Technical Implementations
- **Property Classification**: Uses Texas PTAD state property type codes (SPTD_CD) from DCAD's ACCOUNT_APPRL_YEAR table. Filtering is defined in `src/lib/property-classifications.ts`:
  - **Included**: B11 (Apartments), B12 (Duplexes), F10 (Commercial), F20 (Industrial)
  - **Excluded**: Single-family (A11-A20), vacant land (C11-C14), agricultural (D10-D20), utilities (J10-J80), personal property, exempt properties, etc.
- **Parcel Aggregation**: Properties are aggregated by GIS_PARCEL_ID to represent physical complexes. Parent properties contain constituent accounts (e.g., Northpark Mall with Neiman Marcus, Nordstrom as constituents).
- **Map Management**: A dedicated `DashboardMap` controller manages Mapbox GL lifecycle and state, ensuring a consistent and performant map experience.
- **Search Functionality**: Integrates Mapbox Search Box API for POI, address, and location searches, providing context-aware results and smart zoom levels.

## External Dependencies
- **Snowflake**: For Regrid parcel data access and ingestion.
- **Mapbox**: Used for interactive mapping, geocoding, and Point of Interest (POI) enrichment.
- **LeadMagic**: Provides email validation services.
- **Hunter.io**: Organization domain enrichment (Company Enrichment API) for contact info (emails, phones), social profiles, parent company relationships, tech stack.
- **EnrichLayer**: LinkedIn-sourced data including profile photos (0 credits), company profiles with industry classification (~6 credits per company).
- **Clerk Auth**: Handles user authentication with automatic legacy user migration.
- **Google Gemini**: Utilized for AI-based property enrichment, including contact discovery, beneficial owner identification, and management company detection.

## Organization Domain Enrichment (Hunter.io + EnrichLayer)
- **Implementation**: `src/lib/organization-enrichment.ts`, `src/lib/hunter.ts`, `src/lib/enrichlayer.ts`
- **Schema**: Uses Clearbit-compatible schema for future provider flexibility
- **Trigger**: Automatic enrichment when organizations with domains are created during property enrichment
- **Manual Trigger**: Organization detail page has "Enrich Company" button for orgs that haven't been enriched
- **Parent Company Discovery**: Automatically creates and enriches parent and ultimate parent org records
- **Recursive Enrichment**: Depth-limited to 2 levels to prevent infinite loops
- **Domain Normalization**: All domains are lowercase and trimmed for consistent matching
- **Data Sources**:
  - **EnrichLayer** (LinkedIn-sourced): Industry classification, categories (stored as tags), company name, description, location, logo, founded year, company size
  - **Hunter.io**: Contact info (phone numbers, emails), social handles (LinkedIn, Twitter, Facebook, Crunchbase), parent/ultimate parent domains, tech stack
- **Industry Classification**: Uses EnrichLayer for accurate industry data (e.g., "Hospitals and Health Care" vs Hunter.io's misclassified "Air Freight & Logistics"). Hunter.io's industry fields (industryGroup, subIndustry, gicsCode, sicCode, naicsCode) are cleared to null.
- **EnrichLayer API Endpoints**:
  - `/api/v2/company/resolve` - Resolves domain to LinkedIn company URL (~1 credit)
  - `/api/v2/company` - Fetches full company profile with categories (~5 credits)
- **API Endpoint**: `POST /api/organizations/[id]/enrich` for manual enrichment

## AI Enrichment Rules
- **Model**: ALWAYS use `gemini-3-flash-preview` with search grounding (`tools: [{ googleSearch: {} }]`). NEVER change this model - if it returns empty responses, investigate the root cause rather than switching models.
- **Condo/HOA Exclusion**: The AI enrichment prompt explicitly excludes individual condo unit owners and HOA board members from being listed as beneficial owners or having their companies associated with properties. Instead, it focuses on finding management companies, building developers, and master association contacts for commercial decisions.
- **Building Square Footage**: Calculated as sum of all building taxable objects MINUS parking structures. Parking sqft is tracked separately in `dcad_parking_sqft`.
- **Lot Square Footage**: Sourced from DCAD LAND table (AREA_SIZE converted to sqft based on AREA_UOM_DESC).
- **Source Tracking**: Both lot_sqft and building_sqft have source tracking fields (lot_sqft_source, building_sqft_source) with precedence: AI validated (70%+ confidence) > DCAD > Regrid.