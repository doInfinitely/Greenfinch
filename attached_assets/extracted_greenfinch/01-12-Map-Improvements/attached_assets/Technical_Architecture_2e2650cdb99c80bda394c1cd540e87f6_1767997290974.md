# Technical Architecture

# Greenfinch Technical Architecture

## Overview

Greenfinch is a prospecting tool for salespeople selling services to commercial properties. The core value proposition: we provide sales reps with detailed property information and—most importantly—validated contact information for the multiple stakeholders (owners, property managers, facilities directors) who influence purchase decisions.

This document explains how data flows through the system, how our databases are structured, and how the UI components interact with backend services.

> 🔗 **Live Demo:** [Greenfinch App Prototype](https://client-prospector--greenfinch.replit.app/app)
> 

---

## Table of Contents

1. [The Big Picture](about:blank#1-the-big-picture)
2. [Data Sources](about:blank#2-data-sources)
3. [Parcels vs. Properties](about:blank#3-the-core-problem-parcels-vs-properties)
4. [The Enrichment Pipeline](about:blank#4-the-enrichment-pipeline)
5. [Change Detection and Incremental Updates](about:blank#5-change-detection-and-incremental-updates)
6. [Contact Normalization](about:blank#6-contact-normalization)
7. [Database Schema](about:blank#7-database-schema)
8. [The Property-Contact-Organization Graph](about:blank#8-the-property-contact-organization-graph)
9. [Runtime APIs](about:blank#9-runtime-apis)
10. [User Interface Components](about:blank#10-user-interface-components)
11. [Implementation Sequence](about:blank#11-implementation-sequence)

---

## 1. The Big Picture

At the highest level, the system works like this:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DATA SOURCES   │ ──▶│   PROCESSING    │ ──▶ │  SERVING DB     │
│                 │     │                 │     │                 │
│ • Regrid        │     │ • Deduplicate   │     │ • Properties    │
│ • Clay.com      │     │ • AI Enrich     │     │ • Contacts      │
│                 │     │ • Normalize     │     │ • Organizations │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │   WEB APP UI    │
                                                │                 │
                                                │ • Property List │
                                                │ • Map View      │
                                                │ • Contacts      │
                                                │ • User Lists    │
                                                └─────────────────┘
```

**Data flows in two modes:**

| Mode | When | What Happens |
| --- | --- | --- |
| **Initial Load** | Once, at pilot launch | Pull all Regrid data → deduplicate → enrich with AI → normalize contacts → write to serving database |
| **Incremental Update** | When Regrid data changes | Detect changed parcels via `ll_updated_at` → re-enrich only affected properties → update serving database |
| **Runtime** | User interacts with app | UI queries serving database; uses Regrid APIs for map tiles and address search |

---

## 2. Data Sources

### 2.1 Regrid (via Snowflake)

Regrid is our source for baseline parcel data. We access it through Snowflake, using their standard parcel dataset (no premium add-ons).

**Key identifier fields we use from Regrid:**

| Field | Type | Description |
| --- | --- | --- |
| `ll_uuid` | uuid | **Primary identifier.** Uniquely identifies a single parcel. Stable across county data refreshes. |
| `ll_stack_uuid` | text | **Stack identifier.** Groups parcels with identical geometries (e.g., condo units in same building). All parcels in a stack share the same `ll_stack_uuid`.  (**Note: This ID is not stable and may change as parcel data is updated.)** |
| `ll_updated_at` | timestamp | **Change detection.** Timestamp of last modification to this row. Used to detect when we need to re-enrich. |
| `ll_last_refresh` | date | Date Regrid last refreshed data from the county. |
| `ll_stable_id` | text | Indicates if `ll_uuid` changed during last refresh. Null = new parcel; non-null = matched to previous data. |

**Property information fields:**

| Field | Type | Description |
| --- | --- | --- |
| `address` | text | Parcel/situs address (e.g., “12109 KATZ RD”) |
| `saddno` | text | Street number |
| `saddpref` | text | Street prefix (e.g., “N”) |
| `saddstr` | text | Street name |
| `saddsttyp` | text | Street type (e.g., “RD”, “AVE”) |
| `sunit` | text | Unit number |
| `scity` | text | City |
| `state2` | text | State (2-letter) |
| `szip` | text | ZIP code |
| `county` | text | County name |

**Lot and structure fields:**

| Field | Type | Description |
| --- | --- | --- |
| `ll_gisacre` | double | **Lot size in acres** (calculated by Regrid from geometry) |
| `yearbuilt` | integer | Year structure was built |
| `numstories` | double | Number of stories |
| `numunits` | integer | Number of living units |
| `struct` | boolean | Whether structure exists on parcel |
| `area_building` | integer | **Total building square footage** (Regrid “Building Area”). |

**Ownership fields:**

| Field | Type | Description |
| --- | --- | --- |
| `owner` | text | Owner name (standardized) |
| `owner2` | text | Second owner name |
| `mailadd` | text | Mailing address |
| `mail_city` | text | Mailing city |
| `mail_state2` | text | Mailing state |
| `mail_zip` | text | Mailing ZIP |

**Land use and valuation fields:**

| Field | Type | Description |
| --- | --- | --- |
| `usecode` | text | Parcel use code (varies by municipality) |
| `usedesc` | text | Parcel use description |
| `zoning` | text | Zoning code |
| `zoning_description` | text | Human-readable zoning name |
| `parval` | double | Total parcel value |
| `landval` | double | Land value |
| `improvval` | double | Improvement value |
| `saleprice` | double | Last sale price |
| `saledate` | date | Last sale date |

**Other useful fields:**

| Field | Type | Description |
| --- | --- | --- |
| `parcelnumb` | text | Assessor’s parcel ID |
| `geoid` | text | FIPS code (state + county) |
| `lat` | text | Latitude (centroid) |
| `lon` | text | Longitude (centroid) |
| `legaldesc` | text | Legal description |

**Regrid also provides runtime APIs:**

| API | Purpose | Returns |
| --- | --- | --- |
| Tile API | Renders parcel boundaries on a map | Geometries with `ll_uuid` for each parcel |
| Typeahead API | Address autocomplete search | Matching addresses with `ll_uuid` |

### 2.2 Clay.com

Clay is used to build targeted contact lists—specifically, people with titles like “Property Manager,” “Facilities Director,” or “Asset Manager” at commercial real estate firms.

Clay exports are CSV files containing:
- Name
- Title
- Company name
- Company domain

These contacts are imported into our system and normalized using our internal deduplication logic (see Section 6).

---

## 3. Parcels vs. Properties

### 3.1 The Problem

Tax assessors often assign **multiple parcel records to the same physical piece of land**. Common scenarios:

| Scenario | Example |
| --- | --- |
| Multi-tenant office building | Each suite gets its own parcel record, all with identical boundaries |
| Condo buildings | Each unit is a separate parcel |
| Mixed-use buildings | Retail ground floor and residential upper floors may be separate parcels |

**Why this matters:** If we don’t handle this, a 10-story office building might appear as 10 separate “properties” in our UI—each showing only one floor’s owner. That’s useless for prospecting.

### 3.2 The Solution: Stack UUIDs

Regrid partially solves this by assigning a `ll_stack_uuid` to parcels that share identical geometries. All parcels in a “stack” represent the same physical property.

**Important notes about `ll_stack_uuid`:**
- The UUID used for `ll_stack_uuid` is the `ll_uuid` of one arbitrary parcel in the stack
- All parcels with the same geometry share the same `ll_stack_uuid`
- Parcels that are NOT part of a stack have `ll_stack_uuid = NULL`
- The `ll_stack_uuid` is **not stable** and may change across parcel updates. After the pilot, we will need to develop our own way of handling changes to the `ll_stack_uuid`

**Example:**

| ll_uuid | ll_stack_uuid | owner | address |
| --- | --- | --- | --- |
| abc-111 | abc-111 | Suite 100 LLC | 123 Main St |
| abc-222 | abc-111 | Suite 200 LLC | 123 Main St |
| abc-333 | abc-111 | Suite 300 LLC | 123 Main St |
| def-444 | *(null)* | Industrial Corp | 456 Oak Ave |

The first three parcels are the same building (they share `ll_stack_uuid = abc-111`). The fourth is a standalone property with no stack.

### 3.3 Our Deduplication Rule

We create one property record per unique physical location:

```sql
property_key = COALESCE(ll_stack_uuid, ll_uuid)
```

In the example above:
- Parcels abc-111, abc-222, abc-333 → **one property** (keyed by abc-111)
- Parcel def-444 → **one property** (keyed by def-444)

### 3.4 Preserving Information

When we collapse multiple parcels into one property, we **don't throw away data**. Instead, we store all the original parcel records in a JSON column, preserving the full address (including unit) and parcel number for each sub-property using Regrid's schema field names.

**Sub-Parcel Fields to Preserve (per parcel):**

| Field | Regrid Schema Name | Description |
| --- | --- | --- |
| Parcel UUID | `ll_uuid` | Unique parcel identifier |
| Parcel Number | `parcelnumb` | Assessor's parcel ID (APN) |
| Full Address | `address` | Street address (e.g., "5420 LBJ FWY") |
| Unit | `sunit` | Unit/suite number (e.g., "1300W", "520") |
| Owner | `owner` | Owner name for this parcel/unit |
| Owner 2 | `owner2` | Secondary owner (if any) |
| Use Description | `usedesc` | Parcel use type (e.g., "BPP", "Commercial") |
| Parcel Value | `parval` | Total assessed value for this parcel |
| Improvement Value | `improvval` | Value of improvements on this parcel |

**Example JSON structure:**

```json
{
  "property_id": "prop-001",
  "ll_stack_uuid": "b17d9f30-1cd2-4c8c-b698-9fcdf97be0bb",
  "address": "5420 LBJ FWY",
  "raw_parcels": [
    {
      "ll_uuid": "4685bfd3-aa4e-4a39-baf0-dc25d0700111",
      "parcelnumb": "99170316860000000",
      "address": "5420 LBJ FWY",
      "sunit": "1300W",
      "owner": "WEIZEL DANIEL",
      "usedesc": "BPP",
      "parval": 300.0,
      "improvval": 300.0
    },
    {
      "ll_uuid": "ee0c48b8-e6bf-4c59-85b6-9ba757d4b071",
      "parcelnumb": "99220119112000000",
      "address": "5420 LBJ FWY",
      "sunit": "1300R",
      "owner": "ROSEBOROUGH PATRICK",
      "usedesc": "BPP",
      "parval": 2430.0,
      "improvval": 2430.0
    }
  ]
}
```

### 3.5 Aggregation Rules

When collapsing stacked parcels into a single property, fields must be aggregated correctly to avoid double-counting or losing information.

**Fields to Take Once (NOT sum):**

These fields represent the physical property and are duplicated across all parcels in a stack:

| Field | Aggregation | Rationale |
| --- | --- | --- |
| `ll_gissqft` / `ll_gisacre` | `MAX` or `FIRST` | Lot size is identical across all parcels in a stack—it's the total land area, not per-unit |
| `ll_bldg_footprint_sqft` | `MAX` or `FIRST` | Building footprint is a property-level metric |
| `ll_bldg_count` | `MAX` or `FIRST` | Number of buildings on the property |
| `lat` / `lon` | `FIRST` | Centroid coordinates are identical across stack |
| `yearbuilt` | `MAX` | Building year (if present); take the most recent if multiple values |
| `numstories` | `MAX` | Number of stories is a building attribute |
| `city` / `county` / `state2` / `szip5` | `FIRST` | Location fields are identical |
| `zoning` / `zoning_description` | `FIRST` | Zoning applies to the land parcel |

**Fields to Sum Across Parcels:**

These represent individual unit-level values that should be totaled:

| Field | Aggregation | Rationale |
| --- | --- | --- |
| `parval` | `SUM` | Total property value = sum of all parcel values |
| `improvval` | `SUM` | Total improvement value across all units |

**Fields to Collect as Arrays:**

These vary per parcel and should be preserved for AI enrichment and display:

| Field | Aggregation | Rationale |
| --- | --- | --- |
| `owner` / `owner2` | `ARRAY_AGG(DISTINCT)` | Each unit may have different owners |
| `sunit` | `ARRAY_AGG` | List of all unit numbers in the building |
| `parcelnumb` | `ARRAY_AGG` | All parcel IDs for reference |
| `usedesc` | `ARRAY_AGG(DISTINCT)` | May have mixed uses (BPP + Commercial) |

**Fields to Handle Specially:**

| Field | Handling | Rationale |
| --- | --- | --- |
| `landval` | `MAX` | Land value is typically on the "parent" parcel only (others show 0) |
| `numunits` | `COUNT(parcels)` or `MAX` | If populated, use MAX; otherwise count parcels in stack as proxy |
| `ll_updated_at` | `MAX` | Most recent update across any parcel triggers re-enrichment |

**Example Aggregation SQL:**

```sql
SELECT
    COALESCE(ll_stack_uuid, ll_uuid::text) AS property_key,
    MIN(ll_uuid) AS source_ll_uuid,
    ll_stack_uuid,
    
    -- Take once (property-level)
    MIN(address) AS address,
    MAX(ll_gissqft) AS lot_sqft,
    MAX(ll_bldg_footprint_sqft) AS bldg_footprint_sqft,
    MAX(ll_bldg_count) AS bldg_count,
    MAX(yearbuilt) AS yearbuilt,
    MAX(numstories) AS numstories,
    MIN(lat) AS lat,
    MIN(lon) AS lon,
    MIN(city) AS city,
    MIN(county) AS county,
    MIN(state2) AS state2,
    MIN(szip5) AS szip5,
    
    -- Sum across parcels
    SUM(parval) AS total_parval,
    SUM(improvval) AS total_improvval,
    MAX(landval) AS landval,  -- Usually only on parent parcel
    
    -- Count
    COUNT(*) AS parcel_count,
    
    -- Preserve all sub-parcel details
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'll_uuid', ll_uuid,
            'parcelnumb', parcelnumb,
            'address', address,
            'sunit', sunit,
            'owner', owner,
            'owner2', owner2,
            'usedesc', usedesc,
            'parval', parval,
            'improvval', improvval
        )
    ) AS raw_parcels_json,
    
    MAX(ll_updated_at) AS last_regrid_update
FROM regrid.parcels
GROUP BY COALESCE(ll_stack_uuid, ll_uuid::text), ll_stack_uuid
```

This approach ensures the AI enrichment process can see **all** the owner names, unit numbers, and parcel details while correctly representing property-level metrics like lot size without inflation from double-counting.

---

## 4. The Enrichment Pipeline

The enrichment pipeline transforms raw Regrid data into our rich, deduplicated property database.

### 4.1 Initial Load (Run Once at Pilot Launch)

```
Step 1              Step 2                  Step 3              Step 4
────────────────    ────────────────────    ────────────────    ────────────────
Pull all parcels    Deduplicate             AI Enrichment       Normalize
from Snowflake      (collapse stacks)       (Gemini Flash)      Contacts
      │                   │                       │                   │
      ▼                   ▼                       ▼                   ▼
Raw parcels         One record per          Validated data +    Unique IDs for
(millions)          physical property       discovered          all contacts
                                            contacts/orgs       and orgs
```

### 4.2 Step-by-Step Detail

**Step 1: Pull from Snowflake**

Query all parcels from Regrid’s Snowflake tables. Filter to commercial properties using `usedesc` or `usecode` fields if needed.

```sql
SELECT *
FROM regrid.parcels
WHERE usedesc ILIKE '%commercial%'
   OR usedesc ILIKE '%office%'
   OR usedesc ILIKE '%industrial%'
   OR usedesc ILIKE '%retail%'
   -- etc.
```

**Step 2: Deduplicate**

Group parcels by `COALESCE(ll_stack_uuid, ll_uuid)`. For each group:
- Pick one parcel as the “primary” (e.g., first by `ll_uuid`)
- Aggregate all owner names, ll_uuids, and other varying fields into JSON arrays
- Output one row per property

```sql
-- Simplified example
SELECT
    COALESCE(ll_stack_uuid, ll_uuid::text) AS property_key,
    MIN(ll_uuid) AS source_ll_uuid,  -- Pick one uuid for API lookups
    ll_stack_uuid,
    MIN(address) AS address,
    MAX(ll_gissqft) AS lot_sqft,
    MAX(yearbuilt) AS yearbuilt,
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'll_uuid', ll_uuid,
            'owner', owner,
            'owner2', owner2,
            'sunit', sunit
        )
    ) AS raw_parcels_json,
    MAX(ll_updated_at) AS last_regrid_update
FROM regrid.parcels
GROUP BY COALESCE(ll_stack_uuid, ll_uuid::text), ll_stack_uuid
```

**Step 3: AI Enrichment (Gemini Flash 3.0)**

For each deduplicated property, we call Gemini with a prompt that includes all the collapsed parcel data. The AI:

| Task | Output |
| --- | --- |
| Validates/cleans property info | Corrected address, standardized lot size |
| Classifies asset type | "Multifamily", "Industrial", "Office", "Retail", "Mixed Use" |
| Researches ownership structure | Who owns this? Is it an individual or entity? |
| Discovers contacts | Property managers, facilities directors, leasing agents |
| Discovers organizations | Management companies, ownership entities, tenants |
| Maps relationships | "John Smith is Facilities Director at ABC Property Management, which manages this property" |

**Property Categorization Schema:**

The AI classifies properties into categories and subcategories using the following schema:

```json
{
  "Single-Family Residential": [
    "Single Family Home",
    "Townhouse",
    "Condominium",
    "Mobile Home",
    "Other Residential"
  ],
  "Multifamily": [
    "Apartment Complex",
    "Duplex/Triplex/Quadplex",
    "Mobile Home Park",
    "Senior Living",
    "Other Multifamily"
  ],
  "Office": [
    "Office Building",
    "Medical Office",
    "Business Park",
    "Flex Office",
    "Other Office"
  ],
  "Retail": [
    "Shopping Center",
    "Restaurant/Food Service",
    "Convenience/Gas Station",
    "Standalone Retail",
    "Other Retail"
  ],
  "Industrial": [
    "Warehouse/Distribution",
    "Manufacturing",
    "Flex/Light Industrial",
    "Self-Storage",
    "Other Industrial"
  ],
  "Hospitality": [
    "Hotel",
    "Motel",
    "Resort",
    "Extended Stay",
    "Other Hospitality"
  ],
  "Healthcare": [
    "Hospital",
    "Medical Center",
    "Assisted Living",
    "Outpatient Clinic",
    "Other Healthcare"
  ],
  "Public & Institutional": [
    "Government",
    "School/University",
    "Religious",
    "Recreation/Parks",
    "Other Institutional"
  ],
  "Mixed Use": [
    "Retail/Residential",
    "Office/Retail",
    "Office/Residential",
    "Commercial/Industrial",
    "Other Mixed Use"
  ],
  "Vacant Land": [
    "Commercial Land",
    "Industrial Land",
    "Residential Land",
    "Agricultural Land",
    "Other Vacant Land"
  ],
  "Agricultural": [
    "Farm/Ranch",
    "Vineyard/Orchard",
    "Greenhouse/Nursery",
    "Livestock",
    "Other Agricultural"
  ],
  "Special Purpose": [
    "Parking",
    "Sports/Fitness",
    "Entertainment",
    "Auto Service",
    "Other Special Purpose"
  ]
}
```

**Output format:** JSON object per property containing:

```json
{
  "property": {
    "validated_address": "123 Main Street, Suite 100",
    "validated_address_confidence": 0.95,
    "city": "Dallas",
    "state": "TX",
    "zip": "75201",
    "lat": 32.7876,
    "lon": -96.7985,
    "geocode_confidence": 0.98,
    "lot_sqft": 45000,
    "building_sqft": 125000,
    "year_built": 1985,
    "num_floors": 8,
    "asset_category": "Office",
    "asset_subcategory": "Medical Office",
    "category_confidence": 0.92,
    "property_class": "A",
    "common_name": "Downtown Medical Plaza",
    "common_name_confidence": 0.88,
    "regrid_owner": "DOWNTOWN MEDICAL LLC",
    "regrid_owner2": "SMITH FAMILY TRUST",
    "beneficial_owner": "Welltower Inc.",
    "beneficial_owner_confidence": 0.75,
    "beneficial_owner_type": "REIT",
    "management_type": "3rd Party",
    "management_company": "JLL",
    "management_company_domain": "[jll.com](http://jll.com)",
    "management_confidence": 0.85,
    "physical_intelligence": {
      "permeable_pct": 15,
      "impermeable_pct": 85,
      "parking_ratio": 3.5,
      "condition_note": "Well-maintained Class A medical office building"
    },
    "validation_logic": "Matched tax record owner 'DOWNTOWN MEDICAL LLC' to property at 123 Main St via county assessor records. Cross-referenced with CoStar listing showing JLL as property manager.",
    "discovery_process": "Identified JLL as PM via building signage in Google Street View and confirmed via JLL property listings page."
  },
  "contacts": [
    {
      "name": "John Smith",
      "name_confidence": 0.95,
      "title": "Facilities Director",
      "title_confidence": 0.90,
      "email": "[jsmith@jll.com](mailto:jsmith@jll.com)",
      "email_confidence": 0.85,
      "phone": "214-555-1234",
      "phone_confidence": 0.80,
      "linkedin_url": "[https://www.linkedin.com/in/johnsmith-facilitiesdirector](https://www.linkedin.com/in/johnsmith-facilitiesdirector)",
      "linkedin_confidence": 0.75,
      "employer_name": "JLL",
      "employer_domain": "[jll.com](http://jll.com)",
      "role_at_property": "operations_contact",
      "role_confidence": 0.88
    },
    {
      "name": "Jane Doe",
      "name_confidence": 0.92,
      "title": "Property Manager",
      "title_confidence": 0.88,
      "email": "[jane.doe@jll.com](mailto:jane.doe@jll.com)",
      "email_confidence": 0.82,
      "phone": "214-555-5678",
      "phone_confidence": 0.78,
      "linkedin_url": "[https://www.linkedin.com/in/janedoe-pm](https://www.linkedin.com/in/janedoe-pm)",
      "linkedin_confidence": 0.80,
      "employer_name": "JLL",
      "employer_domain": "[jll.com](http://jll.com)",
      "role_at_property": "property_manager",
      "role_confidence": 0.92
    }
  ],
  "organizations": [
    {
      "name": "JLL",
      "domain": "[jll.com](http://jll.com)",
      "role": "property_manager",
      "role_confidence": 0.90
    },
    {
      "name": "Welltower Inc.",
      "domain": "[welltower.com](http://welltower.com)",
      "role": "owner",
      "role_confidence": 0.75
    }
  ]
}
```

**Field Selection Logic for Final Property Database:**

When merging AI enrichment data with Regrid source data, use these rules to determine which fields to store:

| Field | Source Priority | Logic |
| --- | --- | --- |
| `address` | AI `validated_address` if `validated_address_confidence > 0.80`, else Regrid `address` | AI can correct formatting errors and add suite numbers |
| `owner`, `owner2` | Always keep Regrid values | Regrid owner data comes from tax records and is authoritative |
| `beneficial_owner` | AI only, if `beneficial_owner_confidence > 0.70` | AI discovers parent companies/REITs behind LLCs |
| `lat`, `lon` | AI if `geocode_confidence > 0.90`, else Regrid | AI may provide more precise building centroid |
| `asset_category`, `asset_subcategory` | AI if `category_confidence > 0.75` | AI classification is more granular than Regrid `usedesc` |
| `common_name` | AI if `common_name_confidence > 0.70` | Building names not available in Regrid |
| `management_company` | AI if `management_confidence > 0.75` | Not available in Regrid |
| Contacts | Store if `email_confidence > 0.80` AND email validation passes | Gate on both AI confidence and LeadMagic validation |

**Confidence Score Thresholds:**

| Threshold | Use Case |
| --- | --- |
| `> 0.90` | High confidence — use without review |
| `0.75 - 0.90` | Medium confidence — use but flag for potential review |
| `0.50 - 0.75` | Low confidence — store but don't display to users without review |
| `< 0.50` | Very low confidence — do not store, discard |

```

```

**Confidence score conventions:**

- All confidence scores are floats from `0.0` to `1.0`.
- Email gating logic is defined in Section 6.8.
- Suggested default threshold for storing/displaying phone, company domain, and LinkedIn URL: `> 0.80`.

**Step 4: Normalize Contacts**

Run all discovered contacts and organizations through our internal normalization process (see Section 6) to deduplicate and assign stable IDs.

---

## 5. Change Detection and Incremental Updates

After the initial load, we only re-process properties when Regrid data changes.

### 5.1 How Regrid Tracks Changes

Regrid provides two fields for change detection:

| Field | What it tells us |
| --- | --- |
| `ll_updated_at` | Timestamp of last modification to this row. Any change to any field updates this. |
| `ll_last_refresh` | Date Regrid last pulled fresh data from the county. |

### 5.2 Change Detection Process

We maintain a `regrid_sync_state` table that tracks the last time we synced:

```sql
CREATE TABLE regrid_sync_state (
    sync_id SERIAL PRIMARY KEY,
    last_sync_timestamp TIMESTAMP,  -- Max ll_updated_at we've processed
    sync_completed_at TIMESTAMP,
    parcels_processed INT,
    properties_updated INT
);
```

**Detection query:**

```sql
-- Find parcels updated since our last sync
SELECT *
FROM regrid.parcels
WHERE ll_updated_at > (
    SELECT last_sync_timestamp
    FROM regrid_sync_state
    ORDER BY sync_completed_at DESC
    LIMIT 1
)
```

### 5.3 Incremental Update Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  CHANGE DETECTION JOB (runs periodically or on-demand)         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Query Regrid for parcels where:                             │
│     ll_updated_at > last_sync_timestamp                         │
│                                                                 │
│  2. For each changed parcel:                                    │
│     • Find its property_key: COALESCE(ll_stack_uuid, ll_uuid)   │
│     • Add to "properties to re-enrich" set                      │
│                                                                 │
│  3. For each affected property:                                 │
│     • Pull ALL current parcels in that stack                    │
│     • Re-run deduplication logic                                │
│     • Re-run AI enrichment                                      │
│     • Re-run contact normalization                              │
│     • Update serving database                                   │
│                                                                 │
│  4. Update regrid_sync_state with new timestamp                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Handling Edge Cases

**New parcels:**
- `ll_stable_id = NULL` indicates a new parcel
- If it has an `ll_stack_uuid`, check if that stack already exists in our data
- If yes → add to existing property and re-enrich
- If no → create new property

**Deleted parcels:**
- Parcels that existed before but no longer appear
- Query our `parcel_to_property` table for ll_uuids not in current Regrid data
- For affected properties, re-run enrichment with remaining parcels
- If all parcels in a property are gone, mark property as inactive (don’t delete—preserve history)

**Split/combined parcels:**
- When `ll_stable_id = NULL` for a parcel in an area where we had data before
- May need to re-evaluate property boundaries
- Flag for manual review if significant changes

### 5.5 Sync State Table

```sql
CREATE TABLE regrid_sync_state (
    sync_id SERIAL PRIMARY KEY,
    last_sync_timestamp TIMESTAMP NOT NULL,
    sync_started_at TIMESTAMP NOT NULL,
    sync_completed_at TIMESTAMP,
    status TEXT DEFAULT 'running',  -- running, completed, failed
    parcels_checked INT,
    parcels_changed INT,
    properties_updated INT,
    error_message TEXT
);
```

---

## 6. Contact Normalization

### 6.1 The Deduplication Challenge

Contacts come from multiple sources:
- AI enrichment discovers contacts for properties
- Clay imports provide pre-built contact lists
- The same person may be discovered multiple times (e.g., they manage multiple properties)

We need to recognize when two contact records represent the same person.

### 6.2 Matching Rules

We use a tiered matching approach, from most confident to least:

**Tier 1: Email Match (Highest Confidence)**

```
IF email_a = email_b (case-insensitive, normalized)
THEN same person
```

Email is unique per person, so this is definitive.

**Tier 2: Name + Domain Match**

```
IF normalize(name_a) = normalize(name_b)
   AND domain_a = domain_b
THEN likely same person
```

Two people with the same name at the same company domain are very likely the same person.

**Tier 3: Name + Phone Match**

```
IF normalize(name_a) = normalize(name_b)
   AND normalize(phone_a) = normalize(phone_b)
THEN likely same person
```

### 6.3 Name Matching Libraries

Simple character-based fuzzy matching (e.g., Levenshtein distance) fails for common name variants like "Dick" vs "Richard" or "Bill" vs "William" that share few characters. We use specialized Python libraries to handle these cases.

**Primary Library: `nicknames`**

A hand-curated dataset of ~1100 English given names and their associated nicknames/diminutives.

```bash
pip install nicknames
```

```python
from nicknames import NickNamer

nn = NickNamer()

# Get nicknames for a canonical name
nicks = nn.nicknames_of("william")
# Returns: {'bela', 'bell', 'bill', 'billy', 'wil', 'will', 'willie', 'willy'}

nicks = nn.nicknames_of("richard")
# Returns: {'dick', 'dickie', 'dicky', 'rick', 'rickie', 'ricky', 'rich', 'richie'}

# Go the other way: nickname to canonical names
canonicals = nn.canonicals_of("dick")
# Returns: {'richard'}

# Check if two names are interchangeable
def names_are_equivalent(name1, name2):
    """Check if two first names refer to the same person."""
    name1, name2 = name1.lower().strip(), name2.lower().strip()
    
    if name1 == name2:
        return True
    
    # Check if name2 is a nickname of name1 (or vice versa)
    if name2 in nn.nicknames_of(name1):
        return True
    if name1 in nn.nicknames_of(name2):
        return True
    
    # Check if they share a common canonical form
    canonicals1 = nn.canonicals_of(name1) | {name1}
    canonicals2 = nn.canonicals_of(name2) | {name2}
    if canonicals1 & canonicals2:  # Set intersection
        return True
    
    return False

# Examples:
names_are_equivalent("Dick", "Richard")  # True
names_are_equivalent("Bill", "William")  # True
names_are_equivalent("Bob", "Robert")    # True
names_are_equivalent("John", "Jane")     # False
```

**Complementary Libraries:**

| Library | Purpose | Install |
| --- | --- | --- |
| `nameparser` | Parse names into components (first, middle, last, suffix). Handles "Lastname, Firstname" format. | `pip install nameparser` |
| `probablepeople` | ML-based name parsing that identifies nicknames in quotes, handles corporations vs people. | `pip install probablepeople` |
| `metaphone` | Phonetic matching for misspellings ("Steven" matches "Stephen"). Complements nickname lookup. | `pip install metaphone` |

### 6.3 Name Normalization

Names need to be normalized before comparison:

```python
def normalize_name(name):
    # Lowercase
    name = name.lower()

    # Remove punctuation
    name = re.sub(r'[^\w\s]', '', name)
    
    # Remove common suffixes
    for suffix in ['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq', 'mba']:
    name = re.sub(rf'\b{suffix}\.?\b', '', name)

    # Collapse whitespace
    name = ' '.join(name.split())

    return name.strip()
```

**Examples:**
- “John Smith Jr.” → “john smith”
- “JANE DOE, PhD” → “jane doe”
- “Robert J. Williams” → “robert j williams”

### 6.4 Email Normalization

```python
def normalize_email(email):
    email = email.lower().strip()

    # Handle Gmail plus addressing (john+work@gmail.com → john@gmail.com)
    if '@gmail.com' in email:
        local, domain = email.split('@')
        local = local.split('+')[0]
        email = f"{local}@{domain}"

    return email
```

### 6.5 Domain Extraction

```python
def extract_domain(email_or_url):
    if '@' in email_or_url:
        return email_or_url.split('@')[1].lower()
    else:
        # Remove protocol and www
        domain = re.sub(r'^https?://', '', email_or_url)
        domain = re.sub(r'^www\.', '', domain)
        domain = domain.split('/')[0].lower()
        return domain
```

### 6.6 The Normalization Process

**High-level flow**

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTACT NORMALIZATION                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input: New contact record (name, email, phone, domain, title)  │
│                                                                 │
│  1) Normalize fields                                            │
│  2) Attempt match (email → name+domain → name+phone)            │
│  3) Update existing OR insert new                               │
│                                                                 │
│  Output: contact_id (new or existing)                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Step 1: Normalize all fields**

```
normalized_name  = normalize_name(name)
normalized_email = normalize_email(email)           # if present
normalized_phone = normalize_phone(phone)           # if present
company_domain   = extract_domain(email or company_url)
```

**Step 2: Check for an existing match (in priority order)**

**2A. Email match (highest confidence)**

```sql
SELECT contact_id
FROM contacts
WHERE normalized_email = :normalized_email
LIMIT 1;
```

**2B. Name + domain match (with nickname awareness)**

```python
# First, check for exact normalized name match
exact_match = db.query("""
    SELECT contact_id FROM contacts
    WHERE normalized_name = :normalized_name
      AND company_domain = :company_domain
    LIMIT 1
""", normalized_name=normalized_name, company_domain=company_domain)

if exact_match:
    return exact_[match.contact](http://match.contact)_id

# If no exact match, check for nickname equivalents
# Get all first name variants for the incoming contact
first_name_variants = get_first_name_variants(name)  # From Section 6.3
last_name = HumanName(name).last.lower()

# Query contacts at same domain, then check nickname equivalence
candidates = db.query("""
    SELECT contact_id, full_name FROM contacts
    WHERE company_domain = :company_domain
""", company_domain=company_domain)

for candidate in candidates:
    candidate_parsed = HumanName(candidate.full_name)
    if candidate_parsed.last.lower() == last_name:
        if names_are_equivalent(candidate_parsed.first, HumanName(name).first):
            return [candidate.contact](http://candidate.contact)_id  # "Dick Smith" matches "Richard Smith"
```

**2C. Name + phone match (with nickname awareness)**

```python
# Same pattern: exact match first, then nickname-aware fallback
exact_match = db.query("""
    SELECT contact_id FROM contacts
    WHERE normalized_name = :normalized_name
      AND normalized_phone = :normalized_phone
    LIMIT 1
""", normalized_name=normalized_name, normalized_phone=normalized_phone)

if exact_match:
    return exact_[match.contact](http://match.contact)_id

# Check nickname equivalents for contacts with same phone
candidates = db.query("""
    SELECT contact_id, full_name FROM contacts
    WHERE normalized_phone = :normalized_phone
""", normalized_phone=normalized_phone)

for candidate in candidates:
    candidate_parsed = HumanName(candidate.full_name)
    incoming_parsed = HumanName(name)
    if candidate_parsed.last.lower() == incoming_parsed.last.lower():
        if names_are_equivalent(candidate_parsed.first, incoming_parsed.first):
            return [candidate.contact](http://candidate.contact)_id
```

**Step 3: Upsert behavior**

```
IF a match is found:
  - UPDATE missing fields on the existing contact (do not erase known-good values)
  - return existing contact_id
ELSE:
  - INSERT a new contact row (generate UUID contact_id)
  - store normalized_* fields for future matching
  - return new contact_id
```

### 6.7 Organization Normalization

Organizations are simpler—we match primarily on domain:

```
IF domain_a = domain_b
THEN same organization
```

If no domain is available, fall back to fuzzy name matching with Levenstein distance (but flag as low-confidence and mark for review).

### 6.8 Email Validation

Before storing an email address from AI enrichment, we validate it to ensure deliverability. We also gate storage/display using the AI’s own confidence score for the email.

**Acceptance rule (store + display):**

- We store and display *any* email (including for catch-all domains) if:
    - `is_deliverable = true` (from LeadMagic)
    - and `email_confidence > 0.80` (from AI enrichment)
- If either condition fails, do not store the email on the contact record (treat as missing).

**Validation Service: LeadMagic API**

LeadMagic provides email verification with catch-all detection. Alternative services include ZeroBounce, NeverBounce, and Hunter.io, but LeadMagic offers strong accuracy and reasonable pricing for our volume.

**Validation Flow:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  EMAIL VALIDATION                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Input:                                                                 │
│    • email address from AI enrichment                                   │
│    • email_confidence (0.0–1.0) from AI enrichment                       │
│                                                                         │
│  Step 1: Call LeadMagic verification API                                │
│                                                                         │
│     POST [https://api.leadmagic.io/email/validate](https://api.leadmagic.io/email/validate)                         │
│     {                                                                   │
│       "email": "[jsmith@abcpm.com](mailto:jsmith@abcpm.com)"                                       │
│     }                                                                   │
│                                                                         │
│     Response includes:                                                  │
│     • status: valid, invalid, catch_all, unknown                        │
│     • is_deliverable: true/false                                        │
│     • is_catch_all: true/false                                          │
│     • is_disposable: true/false                                         │
│                                                                         │
│  Step 2: Evaluate result (deliverability + enrichment confidence)       │
│                                                                         │
│     IF is_deliverable = true AND email_confidence > 0.80:               │
│        → ACCEPT email (store + display)                                 │
│        → Store email_status = status (valid/catch_all/unknown/etc.)     │
│                                                                         │
│     ELSE:                                                               │
│        → REJECT email (do not store on contact record)                  │
│        → Proceed to Step 3                                              │
│                                                                         │
│  Step 3: Find replacement email (if rejected)                           │
│                                                                         │
│     POST [https://api.leadmagic.io/email/find](https://api.leadmagic.io/email/find)                             │
│     {                                                                   │
│       "first_name": "John",                                             │
│       "last_name": "Smith",                                             │
│       "company_domain": "[abcpm.com](http://abcpm.com)"                                     │
│     }                                                                   │
│                                                                         │
│     IF found:                                                           │
│        → Verify found email (repeat Step 1 and Step 2)                  │
│     ELSE:                                                               │
│        → Store contact without email, flag as "email_needed"            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Notes:**

- We no longer reject emails *just because* `is_catch_all = true`. Catch-all status is still stored and shown as metadata via `email_status`.
- If LeadMagic returns `status = unknown` but `is_deliverable = true`, we can still accept it as long as `email_confidence > 0.80`.

**Email validation fields in contacts table:**

**Email validation fields in contacts table:**

| Column | Type | Description |
| --- | --- | --- |
| `email_status` | TEXT | valid, invalid, catch_all, unknown, not_found |
| `email_validated_at` | TIMESTAMP | When we last validated |
| `email_source` | TEXT | ai_enrichment, leadmagic_finder, clay_import |

---

### 6.9 LinkedIn URL Validation

LinkedIn URLs discovered by AI enrichment need validation to confirm they point to the correct person and that the person still works at the indicated company.

**Validation Process:**

```
┌─────────────────────────────────────────────────────────────────┐
│  LINKEDIN VALIDATION                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input:                                                         │
│    • linkedin_url from AI enrichment                            │
│    • contact name (e.g., "John Smith")                          │
│    • expected company domain (e.g., "abcpm.com")                │
│                                                                 │
│  Step 1: Fetch LinkedIn profile via web scrape                  │
│                                                                 │
│     Use headless browser or scraping service to visit URL       │
│     Extract:                                                    │
│       • Profile name                                            │
│       • Current job title                                       │
│       • Current employer                                        │
│       • Employer domain (if available)                          │
│                                                                 │
│  Step 2: Evaluate result                                        │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ SCENARIO A: URL returns error (404, invalid, etc.)  │     │
│     │                                                     │     │
│     │ → Proceed to Step 3: Find correct URL via Gemini    │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ SCENARIO B: Name doesn't match                      │     │
│     │                                                     │     │
│     │ Compare scraped name vs. expected name:             │     │
│     │   • Use fuzzy matching (handle "John" vs "Jonathan")│     │
│     │   • Threshold: 80% similarity                       │     │
│     │                                                     │     │
│     │ IF match score < 80%:                               │     │
│     │   → Wrong person, proceed to Step 3                 │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ SCENARIO C: Correct person, wrong company           │     │
│     │                                                     │     │
│     │ Name matches BUT current employer doesn't match     │     │
│     │ expected company domain                             │     │
│     │                                                     │     │
│     │ → FLAG FOR REVIEW                                   │     │
│     │ → Set linkedin_status = "employer_mismatch"         │     │
│     │ → Store both the old company and new company        │     │
│     │ → This person may have changed jobs                 │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ SCENARIO D: All checks pass                         │     │
│     │                                                     │     │
│     │ Name matches AND employer matches                   │     │
│     │                                                     │     │
│     │ → ACCEPT URL                                        │     │
│     │ → Set linkedin_status = "verified"                  │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  Step 3: Find correct LinkedIn URL (Scenarios A & B)            │
│                                                                 │
│     Call Gemini Flash 3.0 with web grounding:                   │
│                                                                 │
│     PROMPT:                                                     │
│     "Find the LinkedIn profile URL for {name}, who works        │
│      as {title} at {company} ({domain}).                        │
│                                                                 │
│      Return ONLY the LinkedIn URL in this format:               │
│      https://www.linkedin.com/in/username                       │
│                                                                 │
│      If you cannot find a matching profile with high            │
│      confidence, return 'NOT_FOUND'."                           │
│                                                                 │
│     IF Gemini returns valid URL:                                │
│        → Re-run validation from Step 1 with new URL             │
│     ELSE:                                                       │
│        → Set linkedin_status = "not_found"                      │
│        → Store contact without LinkedIn URL                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Name matching logic for LinkedIn validation:**

```python
from nicknames import NickNamer
from nameparser import HumanName
from rapidfuzz import fuzz

nn = NickNamer()

def linkedin_names_match(expected_name, scraped_name):
    """
    Check if LinkedIn profile name matches expected contact name.
    Uses nickname awareness + fuzzy matching fallback.
    
    Examples that should match:
      - "Richard Smith" vs "Dick Smith" (nickname)
      - "William Johnson" vs "Bill Johnson" (nickname) 
      - "Robert Jones" vs "Bob Jones" (nickname)
      - "Steven Wilson" vs "Stephen Wilson" (phonetic/typo)
    """
    expected = HumanName(expected_name)
    scraped = HumanName(scraped_name)
    
    # Last names must match (with some fuzzy tolerance for typos)
    last_name_ratio = fuzz.ratio(expected.last.lower(), scraped.last.lower())
    if last_name_ratio < 85:
        return False, last_name_ratio
    
    # Check first names with nickname awareness
    if names_are_equivalent(expected.first, scraped.first):  # From Section 6.3
        return True, 100  # Nickname match = 100% confidence
    
    # Fallback to fuzzy matching for typos/variations
    first_name_ratio = fuzz.ratio(expected.first.lower(), scraped.first.lower())
    if first_name_ratio >= 80:
        return True, first_name_ratio
    
    return False, first_name_ratio

# Usage in LinkedIn validation:
is_match, confidence = linkedin_names_match("Richard Smith", "Dick Smith")
# Returns: (True, 100) - nickname match

is_match, confidence = linkedin_names_match("John Smith", "Jonathan Smith")  
# Returns: (True, ~82) - fuzzy match if "john" not nickname of "jonathan"

is_match, confidence = linkedin_names_match("John Smith", "Jane Smith")
# Returns: (False, ~44) - no match
```

**Company matching logic:**

```python
from rapidfuzz import fuzz
import tldextract
import re

def linkedin_company_matches(scraped_employer: str, expected_domain: str, expected_company_name: str = None) -> tuple[bool, float]:
    """
    Check if LinkedIn employer matches expected company.
    
    Examples:
        scraped: "ABC Property Management"
        expected_domain: "[abcpm.com](http://abcpm.com)"
        expected_company_name: "ABC PM" or None
        
        scraped: "CBRE Group, Inc."
        expected_domain: "[cbre.com](http://cbre.com)"
        expected_company_name: "CBRE"
    
    Returns:
        (is_match: bool, confidence: float)
    """
    if not scraped_employer:
        return False, 0.0
    
    scraped_lower = scraped_employer.lower().strip()
    
    # Strategy 1: Check if domain root appears in company name
    # e.g., "[cbre.com](http://cbre.com)" -> "cbre" should appear in "CBRE Group, Inc."
    domain_root = tldextract.extract(expected_domain).domain.lower()
    if domain_root and len(domain_root) >= 3:
        if domain_root in scraped_lower:
            return True, 0.95
    
    # Strategy 2: Fuzzy match against expected company name (if provided)
    if expected_company_name:
        expected_normalized = normalize_company_name(expected_company_name)
        scraped_normalized = normalize_company_name(scraped_employer)
        
        # Use token_set_ratio for flexible matching
        ratio = fuzz.token_set_ratio(expected_normalized, scraped_normalized)
        if ratio >= 80:
            return True, ratio / 100.0
    
    # Strategy 3: Check common variations
    scraped_core = strip_company_suffixes(scraped_employer)
    domain_variations = generate_domain_variations(expected_domain)
    
    for variation in domain_variations:
        if fuzz.ratio(scraped_core.lower(), variation.lower()) >= 85:
            return True, 0.85
    
    return False, 0.0

def normalize_company_name(name: str) -> str:
    """Normalize company name for comparison."""
    name = name.lower().strip()
    name = re.sub(r'[^\w\s]', '', name)
    suffixes = ['inc', 'llc', 'llp', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited', 'group', 'holdings', 'partners', 'lp']
    for suffix in suffixes:
        name = re.sub(rf'\b{suffix}\b', '', name)
    return ' '.join(name.split())

def strip_company_suffixes(name: str) -> str:
    """Remove legal suffixes from company name."""
    patterns = [
        r',?\s*(Inc\.?|LLC|LLP|Corp\.?|Corporation|Co\.?|Ltd\.?|Limited)\s*$',
        r',?\s*(Group|Holdings|Partners|LP)\s*$'
    ]
    result = name
    for pattern in patterns:
        result = re.sub(pattern, '', result, flags=re.IGNORECASE)
    return result.strip()

def generate_domain_variations(domain: str) -> list[str]:
    """Generate possible company name variations from domain."""
    root = tldextract.extract(domain).domain
    variations = [root]
    if 'property' in root.lower():
        variations.append(root.replace('property', ' property '))
    if 'management' in root.lower():
        variations.append(root.replace('management', ' management '))
    if 'pm' in root.lower():
        variations.append(root.replace('pm', ' property management '))
    return [v.strip() for v in variations]

# Example usage:
is_match, confidence = linkedin_company_matches(
    scraped_employer="CBRE Group, Inc.",
    expected_domain="[cbre.com](http://cbre.com)",
    expected_company_name="CBRE"
)
# Returns: (True, 0.95) - domain root "cbre" found in employer name
```

**LinkedIn validation fields in contacts table:**

| Column | Type | Description |
| --- | --- | --- |
| `linkedin_url` | TEXT | The validated LinkedIn profile URL |
| `linkedin_status` | TEXT | verified, employer_mismatch, not_found, pending |
| `linkedin_validated_at` | TIMESTAMP | When we last validated |
| `linkedin_scraped_employer` | TEXT | Employer name from LinkedIn (for mismatch cases) |
| `linkedin_scraped_title` | TEXT | Title from LinkedIn |
| `needs_review` | BOOLEAN | True if flagged for manual review |
| `review_reason` | TEXT | employer_mismatch, low_confidence, etc. |

---

### 6.10 Validation Retry Logic

For contacts where validation failed, we should implement retry logic:

**Email retries:**
- If email was invalid/catch-all and LeadMagic finder failed, retry after 7 days
- Company email patterns may change, or LeadMagic’s data may update

**LinkedIn retries:**
- If LinkedIn URL was not found, retry after 14 days
- Person may have created/updated their profile

**Employer mismatch follow-up:**
- Contacts flagged for employer mismatch should be reviewed within 48 hours
- If confirmed they changed jobs, update their company association and re-run property relationship analysis

---

### 6.11 Complete Contact Validation Pipeline

Here’s how all the pieces fit together:

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPLETE CONTACT PROCESSING PIPELINE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐                                                │
│  │ AI discovers│                                                │
│  │ new contact │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ STEP 1: Normalize & Deduplicate (Section 6.2-6.7)       │    │
│  │                                                         │    │
│  │ • Normalize name, email, phone                          │    │
│  │ • Check for existing match                              │    │
│  │ • Create new or update existing contact_id              │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ STEP 2: Validate Email (Section 6.8)                    │    │
│  │                                                         │    │
│  │ • Call LeadMagic to verify email                        │    │
│  │ • Reject catch-all and invalid                          │    │
│  │ • If rejected, try to find replacement email            │    │
│  │ • Store email_status                                    │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ STEP 3: Validate LinkedIn (Section 6.9)                 │    │
│  │                                                         │    │
│  │ • Scrape LinkedIn profile                               │    │
│  │ • Verify name match                                     │    │
│  │ • Verify employer match                                 │    │
│  │ • If wrong person/invalid → use Gemini to find URL      │    │
│  │ • If employer mismatch → flag for review                │    │
│  │ • Store linkedin_status                                 │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ STEP 4: Create/Update Junction Records                  │    │
│  │                                                         │    │
│  │ • Link contact to property (property_contacts)          │    │
│  │ • Link contact to organization (contact_organizations)  │    │
│  │ • Set confidence scores                                 │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│                             ▼                                   │
│                        ┌─────────┐                              │
│                        │  DONE   │                              │
│                        │         │                              │
│                        │ Contact │                              │
│                        │ ready   │                              │
│                        │ for use │                              │
│                        └─────────┘                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 6.12 Handling Updates

When we re-encounter a contact (e.g., AI discovers them again at a different property):
- Match to existing record using the rules above
- Update any fields that were previously empty
- If conflicting data (e.g., different title), keep the most recent
- Add new property association to junction table
- Re-validate email and LinkedIn if last validation was >30 days ago

### 6.13 UUID Generation Strategy

**Problem:** Random UUIDs (`Math.random()` or `uuid.v4()`) create new IDs every time, breaking deduplication and causing duplicate records.

**Solution:** Use **deterministic UUIDs (UUID v5)** that hash canonical identifying attributes. Same input → same UUID.

### Property IDs

Properties use `property_key` as their canonical identifier:

```python
# property_key = COALESCE(ll_stack_uuid, ll_uuid)
# This handles parcel stacking per Section 3.3
property_key = parcel.ll_stack_uuid or parcel.ll_uuid
```

**Why not just `ll_uuid`?**

- A 10-story office building may have 10 separate parcel records (one per floor)
- Each has a unique `ll_uuid`, but they share the same `ll_stack_uuid`
- Using `property_key` ensures all parcels in a stack map to ONE property record

### Contact UUIDs

Contacts are identified by a hash of their canonical attributes in priority order:

```python
import uuid

# Greenfinch namespace (generate once, use everywhere)
GREENFINCH_NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')

def generate_contact_uuid(email, normalized_name, domain, normalized_phone):
    """
    Generate deterministic UUID for a contact.
    Priority: email > name+domain > name+phone > name only
    """
    if email:
        # Primary: email is unique per person
        return str(uuid.uuid5(GREENFINCH_NAMESPACE, email.lower().strip()))
    
    if normalized_name and domain:
        # Secondary: name + company domain
        return str(uuid.uuid5(GREENFINCH_NAMESPACE, f"{normalized_name}|{domain.lower()}"))
    
    if normalized_name and normalized_phone:
        # Tertiary: name + phone
        return str(uuid.uuid5(GREENFINCH_NAMESPACE, f"{normalized_name}|{normalized_phone}"))
    
    # Fallback: name only (low confidence, needs manual dedup)
    return str(uuid.uuid5(GREENFINCH_NAMESPACE, f"contact:{normalized_name}"))
```

**Benefits:**

- Same contact discovered at multiple properties → same `contact_id`
- Re-running enrichment doesn't create duplicates
- Natural deduplication in database upserts

### Organization UUIDs

Organizations are identified primarily by domain:

```python
def generate_org_uuid(domain, org_name):
    """
    Generate deterministic UUID for an organization.
    """
    if domain:
        return str(uuid.uuid5(GREENFINCH_NAMESPACE, domain.lower().strip()))
    
    # Fallback: normalized org name (lower confidence)
    normalized = normalize_org_name(org_name)
    return str(uuid.uuid5(GREENFINCH_NAMESPACE, f"org:{normalized}"))
```

**Why domain-first?**

- "CBRE Group, Inc." and "CBRE" and "CBRE|JLL" → all map to same org if domain is "[cbre.com](http://cbre.com)"
- Prevents duplicates from company name variations

### UUID Generation Summary Table

| Entity | Primary Key | UUID Source | Fallback |
| --- | --- | --- | --- |
| Property | `property_key` | `COALESCE(ll_stack_uuid, ll_uuid)` | N/A |
| Contact | `contact_id` | `UUID5(email)` | `UUID5(name\ |
| Organization | `org_id` | `UUID5(domain)` | `UUID5(org:normalized_name)` |

---

---

## 7. Database Schema

All data lives in Snowflake. Here are the core tables:

### 7.1 Properties Table

Stores one record per physical property (after deduplication).

| Column | Type | Description |
| --- | --- | --- |
| `property_id` | UUID | Primary key (generated) |
| `source_ll_uuid` | UUID | One Regrid `ll_uuid` from the stack (for API lookups) |
| `ll_stack_uuid` | TEXT | Regrid stack UUID (null if not stacked) |
| `property_key` | TEXT | **Unique.** `COALESCE(ll_stack_uuid, ll_uuid)` - our dedup key |
| `regrid_address` | TEXT | Original address from Regrid |
| `validated_address` | TEXT | AI-cleaned address (used if `validated_address_confidence > 0.80`) |
| `validated_address_confidence` | FLOAT | AI confidence score for validated address (0.0-1.0) |
| `city` | TEXT | City |
| `state` | TEXT | State (2-letter) |
| `zip` | TEXT | ZIP code |
| `lat` | FLOAT | Latitude (AI value if `geocode_confidence > 0.90`, else Regrid) |
| `lon` | FLOAT | Longitude |
| `geocode_confidence` | FLOAT | AI confidence for lat/lon (0.0-1.0) |
| `lot_sqft` | BIGINT | Lot size in square feet (from `ll_gissqft`) |
| `building_sqft` | BIGINT | Building square footage |
| `yearbuilt` | INT | Year built |
| `num_floors` | INT | Number of floors/stories |
| `asset_category` | TEXT | Multifamily, Office, Industrial, Retail, Mixed Use, etc. |
| `asset_subcategory` | TEXT | More specific type (e.g., Medical Office, Warehouse/Distribution) |
| `category_confidence` | FLOAT | AI confidence for asset classification (0.0-1.0) |
| `property_class` | TEXT | A, B, or C |
| `common_name` | TEXT | Building name (e.g., "Riverfront Plaza") |
| `common_name_confidence` | FLOAT | AI confidence for common name (0.0-1.0) |
| `regrid_owner` | TEXT | Owner name from Regrid (always kept) |
| `regrid_owner2` | TEXT | Second owner from Regrid (always kept) |
| `beneficial_owner` | TEXT | True owner discovered by AI (parent company/REIT) |
| `beneficial_owner_confidence` | FLOAT | AI confidence for beneficial owner (0.0-1.0) |
| `beneficial_owner_type` | TEXT | REIT, Private Equity, Individual, Corporation, etc. |
| `management_type` | TEXT | Self-Managed or 3rd Party |
| `management_company` | TEXT | Property management company name |
| `management_company_domain` | TEXT | PM company website domain |
| `management_confidence` | FLOAT | AI confidence for management info (0.0-1.0) |
| `raw_parcels_json` | JSON | All original parcel records (preserves owner names, etc.) |
| `enrichment_json` | JSON | Full Gemini output including all confidence scores |
| `physical_intelligence_json` | JSON | Permeable/impermeable %, parking ratio, condition notes |
| `validation_logic` | TEXT | AI explanation of how property was verified |
| `discovery_process` | TEXT | AI explanation of how contacts were found |
| `last_regrid_update` | TIMESTAMP | Max `ll_updated_at` from source parcels |
| `last_enriched_at` | TIMESTAMP | When we last ran AI enrichment |
| `created_at` | TIMESTAMP |  |
| `updated_at` | TIMESTAMP |  |
| `is_active` | BOOLEAN | False if all source parcels were deleted |

### 7.2 Contacts Table

| Column | Type | Description |
| --- | --- | --- |
| `contact_id` | UUID | Primary key |
| `full_name` | TEXT | Display name |
| `normalized_name` | TEXT | For matching (lowercase, no suffixes) |
| `name_confidence` | FLOAT | AI confidence for name accuracy (0.0-1.0) |
| `email` | TEXT | Validated email address |
| `normalized_email` | TEXT | For matching |
| `email_confidence` | FLOAT | AI confidence for email (0.0-1.0). Must be > 0.80 to store. |
| `email_status` | TEXT | valid, invalid, catch_all, unknown, not_found |
| `email_validated_at` | TIMESTAMP | When email was last validated |
| `email_source` | TEXT | ai_enrichment, leadmagic_finder, clay_import |
| `phone` | TEXT | Phone number |
| `normalized_phone` | TEXT | For matching (digits only) |
| `phone_confidence` | FLOAT | AI confidence for phone (0.0-1.0) |
| `title` | TEXT | Current job title |
| `title_confidence` | FLOAT | AI confidence for title (0.0-1.0) |
| `company_domain` | TEXT | Domain of current employer |
| `employer_name` | TEXT | Company/employer name |
| `linkedin_url` | TEXT | Validated LinkedIn profile URL |
| `linkedin_confidence` | FLOAT | AI confidence for LinkedIn URL (0.0-1.0) |
| `linkedin_status` | TEXT | verified, employer_mismatch, not_found, pending |
| `linkedin_validated_at` | TIMESTAMP | When LinkedIn was last validated |
| `linkedin_scraped_employer` | TEXT | Employer name from LinkedIn (for mismatch review) |
| `linkedin_scraped_title` | TEXT | Title from LinkedIn |
| `needs_review` | BOOLEAN | True if flagged for manual review |
| `review_reason` | TEXT | employer_mismatch, low_confidence, etc. |
| `source` | TEXT | "ai" or "clay" (where first discovered) |
| `created_at` | TIMESTAMP |  |
| `updated_at` | TIMESTAMP |  |

**Indexes for deduplication:**

```sql
CREATE UNIQUE INDEX idx_contacts_email ON contacts(normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX idx_contacts_name_domain ON contacts(normalized_name, company_domain);
CREATE INDEX idx_contacts_name_phone ON contacts(normalized_name, normalized_phone);
```

### 7.3 Organizations Table

| Column | Type | Description |
| --- | --- | --- |
| `org_id` | UUID | Primary key |
| `name` | TEXT | Company name |
| `domain` | TEXT | **Unique.** Website domain |
| `org_type` | TEXT | owner, property_manager, tenant |
| `created_at` | TIMESTAMP |  |
| `updated_at` | TIMESTAMP |  |

### 7.4 Lookup Table: Parcel → Property

This table enables fast UUID resolution from Regrid APIs:

| Column | Type | Description |
| --- | --- | --- |
| `ll_uuid` | UUID | Primary key — Regrid parcel UUID |
| `property_id` | UUID | Foreign key → properties |

**Why it’s useful:** When a user clicks a parcel on the map, the Tile API gives us a Regrid `ll_uuid`. This table lets us instantly find the corresponding property without complex joins.

### 7.5 Sync State Table

Tracks Regrid synchronization for incremental updates:

| Column | Type | Description |
| --- | --- | --- |
| `sync_id` | SERIAL | Primary key |
| `last_sync_timestamp` | TIMESTAMP | Max `ll_updated_at` we’ve processed |
| `sync_started_at` | TIMESTAMP |  |
| `sync_completed_at` | TIMESTAMP |  |
| `status` | TEXT | running, completed, failed |
| `parcels_checked` | INT |  |
| `parcels_changed` | INT |  |
| `properties_updated` | INT |  |
| `error_message` | TEXT |  |

---

## 8. The Property-Contact-Organization Graph

Properties, contacts, and organizations form a **many-to-many graph**. We model this with three junction tables.

### 8.1 Visual Representation

```
                    ┌─────────────┐
                    │  PROPERTY   │
                    │  123 Main   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐
    │  CONTACT  │    │  CONTACT  │    │    ORG    │
    │John Smith │    │Jane Doe   │    │ ABC Mgmt  │
    │Facilities │    │  Owner    │    │           │
    └─────┬─────┘    └───────────┘    └─────┬─────┘
          │                                 │
          └─────────────────────────────────┘
                    "works at"
```

### 8.2 Junction Tables

**property_contacts** — Links people to properties

| Column | Type | Description |
| --- | --- | --- |
| `property_id` | UUID | FK → properties |
| `contact_id` | UUID | FK → contacts |
| `role` | TEXT | owner, property_manager, operations_contact, leasing_agent, other |
| `confidence_score` | FLOAT | 0.0–1.0, from AI (how confident are we in this association?) |
| `discovered_at` | TIMESTAMP | When this link was first discovered |

**property_organizations** — Links companies to properties

| Column | Type | Description |
| --- | --- | --- |
| `property_id` | UUID | FK → properties |
| `org_id` | UUID | FK → organizations |
| `role` | TEXT | owner, property_manager, tenant |

**contact_organizations** — Links people to companies (employment)

| Column | Type | Description |
| --- | --- | --- |
| `contact_id` | UUID | FK → contacts |
| `org_id` | UUID | FK → organizations |
| `title` | TEXT | Their title at this company |
| `is_current` | BOOLEAN | Still employed there? |
| `started_at` | TIMESTAMP | When we first saw this association |
| `ended_at` | TIMESTAMP | When we detected they left (if known) |

### 8.3 Example Queries This Enables

**“Show me all contacts for property X”**

```sql
SELECT c.*
FROM contacts c
JOIN property_contacts pc ON c.contact_id = pc.contact_id
WHERE pc.property_id = 'X';
```

**“Show me all properties managed by ABC Property Management”**

```sql
SELECT p.*
FROM properties p
JOIN property_organizations po ON p.property_id = po.property_id
JOIN organizations o ON po.org_id = o.org_id
WHERE o.name = 'ABC Property Management'
  AND po.role = 'property_manager';
```

**“Show me everywhere John Smith has a role”**

```sql
SELECT p.validated_address, pc.role
FROM properties p
JOIN property_contacts pc ON p.property_id = pc.property_id
JOIN contacts c ON pc.contact_id = c.contact_id
WHERE c.full_name = 'John Smith';
```

---

## 9. Runtime APIs

At runtime (when users are actively using the app), we interact with two Regrid APIs.

### 9.1 Tile API

**Purpose:** Render parcel boundaries on the map.

**How it works:**
1. UI requests map tiles for the visible area
2. Regrid returns vector tiles with parcel geometries
3. Each parcel includes its `ll_uuid`
4. When user clicks a parcel, we extract the `ll_uuid`

**Connecting to our data:**

```
User clicks parcel
       │
       ▼
Extract ll_uuid from tile
       │
       ▼
Query parcel_to_property table
       │
       ▼
Get property_id
       │
       ▼
Fetch full property record with contacts/orgs
```

### 9.2 Typeahead API

**Purpose:** Address search autocomplete.

**How it works:**
1. User types in search box: “123 Ma…”
2. We call Regrid Typeahead API
3. Returns matching addresses with their `ll_uuid`
4. User selects one
5. We resolve `ll_uuid` → `property_id` (same as above)

### 9.3 UUID Resolution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Regrid Tile API                    Regrid Typeahead API       │
│        │                                    │                   │
│        └──────────────┬─────────────────────┘                   │
│                       │                                         │
│                       ▼                                         │
│               ll_uuid (e.g., "abc-222")                         │
│                       │                                         │
│                       ▼                                         │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  SELECT property_id FROM parcel_to_property           │     │
│   │  WHERE ll_uuid = 'abc-222'                            │     │
│   └───────────────────────────────────────────────────────┘     │
│                       │                                         │
│                       ▼                                         │
│               property_id                                       │
│                       │                                         │
│                       ▼                                         │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  SELECT * FROM properties                             │     │
│   │  WHERE property_id = '...'                            │     │
│   │                                                       │     │
│   │  + JOIN contacts, organizations via junction tables   │     │
│   └───────────────────────────────────────────────────────┘     │
│                       │                                         │
│                       ▼                                         │
│               Full property record with contacts/orgs           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. User Interface Components

> 🔗 **See it in action:** [Greenfinch App Prototype](https://client-prospector--greenfinch.replit.app/app)
> 

### 10.1 Property Views

**List View**
- Searchable, filterable table of properties
- Columns: Address, Asset Type, Lot Size, # of Contacts, etc.
- Search powered by Regrid Typeahead API
- Filters: asset category, lot size range, location, etc.

**Map View**
- Interactive map with parcel boundaries (via Regrid Tile API)
- Click a parcel → show property details
- Same filters as list view
- Parcels color-coded by asset type or other criteria

**Property Detail View** (shown when selecting from list or map)
- Property information panel (address, lot size, asset type, etc.)
- Contacts table: all people associated with this property
- Organizations table: owner, property manager, tenants

### 10.2 Organizations View

- Filterable list of all organizations
- Click an org → see all associated properties and contacts
- Filter by org type (owner, PM, tenant)

### 10.3 Contacts View

- Filterable list of all contacts
- Click a contact → see all properties where they have a role
- Filter by title, company, etc.

### 10.4 Lists View

Users can create custom lists for their workflow:

- Select contacts or properties from any filtered view
- Save to a named list (e.g., “Week 12 Targets”)
- Lists persist across sessions

**Database tables:**

| user_lists | list_items |
| --- | --- |
| list_id (PK) | list_id (FK) |
| user_id | item_id (property_id or contact_id) |
| list_name | added_at |
| list_type (property or contact) |  |
| created_at |  |

---

## 11. Implementation Sequence

Recommended order for building this system:

### Phase 1: Foundation

1. Set up Snowflake serving database with schema from Section 7
2. Build parcel deduplication logic (Section 3)
3. Create `parcel_to_property` lookup table
4. Build basic property list UI (no enrichment yet—just raw Regrid data)

### Phase 2: Initial Enrichment Pipeline

1. Integrate Gemini Flash 3.0 for AI enrichment
2. Build contact normalization logic (Section 6)
3. Run initial load pipeline
4. Populate contacts and organizations tables

### Phase 3: Graph & UI

1. Wire up junction tables
2. Build property detail view with contacts/orgs
3. Build contacts view and organizations view
4. Add map view with Regrid Tile API

### Phase 4: User Features

1. Implement user authentication
2. Build lists functionality
3. Add Clay import workflow

### Phase 5: Change Detection

1. Build `regrid_sync_state` tracking
2. Implement change detection job (Section 5)
3. Test incremental update flow

### Phase 6: Polish

1. Add caching for Tile API responses
2. Build admin tools for pipeline monitoring
3. Handle edge cases (splits, combines, deletes)

---

## 12. Two-Tier Data Architecture

| Service Down | Behavior |
| --- | --- |
| Gemini | Queue enrichments, show unavailable message |
| LeadMagic | Skip validation, mark validation_pending |
| Bright Data | Skip LinkedIn, mark linkedin_pending |
| Regrid Tiles | Show cached tiles only |
| Regrid Typeahead | Fall back to local search on staging_properties |

**Graceful Degradation:**

**Circuit Breaker Pattern:** For each external service (Gemini, LeadMagic, Bright Data, Regrid). States: Closed (normal), Open (fail fast), Half-Open (testing). Trip: 5 failures in 60s opens circuit. Recovery: 30s to half-open, 3 successes to close.

| Column | Type | Description |
| --- | --- | --- |
| dlq_id | UUID | Primary key |
| job_id | UUID | Original job ID |
| entity_type | TEXT | property, contact |
| entity_id | TEXT | property_key or contact_id |
| error_type | TEXT | Classification |
| error_message | TEXT | Full error details |
| payload | JSONB | Original request for replay |
| attempts | INT | Retry attempts made |
| first_failed_at | TIMESTAMP | First failure |
| last_failed_at | TIMESTAMP | Most recent failure |
| resolved_at | TIMESTAMP | When resolved |
| resolved_by | UUID | Who resolved |

**Dead Letter Queue Table:**

| Error Type | Max Retries | Backoff | Example |
| --- | --- | --- | --- |
| Transient API error | 5 | Exponential (1s, 2s, 4s, 8s, 16s) | Gemini 503 |
| Validation error | 0 | No retry | Invalid data |
| Timeout | 3 | Linear (30s intervals) | Slow AI |
| Service down | 10 | Exponential with jitter | LeadMagic outage |

**Retry Configuration:**

queued → running → completed OR failed → retry_pending → running (retry) OR dead_letter (max retries exceeded)

**Enrichment Job States:**

### 15.2 Error Handling & Retry Logic

**Retention:** 2 years. Archive to cold storage after 90 days.

**Actions to Log:** Authentication (login, logout, login_failed), Data Access (property_viewed, contact_revealed, list_exported), Data Modification (property_enriched, contact_updated), Admin Actions (user_invited, bulk_enrichment_started), Billing (credits_purchased, subscription_changed), System (sync_completed).

| Column | Type | Description |
| --- | --- | --- |
| log_id | UUID | Primary key |
| timestamp | TIMESTAMP | When action occurred |
| user_id | UUID | FK to users (null for system) |
| account_id | UUID | FK to accounts |
| action | TEXT | Action type |
| entity_type | TEXT | properties, contacts, lists, users, jobs |
| entity_id | UUID | ID of affected entity |
| old_values | JSONB | Previous state |
| new_values | JSONB | New state |
| ip_address | TEXT | Client IP |
| user_agent | TEXT | Browser identifier |
| request_id | TEXT | Correlation ID |

**Audit Logs Table:**

All significant actions must be logged for security, debugging, and compliance.

### 15.1 Audit Logging

This section covers operational infrastructure for production.

## 15. Operations & Reliability

---

**Notifications:** Alert account admins when credits drop below 20% of monthly allocation, when credits are about to expire, and when usage approaches tier limits.

**Admin Dashboard:** Display credit usage analytics, burn rate, and projected depletion date.

**Contact Reveal:** Check credits before exposing contact details. Contacts remain "masked" until user spends credits to reveal.

**Enrichment Pipeline:** Check credits before queuing enrichment jobs. Deduct credits as each property completes.

### 14.8 Integration Points

**Reservation Pattern:** For bulk jobs, reserve credits at job creation (pending_usage), then convert to actual usage as properties are processed. Release unused reservations if job fails or is canceled.

**Usage Check:** Before any credit-consuming action, verify available_balance >= required_credits. If insufficient, block action and prompt for upgrade or credit purchase.

**Monthly Allocation:** On billing cycle renewal, add monthly_credits to account. If balance exceeds credit_rollover_limit, expire excess credits.

### 14.7 Credit Operations

| Column | Type | Description |
| --- | --- | --- |
| account_id | UUID | FK to accounts |
| current_balance | INT | Available credits |
| pending_usage | INT | Credits reserved for in-progress jobs |
| available_balance | INT | current_balance - pending_usage |
| last_allocation_date | TIMESTAMP | When credits were last allocated |
| next_allocation_date | TIMESTAMP | Next scheduled allocation |

For efficient balance queries, maintain a materialized view or cached balance.

### 14.6 Credit Balance View

| Column | Type | Description |
| --- | --- | --- |
| transaction_id | UUID | Primary key |
| account_id | UUID | FK to accounts |
| transaction_type | TEXT | allocation, usage, purchase, adjustment, expiration |
| amount | INT | Credits (positive for additions, negative for usage) |
| balance_after | INT | Running balance after this transaction |
| action_type | TEXT | enrichment, contact_reveal, export, etc. (for usage) |
| reference_id | UUID | FK to the entity that triggered this (property_id, job_id, etc.) |
| user_id | UUID | User who performed the action (if applicable) |
| description | TEXT | Human-readable description |
| created_at | TIMESTAMP | Transaction timestamp |
| expires_at | TIMESTAMP | When these credits expire (for allocations) |

Track all credit transactions for audit and balance calculation.

### 14.5 Credit Ledger Table

| Column | Type | Description |
| --- | --- | --- |
| subscription_id | UUID | Primary key |
| account_id | UUID | FK to accounts |
| tier_id | UUID | FK to subscription_tiers |
| billing_cycle | TEXT | monthly or annual |
| current_period_start | TIMESTAMP | Start of current billing period |
| current_period_end | TIMESTAMP | End of current billing period |
| status | TEXT | active, past_due, canceled, trialing |
| stripe_subscription_id | TEXT | External payment provider reference |
| created_at | TIMESTAMP | When subscription started |
| canceled_at | TIMESTAMP | When canceled (if applicable) |

### 14.4 Account Subscriptions Table

| Column | Type | Description |
| --- | --- | --- |
| tier_id | UUID | Primary key |
| name | TEXT | Tier name (Starter, Professional, Enterprise) |
| monthly_price | DECIMAL | Monthly account fee |
| annual_price | DECIMAL | Annual account fee (discounted) |
| per_user_monthly | DECIMAL | Monthly fee per additional user |
| per_user_annual | DECIMAL | Annual fee per additional user |
| included_users | INT | Users included in base price |
| monthly_credits | INT | Credits allocated each billing cycle |
| credit_rollover_limit | INT | Max unused credits that roll over |
| features | JSONB | Feature flags for this tier |
| is_active | BOOLEAN | Available for new signups |

### 14.3 Subscription Tiers Table

| Action | Credit Cost | Description |
| --- | --- | --- |
| Property Enrichment | 5 credits | Full AI enrichment with contact discovery |
| Contact Reveal | 1 credit | Expose email/phone for already-enriched contact |
| Bulk Enrichment (per property) | 4 credits | Discounted rate for batch jobs |
| Re-enrichment | 3 credits | Refresh stale data on previously enriched property |
| Export to CRM | 0.5 credits | Per contact exported |

**Credit-Consuming Actions:**

Credits are the internal currency for metered platform actions. Credits are allocated monthly based on account tier, do not roll over (or roll over with limits based on tier), and can be purchased as add-on packs.

### 14.2 Credit System Overview

**Per-User Fees:** Additional monthly or annual fee for each active user beyond the base allocation. User fees follow the same billing cycle as the account subscription.

**Account-Level Subscription:** Each customer account pays a base monthly or annual fee. Annual plans receive a discount (e.g., 2 months free). The account tier determines included credits, feature access, and support level.

### 14.1 Subscription Model

Greenfinch uses a hybrid billing model combining subscription fees with a usage-based credit system for metered actions.

## 14. Billing & Credit System

---

System admins access a separate interface with bulk enrichment panel, account management, job monitor, and usage analytics.

### 13.5 Admin Dashboard

View staging: All roles. Enrich single property: All roles. Bulk enrich: System admin only. Manage users: Account admin and above. Admin dashboard: System admin only.

### 13.4 Permission Matrix

| Column | Type | Description |
| --- | --- | --- |
| account_id | UUID | Primary key |
| name | TEXT | Company name |
| domain | TEXT | For SSO matching |
| enrichment_credits | INT | Available credits |
| data_regions | TEXT[] | Counties with access |

### 13.3 Accounts Table

| Column | Type | Description |
| --- | --- | --- |
| user_id | UUID | Primary key |
| replit_id | TEXT | Replit user ID |
| email | TEXT | User email |
| name | TEXT | Display name |
| account_id | UUID | FK to accounts |
| team_id | UUID | FK to teams |
| role | TEXT | system_admin, account_admin, team_manager, standard_user |
| is_active | BOOLEAN | Can log in |

### 13.2 Users Table

Standard User: View staging properties, enrich single properties on-demand, create personal lists.

Team Manager: Manage team members, view team activity, share lists across team.

Account Admin (Customer): Manage users in their account, view usage/billing and credits, manage teams.

System Admin (Greenfinch internal): Full platform access, bulk enrichment, customer setup, view all accounts.

### 13.1 Role Hierarchy

Greenfinch uses Replit Auth for authentication with a role-based authorization layer.

## 13. Authentication & Authorization

---

[Change Log](https://www.notion.so/Change-Log-2e3650cdb99c80048d85cb3a8b347b25?pvs=21)

[Enrichment Script Draft](https://www.notion.so/Enrichment-Script-Draft-2e2650cdb99c80d0bca6e279d8c7c810?pvs=21)

| Column | Type | Description |
| --- | --- | --- |
| `job_id` | UUID | Primary key |
| `job_type` | TEXT | `single` or `bulk` |
| `status` | TEXT | `queued`, `running`, `completed`, `failed` |
| `requested_by` | UUID | FK to users |
| `property_keys` | TEXT[] | Properties to enrich |
| `total_count` | INT | Total properties in job |
| `completed_count` | INT | Processed so far |
| `failed_count` | INT | Failed properties |
| `estimated_cost` | DECIMAL | Estimated credits |
| `actual_cost` | DECIMAL | Actual cost after completion |
| `created_at` | TIMESTAMP | When created |
| `completed_at` | TIMESTAMP | When finished |

### 12.6 Enrichment Job Queue Table

1. Progress shown in admin dashboard
2. Job processes properties respecting API rate limits
3. Clicks "Enrich Selected" to queue batch job
4. Reviews count and estimated cost
5. Filters staging_properties (e.g., commercial + >1 acre + ZIP 75201)
6. Admin navigates to Enrichment Admin panel

**Bulk (System Admins Only):**

1. When complete, full data with contacts appears
2. UI polls for completion, shows progress
3. System queues single-property enrichment job
4. User clicks "Enrich Property" button
5. Contacts section shows "Not yet enriched"
6. Sees basic staging data (address, lot size, owner names)
7. User clicks property in list/map view

**On-Demand (Standard Users):**

### 12.5 Enrichment Triggers

We classify properties without AI using Regrid's `usedesc` field pattern matching. Commercial includes: office, retail, industrial, warehouse, hotel, shopping, medical, restaurant, flex, business park, apartment, multifamily, senior living. Residential excludes: single family, townhouse, condo, mobile home.

### 12.4 Commercial Classification Rules

| Column | Type | Description |
| --- | --- | --- |
| `property_key` | TEXT | **PK.** `COALESCE(ll_stack_uuid, ll_uuid)` |
| `source_ll_uuid` | UUID | One Regrid `ll_uuid` for API lookups |
| `address` | TEXT | Property address |
| `city` | TEXT | City |
| `state` | TEXT | State (2-letter) |
| `zip` | TEXT | ZIP code |
| `lat` | FLOAT | Latitude |
| `lon` | FLOAT | Longitude |
| `lot_sqft` | BIGINT | Lot size (`MAX(ll_gissqft)`) |
| `lot_acres` | FLOAT | Lot size in acres (computed) |
| `building_sqft` | BIGINT | Building sq ft (`MAX(area_building)`) |
| `yearbuilt` | INT | Year built |
| `total_parval` | DECIMAL | Total parcel value (`SUM(parval)`) |
| `usedesc_raw` | TEXT | Raw use description from Regrid |
| `is_commercial` | BOOLEAN | Rule-based classification |
| `property_class_hint` | TEXT | Estimated class (Office, Retail, etc.) |
| `parcel_count` | INT | Number of parcels in stack |
| `owner_names` | TEXT[] | Array of all owner names |
| `raw_parcels_json` | JSON | Full parcel details for enrichment |
| `enrichment_status` | TEXT | `pending`, `in_progress`, `enriched`, `failed`, `stale` |
| `enriched_property_id` | UUID | FK to properties (null until enriched) |
| `last_regrid_update` | TIMESTAMP | Max `ll_updated_at` |

This table holds ALL properties with basic data extracted from Regrid (no AI costs).

### 12.3 Staging Properties Table

**Tier 2 - Enriched (Selective):** Full AI enrichment, contact discovery and validation, organization mapping. Cost: ~$0.05-0.15 per property. Triggered on-demand by users OR in bulk by admins.

**Tier 1 - Staging (All Properties):** Aggregates parcel stacks, classifies residential vs commercial using rule-based logic (no AI), stores basic Regrid metrics. Cost: $0. Result: ~100K-200K deduplicated property records. All staged properties should be visible in the map view. Only commercial and multifamily properties should be viewable in list view.

### 12.2 The Solution: Staging + Selective Enrichment

Running full AI enrichment on every parcel is expensive (~$0.05/property × 800K = $40,000+), slow (days at high throughput), and wasteful since most users only care about properties matching specific criteria.

### 12.1 The Problem

To handle large county datasets efficiently (e.g., 800K+ parcels in Dallas County), we use a two-tier approach that separates lightweight staging from expensive enrichment.

## Appendix A: Regrid API Reference

**Typeahead (address search):**

```
GET https://app.regrid.com/api/v2/typeahead?query=123+Main+St
```

**Parcel by UUID:**

```
GET https://app.regrid.com/api/v2/parcels/ll_uuid/{ll_uuid}
```

**Tile API:**

```
GET https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt
```

*(Refer to Regrid documentation for authentication and full parameter details)*

---

## Appendix B: LeadMagic API Reference

LeadMagic is used for email validation and email finding.

**Email Verification:**

```
POST [https://api.leadmagic.io/email/validate](https://api.leadmagic.io/email/validate)
Headers:
  X-API-Key: {your_api_key}
  Content-Type: application/json

Body:
{
  "email": "[jsmith@abcpm.com](mailto:jsmith@abcpm.com)"
}

Response:
{
  "email": "[jsmith@abcpm.com](mailto:jsmith@abcpm.com)",
  "status": "valid",           // valid, invalid, catch_all, unknown
  "is_deliverable": true,
  "is_catch_all": false,
  "is_disposable": false,
  "is_role_based": false,      // e.g., info@, sales@, support@
  "domain_status": "active"
}
```

**Email Finder:**

```
POST [https://api.leadmagic.io/email/find](https://api.leadmagic.io/email/find)
Headers:
  X-API-Key: {your_api_key}
  Content-Type: application/json

Body:
{
  "first_name": "John",
  "last_name": "Smith",
  "company_domain": "[abcpm.com](http://abcpm.com)"
}

Response:
{
  "email": "[john.smith@abcpm.com](mailto:john.smith@abcpm.com)",
  "confidence": 95,
  "status": "valid",
  "is_catch_all": false
}
```

**Rate Limits & Pricing:**
- Verification: ~$0.003 per email
- Email finder: ~$0.03 per lookup
- Rate limit: 100 requests/second

**Alternative Services:**
- ZeroBounce (similar pricing, good accuracy)
- NeverBounce (bulk-focused)
- Hunter.io (good for finding emails, weaker on verification)

---

## Appendix C: LinkedIn Scraping Considerations

> **Important Update (January 2025):** Proxycurl shut down in July 2025 after LinkedIn/Microsoft filed a lawsuit alleging unauthorized scraping via fake accounts. We now recommend Bright Data as the primary LinkedIn scraping service.
> 

**Use a scraping service (Recommended)**

**Bright Data** (Recommended): [https://brightdata.com/products/web-scraper/linkedin](https://brightdata.com/products/web-scraper/linkedin)

- Won legal cases against Meta and X in 2024, establishing precedent for public data scraping
- Only scrapes publicly available data without authentication
- ~$0.001-0.05 per profile depending on volume
- Returns structured JSON
- GDPR and CCPA compliant
- Handles anti-bot measures, proxies, and CAPTCHAs automatically

**Bright Data LinkedIn Profile API example:**

```python
import requests

API_KEY = "YOUR_BRIGHT_DATA_API_KEY"

def scrape_linkedin_profile(linkedin_url: str) -> dict:
    """
    Scrape a LinkedIn profile using Bright Data's LinkedIn Scraper API.
    
    Returns structured profile data including:
    - Name, headline, location
    - Current company and title
    - Work experience history
    - Education
    - Skills
    """
    endpoint = "[https://api.brightdata.com/datasets/v3/trigger](https://api.brightdata.com/datasets/v3/trigger)"
    
    payload = {
        "dataset_id": "gd_l1viktl72bvl7bjuj0",  # LinkedIn Profile dataset
        "url": linkedin_url,
        "format": "json"
    }
    
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    response = [requests.post](http://requests.post)(endpoint, json=payload, headers=headers)
    
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Bright Data API error: {response.status_code}")

# Example response structure:
# {
#   "id": "john-smith-12345",
#   "name": "John Smith",
#   "headline": "Facilities Director at CBRE",
#   "location": "Dallas, Texas",
#   "current_company": "CBRE",
#   "current_title": "Facilities Director",
#   "experience": [...],
#   "education": [...],
#   "skills": [...]
# }
```

**Gemini Flash 3.0 with Web Grounding (for finding LinkedIn URLs):**

```python
import google.generativeai as genai

genai.configure(api_key="YOUR_API_KEY")

model = genai.GenerativeModel(
    model_name="gemini-3.0-flash-preview",
    tools="google_search_retrieval"  # Enables web grounding
)

def find_linkedin_url(name: str, title: str, company: str, domain: str) -> str:
    """
    Use Gemini with web grounding to find a person's LinkedIn URL.
    """
    prompt = f"""
    Find the LinkedIn profile URL for {name}, who works as
    {title} at {company} ({domain}).
    
    Return ONLY the LinkedIn URL in this format:
    [https://www.linkedin.com/in/username](https://www.linkedin.com/in/username)
    
    If you cannot find a matching profile with high confidence, return 'NOT_FOUND'.
    """
    
    response = model.generate_content(prompt)
    result = response.text.strip()
    
    if result.startswith("[https://www.linkedin.com/in/](https://www.linkedin.com/in/)"):
        return result
    return None

# Example usage:
linkedin_url = find_linkedin_url(
    name="John Smith",
    title="Facilities Director", 
    company="ABC Property Management",
    domain="[abcpm.com](http://abcpm.com)"
)
```

---

## Appendix D: Key Regrid Fields Quick Reference

| Our Use | Regrid Field | Notes |
| --- | --- | --- |
| Parcel unique ID | `ll_uuid` | Stable across refreshes |
| Stack grouping | `ll_stack_uuid` | Null if not stacked; **not stable** |
| Change detection | `ll_updated_at` | Timestamp of last modification |
| Lot size | `ll_gissqft` | Calculated by Regrid |
| Year built | `yearbuilt` |  |
| Owner name | `owner` | Standardized |
| All owners | `owner`, `owner2`, `owner3`, `owner4` |  |
| Property address | `address` | Full situs address |
| Use description | `usedesc` | For filtering commercial |

---

## Appendix E: External Services Summary

| Service | Purpose | Est. Cost | When Used |
| --- | --- | --- | --- |
| **Regrid** | Parcel data, tile maps, address search | Per contract | Data source + runtime |
| **Gemini Flash 3.0** | AI enrichment, LinkedIn URL discovery | ~$0.075/1M tokens | Batch enrichment |
| **LeadMagic** | Email validation + finding | ~$0.003-0.03/lookup | Contact validation |
| **Bright Data** | LinkedIn profile scraping | ~$0.001-0.05/profile | Contact validation |

---

## Questions for Product/Engineering Discussion

1. **Commercial property filtering:** What `usedesc` or `usecode` values define “commercial” for our purposes?
2. **Confidence thresholds:** Should we hide low-confidence contact associations from users or display them but flag as low-confidence?
3. **Change detection frequency:** How often do we check for Regrid updates? Daily? Weekly?
4. **User-initiated enrichment runs:** If a user doesn’t feel the data is accurate, can we have them provide their reasoning and any directional information to point the AI toward a better solution, and re-run the enrichment themselves? 
5. **User roles:** Do different users see different data? (e.g., territory restrictions)

---