# enrichment-refactor-plan

# Enrichment Pipeline Refactor Plan

## Overview

This document is an implementation plan for refactoring `ai-enrichment.ts`, the AI-powered property enrichment pipeline for Greenfinch. The goal is to improve accuracy, relevance, and recency of discovered contacts and property information.

The file being refactored is the focused enrichment script that uses Gemini with Google Search grounding to:
1. Classify and verify commercial property data
2. Identify property ownership and management
3. Discover decision-maker contacts

Changes are organized into 5 phases. Complete each phase fully and test before moving to the next.

### Cost Constraint

**Every prompt and response schema must be as lean as possible.** The cost of this pipeline scales with the number of properties enriched. Rules:
- Prompts should include only the data the model needs for THAT specific task. Do not repeat context that doesn’t help the search.
- Response JSON schemas should request only the fields needed. No summaries unless they serve a downstream purpose.
- Prefer a single well-structured API call over two calls when the tasks are closely related and the combined prompt stays small.
- When splitting a stage into multiple calls IS justified (contact identification vs enrichment), keep each sub-call’s prompt and response minimal.
- Never ask for freeform explanation fields in high-volume calls (like per-contact enrichment). Short coded values only.
- Summaries are requested only once per stage and kept to 2 sentences max.

---

## Phase 1: Split Contact Discovery from Contact Enrichment

**Priority: Highest — this is the single biggest accuracy improvement.**

### Current Problem

Stage 3 (`discoverContacts`) asks Gemini to simultaneously identify WHO the right people are AND find their contact details (email, phone, location) in one prompt. This causes:
- The model conflates “I found a name” with “I found contact info” and backfills to connect them
- Contacts that are tangentially related rather than current and directly involved
- Lower accuracy on both identification and contact details because the model is doing too much at once

### Changes

### 1a. Create new function `identifyDecisionMakers`

This replaces the first half of the current `discoverContacts`. It should ONLY identify people — no emails, no phones.

**New interface:**

```tsx
export interface IdentifiedDecisionMaker {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  role: string; // property_manager | facilities_manager | owner | leasing | other
  roleConfidence: number;
  connectionEvidence: string; // 1 sentence: WHY this person is connected to this property
  contactType: 'individual' | 'general';
}
```

**Prompt for `identifyDecisionMakers`:**

Keep input compact — only the fields that help the model search effectively.

```
Find 3-5 decision-makers for this commercial property. Return ONLY valid JSON.

PROPERTY: [name] at [full address]
TYPE: [category - subcategory]
MGMT CO: [name] ([domain])
OWNER: [beneficial owner name]
PROPERTY SITE: [url or "none"]

SEARCH STRATEGY:
1. Search [mgmt domain] for staff assigned to this property or this market
2. Search "[property name] property manager" and "[property name] facilities manager"
3. Search LinkedIn for property/facilities managers at [mgmt company] in [city]

Only return people verifiably connected to THIS property at THIS address as of 2025-2026.

Return JSON:
{"contacts":[{"name":"Full Name","title":"Title","company":"Co","domain":"co.com","role":"property_manager|facilities_manager|owner|leasing|other","rc":0.0-1.0,"evidence":"1 sentence linking them to this property","type":"individual|general"}],"orgs":[{"name":"Co","domain":"co.com","org_type":"owner|management|tenant|developer","roles":["property_manager"]}],"summary":"2 sentences max."}
```

Key differences from current prompt:
- No email/phone fields — dramatically reduces output tokens and prevents backfill hallucination
- Requires `evidence` — forces the model to justify each contact (but capped at 1 sentence to control output size)
- Positive framing only — no long exclusion lists
- Explicit search strategy using Stage 2 outputs
- Abbreviated JSON field names where possible (`rc` for role_confidence, `type` for contact_type)
- Temperature: 0.1

### 1b. Create new function `enrichContactDetails`

For EACH identified decision-maker from 1a, run a separate focused search to find their contact info.

**New interface:**

```tsx
export interface ContactEnrichmentResult {
  email: string | null;
  emailSource: 'ai_discovered' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  location: string | null;
  enrichmentSources: GroundedSource[];
}
```

**Prompt for each contact — keep this extremely minimal:**

```
Find contact info for [Name], [Title] at [Company] ([domain]) in [city], TX. Return ONLY valid JSON.

{"email":"found@email.com|null","phone":"+1XXXXXXXXXX|null","pl":"direct_work|office|personal|null","pc":0.0-1.0,"loc":"City, ST|null"}
```

