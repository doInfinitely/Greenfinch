# Enrichment Script Draft

# Enrichment Script Draft

This script handles AI-powered enrichment of property data using Gemini Flash 3.0. The output schema aligns with the database schema defined in the Technical Architecture document (Section 7).

## Output Schema Alignment

The enrichment script outputs data that maps directly to:

- `properties` table (Section 7.1)
- `contacts` table (Section 7.2)
- `organizations` table (Section 7.3)
- `property_contacts` junction table (Section 8.2)

All key fields include AI confidence scores (0.0-1.0) which determine whether data is stored/displayed per the thresholds in Section 4.

## Confidence Thresholds

| Threshold | Value | Use Case |
| --- | --- | --- |
| HIGH | > 0.90 | Use without review |
| MEDIUM | 0.75 - 0.90 | Use but flag for potential review |
| LOW | 0.50 - 0.75 | Store but don't display without review |
| DISCARD | < 0.50 | Do not store |

## Field Selection Logic

| Field | Source Priority | Confidence Threshold |
| --- | --- | --- |
| `address` | AI `validated_address` if confident, else Regrid | > 0.80 |
| `owner`, `owner2` | Always Regrid (authoritative tax records) | N/A |
| `beneficial_owner` | AI only | > 0.50 to store |
| `lat`, `lon` | AI if high confidence, else Regrid | > 0.90 |
| `asset_category` | AI classification | > 0.75 |
| `common_name` | AI only | > 0.70 |
| `management_company` | AI only | > 0.75 |
| Contact `email` | AI, gated by confidence + LeadMagic | > 0.80 |
| Contact `phone` | AI, gated by confidence | > 0.80 |
| Contact `linkedin_url` | AI, gated by confidence | > 0.75 |

---

## Input Data Structure

The enrichment function receives a **pre-aggregated property record** from the deduplication step (Section 3.5 of Technical Architecture). The `property_key` is passed as input—the script does not compute it.

```tsx
export interface AggregatedPropertyInput {
  // ===== IDENTITY (passed in, not computed) =====
  property_key: string;           // COALESCE(ll_stack_uuid, ll_uuid) - computed upstream
  source_ll_uuid: string;         // One ll_uuid for API lookups
  ll_stack_uuid: string | null;   // Stack UUID if parcels are stacked
  
  // ===== LOCATION =====
  address: string;                // Primary address from Regrid
  city: string;
  state: string;
  zip: string;
  county: string;
  lat: number;
  lon: number;
  
  // ===== PHYSICAL CHARACTERISTICS (from Regrid) =====
  lot_sqft: number;               // From ll_gissqft (MAX across stack)
  building_sqft: number | null;   // From area_building (MAX across stack)
  yearbuilt: number | null;       // MAX across stack
  num_floors: number | null;      // From numstories (MAX across stack)
  
  // ===== VALUATION (aggregated) =====
  total_parval: number;           // SUM across stack
  total_improvval: number;        // SUM across stack
  landval: number;                // MAX (usually only on parent parcel)
  
  // ===== OWNERSHIP (from Regrid tax records) =====
  all_owners: string[];           // ARRAY_AGG(DISTINCT) of owner, owner2
  primary_owner: string | null;   // First owner
  
  // ===== LAND USE =====
  usedesc: string[];              // ARRAY_AGG(DISTINCT) - use descriptions
  usecode: string[];              // ARRAY_AGG(DISTINCT) - use codes
  zoning: string | null;
  zoning_description: string | null;
  
  // ===== RAW PARCEL DATA =====
  parcel_count: number;           // Number of parcels in stack
  raw_parcels_json: RawParcel[];  // Full parcel details for AI context
  
  // ===== TIMESTAMPS =====
  last_regrid_update: string;     // MAX(ll_updated_at) across stack
}

export interface RawParcel {
  ll_uuid: string;
  parcelnumb: string;
  address: string;
  sunit: string | null;
  owner: string | null;
  owner2: string | null;
  usedesc: string | null;
  parval: number;
  improvval: number;
}
```

---

## UUID Generation Strategy

**Important:** Random UUIDs are unreliable for entity deduplication. We use **deterministic UUIDs (UUID v5)** based on canonical identifying attributes.

### Property IDs

