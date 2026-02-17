# greenfinch.ai - Commercial Property Prospecting Tool

## Overview
greenfinch.ai is a commercial property prospecting tool that provides sales representatives with commercial property information and validated contact details for decision-makers. It integrates Regrid parcel data, Mapbox POI enrichment, and email validation through LeadMagic, presented on interactive maps. The platform aims to streamline commercial real estate prospecting through a comprehensive, data-driven approach, with an MVP focused on a specific Dallas ZIP code and a vision for nationwide expansion.

## User Preferences
- Preferred communication style: Simple, everyday language
- Use only Standard Regrid fields (avoid Premium fields like zoning_type, zoning_subtype, homestead_exemption)
- Use Mapbox for maps with separate logic testing
- Use Replit Auth for authentication
- Use zoning-only classification (rule-based, no AI) for commercial/multifamily detection
- Use Mapbox POI enrichment for category/subcategory assignment
- Design for nationwide expansion (MVP scope: ZIP 75225 in Dallas, TX)
- Light mode only: Dark mode is disabled; the app always serves light mode design regardless of device preferences

## System Architecture

### Framework
- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS v3
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Runtime**: Node.js 20

### Project Structure
The project uses a standard Next.js structure with `/src/app` for API routes and UI pages, `/src/components` for reusable React components, and `/src/lib` for backend logic, database interactions, and utility functions.

### Data Sources
- **Snowflake**: Used for ingesting Regrid parcel data into PostgreSQL.
- **PostgreSQL**: The primary operational database, storing enriched property records, contacts, organizations, and user-generated lists.

### Authentication System
- **Clerk Auth**: Implements authentication using Clerk SDK with Next.js proxy.
- **Migration Support**: Legacy Replit Auth users are automatically migrated to Clerk.
- **Role-Based Access Control**: Uses Clerk Organizations for role management with defined roles and permissions for internal and external users.

### UI/UX Decisions
- **Navigation**: AppSidebar component with grouped navigation sections: Prospecting, Pipeline, Admin, Internal, Help.
- **Interactive Maps**: Utilizes Mapbox for displaying property data, clusters, and interactive elements.
- **Dashboard**: Features a tab-based interface for map and list views with synchronized property lists and a search bar.
- **Property Details**: Dedicated pages for detailed property information, contacts, and organizations, with hidden sections when beneficial owner data is enriched.
- **Clickable Records**: Contact and organization cards/rows are fully clickable with chevron indicators for mobile UX.
- **Property Filters**: Collapsible filter panel with sections for size, category/subcategory, building class, HVAC types, and linked records.
- **Mobile Responsiveness**: Pipeline board uses CSS snap scrolling with swipe hints on mobile. Filter selects use shadcn Select components for consistent styling. Property page action buttons use flex-wrap for mobile stacking.
- **Dropdown/Overlay Backgrounds**: All dropdown menus, select menus, popovers, dialogs, and overlay elements MUST have explicit opaque backgrounds (e.g., `bg-popover`, `bg-card`, or `bg-white dark:bg-gray-900`). Never use transparent backgrounds for floating/overlay UI elements.

### Technical Implementations
- **Property Classification**: Uses Texas PTAD state property type codes for classification of commercial and multifamily properties, excluding single-family, vacant land, and others.
- **Parcel Aggregation**: Properties are aggregated by GIS_PARCEL_ID to represent physical complexes, handling parent-constituent relationships.
- **Map Management**: A dedicated `DashboardMap` controller manages Mapbox GL lifecycle and state.
- **Search Functionality**: Integrates Mapbox Search Box API for POI, address, and location searches.
- **Cascade Enrichment Architecture**: Uses a multi-provider cascade approach for enrichment with provider tracking and early-exit optimization for both organizations and contacts.
- **Email Validation Rules**: Prioritizes ZeroBounce with NeverBounce as fallback. Catch-all emails are invalid, and personal email providers trigger further business email enrichment.
- **Enrichment Queue System**: A non-blocking queue system allows background processing of enrichment tasks with UI progress updates and persistence.
- **Horizontal Scaling Infrastructure**: Redis-backed distributed state management using Upstash for cross-instance coordination.
  - **Redis State**: Enrichment queue, caches (ZeroBounce, Mapbox POI, Google Places) use Redis with in-memory fallback when Redis unavailable.
  - **Distributed Locking**: Uses Redis SETNX pattern with unique tokens for batch enrichment locks (5-minute timeout). Fail-closed on Redis errors to prevent concurrent access.
  - **Cache TTLs**: ZeroBounce 1hr, Mapbox POI 24hr, Google Places 24hr.
  - **Key Prefixes**: `gf:cache:`, `gf:queue:`, `gf:lock:` for namespace isolation (helpers auto-prefix).
