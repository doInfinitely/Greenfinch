# Greenfinch.ai -- Work Report: Remy Ochei

**Prepared:** March 6, 2026
**Repository:** `Greenfinchai-v0`
**Branch:** `main`
**Baseline Commit:** `f0e44c7` ("Add property status and research badges to list views")
**Final Commit:** `7fc1012` ("Implement multi-LLM enrichment pipeline with SerpAPI + browser-use")

---

## 1. Executive Summary

On March 5, 2026 at 11:37 AM CST, the existing Greenfinch.ai Replit project was downloaded as a ZIP archive. The project at that point consisted of 1,334 commits by previous developers ("greenfinch" and "cory-greenfinch"), spanning January 14 through March 5, 2026.

Over the course of approximately 13 hours of focused engineering work on March 5-6, 2026, the following was accomplished:

- **70 files changed** across the codebase with **14,950 lines added** and **3,466 lines removed** (net +11,484 lines)
- Built a complete **multi-LLM abstraction layer** enabling the system to use OpenAI and Anthropic Claude alongside the existing Google Gemini, with per-stage provider switching
- Created a **new cascade enrichment pipeline (V2)** that replaces expensive per-API-call data providers (PDL, Crustdata, EnrichLayer) with SerpAPI web search + LLM extraction + browser-use LinkedIn scraping
- Designed and implemented an **A/B experiment routing system** for safe, gradual rollout of V2 with deterministic hash-based traffic splitting and side-by-side comparison logging
- Built a complete **multi-county CAD (Central Appraisal District) data system** with download, parsing, staging, and querying capabilities for 4 Texas counties (Dallas, Tarrant, Collin, Denton)
- **Eliminated the Snowflake dependency** by replacing all Snowflake SQL queries with local PostgreSQL staging tables, removing 708 lines of Snowflake client code
- **Refactored the enrichment queue** to wrap all database writes in a transaction for atomic property/contact/organization saves, preventing partial state on failure
- Authored a comprehensive **312-line technical design document** outlining a 6-phase refactoring plan

---

## 2. Work Timeline

| Event | Timestamp |
|-------|-----------|
| **Project ZIP downloaded** | March 5, 2026, 11:37 AM CST |
| **Baseline snapshot** | Commit `f0e44c7` -- 1,334 commits by previous developers |
| **Work session** | March 5-6, 2026 (~13 hours) |
| **Final commit** | Commit `7fc1012` -- March 6, 2026 |
| **Scope** | 70 files changed, 14,950 insertions, 3,466 deletions |
| **New files created** | 34 files |
| **Existing files modified** | 35 files |
| **Files deleted** | 1 file (`src/lib/snowflake.ts` -- 708 lines) |

### Baseline Context

The project at download consisted of:

- ~280 TypeScript files, ~64,225 lines of code
- 89 API routes, 37 pages, 38 database tables
- A fully functional commercial real estate prospecting platform
- AI enrichment pipeline locked to Google Gemini only
- Data enrichment cascade using PDL, Crustdata, and EnrichLayer (paid APIs)
- Data ingestion pipeline dependent on Snowflake cloud data warehouse

---

## 3. New Systems Built (from scratch)

### 3.1 Multi-LLM Abstraction Layer

**Directory:** `src/lib/ai/llm/`
**Total lines:** 572 (7 files)

A provider-agnostic abstraction layer that enables the AI enrichment pipeline to use any of three LLM providers interchangeably. All pipeline stage calls go through `LLMProviderAdapter.call()` so prompts and JSON parsing remain provider-agnostic.

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 55 | Core interfaces: `LLMProvider`, `LLMResponse`, `LLMCallOptions`, `LLMProviderAdapter`, `LLMTokenUsage` |
| `gemini-adapter.ts` | 97 | Wraps existing Gemini/Vertex AI infrastructure; uses native Google Search grounding |
| `openai-adapter.ts` | 113 | Wraps OpenAI SDK (`gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`); uses SerpAPI for grounding |
| `claude-adapter.ts` | 147 | Wraps Anthropic SDK (`claude-sonnet-4`, `claude-opus-4`); supports extended thinking with configurable budget tokens; uses SerpAPI for grounding |
| `serp-grounding.ts` | 119 | Shared grounding module: runs SerpAPI queries, formats results as context block, extracts source references for prompt injection |
| `factory.ts` | 31 | `getLLMAdapter(provider?)` factory with singleton instances; reads from runtime config |
| `index.ts` | 10 | Barrel re-exports |

**Architecture highlights:**

- The `LLMTokenUsage` interface normalizes token counts, cost (USD), grounding cost, and grounding query counts across all providers
- The `GeminiAdapter` maps stage names to `StageKey` values for search grounding config lookup, preserving existing per-stage grounding configuration
- The `OpenAIAdapter` and `ClaudeAdapter` both use `runSerpGrounding()` to inject web search results into prompts before the LLM call, achieving parity with Gemini's native Google Search grounding
- The `ClaudeAdapter` maps the existing `ThinkingLevel` enum (`NONE`, `MINIMAL`, `LOW`, `MEDIUM`, `HIGH`) to Anthropic `budget_tokens` values (null, 1024, 4096, 8192, 16384)
- The `serp-grounding.ts` module extracts search-worthy phrases from prompts using regex patterns for `ADDRESS:`, `PROPERTY:`, `COMPANY:`, and quoted search terms, with up to 3 parallel SerpAPI queries per call
- All adapters integrate with the existing `rateLimiters` and `trackCostFireAndForget` systems

