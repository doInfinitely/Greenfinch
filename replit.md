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
- **Replit Auth**: Implements session-based authentication using OpenID Connect + PKCE flow.
- **Role-Based Access Control**: Supports user roles (`standard_user`, `team_manager`, `account_admin`, `system_admin`) for managing access to features and routes, with protected admin routes and enforced list ownership.

### UI/UX Decisions
- **Interactive Maps**: Utilizes Mapbox for displaying property data, clusters, and interactive elements.
- **Dashboard**: Features a tab-based interface for map and list views, with synchronized property lists and a search bar.
- **Property Details**: Dedicated pages for detailed property information, contacts, and organizations.

### Technical Implementations
- **Property Classification**: Employs a rule-based system in `src/lib/zoning-classification.ts` for categorizing properties as `single_family`, `multifamily`, `commercial`, or `public` based on `zoning_description` and `usedesc` fields.
- **Map Management**: A dedicated `DashboardMap` controller manages Mapbox GL lifecycle and state, ensuring a consistent and performant map experience.
- **Search Functionality**: Integrates Mapbox Search Box API for POI, address, and location searches, providing context-aware results and smart zoom levels.

## External Dependencies
- **Snowflake**: For Regrid parcel data access and ingestion.
- **Mapbox**: Used for interactive mapping, geocoding, and Point of Interest (POI) enrichment.
- **LeadMagic**: Provides email validation services.
- **Replit Auth**: Handles user authentication.
- **Google Gemini**: Utilized for AI-based property enrichment, including contact discovery, beneficial owner identification, and management company detection.