Key points:
- This is the highest-volume call (runs once per contact), so the prompt MUST be tiny
- No search strategy instructions — the query is self-evident
- Response schema is minimal: 5 fields, abbreviated keys
- Run in parallel using `Promise.all` with existing `geminiLimit` concurrency control
- Timeout: 30s (shorter than other stages since it’s a simple lookup)
- Temperature: 0.1
- Map abbreviated response keys back to full field names in code after parsing

### 1c. Update `discoverContacts` to orchestrate both steps

The existing `discoverContacts` function signature and return type stay the same so nothing downstream breaks. Internally it:
1. Calls `identifyDecisionMakers`
2. Calls `enrichContactDetails` for each result (in parallel)
3. Merges results into the existing `DiscoveredContact[]` format
4. Combines all sources from both steps

### 1d. Update timing tracking

Add timing for the sub-steps:

```tsx
timing: {
  // ... existing fields ...
  contactIdentificationMs: number;
  contactEnrichmentMs: number;
}
```

### 1e. Cost impact assessment

- **Before:** 1 large grounded search call for contacts (~large prompt, large response)
- **After:** 1 small grounded search for identification + N small grounded searches for enrichment (N = number of contacts, typically 3-5)
- Net cost increase: moderate (more calls, but each is smaller). The per-contact enrichment calls are very cheap due to tiny prompts.
- Net accuracy increase: significant — this is the primary improvement.
- If cost is a concern, the per-contact enrichment (1b) can be made optional or limited to top-N contacts by priority_rank.

---

## Phase 2: Restructure Ownership Identification (Stage 2)

**Priority: High — improves management company and owner accuracy without adding API calls.**

### Current Problem

Stage 2 asks Gemini to find beneficial owner, management company, property website, and property phone all at once. These are different research tasks with different search strategies. The prompt is also heavy — it dumps the full DCAD owner record as JSON, which wastes input tokens on fields the model often can’t use (owner mailing address rarely helps find the beneficial owner).

### Changes

### 2a. Restructure as a single call with a directed search sequence

Do NOT split into two API calls — the tasks are related enough that one grounded search can usually resolve both. But restructure the prompt to give the model a clear research path and lean input.

**Revised prompt for `identifyOwnership`:**

```
Find the ownership and management of this commercial property. Return ONLY valid JSON.

PROPERTY: [property name] at [full address]
TYPE: [category - subcategory], [sqft] sqft
DCAD DEED OWNER: [bizName or ownerName1] (transferred [deedTxfrDate or "date unknown"])
DCAD SECONDARY: [ownerName2 or omit this line entirely if null]

SEARCH SEQUENCE:
1. Search "[property name] [city]" to find the property website and management company
2. Search the management company website for this property listing to confirm and find leasing phone
3. Search "[deed owner name] Texas" on OpenCorporates or TX Secretary of State to find the entity behind the LLC/trust
4. Search for news about acquisitions or sales of [property name] around [deed transfer date] to identify the beneficial owner

Return JSON:
{"mgmt":{"name":"Co|null","domain":"co.com|null","c":0.0-1.0},"owner":{"name":"Entity|null","type":"REIT|PE|Family Office|Individual|Corporation|Institutional|Syndicator|null","c":0.0-1.0},"site":"https://property-site.com|null","phone":"+1XXXXXXXXXX|null","summary":"2 sentences max: who owns it, who manages it."}
```

Key changes from current:
- **Lean input:** Only include deed owner name and transfer date from DCAD records. Remove the full ownerInfo JSON dump (owner mailing address, city, state, zip rarely help and waste ~100 input tokens per call).
- **Include legal description only if it contains a recognizable property/development name.** Add a code check before prompt assembly (see 2b).
- **Directed search sequence** with numbered steps. The model searches more effectively with an explicit plan.
- **Deed transfer date is a first-class search signal.** Pulled out of the JSON dump and highlighted.
- **Expanded owner type taxonomy:** Added “Institutional” (pension funds, sovereign wealth), “PE” (private equity, abbreviated), and “Syndicator” which are common in Dallas CRE.
- **Abbreviated response keys** to reduce output tokens: `mgmt` instead of `managementCompany`, `c` instead of `confidence`, `site` instead of `propertyWebsite`.
- **Summary capped at 2 sentences.**
- Temperature: 0.1