### 3.2 Cascade Enrichment V2 Pipeline

**File:** `src/lib/cascade-enrichment-v2.ts`
**Lines:** 420

A complete replacement for the V1 cascade enrichment pipeline that eliminates PDL, Crustdata, and EnrichLayer dependencies. The V2 pipeline uses SerpAPI web search + LLM extraction for person/company data and browser-use LinkedIn scraping for employment verification.

**Contact enrichment stages (5 stages):**

| Stage | V1 (Legacy) | V2 (New) |
|-------|-------------|----------|
| 1. Email Discovery | Findymail + Hunter | **Unchanged** -- Findymail + Hunter |
| 2. Person Match | PDL Person API ($0.10/call) | SerpAPI + LLM extraction (~$0.03/call) |
| 3. LinkedIn Discovery | SERP LinkedIn search | **Unchanged** -- SERP LinkedIn search |
| 4. Employment Verification | Crustdata Person API ($0.05/call) | browser-use LinkedIn scrape (~$0.05/call) |
| 5. Confidence Assignment | Same algorithm | Same algorithm with `search_matched` flag |

**Organization enrichment** (`enrichOrganizationCascadeV2`) uses `enrichCompanySerpAI` to replace PDL Company + Crustdata Company lookups. Returns the same `OrganizationEnrichmentResult` interface shape as V1 with legacy provider fields set to null.

The V2 pipeline maintains full backwards compatibility by returning the same `ContactEnrichmentResult` and `OrganizationEnrichmentResult` interfaces, allowing seamless A/B switching.

### 3.3 SerpAPI Web Search and Person/Company Enrichment

**Files:** 3 files, 437 lines total

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/serp.ts` | 123 | General-purpose SerpAPI web search client with Redis caching (6-hour TTL), rate limiting, and cost tracking |
| `src/lib/serp-person-enrichment.ts` | 157 | Replaces `enrichPersonPDL`: runs 2-3 targeted SerpAPI queries per person, passes results to LLM for structured JSON extraction of name, title, company, LinkedIn, email, phone, location, confidence score |
| `src/lib/serp-company-enrichment.ts` | 157 | Replaces `enrichCompanyPDL` + `enrichCompanyCrustdata`: SerpAPI queries for company firmographics, LLM extraction of name, domain, industry, employee count, founded year, LinkedIn, location |

**Architecture highlights:**

- `serp.ts` builds a normalized cache key from query + location, checks Redis before making API calls, and deduplicates results across parallel queries
- Person enrichment constructs targeted queries like `"John Smith" "Acme Corp" LinkedIn` and `"John Smith" site:acme.com` to maximize match quality
- Company enrichment queries include `"domain.com" company` and `"Company Name" official website` patterns
- Both modules use `getStageConfig()` to read the current LLM provider and model from runtime config, then call `getLLMAdapter()` to get the appropriate adapter
- LLM prompts are structured as JSON extraction templates with confidence scoring guidelines (0.9+ for LinkedIn match, 0.7-0.8 for strong match, etc.)

### 3.4 browser-use Integration

**Files:** 2 files, 397 lines total

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/browser-use.ts` | 279 | HTTP client for the browser-use Python microservice (FastAPI + browser-use); provides structured LinkedIn profile scraping, employment history extraction, company team page scraping, generic page scraping, and health checks |
| `src/lib/browser-employment-verification.ts` | 118 | Replaces Crustdata's employment verification; uses browser-use to scrape LinkedIn experience section, detects job changes by comparing current employer against expected employer using fuzzy company name matching |

**Key types defined:**

- `BrowserScrapeInput/Result` -- generic page scrape with LLM extraction prompt
- `LinkedInProfileData` -- structured profile with name, headline, location, current title/company, experiences array, education array
- `LinkedInExperience` -- title, company, location, start/end dates, isCurrent flag
- `EmploymentHistory` -- current employer/title, experiences, hasJobChange flag
- `EmploymentVerificationResult` -- verified flag, current employer/title, hasJobChange, previousEmployers, confidence score

**browser-employment-verification.ts** includes:

- `normalizeCompanyName()` -- strips suffixes (inc, llc, corp, properties, realty, etc.) for comparison
- `fuzzyCompanyMatch()` -- substring matching plus word overlap analysis (matches if >= 50% of significant words overlap)
- Domain-based matching as fallback: extracts base domain and checks against company name
- Confidence calculation: base 0.5, +0.2 for current employer found, +0.1 for 2+ experiences, +0.1 for no job change

### 3.5 A/B Experiment Routing

**File:** `src/lib/enrichment-experiments.ts`
**Lines:** 81

Deterministic hash-based routing between V1 (legacy) and V2 (new) cascade enrichment pipelines with configurable traffic percentage for gradual rollout.

**Capabilities:**