The `property_key` is **passed as input** from the upstream deduplication step. The enrichment script does not compute it—this ensures consistency with the parcel-to-property lookup table.

### Contact UUIDs

Contacts are identified by a hash of their canonical attributes in priority order:

1. **Email (primary)**: If email exists → `UUID v5(NAMESPACE, email.toLowerCase())`
2. **Name + Domain**: If no email → `UUID v5(NAMESPACE, normalized_name + "|" + domain)`
3. **Name + Phone**: If no domain → `UUID v5(NAMESPACE, normalized_name + "|" + normalized_phone)`

### Organization UUIDs

Organizations are identified by domain:

- **Domain (primary)**: `UUID v5(NAMESPACE, domain.toLowerCase())`
- **Fallback (no domain)**: `UUID v5(NAMESPACE, "org:" + normalized_name)`

---

## Asset Categorization Schema

The AI uses this exact schema from Technical Architecture Section 4:

```json
{
  "Single-Family Residential": ["Single Family Home", "Townhouse", "Condominium", "Mobile Home", "Other Residential"],
  "Multifamily": ["Apartment Complex", "Duplex/Triplex/Quadplex", "Mobile Home Park", "Senior Living", "Other Multifamily"],
  "Office": ["Office Building", "Medical Office", "Business Park", "Flex Office", "Other Office"],
  "Retail": ["Shopping Center", "Restaurant/Food Service", "Convenience/Gas Station", "Standalone Retail", "Other Retail"],
  "Industrial": ["Warehouse/Distribution", "Manufacturing", "Flex/Light Industrial", "Self-Storage", "Other Industrial"],
  "Hospitality": ["Hotel", "Motel", "Resort", "Extended Stay", "Other Hospitality"],
  "Healthcare": ["Hospital", "Medical Center", "Assisted Living", "Outpatient Clinic", "Other Healthcare"],
  "Public & Institutional": ["Government", "School/University", "Religious", "Recreation/Parks", "Other Institutional"],
  "Mixed Use": ["Retail/Residential", "Office/Retail", "Office/Residential", "Commercial/Industrial", "Other Mixed Use"],
  "Vacant Land": ["Commercial Land", "Industrial Land", "Residential Land", "Agricultural Land", "Other Vacant Land"],
  "Agricultural": ["Farm/Ranch", "Vineyard/Orchard", "Greenhouse/Nursery", "Livestock", "Other Agricultural"],
  "Special Purpose": ["Parking", "Sports/Fitness", "Entertainment", "Auto Service", "Other Special Purpose"]
}
```

---

## TypeScript Implementation

