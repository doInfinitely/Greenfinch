# Greenfinch - Commercial Property Prospecting Tool

## Overview
Greenfinch is a commercial property prospecting tool designed for sales representatives. Its primary purpose is to provide detailed commercial property information and validated contact details for decision-makers. The application integrates Regrid parcel data, Mapbox POI enrichment for property categorization, and email validation through LeadMagic, all presented on interactive Mapbox maps. The business vision is to streamline commercial real estate prospecting, offering a comprehensive, data-driven platform for nationwide expansion, with an initial focus on a specific ZIP code for its Minimum Viable Product (MVP).

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
The project is organized into `/src/app` for API routes and UI pages, `/src/components` for reusable React components, and `/src/lib` for backend logic, database interactions, and utility functions. Key areas include:
- **API Endpoints**: Structured for properties, contacts, organizations, data ingestion, enrichment, and authentication.
- **Admin Dashboard**: Provides controls for data ingestion and enrichment processes.
- **User Interface**: Pages for property search, contact management, organization viewing, and list management.
- **Core Logic**: Modules for authentication, database operations, AI enrichment, data ingestion (ETL), email validation, and geographic data handling (Regrid, Mapbox).

### Data Sources
- **Snowflake**: Utilized for Regrid parcel data ingestion into PostgreSQL.
- **PostgreSQL**: Primary operational database storing enriched property records, contacts, organizations, and user-generated lists.
  - **Schema includes**: `users`, `sessions`, `properties`, `contacts`, `organizations`, `property_contacts`, `parcel_to_property`, `user_lists`, `list_items`.
  - **Property Data**: Stores key identification, address, owner, mailing, property characteristics, structure details, and location.

### Authentication System
- **Replit Auth**: Implemented using session-based authentication with OpenID Connect + PKCE flow.
- **Role-Based Access Control**: Supports user roles (`standard_user`, `team_manager`, `account_admin`, `system_admin`) to manage access to features and routes. Admin routes are protected, and list ownership is enforced at the API level.

## External Dependencies
- **Snowflake**: For accessing and ingesting Regrid parcel data.
- **Mapbox**: Used for interactive maps, geocoding, and Point of Interest (POI) enrichment.
- **LeadMagic**: Integrated for email validation services.
- **Replit Auth**: Provides authentication services.
- **Google Gemini**: Available for AI-based enrichment if needed (not currently used for classification).
- **Notion**: Used for documentation hosting.

## Classification System
Property classification uses a rule-based approach in `src/lib/zoning-classification.ts`:
- **Categories**: single_family, multifamily, commercial, public (or null if unclassified)
- **Priority**: Checks zoning_description first (more specific), then falls back to usedesc
- **Commercial detection**: Properties with classification "commercial" or "multifamily" are considered commercial for prospecting
- **Pattern matching**: Uses regex patterns for single-family, multifamily, commercial, and public/institutional detection
- **Special permits**: Handles S-P-1, S-P-2, PUD with context-aware classification