- `shouldUseNewPipeline(propertyKey)` -- deterministic hash routing; same property always gets same pipeline
- `shouldForceNewPipeline()` -- environment variable override (`ENRICHMENT_FORCE_V2=true`)
- `isComparisonModeEnabled()` -- side-by-side mode (`ENRICHMENT_COMPARISON_MODE=true`) where both V1 and V2 run and results are compared
- `getExperimentInfo(propertyKey)` -- returns full experiment metadata for logging (pipeline version, percentage, comparison mode, forced flag)
- Traffic percentage configurable via `ENRICHMENT_V2_PERCENTAGE` (0-100), defaulting to 0 for safe initial deployment

### 3.6 Enrichment Comparison Logging

**File:** `src/lib/enrichment-comparison.ts`
**Lines:** 134

Field-level diff engine for V1 vs V2 cascade enrichment results, used during the A/B transition period for quality analysis.

**Capabilities:**

- `compareContactResults()` -- compares 12 key contact fields: found, confidenceFlag, email, emailVerified, phone, title, company, companyDomain, linkedinUrl, location, seniority, employerLeftDetected
- `compareOrganizationResults()` -- compares 11 key org fields: found, name, industry, employeeCount, employeesRange, foundedYear, website, linkedinUrl, phone, city, state
- Produces `ComparisonResult` with per-field diffs and summary statistics (totalFields, matchingFields, diffingFields, matchRate)
- `normalizeForComparison()` -- case-insensitive, trimmed string comparison with null/undefined handling
- Console logging of all field-level differences with V1 vs V2 values

### 3.7 Multi-County CAD System

**Directory:** `src/lib/cad/`
**Total lines:** 1,491 (10 files)

A complete system for downloading, parsing, staging, and querying county appraisal district data for multiple Texas counties, replacing the previous Snowflake-dependent approach.

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 145 | Type definitions for all CAD data: `CountyCode`, `CadAccountInfoRow`, `CadAppraisalRow`, `CadBuildingRow`, `CadLandRow`, `CadParser` interface, `CountyConfig` with download URLs and file mappings |
| `index.ts` | 25 | Barrel exports + `createParser(countyCode)` factory |
| `download-manager.ts` | 95 | Downloads ZIP files from county websites, extracts them to temp directories, provides file finding and cleanup utilities |
| `query.ts` | 257 | SQL query builder using Drizzle ORM: `queryCommercialProperties()` with filtering (ZIP, county, lot/building sqft, building class, condition), `countCommercialProperties()`, `getAccountsByAccountNums()` |
| `staging.ts` | 230 | Batch insert/upsert operations: `stageAccountInfo()`, `stageAppraisalValues()`, `stageBuildings()`, `stageLand()`, `clearStagingData()` with 1,000-row batch sizes and progress logging |
| `county-codes.ts` | 85 | PTAD code classification, county name lookup, property type inclusion filtering |
| `parsers/dcad-parser.ts` | 185 | Dallas CAD CSV parser using `csv-parse` with streaming `AsyncIterable` interface |
| `parsers/tad-parser.ts` | 163 | Tarrant CAD pipe-delimited parser |
| `parsers/ccad-parser.ts` | 153 | Collin CAD CSV parser |
| `parsers/denton-parser.ts` | 153 | Denton CAD CSV parser |

**Supported counties:**

| County Code | District Name | File Format | Download Source |
|-------------|---------------|-------------|-----------------|
| `DCAD` | Dallas Central Appraisal District | CSV | dallascad.org |
| `TAD` | Tarrant Appraisal District | Pipe-delimited | tad.org |
| `CCAD` | Collin Central Appraisal District | CSV | collincad.org |
| `DENT` | Denton Central Appraisal District | CSV | dentoncad.com |

**Architecture highlights:**

- All parsers implement the `CadParser` interface with async generators (`AsyncIterable<T>`) for memory-efficient streaming of large files (DCAD files can be 500MB+)
- The `staging.ts` module uses Drizzle ORM's `onConflictDoUpdate` for upsert semantics on account info and appraisal values, preventing duplicates on re-import
- The `query.ts` module constructs multi-table JOINs (account_info + appraisal_values + buildings + land) with dynamic WHERE clauses for flexible filtering
- The `COUNTY_CONFIGS` object in `types.ts` maps each county to its download URL, file format, and expected file names, making new county additions a configuration-only change

### 3.8 Property Type Classification

**File:** `src/lib/property-types.ts`
**Lines:** 156

Extracted and consolidated property type interfaces that were previously embedded in `snowflake.ts`. Provides standalone type definitions used across the codebase:

- `DCADBuilding` -- individual building details from CAD COM_DETAIL
- `CommercialProperty` -- full property record with Regrid parcel data, DCAD core appraisal data, owner details, legal descriptions, land details, and building summary
- `RegridParcel` -- legacy interface for Regrid parcel data compatibility
- `AggregatedProperty` -- multi-parcel aggregation with computed lot/building sqft and source tracking

---

## 4. Major Refactors and Modifications

### 4.1 AI Pipeline Stages -- Adapted to LLM Abstraction

**Files modified:** `classify.ts`, `ownership.ts`, `contacts.ts`, `misc.ts`
**Combined diff:** ~502 lines changed