- **API Performance Optimizations**:
  - **Cursor Pagination**: Contacts and properties APIs use cursor-based pagination for stable, efficient pagination on large datasets. Base64-encoded cursors contain id and sort value.
  - **Rate Limiting**: Redis-based fixed window rate limiting protects expensive endpoints (enrichment, validation, waterfall) with 20 req/min limit. Falls back to in-memory when Redis unavailable.
  - **Client Debouncing**: useDebounce hook (300ms default) applied to search inputs and filter components to reduce API calls.
  - **Connection Pool Tuning**: PostgreSQL pool configured with max=20 connections, 30s idle timeout, 5s connection timeout.
- **Database Performance**: Indexes on properties.zip, properties.assetSubcategory, properties.enrichmentStatus, and composite indexes on contactOrganizations for relationship lookups. N+1 queries fixed via batch fetching with inArray() in contacts and analytics APIs.
- **Organization Domain Enrichment**: Automates enrichment for organizations using Hunter.io and EnrichLayer, including parent company discovery and industry classification.
- **AI Enrichment Rules**: Employs `gemini-3-flash-preview` with search grounding for property enrichment, excluding condo/HOA and focusing on management companies and developers. Building and lot square footage are calculated with source tracking and precedence rules.
- **Notifications System**: In-app notification system supporting @ mentions in notes and follow-up action reminders.
  - **@ Mentions**: Users can @mention team members in property notes. Mentioned users receive in-app notifications.
  - **Follow-up Actions**: Schedule follow-ups for properties with quick options (tomorrow 9am, next week 9am) or custom dates.
  - **Notification Bell**: Located in the global app header (next to enrichment queue). Shows unread count with real-time polling (60s). Accessible from any page.
  - **Notification Types**: `mention` (when mentioned in notes), `action_due` (reminder for due actions), `action_assigned` (when assigned a follow-up by another user).
- **Add Contact to Property**: Allows users to add contacts and create contact-property relationships directly from property detail pages.
  - **4-Step Wizard Modal**: Search existing contacts with autocomplete → associate with role selection, OR create new contacts via Apollo enrichment.
  - **Apollo Enrichment**: Supports lookup by email or LinkedIn URL using Apollo People Match API. Prefills contact form with enriched data.
  - **ZeroBounce Validation**: New contact emails are validated with ZeroBounce and status is stored with the contact.
  - **Deduplication**: Server-side checks prevent duplicate contacts by normalized email or LinkedIn URL. Returns existing contact ID with suggestion to use associate endpoint.
  - **Relationship Roles**: Contacts are linked to properties via propertyContacts junction table with role field (uses ROLE_LABELS constants).
  - **Targeted Refresh**: Uses fetchProperty() instead of full page reload for better UX after adding contacts.
- **Unread Property Indicators**: Tracks which properties each user has viewed, showing visual indicators for unviewed ("new") properties.
  - **View Tracking**: When a user opens a property detail page, a view record is created/updated in `property_views` table (scoped by user + org).
  - **Blue Dot Indicators**: Unviewed properties show a blue dot and bolder text in both list view (desktop table and mobile cards) and PropertyList panel view.
  - **Mark as New**: Users can mark a property as "new" again via the property detail page dropdown menu (deletes the view record).
  - **View Status Filter**: PropertyFilters includes a "View Status" section with All / New Only / Viewed options for client-side filtering.
  - **API**: `GET/POST/DELETE /api/properties/views` for batch view status checks, recording views, and removing view records.

## External Dependencies
- **Snowflake**: For Regrid parcel data access and ingestion.
- **Mapbox**: For interactive mapping, geocoding, and Point of Interest (POI) enrichment.
- **LeadMagic**: Provides email validation services.
- **Hunter.io**: For organization domain enrichment (contact info, social profiles, parent companies, tech stack).
- **EnrichLayer**: For LinkedIn-sourced company and contact data (profile photos, company profiles, industry classification).
- **Clerk Auth**: Handles user authentication and legacy user migration.
- **Google Gemini**: Utilized for AI-based property enrichment, including contact discovery and beneficial owner identification.

## Future Exploration

### Refactor to use Clerk IDs everywhere
Currently the system uses separate database user IDs (`dbUserId`) alongside Clerk user IDs for certain operations like pipeline owner assignments. Consider refactoring to use Clerk IDs consistently across all operations for simpler ID handling. This would require:
- Migrating database `users.id` to use Clerk user IDs as primary key
- Updating all foreign key references (pipeline.ownerId, notes.userId, actions.assignedTo, etc.)
- Removing dual-ID handling in org/members API and related components

### Admin CSV Enrichment Page (PDL Integration)
Build an admin-only page that allows bulk person enrichment via CSV upload:
- Upload CSV with columns: name, company domain, location (+ other optional columns)
- Select enrichment provider (e.g., People Data Labs)
- Parse CSV and call PDL Person Enrichment API for each row
- Display enriched results in a table with export functionality
- Will require PDL API key to be added as a secret