```tsx
import { GoogleGenAI } from "@google/genai";
import { v5 as uuidv5 } from "uuid";

// UUID namespace for Greenfinch (generate once, use everywhere)
const GREENFINCH_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Confidence threshold constants (from Technical Architecture Section 4)
const CONFIDENCE = {
  HIGH: 0.90,
  MEDIUM: 0.75,
  LOW: 0.50,
  EMAIL_THRESHOLD: 0.80,
  PHONE_THRESHOLD: 0.80,
  LINKEDIN_THRESHOLD: 0.75,
  ADDRESS_THRESHOLD: 0.80,
  GEOCODE_THRESHOLD: 0.90,
  CATEGORY_THRESHOLD: 0.75,
  COMMON_NAME_THRESHOLD: 0.70,
  BENEFICIAL_OWNER_THRESHOLD: 0.50,
  MANAGEMENT_THRESHOLD: 0.75
};

// Asset categorization schema (from Technical Architecture Section 4)
const ASSET_CATEGORIES = {
  "Single-Family Residential": ["Single Family Home", "Townhouse", "Condominium", "Mobile Home", "Other Residential"],
  "Multifamily": ["Apartment Complex", "Duplex/Triplex/Quadplex", "Mobile Home Park", "Senior Living", "Other Multifamily"],
  "Office": ["Office Building", "Medical Office", "Business Park", "Flex Office", "Other Office"],
  "Retail": ["Shopping Center", "Restaurant/Food Service", "Convenience/Gas Station", "Standalone Retail", "Other Retail"],
  "Industrial": ["Warehouse/Distribution", "Manufacturing", "Flex/Light Industrial", "Self-Storage", "Other Industrial"],
  "Hospitality": ["Hotel", "Motel", "Resort", "Extended Stay", "Other Hospitality"],
  "Healthcare": ["Hospital", "Medical Center", "Assisted Living", "Outpatient Clinic", "Other Healthcare"],
  "Public & Institutional": ["Government", "School/University", "Religious", "Recreation/Parks", "Other Institutional"],
  "Mixed Use": ["Retail/Residential", "Office/Retail", "Office/Residential", "Commercial/Industrial", "Other Mixed Use"],
  "Vacant Land": ["Commercial Land", "Industrial Land", "Residential Land", "Agricultural Land", "Other Vacant Land"],
  "Agricultural": ["Farm/Ranch", "Vineyard/Orchard", "Greenhouse/Nursery", "Livestock", "Other Agricultural"],
  "Special Purpose": ["Parking", "Sports/Fitness", "Entertainment", "Auto Service", "Other Special Purpose"]
};

// =============================================================================
// UUID GENERATION FUNCTIONS
// =============================================================================

function generateContactUUID(
  email: string | null,
  normalizedName: string,
  domain: string | null,
  normalizedPhone: string | null
): string {
  if (email) {
    return uuidv5(email.toLowerCase().trim(), GREENFINCH_NAMESPACE);
  }
  if (normalizedName && domain) {
    return uuidv5(`${normalizedName}|${domain.toLowerCase()}`, GREENFINCH_NAMESPACE);
  }
  if (normalizedName && normalizedPhone) {
    return uuidv5(`${normalizedName}|${normalizedPhone}`, GREENFINCH_NAMESPACE);
  }
  return uuidv5(`contact:${normalizedName}`, GREENFINCH_NAMESPACE);
}

function generateOrgUUID(domain: string | null, orgName: string): string {
  if (domain) {
    return uuidv5(domain.toLowerCase().trim(), GREENFINCH_NAMESPACE);
  }
  const normalizedOrgName = normalizeOrgName(orgName);
  return uuidv5(`org:${normalizedOrgName}`, GREENFINCH_NAMESPACE);
}

// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================

function normalizeName(name: string): string {
  let normalized = name.toLowerCase().trim();
  normalized = normalized.replace(/[^\w\s]/g, "");
  const suffixes = ["jr", "sr", "ii", "iii", "iv", "phd", "md", "esq", "mba"];
  for (const suffix of suffixes) {
    normalized = normalized.replace(new RegExp(`\\b${suffix}\\.?\\b`, "g"), "");
  }
  return normalized.split(/\s+/).filter(Boolean).join(" ");
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function normalizeOrgName(name: string): string {
  let normalized = name.toLowerCase().trim();
  const suffixes = ["inc", "llc", "llp", "corp", "corporation", "company", "co", "ltd", "limited", "group", "holdings", "partners", "lp"];
  for (const suffix of suffixes) {
    normalized = normalized.replace(new RegExp(`\\b${suffix}\\.?\\b`, "gi"), "");
  }
  return normalized.split(/\s+/).filter(Boolean).join(" ");
}

function extractDomain(emailOrUrl: string): string | null {
  if (!emailOrUrl) return null;
  if (emailOrUrl.includes("@")) {
    return emailOrUrl.split("@")[1].toLowerCase();
  }
  let domain = emailOrUrl.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0].toLowerCase();
  return domain || null;
}

// =============================================================================
// VALIDATION FUNCTION
// =============================================================================

function validateAssetCategory(category: string, subcategory: string): boolean {
  const validCategories = Object.keys(ASSET_CATEGORIES);
  if (!validCategories.includes(category)) return false;
  const validSubcategories = ASSET_CATEGORIES[category as keyof typeof ASSET_CATEGORIES];
  return validSubcategories.includes(subcategory);
}
```

---

## Main Enrichment Function

The complete `enrichPropertyData` function is split into sections for clarity.

### Complete Implementation File

Due to length constraints, the complete TypeScript implementation is maintained in a separate file: `greenfinch-enrichment-script.ts`

**Key aspects of the implementation:**

1. **`buildEnrichmentPrompt()`** - Constructs the AI prompt including:
    - Full `ASSET_CATEGORIES` schema as JSON in the prompt
    - Explicit instruction: "asset_category MUST be one of: ${validCategoryNames}"
    - Explicit instruction: "asset_subcategory MUST be from the corresponding category's list"
    - Regrid physical data (lot_sqft, building_sqft) for AI to cross-reference
    - Instructions to increase confidence when research matches Regrid