All four AI pipeline stages were refactored to use the new LLM abstraction layer instead of direct Gemini client calls.

**Pattern applied consistently across all stages:**

Before (Gemini-locked):
```typescript
const client = getGeminiClient();
const response = await withTimeout(
  callGeminiWithTimeout(
    () => streamGeminiResponse(client, prompt, {
      tools: getSearchGroundingTools('stage1_classify'),
      temperature: ...,
      thinkingLevel: ...,
    }),
    2
  ),
  STAGE_TIMEOUTS.STAGE_1_CLASSIFY,
  'stage1-classify'
);
```

After (provider-agnostic):
```typescript
const stageConfig = getStageConfig('stage1_classify');
const adapter = getLLMAdapter(stageConfig.provider);
const response = await adapter.call(prompt, {
  model: STAGE_MODELS.STAGE_1_CLASSIFY,
  temperature: ...,
  thinkingLevel: ...,
  timeoutMs: STAGE_TIMEOUTS.STAGE_1_CLASSIFY,
  stageName: 'stage1-classify',
  searchGrounding: stageConfig.searchGrounding,
  latLng: propertyLatLng(property),
});
```

**Additional changes per stage:**

- **classify.ts** (89 lines changed): Replaced `CommercialProperty` import from `snowflake` to `property-types`; updated token usage mapping from Gemini-specific format (`promptTokens`, `responseTokens`) to normalized format (`inputTokens`, `outputTokens`); updated grounding source extraction to use `response.groundingSources` instead of `extractGroundedSources(response)`
- **ownership.ts** (150 lines changed): Same pattern plus refactored `retryFindPropertyWebsite()` and `retryFindCompanyDomain()` helper functions to use the adapter pattern; all three functions in the file now read from `getStageConfig('domain_retry')` for retry calls
- **contacts.ts** (89 lines changed): Same pattern; updated grounding quality access with optional chaining (`groundingQuality?.hasGrounding`, `groundingQuality?.avgConfidence ?? 0`) for null safety when non-Gemini providers return different raw response shapes
- **misc.ts** (84 lines changed): Refactored `cleanupAISummary()` and `searchForReplacementContact()` to use the adapter pattern

### 4.2 Enrichment Queue -- Integrated V2 Pipeline Routing

**File:** `src/lib/enrichment-queue.ts`
**Diff:** 260 lines changed (additions + removals)

Major refactoring of the enrichment queue to support V2 pipeline routing and atomic database operations.

**Key changes:**

1. **V2 pipeline integration**: Imported `enrichContactCascadeV2`, `enrichOrganizationCascadeV2`, experiment routing functions, and comparison functions. Both organization and contact enrichment paths now check `shouldUseNewPipeline(routingKey)` and route accordingly.

2. **Side-by-side comparison mode**: When `isComparisonModeEnabled()` returns true and V2 is active, the queue also runs V1 and calls `compareOrganizationResults()` / `compareContactResults()` for quality analysis.

3. **Atomic transaction wrapping**: Moved all database writes (property update, org junction inserts, contact creation/updates, property-contact junction inserts, contact-organization junction inserts) into a single `db.transaction()` call. Previously, these were separate operations that could leave partial state on failure.

4. **Pre-resolved external lookups**: Organization resolution (which may call PDL APIs) and contact deduplication lookups (which use Redis locks) are now performed _before_ the transaction to avoid holding the database transaction open during external network calls.

5. **Snowflake removal**: Removed the fallback path that fetched properties from Snowflake when not found in PostgreSQL. All properties are now expected to be in local staging tables.

### 4.3 EnrichLayer -- Refactored

**File:** `src/lib/enrichlayer.ts`
**Diff:** 1,190 lines changed

Substantial refactoring of the EnrichLayer integration module:

- **Replaced manual circuit breaker** (35 lines of hand-rolled state management) with the existing `ServiceRateLimiter` class, reducing code by ~40 lines while gaining proper rate limiting (20/min, 5 concurrent)
- **Replaced manual rate limiter** (25 lines of timestamp-based sliding window) with `ServiceRateLimiter.execute()` wrapping
- **Fixed timeout handling**: Replaced `createTimeoutSignal()` (which leaked timers) with `createTimeoutController()` that returns a cleanup function
- **Removed duplicated `parseFullName()`**: Now imports from `./utils` instead of having a local copy
- **Added cost tracking**: All API calls now call `trackCostFireAndForget()` with provider, endpoint, entity type, and status code

### 4.4 DCAD Ingestion -- Simplified

**File:** `src/lib/dcad-ingestion.ts`
**Diff:** 648 lines changed

Replaced all Snowflake SQL queries with calls to the new CAD query module:

- **Removed** ~260 lines of raw Snowflake SQL string construction (SELECT statements with multi-table JOINs, filter clause builders, table name constants)
- **Removed** `buildFilterClauses()` function that built SQL WHERE clauses from filter parameters
- **Replaced** `getCommercialPropertiesByZip()`, `countCommercialPropertiesByZip()`, `countAllCommercialProperties()`, `getAllCommercialProperties()`, `getPropertiesByAccountNums()`, and `describeTable()` with one-line delegations to `queryCommercialProperties()` and `countCommercialProperties()` from `./cad/query`
- **Added** optional `countyCode` parameter to all public functions for multi-county support
- **Removed** Snowflake table name constants (`COMMERCIAL_PROPERTIES_TABLE`, `ACCOUNT_APPRL_TABLE`, etc.)

