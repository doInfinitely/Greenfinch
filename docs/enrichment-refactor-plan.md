# Enrichment System Refactor: Multi-LLM + SerpAPI + browser-use

## Context

The current enrichment pipeline is tightly coupled to **Gemini** (with built-in search grounding) for AI stages and relies on **PDL**, **Crustdata**, and **EnrichLayer** for post-pipeline cascade enrichment. We want to:

1. Support **OpenAI and Claude** alongside Gemini as swappable LLM providers
2. Use **SerpAPI** for web grounding when using non-Gemini LLMs
3. Use **browser-use** (Python microservice) for deep web scraping (LinkedIn profiles, company pages)
4. **Eliminate** PDL, Crustdata, and EnrichLayer dependencies
5. **Keep** Hunter and Findymail for email discovery/verification
6. **Phased rollout** with A/B comparison before cutover

---

## Phase 1: LLM Abstraction Layer

### 1.1 Create provider-agnostic interfaces

**New file: `src/lib/ai/llm/types.ts`**

```typescript
export type LLMProvider = 'gemini' | 'openai' | 'claude';

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  costUsd: number;
  groundingCostUsd: number;
  groundingQueriesUsed: number;
}

export interface LLMResponse {
  text: string;
  tokenUsage: LLMTokenUsage;
  groundingSources: GroundedSource[];
  finishReason?: string;
  raw?: any;
}

export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number;
  timeoutMs?: number;
  stageName: string;
  searchGrounding?: boolean;
  searchQueries?: string[];      // Explicit queries for SerpAPI grounding
  latLng?: { latitude: number; longitude: number };
}

export interface LLMProviderAdapter {
  readonly provider: LLMProvider;
  call(prompt: string, options: LLMCallOptions): Promise<LLMResponse>;
}
```

### 1.2 Create provider adapters

| File | Wraps | Grounding Strategy |
|------|-------|--------------------|
| `src/lib/ai/llm/gemini-adapter.ts` | Existing `client.ts` | Native `{ googleSearch: {} }` tool |
| `src/lib/ai/llm/openai-adapter.ts` | OpenAI SDK | SerpAPI results injected into prompt context |
| `src/lib/ai/llm/claude-adapter.ts` | Anthropic SDK | SerpAPI results injected into prompt context |
| `src/lib/ai/llm/serp-grounding.ts` | SerpAPI | Shared module — runs search queries, formats results as context block |
| `src/lib/ai/llm/factory.ts` | — | `getLLMAdapter(provider?)` factory, reads from runtime config |

### 1.3 Extend runtime config

**Modify: `src/lib/ai/runtime-config.ts`**

- Add `provider: LLMProvider` field to `StageConfig` (default: `'gemini'`)
- Expand `AVAILABLE_MODELS` into `AVAILABLE_MODELS_BY_PROVIDER`:
  - gemini: current list
  - openai: `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`
  - claude: `claude-opus-4`, `claude-sonnet-4`

### 1.4 Refactor stage calls

**Modify:** `src/lib/ai/stages/classify.ts`, `ownership.ts`, `contacts.ts`