### 2b. Add legal description filtering in code

Before building the prompt, check if the legal description adds value:

```tsx
function extractUsefulLegalInfo(property: CommercialProperty): string | null {
  const legal = [property.legal1, property.legal2, property.legal3, property.legal4]
    .filter(Boolean).join(' ');
  if (!legal) return null;
  // Only include if it contains a recognizable property/development name
  const usefulPatterns = /plaza|center|tower|park|square|village|crossing|place|point|commons|mall|industrial|business/i;
  return usefulPatterns.test(legal) ? legal : null;
}
```

If no useful legal info, omit the LEGAL DESCRIPTION line entirely from the prompt to save tokens.

### 2c. Map abbreviated response keys back to full interface in code

After parsing the Gemini response, map the compact JSON back to the existing `OwnershipInfo` interface:

```tsx
const ownershipData: OwnershipInfo = {
  beneficialOwner: {
    name: parsed.owner?.name ?? null,
    type: parsed.owner?.type === 'PE' ? 'Private Equity' : parsed.owner?.type ?? null,
    confidence: parsed.owner?.c ?? 0,
  },
  managementCompany: {
    name: parsed.mgmt?.name ?? null,
    domain: parsed.mgmt?.domain ?? null,
    confidence: parsed.mgmt?.c ?? 0,
  },
  propertyWebsite: parsed.site ?? null,
  propertyPhone: parsed.phone ?? null,
};
```

The `OwnershipInfo` interface itself does NOT change — abbreviation is internal to the AI prompt/response only. Note the mapping of “PE” back to “Private Equity” for the external interface.

### 2d. Cross-validate management company against property website in code

After the Gemini call returns, add a simple consistency check:

```tsx
function crossValidateOwnership(ownership: OwnershipInfo): OwnershipInfo {
  if (ownership.managementCompany.domain && ownership.propertyWebsite) {
    try {
      const siteHost = new URL(ownership.propertyWebsite).hostname.toLowerCase();
      const mgmtDomain = ownership.managementCompany.domain.toLowerCase();
      if (!siteHost.includes(mgmtDomain) && !mgmtDomain.includes(siteHost)) {
        if (ownership.managementCompany.confidence < 0.5) {
          console.warn('[FocusedEnrichment] Low-confidence mgmt co with separate property website — verify');
        }
      }
    } catch { /* invalid URL, skip */ }
  }
  return ownership;
}
```

This is logging only for now — helps identify data quality issues over time without adding cost.

---

## Phase 3: Pass Context Forward Between Stages

**Priority: High — stages should build on each other, not start from scratch.**

### Current Problem

Each stage starts its search from scratch. Stage 2 discovers the management company and property website, but Stage 3 doesn’t use those as primary search targets.

### Changes

### 3a. Pass Stage 2 outputs into Stage 3 prompts

This is already built into the Phase 1 prompt design for `identifyDecisionMakers`, which includes management company domain and property website. Verify that the implementation:

- Includes the management company domain in the search strategy instructions
- Includes the property website URL if found
- Does NOT re-include the full DCAD owner record (Stage 3 only needs the resolved beneficial owner name, not raw DCAD data)

### 3b. Add source quality scoring

Create a utility function that scores grounding sources by domain quality:

```tsx
interface ScoredSource extends GroundedSource {
  trustTier: 'high' | 'medium' | 'low';
}

function scoreSource(source: GroundedSource, knownDomains: string[]): ScoredSource {
  let hostname: string;
  try {
    hostname = new URL(source.url).hostname.toLowerCase();
  } catch {
    return { ...source, trustTier: 'low' };
  }

  // High: management company domain, property website, linkedin
  if (knownDomains.some(d => hostname.includes(d)) || hostname.includes('linkedin.com')) {
    return { ...source, trustTier: 'high' };
  }
  // Medium: CRE directories, news, press releases
  const mediumDomains = ['loopnet.com', 'costar.com', 'commercialcafe.com', 'crexi.com',
    'bizjournals.com', 'dallasnews.com', 'dmagazine.com', 'prnewswire.com', 'globenewswire.com'];
  if (mediumDomains.some(d => hostname.includes(d))) {
    return { ...source, trustTier: 'medium' };
  }
  return { ...source, trustTier: 'low' };
}
```