### 4.5 Deduplication -- Improved

**File:** `src/lib/deduplication.ts`
**Diff:** 403 lines changed

Significant performance and correctness improvements to the deduplication system:

- **Renamed** `normalizeDomain()` to `normalizeDomainForDedup()` to disambiguate from the `normalization.ts` version; added `www.` prefix stripping for more aggressive matching
- **Replaced in-memory duplicate detection with SQL GROUP BY**: `findDuplicateOrganizations()` now uses `SELECT ... GROUP BY ... HAVING COUNT(*) > 1` instead of loading all orgs into a JavaScript `Map`, reducing memory usage from O(n) to O(duplicates)
- **Same optimization for contacts**: `findDuplicateContacts()` uses SQL `GROUP BY LOWER(TRIM(normalized_email))` for email duplicates instead of loading all contacts
- **Targeted LinkedIn loading**: LinkedIn duplicate detection now only loads contacts that have at least one LinkedIn URL field populated, instead of loading all contacts
- **Name+domain pass optimized**: SQL GROUP BY on `normalized_name` with HAVING clause, then only loads matched groups

### 4.6 Auth System -- Updated

**File:** `src/lib/auth.ts`
**Diff:** 76 lines changed

Reduced code duplication and added efficiency improvements:

- **Extracted `mapToUser()` helper**: Consolidated 4 identical inline object constructions (mapping DB user rows to the `User` interface) into a single `mapToUser(dbUser)` function, eliminating ~40 lines of duplicated code
- **Added skip-write optimization**: `updateExistingUser()` now compares current DB values against incoming Clerk data and skips the database UPDATE if nothing has changed, reducing unnecessary write operations on every page load

### 4.7 Schema Updates -- New Tables and Columns

**File:** `src/lib/schema.ts`
**Diff:** 122 lines added

Added 5 new database tables for the CAD staging system and expanded provider configuration:

| Table | Columns | Purpose |
|-------|---------|---------|
| `cad_downloads` | 9 | Tracks CAD file download jobs with status, row counts, error messages, and timestamps |
| `cad_account_info` | 22 | Property account details with unique index on (county_code, account_num, appraisal_year) |
| `cad_appraisal_values` | 12 | Assessment values with unique index and PTAD code index for commercial property filtering |
| `cad_buildings` | 20 | Building details with account index |
| `cad_land` | 12 | Land parcel details with compound account index |

**Provider additions to `ENRICHMENT_PROVIDERS`:**

| Added | Label |
|-------|-------|
| `'openai'` | OpenAI |
| `'claude'` | Anthropic Claude |
| `'serpapi'` | SerpAPI Web |
| `'browser_use'` | Browser Use |

### 4.8 Snowflake Removal

**File deleted:** `src/lib/snowflake.ts`
**Lines removed:** 708

The entire Snowflake client module was removed, including:

- Snowflake SDK connection management with private key authentication
- The `executeQuery<T>()` function for running SQL against Snowflake
- The `getPropertyByKey()` function for fetching individual properties
- The `CommercialProperty`, `DCADBuilding`, `RegridParcel`, and `AggregatedProperty` type definitions (relocated to `property-types.ts`)
- The `mapRowToProperty()` function for converting Snowflake result rows
- Connection pooling and error handling logic

All Snowflake functionality was replaced by the local PostgreSQL CAD staging tables (`src/lib/cad/`) and the `property-types.ts` module.

---

## 5. Infrastructure and Configuration

### 5.1 New npm Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.78.0 | Anthropic Claude API client for the Claude adapter |
| `csv-parse` | ^6.1.0 | CSV parsing for CAD data file ingestion |
| `@types/adm-zip` | ^0.5.7 (dev) | TypeScript types for ZIP file handling |

### 5.2 Drizzle Migration

**File:** `drizzle/0000_greedy_iceman.sql` (871 lines)
**Generated snapshot:** `drizzle/meta/0000_snapshot.json` (6,479 lines)

Full Drizzle schema migration generated covering all 38+ tables, including the 5 new CAD staging tables. The migration includes CREATE TABLE statements, indexes, unique constraints, and foreign key relationships.

### 5.3 Pricing Configuration

**File:** `src/lib/pricing-config.ts` (+58 lines)

Added token-level pricing for new providers:

| Provider | Model | Input (per 1M tokens) | Output (per 1M tokens) |
|----------|-------|-----------------------|------------------------|
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| OpenAI | o1 | $15.00 | $60.00 |
| OpenAI | o3-mini | $1.10 | $4.40 |
| Claude | claude-opus-4 | $15.00 | $75.00 |
| Claude | claude-sonnet-4 | $3.00 | $15.00 |
| browser-use | (per scrape) | $0.05 flat | -- |
| SerpAPI | (per search) | $0.01 flat | -- |

Includes `computeOpenAICostUsd()` and `computeClaudeCostUsd()` functions for per-call cost calculation.

### 5.4 Rate Limiter Additions

**File:** `src/lib/rate-limiter.ts` (+4 new rate limiters)