2. **`validateAssetCategory()`** - Server-side validation:

```tsx
function validateAssetCategory(category: string, subcategory: string): boolean {
  const validCategories = Object.keys(ASSET_CATEGORIES);
  if (!validCategories.includes(category)) return false;
  const validSubcategories = ASSET_CATEGORIES[category];
  return validSubcategories.includes(subcategory);
}
```

1. **Response processing** - If AI returns invalid category:

```tsx
if (!validateAssetCategory(data.asset_category, data.asset_subcategory)) {
  console.warn(`Invalid category: ${data.asset_category}/${data.asset_subcategory}`);
  data.asset_category = "Special Purpose";
  data.asset_subcategory = "Other Special Purpose";
  data.category_confidence = 0.3; // Low confidence for fallback
}
```

1. **Physical data cross-reference in prompt:**

```
=== PHYSICAL VERIFICATION ===
- Lot Size: Regrid=${input.lot_sqft} sqft. Does this match?
- Building Size: Regrid=${input.building_sqft} sqft. Does this match?
- Matches INCREASE confidence. Conflicts require explanation.
```

---

## Key Implementation Notes

### 1. Property Key is Passed as Input

The `property_key` is computed upstream in the deduplication step (Section 3.3) and passed to this function. This ensures:

- Consistency with the parcel_to_property lookup table
- No risk of computing different values in different places
- The enrichment function focuses only on enrichment, not identity resolution

### 2. Regrid Data Informs Confidence

The prompt explicitly asks the AI to compare its research findings against Regrid data:

- If AI research matches Regrid → higher confidence
- If AI research conflicts with Regrid → AI explains discrepancy, may have lower confidence
- Lot size and building sqft from Regrid serve as ground truth checks

### 3. Asset Categorization Uses Exact Schema

The AI must classify using the exact categories/subcategories from Technical Architecture Section 4. Invalid classifications are rejected.

### 4. Deterministic UUIDs Prevent Duplicates

Using UUID v5 with consistent inputs ensures natural deduplication.

### 5. Regrid Ownership is Authoritative

`regrid_owner` and `regrid_owner2` are always preserved. AI discovers beneficial owners as additional context.

---

## Output Type Definitions

```tsx
export interface EnrichmentResult {
  property: EnrichedProperty;
  contacts: EnrichedContact[];
  organizations: EnrichedOrganization[];
}

export interface EnrichedProperty {
  property_key: string;  // Passed through from input
  source_ll_uuid: string;
  ll_stack_uuid: string | null;
  regrid_address: string;
  validated_address: string | null;
  validated_address_confidence: number;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
  geocode_confidence: number;
  lot_sqft: number;
  building_sqft: number | null;
  yearbuilt: number | null;
  num_floors: number | null;
  asset_category: string;
  asset_subcategory: string | null;
  category_confidence: number;
  property_class: "A" | "B" | "C" | null;
  common_name: string | null;
  common_name_confidence: number;
  regrid_owner: string | null;
  regrid_owner2: string | null;
  beneficial_owner: string | null;
  beneficial_owner_confidence: number;
  beneficial_owner_type: string | null;
  management_type: "Self-Managed" | "3rd Party" | null;
  management_company: string | null;
  management_company_domain: string | null;
  management_confidence: number;
  raw_parcels_json: RawParcel[];
  enrichment_json: object;
  physical_intelligence_json: object | null;
  validation_logic: string | null;
  discovery_process: string | null;
  last_regrid_update: string;
  last_enriched_at: string;
}

export interface EnrichedContact {
  contact_id: string;
  full_name: string;
  normalized_name: string;
  name_confidence: number;
  email: string | null;
  normalized_email: string | null;
  email_confidence: number;
  phone: string | null;
  normalized_phone: string | null;
  phone_confidence: number;
  title: string | null;
  title_confidence: number;
  employer_name: string | null;
  company_domain: string | null;
  linkedin_url: string | null;
  linkedin_confidence: number;
  role_at_property: string;
  role_confidence: number;
  source: "ai_enrichment";
}

export interface EnrichedOrganization {
  org_id: string;
  name: string;
  domain: string | null;
  org_type: "owner" | "property_manager" | "tenant";
}
```