## Recent Changes
- 2026-01-11: Fixed map style switch to preserve position/zoom during satellite transitions (prevents animation reset)
- 2026-01-11: Fixed enriched property display - now shows common name if ANY enrichment fields present (not just status=completed)
- 2026-01-11: Updated enrichment prompt to explicitly request emails/phones and exclude deceased contacts
- 2026-01-11: Fixed React duplicate key warning in contact list by using composite key with index
- 2026-01-11: Property details now show beneficial owner and management company prominently, with registered owners in collapsible section
- 2026-01-11: Fixed lot size to use ll_gisacre field (converted to sqft: acres * 43560)
- 2026-01-11: Fixed building size to use area_building field from Regrid
- 2026-01-11: LinkedIn discovery now skipped during bulk enrichment - available as on-demand action per contact
- 2026-01-11: Created contact detail page (/contact/[id]) showing full info, associated properties, and orgs
- 2026-01-11: Added LinkedIn discovery API endpoint (/api/contacts/[id]/linkedin) for individual contacts
- 2026-01-11: Contact display in property details now shows "No email/phone/LinkedIn" placeholders with icons
- 2026-01-11: Added "View Details" link on each contact card leading to contact detail page
- 2026-01-11: Fixed enrichment storage - changed storeResults to true, now saves contacts/orgs to database
- 2026-01-11: Optimized LinkedIn discovery - limited to 3 contacts, parallel with pLimit, 15s timeout per lookup
- 2026-01-11: Removed duplicate LinkedIn lookups from high-priority validation step
- 2026-01-11: Fixed duplicate map event handlers issue causing cluster zoom reset
- 2026-01-11: Fixed map style loading race condition (checks isStyleLoaded before adding layers)
- 2026-01-11: Fixed cluster click behavior to use getClusterExpansionZoom for proper expansion
- 2026-01-11: Property detail map now highlights the parcel and shows address/common name overlay
- 2026-01-11: Enhanced contact enrichment: AI prompt now requests 5-10 contacts prioritized by relevance
- 2026-01-11: Added LeadMagic email finder integration for contacts missing emails
- 2026-01-11: Added LinkedIn URL discovery using Gemini with web grounding
- 2026-01-11: Implemented auto-validation flow for property manager/facilities contacts
- 2026-01-11: High-priority contacts flagged for review when enrichment fails or info incomplete
- 2026-01-11: Removed confidence badges from UI for contact names and property common name
- 2026-01-11: Property details now show lot size, year built, building size instead of property values
- 2026-01-11: All owners displayed equally without "Registered Owner" vs "Additional Owners" distinction
- 2026-01-11: Back button preserves map state (position/zoom) via URL params
- 2026-01-11: Dashboard redesign with property list panel, filters, and map/list view toggle
- 2026-01-11: Added FilterBar component with category, subcategory, enriched status, and ZIP code filters
- 2026-01-11: Added PropertyList component with panel and full-width table modes
- 2026-01-11: Switched typeahead to Mapbox Search Box API for better POI support
- 2026-01-11: GeoJSON API now supports filtering by category, subcategory, enriched, zipCode
- 2026-01-11: Enrichment API now uses PostgreSQL data first (already ingested), falls back to Snowflake only if needed
- 2026-01-11: Increased Snowflake parcel LIMIT from 10 to 100 for properties with many parcels
- 2026-01-11: Map popup now shows "Residential" indicator for single-family properties instead of owner/POI info
- 2026-01-11: Updated ownership section to show all owners from aggregated parcels (not just primary owner)
- 2026-01-11: Map improvements: hide individual properties until zoom 15+, bright green boundary lines, satellite view at zoom 14+, fill only on hover
- 2026-01-11: Replaced classification system with new pattern-based approach using usedesc and zoning_description
- 2026-01-11: Removed old AI-based classification.ts and deprecated test routes
- 2026-01-11: Removed unused Snowflake functions (searchCommercialProperties, getCommercialPropertiesInBounds)
- 2026-01-11: Cleaned up ingestion.ts - removed old commercial filter arrays and batch ingestion functions
- 2026-01-11: Re-ran MVP ingestion with new classification: 9,501 parcels -> 6,861 properties -> 299 commercial/multifamily (ZIP 75225)
- 2026-01-11: Fixed Regrid parcel tiles - changed API from v2 to v1, adjusted zoom levels (minzoom: 10, visible at 14+)
- 2026-01-11: Enhanced typeahead API with POI resolution - now resolves POI searches to property addresses via reverse geocode
- 2026-01-11: Fixed ZIP filter bug - changed from `szip` to `szip5` column for correct 5-digit ZIP filtering
- 2026-01-11: Lot size now displays in acres (using MAX aggregation from ll_gisacre, not summed across parcels)
- 2026-01-12: Fixed map snap-back issue - moved style switching to idle event, removed complex interaction tracking, separated isStyleSwitching from animation logic
- 2026-01-12: Dashboard redesign - replaced toggle view with tab-based routing (/dashboard/map and /dashboard/list)
- 2026-01-12: Map tab: 2/3 map with 1/3 synced property list showing only visible properties via onBoundsChange
- 2026-01-12: List tab: Full database search with PostgreSQL ILIKE pattern matching on property name/address/owner
- 2026-01-12: Updated clustering: clusterMaxZoom: 13, clusterRadius: 120, clusters visible < zoom 14, individual properties visible >= zoom 14
- 2026-01-12: Added /api/properties/search endpoint with PostgreSQL text search and commercial property filtering
- 2026-01-12: Replaced complex MapView with SimpleMapView for dashboard - fewer state management issues, cleaner lifecycle
- 2026-01-12: SimpleMapView uses refs for callbacks to avoid closure issues and checks isStyleLoaded before layer operations
- 2026-01-12: Complete map rebuild with imperative DashboardMap controller (src/map/DashboardMap.ts)
- 2026-01-12: DashboardMap class manages mapbox-gl lifecycle outside React render cycle - eliminates flickering
- 2026-01-12: MapCanvas React wrapper (src/map/MapCanvas.tsx) mounts controller once, uses refs for callbacks
- 2026-01-12: Style swap at zoom 14 now preserves property data via currentData persistence and reapply on style.load
- 2026-01-12: Clustering: clusterMaxZoom 13, clusterRadius 100, clusters visible below zoom 14, parcels/satellite at zoom 14+
- 2026-01-12: Increased clusterRadius to 160 for 8-12 clusters per view
- 2026-01-12: Added parcel fill layer with hover effect (25% green fill on hover, transparent otherwise)
- 2026-01-12: Parcel boundaries only visible at zoom 14+ with feature-state hover support
- 2026-01-12: Added popup on parcel mouseover showing common name (if available) and address
- 2026-01-12: Parcel click navigates to property detail page via location matching
- 2026-01-12: Fixed type conversion error in ingestion - lotSqft, buildingSqft, yearBuilt, numFloors now rounded to integers before database insert
- 2026-01-12: Re-ran MVP ingestion: 9,501 parcels → 6,861 properties → 299 commercial/multifamily (0 errors)
- 2026-01-13: Fixed satellite style switching - handlers persist across style changes, only layers re-added on style.load
- 2026-01-13: Added isStyleSwitching guards to parcel hover handlers to prevent errors during style transitions
- 2026-01-13: Added propertyWebsite, propertyManagerWebsite, aiRationale fields to properties schema
- 2026-01-13: Enrichment prompt requests property website, manager website, and classification rationale
- 2026-01-13: Property detail view shows enrichment details section (last researched, websites, AI rationale)
- 2026-01-13: Dashboard list view shows lot size (acres) and building sq ft columns with proper formatting
- 2026-01-13: Common name display logic - only shows when property is enriched (enriched && commonName check)
- 2026-01-13: Fixed cluster click error - captured coordinates before async callback to prevent undefined access
- 2026-01-13: DashboardMap now supports initialCenter and initialZoom configuration
- 2026-01-13: Property detail page now uses same DashboardMap component as dashboard (consistent map experience)
- 2026-01-13: Property detail map centers and zooms on the property location at zoom level 16 (satellite view)
- 2026-01-13: Added MapSearchBar component using Mapbox Search Box API for POI/address/neighborhood search
- 2026-01-13: Search results show "In database" badge when matching a property in our PostgreSQL data
- 2026-01-13: If search result matches a property, flies to zoom 17 then navigates to property details
- 2026-01-13: If no property match, flies to location at zoom 15 to show surrounding properties
- 2026-01-13: Added flyTo method to DashboardMap and exposed via MapCanvasHandle ref
- 2026-01-13: Enhanced search to support POI, address, street, place (city), neighborhood, and postcode types
- 2026-01-13: Search results now context-aware - biased toward current map center via proximity parameter
- 2026-01-13: Search results show full address context and type labels (Address, Street, City, Neighborhood, ZIP Code, Place)
- 2026-01-13: Smart zoom levels based on result type: POI/address (16), street (15), neighborhood (14), postcode (13), place (12)
- 2026-01-14: Changed zoom level for parcel boundaries and satellite view from 14 to 15
- 2026-01-14: Updated clusterMaxZoom from 13 to 14 (clusters visible below zoom 15)
- 2026-01-14: Added Google Maps API key to config endpoint (GOOGLE_MAPS_API_KEY)
- 2026-01-14: Created Google Maps proof-of-concept with deck.gl for Regrid parcel tiles
- 2026-01-14: GoogleMapController class in src/map/GoogleMap.ts with clustering, satellite view at zoom 15+
- 2026-01-14: GoogleMapCanvas React wrapper in src/map/GoogleMapCanvas.tsx
- 2026-01-14: Test page at /dashboard/google-map for Google Maps POC validation