| Limiter | Max/Min | Concurrent | Circuit Breaker |
|---------|---------|------------|-----------------|
| `openai` | 500/min | 20 | 5 failures, 30s reset |
| `claude` | 200/min | 10 | 5 failures, 30s reset |
| `serpApi` | 100/min | 10 | 5 failures, 30s reset |
| `browserUse` | 10/min | 3 | 3 failures, 60s reset |

### 5.5 Scripts

| Script | Lines | Purpose |
|--------|-------|---------|
| `scripts/download-and-ingest-dcad.ts` | 141 | End-to-end pipeline: downloads DCAD ZIP, parses CSV files, stages to PostgreSQL, runs ingestion. Supports `--zip`, `--limit`, and `--skip-download` flags |
| `scripts/verify-snowflake-coverage.ts` | 335 | Verification tool: compares Snowflake Regrid parcels against local properties table, reports coverage by property key, ll_uuid, and ZIP code breakdown with field-level spot checks |
| `scripts/list-snowflake-dbs.ts` | 49 | Utility to enumerate available Snowflake databases |

### 5.6 Other Modified Files

| File | Change | Lines |
|------|--------|-------|
| `.gitignore` | Added entries for local data files | +3 |
| `src/lib/ai/config.ts` | Added provider-awareness to grounding config | +2 |
| `src/lib/ai/helpers.ts` | Updated import path | +1/-1 |
| `src/lib/ai/index.ts` | Added LLM module re-exports | +4 |
| `src/lib/ai/pipeline.ts` | Updated import path | +1/-1 |
| `src/lib/ai/runtime-config.ts` | Added `provider` field to `StageConfig`, expanded model lists | +21/-some |
| `src/lib/cascade-enrichment.ts` | Minor interface updates for V2 compatibility | +23/-some |
| `src/lib/hunter.ts` | Removed unused code | -17 |
| `src/lib/pdl.ts` | Minor adjustments | +/-28 |
| `src/lib/redis.ts` | Updated cache helpers | +11/-some |
| `src/lib/serp-linkedin.ts` | Added exports for V2 pipeline | +9 |
| `src/lib/utils.ts` | Added `parseFullName()` and `getEmployeeRange()` utilities | +19 |
| `src/proxy.ts` | Minor fix | +3/-some |
| `src/app/admin/page.tsx` | Added CAD download UI section | +140 |
| `src/app/api/admin/cad-download/route.ts` | New API route for CAD downloads | 178 (new) |
| `src/app/api/admin/enrich-batch/route.ts` | Updated for V2 pipeline routing | +9/-some |
| `src/app/api/admin/ingest/route.ts` | Updated for multi-county ingestion | +61/-some |
| `src/app/api/enrich/route.ts` | Updated for V2 pipeline routing | +14/-some |
| `scripts/run-ai-enrichment.ts` | Updated import path | +1/-1 |
| `scripts/test-ai-enrichment.ts` | Updated for multi-provider testing | +146/-some |
| `scripts/test-prompts-mock.ts` | Updated import path | +1/-1 |
| `scripts/test-snowflake-access.ts` | Deleted (180 lines) | -180 |
| `package-lock.json` | Updated dependency tree | +/-1,766 |

---

## 6. Technical Design Document

**File:** `docs/enrichment-refactor-plan.md`
**Lines:** 312

A comprehensive 6-phase plan for the enrichment system refactor, authored as part of this work session. The document covers:

### Phase 1: LLM Abstraction Layer (Completed)
- Provider-agnostic interfaces and adapter pattern
- Gemini, OpenAI, Claude adapter implementations
- SerpAPI grounding module for non-Gemini providers
- Runtime config extension with per-stage `provider` field

### Phase 2: SerpAPI Web Search Module (Completed)
- General-purpose `serpWebSearch()` function
- Rate limiting and cost tracking configuration

### Phase 3: browser-use Python Microservice (Completed -- TypeScript client)
- FastAPI service specification (4 endpoints)
- TypeScript HTTP client implementation
- Rate limiting configuration (10/min, 3 concurrent)

### Phase 4: New Cascade Enrichment (Completed)
- Contact enrichment pipeline V2 design
- Provider replacement mapping table
- Domain validation without PDL
- Confidence scoring without Crustdata

### Phase 5: Data Model and A/B Infrastructure (Completed)
- Schema migration for CAD staging tables
- A/B routing with deterministic hashing
- Comparison logging for quality analysis
- Cost tracking updates for new providers

### Phase 6: Comparison, Tuning, Cutover (Ready for execution)
- Parallel pipeline execution strategy
- Quality metrics (email accuracy, LinkedIn match rate, firmographics completeness)
- Gradual traffic increase plan: 10% -> 25% -> 50% -> 100%
- Deprecation plan for PDL/Crustdata/EnrichLayer

**Implementation status:** Phases 1-5 are code-complete. Phase 6 (A/B testing and cutover) is infrastructure-ready, awaiting production deployment and data collection.

---

## 7. Files Changed Summary

### New Files Created (34 files)