- `knownDomains` populated from Stage 2 results (management company domain, property website domain)
- Attach to sources as metadata — no logic changes yet, just instrumentation

---

## Phase 4: Tighten Prompts and Reduce Overload

**Priority: Medium — incremental quality and cost improvements.**

### Changes

### 4a. Tighten Stage 1 (Classification) prompt input

The current prompt includes verbose formatting. Compact it:

**Current format (verbose):**

```
PROPERTY DATA:
Address: 1234 Main St, Dallas, TX 75201
DCAD Property Type: Commercial (SPTD Code: F10)
Buildings: 2 buildings, 150,000 sqft total
Zoning/Use: Office Building
Deed Owner: SOME LLC
Value: $25,000,000
Lot Size: 130,680 sqft
DCAD Quality Grade: Good
```

**New format (compact):**

```
ADDRESS: 1234 Main St, Dallas, TX 75201
DCAD: F10 Commercial | 2 bldgs, 150,000 sqft | $25M | 3.0 acres | Quality: Good
OWNER: SOME LLC | ZONING: Office Building
```

- Only include building detail lines if there are 2+ buildings with different characteristics
- For single-building properties, the summary line has everything needed

### 4b. Make physical data verification contextual

Add DCAD values to prompt so the model knows what to verify:

```
DCAD SIZE: 130,680 sqft lot (3.0 acres), 150,000 sqft building
Note: DCAD may show one parcel of a multi-parcel property. Confirm or correct with canonical totals.
```

### 4c. Move building class mapping to code

```tsx
function mapQualityGradeToClass(grade: string | null): { propertyClass: string | null; confidence: number } {
  if (!grade) return { propertyClass: null, confidence: 0 };
  const gradeNorm = grade.trim().toLowerCase();
  const mapping: Record<string, { propertyClass: string; confidence: number }> = {
    'excellent': { propertyClass: 'A', confidence: 0.8 },
    'superior': { propertyClass: 'A+', confidence: 0.8 },
    'good': { propertyClass: 'B', confidence: 0.7 },
    'average': { propertyClass: 'C', confidence: 0.6 },
    'fair': { propertyClass: 'C', confidence: 0.6 },
    'poor': { propertyClass: 'D', confidence: 0.7 },
    'unsound': { propertyClass: 'D', confidence: 0.7 },
  };
  return mapping[gradeNorm] || { propertyClass: null, confidence: 0 };
}
```

Remove the BUILDING CLASS mapping table from the Stage 1 prompt. Replace with one line:

```
DCAD CLASS ESTIMATE: B (from quality grade "Good"). Override only if research shows renovations or condition changes.
```

### 4d. Compact category schema

If classification accuracy is already high without the full schema, remove it entirely and test. If accuracy drops, use this compact format instead of the current verbose one:

```
CATEGORIES: Office (A/B/C, Medical, Flex) | Retail (Strip, Power, Mall, Single Tenant, Restaurant) | Industrial (Warehouse, Distribution, Manufacturing, Flex, Data Center) | Multifamily (Garden, Mid-Rise, High-Rise, Student, Senior) | Hospitality (Full/Select/Extended) | Special Purpose (Religious, Education, Healthcare, Gov) | Land (Development, Parking)
```

One line instead of 7+ lines.

### 4e. Remove negative instruction lists from all prompts

Audit all prompts. Replace any “DO NOT include…” blocks with positive constraints. The Phase 1 and Phase 2 prompt designs already do this.

### 4f. Update all temperatures to 0.1

Change every Gemini API call from `temperature: 0.0` to `temperature: 0.1`:
- `classifyAndVerifyProperty` (Stage 1)
- `identifyOwnership` (Stage 2)
- `identifyDecisionMakers` (Stage 3a, new)
- `enrichContactDetails` (Stage 3b, new)
- `cleanupAISummary` (already 0.1, leave as-is)

### 4g. Compact all response schemas with abbreviated keys

Across all stages, use abbreviated JSON keys in response schemas and map back to full field names in code.

Stage 1 response:

```json
{"name":"...","addr":"...","cat":"...","sub":"...","c":0.0,"class":"B","cc":0.0,"acres":0,"ac":0.0,"sqft":0,"sc":0.0,"summary":"2 sentences max."}
```

Map in code:

```tsx
const classification = {
  propertyName: parsed.name || '',
  canonicalAddress: parsed.addr || '',
  category: parsed.cat || '',
  subcategory: parsed.sub || '',
  confidence: parsed.c ?? 0,
  propertyClass: parsed.class ?? null,
  propertyClassConfidence: parsed.cc ?? null,
};
const physical = {
  lotAcres: parsed.acres ?? null,
  lotAcresConfidence: parsed.ac ?? null,
  netSqft: parsed.sqft ?? null,
  netSqftConfidence: parsed.sc ?? null,
};
```

Apply this abbreviated-key pattern to Stage 2 (already done in Phase 2) and Stage 3a (already done in Phase 1). The external interfaces stay unchanged.

---

## Phase 5: Add Validation and Deduplication

**Priority: Lower — polish and error reduction after structural changes are stable.**

### Changes

### 5a. Add contact deduplication in code (no API call — zero cost)

After Stage 3 completes, deduplicate contacts:

```tsx
function deduplicateContacts(contacts: DiscoveredContact[]): DiscoveredContact[] {
  // Normalize names: trim, collapse whitespace, title case
  // Group by normalized name
  // For duplicates: merge (prefer non-null values, higher confidence)
  // Keep the higher priority_rank entry as base
}
```

Also deduplicate organizations by normalized name + domain.

### 5b. Lightweight validation pass (optional — assess cost/benefit)

One Gemini call WITHOUT grounding to review the contact set:

**Prompt — extremely compact:**

```
Review contacts for [property name] at [address]. Mgmt: [co]. Owner: [owner].
[name, title, company, evidence — one line per contact]
Return JSON: {"remove":["Name1"]} or {"remove":[]} if all valid.
Remove if: wrong city/company, stale, or weak evidence.
```

Cost controls:
- No grounding search — pure reasoning, very cheap
- Response is tiny: just names to remove or empty array
- Gate behind a flag or threshold (only run for 5+ contacts)
- Temperature: 0.1

### 5c. Track source-to-contact attribution (metadata only — zero cost)

```tsx
export interface DiscoveredContact {
  // ... existing fields ...
  discoverySource: string | null;
  discoverySourceTier: 'high' | 'medium' | 'low' | null;
}
```

---

## Implementation Notes

### Token budget estimates (approximate per property)

| Stage | Current (est.) | After Refactor (est.) | Notes |
| --- | --- | --- | --- |
| Stage 1 (classify) | ~800 in, ~300 out | ~500 in, ~200 out | Compact prompt + abbreviated response |
| Stage 2 (ownership) | ~700 in, ~300 out | ~400 in, ~150 out | Removed DCAD JSON dump, abbreviated response |
| Stage 3a (identify contacts) | — | ~350 in, ~250 out | New call, replaces half of old Stage 3 |
| Stage 3b (enrich × 3 contacts) | — | ~150 in, ~90 out | 3 × ~50 in, ~30 out |
| Old Stage 3 (combined) | ~900 in, ~500 out | — | Eliminated |
| **Prompt/response total** | **~2400 in, ~1100 out** | **~1400 in, ~690 out** | **~40% fewer tokens** |

Grounding search costs: adds ~3 extra grounding calls for contact enrichment (one per contact). Monitor this. If grounding costs dominate, batch 2-3 contacts per enrichment call.

### Testing approach

- After each phase, run on 5-10 known properties with manually verifiable results
- Compare contact relevance and accuracy before/after
- Track timing and token usage per stage
- Monitor grounding search cost per property

### Things to preserve

- `StageResult<T>` pattern and `runFocusedEnrichment` function signature
- `callGeminiWithTimeout` retry logic — apply to all new functions
- `geminiLimit` concurrency control — all Gemini calls go through it
- `trackCostFireAndForget` instrumentation — add to all new endpoints
- `extractGroundedSources` and AI source filtering
- `FocusedEnrichmentResult` interface (extend, don’t break)
- `cleanupAISummary` stays as-is
- All external interfaces unchanged — abbreviation is internal to AI prompts only

### Concurrency notes

- Stage 3a → Stage 3b (sequential: identify then enrich)
- Stage 3b enrichments run in parallel, all through `geminiLimit`
- Pipeline: Stage 1 → Stage 2 → Stage 3a → Stage 3b (sequential between stages)

### Error handling

- Same try/catch pattern as existing stages for all new functions
- Failed contact enrichments return null fields — contact still exists from 3a
- Validation pass (5b) is best-effort — skip on failure, return unvalidated contacts