Replace `streamGeminiResponse(client, prompt, options)` calls with `getLLMAdapter(config.provider).call(prompt, options)`. Prompt text and JSON parsing remain unchanged (they're provider-agnostic).

### 1.5 Files touched

| File | Action |
|------|--------|
| `src/lib/ai/llm/types.ts` | **Create** |
| `src/lib/ai/llm/gemini-adapter.ts` | **Create** — wraps `client.ts` |
| `src/lib/ai/llm/openai-adapter.ts` | **Create** |
| `src/lib/ai/llm/claude-adapter.ts` | **Create** |
| `src/lib/ai/llm/serp-grounding.ts` | **Create** |
| `src/lib/ai/llm/factory.ts` | **Create** |
| `src/lib/ai/runtime-config.ts` | **Modify** — add `provider` field |
| `src/lib/ai/config.ts` | **Modify** — `getSearchGroundingTools` becomes provider-aware |
| `src/lib/ai/stages/classify.ts` | **Modify** — use adapter |
| `src/lib/ai/stages/ownership.ts` | **Modify** — use adapter |
| `src/lib/ai/stages/contacts.ts` | **Modify** — use adapter |
| `src/lib/ai/client.ts` | **Keep** — used internally by gemini-adapter |
| `src/lib/pricing-config.ts` | **Modify** — add OpenAI/Claude token pricing |
| `src/lib/rate-limiter.ts` | **Modify** — add `openai`, `claude`, `serpApi` rate limiters |

---

## Phase 2: SerpAPI Web Search Module

### 2.1 Expand SerpAPI usage

**New file: `src/lib/serp.ts`** — general-purpose SerpAPI web search (not just LinkedIn)

```typescript
export async function serpWebSearch(options: {
  query: string;
  numResults?: number;
  location?: string;
  latLng?: { latitude: number; longitude: number };
}): Promise<SerpWebResult[]>;
```

**Keep: `src/lib/serp-linkedin.ts`** — re-export existing LinkedIn search, unchanged.

The `serp-grounding.ts` module (Phase 1) uses `serpWebSearch` to run queries and format results for LLM context injection.

### 2.2 Rate limiting + cost tracking

- Add `serpApi` rate limiter to `src/lib/rate-limiter.ts` (100/min, 10 concurrent)
- Add `'serpapi'` to provider pricing (~$0.01/search)

---

## Phase 3: browser-use Python Microservice

### 3.1 Microservice (separate repo/directory)

Python FastAPI service using browser-use library. Key endpoints:

```
POST /api/scrape          — Generic page scrape with LLM extraction
POST /api/linkedin/profile — LinkedIn profile data extraction
POST /api/company/team     — Company team page scrape
GET  /health               — Health check
```

### 3.2 TypeScript client

**New file: `src/lib/browser-use.ts`**

```typescript
export async function browserScrape(input: BrowserScrapeInput): Promise<BrowserScrapeResult>;
export async function browserExtractLinkedInProfile(url: string): Promise<LinkedInProfileData>;
export async function browserExtractEmploymentHistory(linkedinUrl: string): Promise<EmploymentHistory>;
export async function browserExtractTeamPage(domain: string): Promise<{ people: PersonFromPage[] }>;
```

### 3.3 Rate limiting

Add `browserUse` rate limiter: 10/min, 3 concurrent (browser instances are expensive).

---

## Phase 4: New Cascade Enrichment (Replaces PDL/Crustdata/EnrichLayer)

### 4.1 New contact enrichment pipeline

Current flow → New flow:

| Step | Current (Legacy) | New |
|------|-----------------|-----|
| 1. Email discovery | Findymail + Hunter | **Keep** Findymail + Hunter |
| 2. LinkedIn discovery | Findymail reverse-email + SERP LinkedIn | **Keep** + expand SERP queries |
| 3. Person enrichment | **PDL Person** | SerpAPI + LLM structured extraction |
| 4. Employment verification | **Crustdata Person** | browser-use LinkedIn profile scrape |
| 5. Profile picture | **EnrichLayer** | browser-use LinkedIn profile |
| 6. Work email lookup | **EnrichLayer** | Hunter + Findymail (already kept) |
| 7. Company enrichment | **PDL Company** → Crustdata fallback | SerpAPI + LLM → browser-use company page |

### 4.2 New provider modules

**New file: `src/lib/serp-person-enrichment.ts`**

Replaces `enrichPersonPDL`. Runs 2-3 SerpAPI queries, passes results to LLM for structured extraction → returns name, title, company, domain, LinkedIn, email, phone, location, confidence.

**New file: `src/lib/serp-company-enrichment.ts`**

Replaces `enrichCompanyPDL` + `enrichCompanyCrustdata`. SerpAPI queries for company firmographics, LLM extraction.

**New file: `src/lib/browser-employment-verification.ts`**

Replaces Crustdata's employment history verification. Uses browser-use to scrape LinkedIn experience section → detects job changes.

### 4.3 Domain validation without PDL

Stage 2 (ownership) currently calls `enrichCompanyPDL` for domain validation. Replace with:
1. SerpAPI search: `"company name" official website`
2. DNS validation (already exists in `domain-validator.ts`)
3. LLM verification via the provider adapter

### 4.4 Confidence scoring without Crustdata

| Signal | New Source |
|--------|-----------|
| Current employer verification | browser-use LinkedIn scrape |
| Employment history | browser-use LinkedIn experience section |
| Job change detection | Compare scraped current employer vs expected |
| Domain match confirmation | SerpAPI + DNS validation |

Confidence flags remain the same (`verified`, `search_matched` replacing `pdl_matched`, `unverified`, etc.).

### 4.5 Updated cascade function

**New file: `src/lib/cascade-enrichment-v2.ts`**

Contains `enrichContactCascadeV2` and `enrichOrganizationCascadeV2` with the new pipeline. Returns the same `ContactEnrichmentResult` interface shape, with provider-specific fields set to null for deprecated providers.

### 4.6 Files touched

| File | Action |
|------|--------|
| `src/lib/serp-person-enrichment.ts` | **Create** |
| `src/lib/serp-company-enrichment.ts` | **Create** |
| `src/lib/browser-employment-verification.ts` | **Create** |
| `src/lib/browser-use.ts` | **Create** |
| `src/lib/cascade-enrichment-v2.ts` | **Create** |
| `src/lib/ai/stages/ownership.ts` | **Modify** — replace PDL domain validation |
| `src/lib/organization-enrichment.ts` | **Modify** — add V2 path |
| `src/lib/pdl.ts` | **Keep** during transition |
| `src/lib/crustdata.ts` | **Keep** during transition |
| `src/lib/enrichlayer.ts` | **Keep** during transition |

---

## Phase 5: Data Model + A/B Infrastructure

### 5.1 Schema migration

**New migration: `drizzle/XXXX_enrichment_refactor.sql`**

Add generic enrichment columns alongside existing provider-specific ones:
- `contacts.enrichment_experiences` (jsonb) — replaces crustdata experience fields
- `contacts.enrichment_providers_used` (json) — tracks which providers contributed
- `contacts.enrichment_raw_data` (jsonb) — single raw data column
- `organizations.enrichment_raw_data` (jsonb)

Existing `pdl_*` and `crustdata_*` columns remain (not dropped — data retention). During transition, writes go to both old and new columns.

### 5.2 A/B routing

**New file: `src/lib/enrichment-experiments.ts`**

```typescript
export function shouldUseNewPipeline(propertyKey: string): boolean;
// Deterministic hash-based routing, configurable traffic percentage
```

**Modify: `src/lib/enrichment-queue.ts`**

Route to V1 or V2 cascade based on experiment config. Optionally run both for side-by-side comparison.

### 5.3 Comparison logging

**New file: `src/lib/enrichment-comparison.ts`**

Log field-level diffs between legacy and new pipeline results for quality analysis.

### 5.4 Cost tracking updates

**Modify: `src/lib/pricing-config.ts`**

Add pricing for: `openai` (token-based), `claude` (token-based), `browser_use` (~$0.05/scrape), `serpapi` (~$0.01/search).

**Modify: `src/lib/schema.ts`**

Add `'openai' | 'claude' | 'browser_use' | 'serpapi'` to `ENRICHMENT_PROVIDERS`.

---

## Phase 6: Comparison, Tuning, Cutover

1. Run both pipelines in parallel on a test batch
2. Compare: email accuracy, LinkedIn match rate, company firmographics completeness
3. Tune SerpAPI query strategies and LLM extraction prompts
4. Gradually increase new pipeline traffic: 10% → 25% → 50% → 100%
5. After cutover, deprecate PDL/Crustdata/EnrichLayer imports

---

## Implementation Order

| Phase | Work | Dependencies |
|-------|------|-------------|
| **1** | LLM abstraction + Gemini adapter | None |
| **2** | SerpAPI web search module | None |
| **3** | browser-use microservice + TS client | None |
| **1b** | OpenAI + Claude adapters (use SerpAPI grounding) | Phase 1 + 2 |
| **4** | New cascade enrichment modules | Phase 2 + 3 |
| **5** | Schema migration + A/B routing | Phase 4 |
| **6** | Comparison + tuning + cutover | Phase 5 |

Phases 1, 2, and 3 can proceed **in parallel** since they have no cross-dependencies.

---

## Verification

- **Phase 1**: Run existing enrichment on a test property with Gemini adapter — results should be identical to current behavior
- **Phase 1b**: Run same test property with OpenAI and Claude — compare output quality
- **Phase 3**: Manually test browser-use microservice against a few LinkedIn profiles
- **Phase 4**: Run new cascade on 10 properties, compare against legacy cascade results
- **Phase 5-6**: A/B comparison dashboard to track quality metrics across batches

---

## Implementation Notes

### browser-use Python Microservice

Located at `services/browser-use/`. FastAPI service using the browser-use library for LLM-powered web scraping.

**Endpoints:**
- `POST /api/scrape` — Generic page scrape with LLM extraction
- `POST /api/linkedin/profile` — LinkedIn profile data extraction (name, headline, experiences, education)
- `POST /api/company/team` — Company team page scrape (discovers people with titles/emails)
- `GET /health` — Health check

**Running:**
```bash
cd services/browser-use
pip install -r requirements.txt
uvicorn main:app --port 8100
# Or via Docker:
docker build -t browser-use . && docker run -p 8100:8100 -e OPENAI_API_KEY=sk-... browser-use
```

Set `BROWSER_USE_URL=http://localhost:8100` in the main app's `.env.local`. The TypeScript client is at `src/lib/browser-use.ts`.

### PDL Cache with Changelog Invalidation

PDL person and company enrichment results are cached in Redis to avoid burning credits on repeat lookups.

**Cache keys:**
- Person: `pdl-person:{firstName}|{lastName}|{domain}|...`
- Company: `pdl-company:{domain}|{name}` or `pdl-company:id:{pdlId}`

**TTL:** 30 days for both person and company. Negative results (not found) cached for 24 hours.

**Changelog invalidation (person only):**
The [PDL Person Changelog API](https://docs.peopledatalabs.com/docs/person-changelog-api) is free (no credits consumed) and tells us which person records changed between dataset versions. On every cache hit for a found person:

1. Compare the cached `datasetVersion` against the latest known version (stored at `pdl-version:latest`, 6h TTL)
2. If versions differ, call `POST /v5/person/changelog` with the cached `pdlPersonId`
3. If the person was updated/deleted/merged/opted-out → delete cache entry → re-fetch from PDL
4. If the cached version is no longer valid (too old for changelog) → treat as stale → re-fetch

This means the cache is effectively unbounded for stable records while still picking up changes within hours of a new PDL data release.

### V2 Cascade Pipeline (updated)

The V2 contact cascade now has 6 stages:

1. **Email discovery** — Findymail + Hunter (unchanged from V1)
2. **Person match** — SerpAPI + LLM structured extraction
3. **PDL supplement** — emails, phones, LinkedIn, photo from PDL (cached)
4. **LinkedIn discovery** — SERP fallback if still no LinkedIn URL
5. **Employment verification** — browser-use LinkedIn scrape (replaces Crustdata)
6. **Confidence flag** — verified / pdl_matched / search_matched / email_only / no_match

PDL fills gaps that SerpAPI and Findymail/Hunter miss, particularly multiple email addresses (`emailsJson`), phone numbers (`phonesJson`, `mobilePhone`), and profile photos.