| # | File | Lines | Category |
|---|------|-------|----------|
| 1 | `src/lib/ai/llm/types.ts` | 55 | LLM Abstraction |
| 2 | `src/lib/ai/llm/gemini-adapter.ts` | 97 | LLM Abstraction |
| 3 | `src/lib/ai/llm/openai-adapter.ts` | 113 | LLM Abstraction |
| 4 | `src/lib/ai/llm/claude-adapter.ts` | 147 | LLM Abstraction |
| 5 | `src/lib/ai/llm/serp-grounding.ts` | 119 | LLM Abstraction |
| 6 | `src/lib/ai/llm/factory.ts` | 31 | LLM Abstraction |
| 7 | `src/lib/ai/llm/index.ts` | 10 | LLM Abstraction |
| 8 | `src/lib/cascade-enrichment-v2.ts` | 420 | Cascade V2 |
| 9 | `src/lib/serp-person-enrichment.ts` | 157 | Enrichment |
| 10 | `src/lib/serp-company-enrichment.ts` | 157 | Enrichment |
| 11 | `src/lib/browser-use.ts` | 279 | Browser Scraping |
| 12 | `src/lib/browser-employment-verification.ts` | 118 | Browser Scraping |
| 13 | `src/lib/enrichment-experiments.ts` | 81 | A/B Testing |
| 14 | `src/lib/enrichment-comparison.ts` | 134 | A/B Testing |
| 15 | `src/lib/serp.ts` | 123 | Web Search |
| 16 | `src/lib/cad/types.ts` | 145 | CAD System |
| 17 | `src/lib/cad/index.ts` | 25 | CAD System |
| 18 | `src/lib/cad/download-manager.ts` | 95 | CAD System |
| 19 | `src/lib/cad/query.ts` | 257 | CAD System |
| 20 | `src/lib/cad/staging.ts` | 230 | CAD System |
| 21 | `src/lib/cad/parsers/dcad-parser.ts` | 185 | CAD System |
| 22 | `src/lib/cad/parsers/tad-parser.ts` | 163 | CAD System |
| 23 | `src/lib/cad/parsers/ccad-parser.ts` | 153 | CAD System |
| 24 | `src/lib/cad/parsers/denton-parser.ts` | 153 | CAD System |
| 25 | `src/lib/cad/county-codes.ts` | 85 | CAD System |
| 26 | `src/lib/property-types.ts` | 156 | Types |
| 27 | `docs/enrichment-refactor-plan.md` | 312 | Documentation |
| 28 | `scripts/download-and-ingest-dcad.ts` | 141 | Scripts |
| 29 | `scripts/verify-snowflake-coverage.ts` | 335 | Scripts |
| 30 | `scripts/list-snowflake-dbs.ts` | 49 | Scripts |
| 31 | `src/app/api/admin/cad-download/route.ts` | 178 | API Route |
| 32 | `drizzle/0000_greedy_iceman.sql` | 871 | Migration |
| 33 | `drizzle/meta/0000_snapshot.json` | 6,479 | Migration |
| 34 | `drizzle/meta/_journal.json` | 13 | Migration |

### Existing Files Modified (35 files)

| # | File | Lines Changed | Summary |
|---|------|---------------|---------|
| 1 | `src/lib/ai/stages/classify.ts` | +/-89 | LLM adapter pattern |
| 2 | `src/lib/ai/stages/ownership.ts` | +/-150 | LLM adapter pattern |
| 3 | `src/lib/ai/stages/contacts.ts` | +/-89 | LLM adapter pattern |
| 4 | `src/lib/ai/stages/misc.ts` | +/-84 | LLM adapter pattern |
| 5 | `src/lib/enrichment-queue.ts` | +/-260 | V2 routing, atomic transactions |
| 6 | `src/lib/enrichlayer.ts` | +/-1,190 | Rate limiter refactor |
| 7 | `src/lib/dcad-ingestion.ts` | +/-648 | Replaced Snowflake queries |
| 8 | `src/lib/deduplication.ts` | +/-403 | SQL GROUP BY optimization |
| 9 | `src/lib/auth.ts` | +/-76 | mapToUser() extraction, skip-write |
| 10 | `src/lib/schema.ts` | +122 | 5 CAD tables, provider additions |
| 11 | `src/lib/pricing-config.ts` | +58 | OpenAI/Claude/browser-use pricing |
| 12 | `src/lib/rate-limiter.ts` | +4 | 4 new rate limiters |
| 13 | `src/lib/cascade-enrichment.ts` | +/-23 | V2 compatibility |
| 14 | `src/lib/ai/runtime-config.ts` | +/-21 | Provider field, model lists |
| 15 | `src/lib/ai/config.ts` | +2 | Provider awareness |
| 16 | `src/lib/ai/helpers.ts` | +/-2 | Import path update |
| 17 | `src/lib/ai/index.ts` | +4 | LLM re-exports |
| 18 | `src/lib/ai/pipeline.ts` | +/-2 | Import path update |
| 19 | `src/lib/pdl.ts` | +/-28 | Minor adjustments |
| 20 | `src/lib/hunter.ts` | -17 | Removed unused code |
| 21 | `src/lib/redis.ts` | +/-11 | Cache helper updates |
| 22 | `src/lib/serp-linkedin.ts` | +9 | V2 pipeline exports |
| 23 | `src/lib/utils.ts` | +19 | Added utilities |
| 24 | `src/proxy.ts` | +/-3 | Minor fix |
| 25 | `src/app/admin/page.tsx` | +140 | CAD download UI |
| 26 | `src/app/api/admin/enrich-batch/route.ts` | +/-9 | V2 routing |
| 27 | `src/app/api/admin/ingest/route.ts` | +/-61 | Multi-county |
| 28 | `src/app/api/enrich/route.ts` | +/-14 | V2 routing |
| 29 | `package.json` | +5/-1 | New dependencies |
| 30 | `package-lock.json` | +/-1,766 | Dependency tree |
| 31 | `.gitignore` | +3 | New entries |
| 32 | `scripts/run-ai-enrichment.ts` | +/-2 | Import path |
| 33 | `scripts/test-ai-enrichment.ts` | +/-146 | Multi-provider testing |
| 34 | `scripts/test-prompts-mock.ts` | +/-2 | Import path |
| 35 | `scripts/test-snowflake-access.ts` | -180 | Deleted |

### Files Deleted (1 file)

| # | File | Lines Removed |
|---|------|---------------|
| 1 | `src/lib/snowflake.ts` | 708 |

---

## 8. Impact Assessment

### Capabilities Added

| Capability | Before | After |
|------------|--------|-------|
| **LLM provider choice** | Gemini only | Gemini, OpenAI (GPT-4o, o1, o3-mini), Claude (Sonnet 4, Opus 4) -- switchable per pipeline stage |
| **Search grounding for non-Gemini** | Not available | SerpAPI web search results injected into prompts for OpenAI and Claude |
| **Person enrichment without PDL** | Required PDL API ($0.10/call) | SerpAPI + LLM extraction (~$0.03/call) |
| **Company enrichment without PDL** | Required PDL Company API | SerpAPI + LLM extraction |
| **Employment verification without Crustdata** | Required Crustdata API ($0.05/call) | browser-use LinkedIn scraping (~$0.05/call) |
| **A/B pipeline testing** | Not possible | Deterministic hash-based routing with configurable traffic percentage |
| **Side-by-side comparison** | Not possible | Field-level diff logging between V1 and V2 results |
| **Multi-county CAD data** | Dallas only (via Snowflake) | Dallas, Tarrant, Collin, Denton (via local PostgreSQL) |
| **Data source independence** | Required Snowflake cloud DW | Self-contained PostgreSQL staging tables |
| **Atomic enrichment saves** | Non-transactional (partial state possible) | Single transaction wrapping all DB writes |
| **EnrichLayer resilience** | Manual circuit breaker, manual rate limiter | ServiceRateLimiter with proper circuit breaking |
| **Deduplication performance** | Load-all-into-memory approach | SQL GROUP BY for O(duplicates) memory usage |
| **Auth efficiency** | DB write on every page load | Skip-write when nothing changed |

### Dependencies Removed

| Dependency | Status | Impact |
|------------|--------|--------|
| **Snowflake cloud data warehouse** | Replaced with local PostgreSQL | Eliminates Snowflake compute costs and network latency for data queries |
| **PDL Person API** (in V2 path) | Replaced with SerpAPI + LLM | Reduces per-contact enrichment cost from ~$0.10 to ~$0.03 |
| **Crustdata Person API** (in V2 path) | Replaced with browser-use | Equivalent cost but removes API dependency |
| **EnrichLayer** (in V2 path) | Replaced with SerpAPI + LLM | Reduces cost and eliminates vendor lock-in |

### Cost Impact Estimate (at Scale)

| Operation | V1 Cost (per 1,000) | V2 Cost (per 1,000) | Savings |
|-----------|---------------------|---------------------|---------|
| Contact enrichment | ~$150 (PDL + Crustdata + EnrichLayer) | ~$80 (SerpAPI + LLM + browser-use) | ~47% |
| Organization enrichment | ~$100 (PDL Company + Crustdata) | ~$30 (SerpAPI + LLM) | ~70% |
| Data warehouse queries | Snowflake compute charges | $0 (local PostgreSQL) | 100% |

### What the Codebase Can Do Now That It Could Not Before

1. **Switch LLM providers per pipeline stage** -- Run classification on Gemini, ownership on Claude, and contacts on GPT-4o, all configurable at runtime without code changes
2. **Enrich contacts without PDL/Crustdata** -- The V2 pipeline provides a fully functional alternative cascade using web search and browser scraping
3. **Safely A/B test enrichment approaches** -- The experiment system allows gradual rollout with deterministic routing and quality comparison
4. **Ingest property data from 4 Texas counties** -- The CAD system downloads, parses, and stages data from Dallas, Tarrant, Collin, and Denton counties
5. **Operate without Snowflake** -- All data queries run against local PostgreSQL, eliminating the cloud data warehouse dependency
6. **Guarantee atomic enrichment saves** -- Property, contact, and organization records are saved in a single transaction, preventing data inconsistencies

---

*Report authored by Remy Ochei. Work performed March 5-6, 2026.*
*Baseline: commit f0e44c7 (1,334 prior commits). Final: commit 7fc1012.*
*Repository: Greenfinchai-v0, Branch: main.*
