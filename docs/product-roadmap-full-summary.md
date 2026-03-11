# Greenfinch Product Roadmap — Full Summary

All 22 epics from `product_roadmap_1/` are **COMPLETE**. This document provides a comprehensive overview of every epic, its implementation status, and key files.

---

## Overview

| Priority | Count | Epics |
|----------|-------|-------|
| **P0 Critical** | 5 | 01, 11, 12, 15, 21 |
| **P1 High** | 10 | 02, 04, 05, 06, 07, 16, 17, 18, 19, 20 |
| **P2 Medium** | 7 | 00, 03, 08, 09, 13, 14, 10 |

| Category | Epics |
|----------|-------|
| **Infrastructure** | 00, 10, 11 |
| **Data & Enrichment** | 01, 02, 12 |
| **Billing & Monetization** | 06, 07, 15, 17 |
| **Prospecting & Search** | 04, 05, 09, 16 |
| **Collaboration & Admin** | 03, 08, 13, 18 |
| **Segments & Geography** | 14, 19, 21 |
| **Account Intelligence** | 04 |
| **Reporting & Export** | 20 |

---

## Epic Details

### EPIC_00 — Org Hierarchy & Affiliations (P2)
**GF-70 · Infrastructure**

**Goal:** Data model for org-to-org relationships (parent companies, subsidiaries, franchise networks, PM firms managing properties). Portfolio-level views showing full control structure.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Parent-child org linking | `organizations` table with `parentOrgId`, `ultimateParentOrgId` |
| Portfolio view | `/api/organizations/[id]/portfolio` endpoint |
| Org hierarchy navigation | `/api/organizations/[id]/hierarchy` endpoint |
| Set parent modal | `src/components/SetParentOrgModal.tsx` |
| Enrichment populates hierarchy | PDL `pdlCompanyId` resolution in `organization-enrichment.ts` |

**Key Files:** `src/lib/schema.ts`, `src/app/api/organizations/[id]/hierarchy/route.ts`, `src/app/api/organizations/[id]/portfolio/route.ts`

---

### EPIC_01 — Multi-County Data Ingestion (P0)
**GF-16 · Data & Enrichment**

**Goal:** Generalize data ingestion beyond DCAD to support multiple counties with pluggable adapters mapping into a common schema.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Pluggable adapter pattern | `src/lib/cad/parsers/` — dcad, tad, ccad, denton parsers |
| 4 counties ingested | DCAD (Dallas), TAD (Tarrant), CCAD (Collin), DENTON |
| Download manager | `src/lib/cad/download-manager.ts` with staging tables |
| Admin ingestion controls | `/api/admin/cad-download`, `/api/admin/ingest` |
| Geographic filtering | County filter in `PropertyFilters.tsx`, `COUNTY_LABELS` map |

**Key Files:** `src/lib/dcad-ingestion.ts`, `src/lib/cad-ingestion.ts`, `src/lib/cad/parsers/`, `scripts/download-and-ingest-cad.ts`, `scripts/ingest-all-dfw.ts`

---

### EPIC_02 — Basic Duplicate Detection & Merge (P1)
**GF-17 · Data & Enrichment**

**Goal:** Admin tooling to identify and resolve duplicate records across contacts, organizations, and properties with semi-automated detection and human confirmation.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Fuzzy matching | `pg_trgm` similarity scoring in `duplicate-detection.ts` |
| Cross-county dedup | `detectCrossCountyDuplicates()` — same address + different county |
| Merge UI | Admin pages: `merge-contacts`, `merge-properties`, `merge-orgs` |
| Duplicate viewer | `src/app/admin/duplicates/page.tsx` |
| Batch dedup scan | `/api/admin/run-dedup-scan` endpoint |
| Auditable merge | `deduplication.ts` preserves most complete data |

**Key Files:** `src/lib/duplicate-detection.ts`, `src/lib/deduplication.ts`, `src/app/admin/duplicates/page.tsx`, `src/app/api/admin/potential-duplicates/`

---

### EPIC_03 — Manager Role (P2)
**GF-57 · Collaboration & Admin**

**Goal:** Intermediate role between Admin and Member for team leads. View team activity, assign territories, access team analytics — without billing or org management access.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Differentiated permissions | `org:manager` in `permissions.ts` — 17 permissions (no billing, no admin:ingest) |
| Team activity view | `getManagerTeamUserIds()` in `team-scope.ts` |
| Territory assignment | PATCH `/api/territories/[id]` — restricted to assignment fields |
| Pipeline team filter | `owner=team` filter on board + dashboard routes |
| Team analytics | Manager-scoped metrics in `/api/org-admin/analytics` |
| Assign rep UI | Inline Select dropdown in `territories/page.tsx` |

**Key Files:** `src/lib/team-scope.ts`, `src/lib/permissions.ts`, `src/app/api/territories/[id]/route.ts`, `src/app/api/pipeline/board/route.ts`

---

### EPIC_04 — Basic Revenue Estimation (P1)
**GF-24 · Account Intelligence**

**Goal:** Rule-based estimation of annual contract value by service type for each property, helping providers prioritize high-value targets.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| 11 service models | landscaping, tree_trimming, irrigation, janitorial, hvac, security, waste, elevator, roofing, plumbing, fire_protection |
| Revenue factors | Lot acreage, building sqft, unit counts, building class multipliers |
| Confidence levels | high/medium/low per estimate |
| Property detail display | Revenue card in `PropertyStats.tsx` |
| Sort/filter by revenue | `estimatedRevenue` sort in search API |
| Suitability checks | `checkPropertySuitability()` — skips unsuitable subcategories |
| Residential revenue | `estimateResidentialRevenue()` — outdoor services only |

**Key Files:** `src/lib/revenue-estimation.ts`, `src/components/property/PropertyStats.tsx`, `src/lib/schema.ts` (revenueEstimates table)

---

### EPIC_05 — Territory Definitions (P1)
**GF-8 · Prospecting & Search**

**Goal:** Allow org admins to define geographic territories assigned to individual reps with boundary support and overlap detection.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Territory schema | `territories` table with polygon geometry, zip codes, county |
| Territory CRUD | `/api/territories` endpoints |
| Polygon filtering | GeoJSON route filters by territory boundaries |
| Overlap detection | Intersection check on territory creation |
| Territory map view | `TerritoryDialog.tsx` with boundary visualization |
| Rep assignment | `assignedUserId`, `assignedClerkUserId` fields |
| Default territory filter | Reps auto-filtered to their territory |

**Key Files:** `src/lib/schema.ts`, `src/app/api/territories/`, `src/components/TerritoryDialog.tsx`, `src/app/org-admin/territories/page.tsx`

---

### EPIC_06 — Billing Admin: Usage Monitoring (P1)
**GF-47 · Billing & Monetization**

**Goal:** Dashboard for org admins to monitor team credit usage, billing history, and spending patterns.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Credit balance display | 3-pool breakdown (current + rollover + purchased) |
| Usage by user/action | Transaction history with user + action type filters |
| Billing history | Stripe invoice integration |
| Credit indicator | `CreditBalanceIndicator.tsx` — persistent header badge |
| Warning at 80% | Low-balance alert in billing page |
| Action cost lookup | `/api/billing/action-costs` endpoint |

**Key Files:** `src/lib/credits.ts`, `src/app/billing/page.tsx`, `src/components/CreditBalanceIndicator.tsx`, `src/app/api/billing/`

---

### EPIC_07 — Plan Management: Upgrade/Downgrade/Cancel (P1)
**GF-48 · Billing & Monetization**

**Goal:** Self-service plan changes with automatic prorations and retention flows for cancellations.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Plan comparison | GET `/api/billing/change-plan` returns all tiers |
| Proration preview | `stripe.invoices.createPreview()` with `subscription_details` |
| Upgrade/downgrade | POST to change-plan updates Stripe + DB + rollover cap |
| Cancel with reason | POST `/api/billing/cancel` with reason + feedback |
| Reactivation | DELETE `/api/billing/cancel` clears `cancel_at_period_end` |
| Retention offer | Cancel dialog shows downgrade alternative |
| Webhook sync | Tier change → rollover cap sync; deletion → `canceledAt` |

**Key Files:** `src/app/api/billing/change-plan/route.ts`, `src/app/api/billing/cancel/route.ts`, `src/app/api/webhook/stripe/route.ts`, `src/app/billing/page.tsx`

---

### EPIC_08 — Chatbot with Human Escalation (P2)
**GF-71 · Infrastructure**

**Goal:** In-app AI-powered support chat with human escalation for complex issues.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| AI chat | `src/lib/support/chat-session.ts` with system prompt |
| Grounded responses | System prompt includes product docs + account context |
| Human escalation | Support tickets table + admin queue |
| Persistent chat | Chat endpoints at `/api/support-chat/` |
| Ticket management | `src/app/admin/support-tickets/page.tsx` |
| Transcript storage | Full chat history + AI summaries |

**Key Files:** `src/lib/support/chat-session.ts`, `src/lib/support/system-prompt.ts`, `src/app/api/support-chat/`, `src/components/support/`

---

### EPIC_09 — Segment-Specific Filter Defaults (P2)
**GF-9 · Prospecting & Search**

**Goal:** Adjust default filter configuration based on selected service type to surface relevant properties faster.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Segment defaults map | `segment-filter-defaults.ts` — per-service filter presets |
| Landscaping defaults | Lot-size-heavy filters |
| Janitorial defaults | Sqft-heavy filters |
| Hook integration | `use-segment-defaults.ts` applies defaults on service change |
| Filter options API | `/api/properties/filter-options` returns available values |

**Key Files:** `src/lib/segment-filter-defaults.ts`, `src/hooks/use-segment-defaults.ts`, `src/components/PropertyFilters.tsx`

---

### EPIC_10 — Database Simplification (P1)
**GF-69 · Infrastructure**

**Goal:** Evaluate consolidating three-layer data stack (GCP + Snowflake + PostgreSQL) to primarily PostgreSQL.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Snowflake removed | Scripts deleted (`list-snowflake-dbs.ts`, `verify-snowflake-coverage.ts`) |
| PostgreSQL primary | All data in Drizzle ORM + PostgreSQL |
| Spatial queries | PostGIS for map rendering + territory filtering |
| CAD data in PostgreSQL | Staging + production tables for all 4 counties |
| Cost reduction | Single-database architecture |

**Key Files:** `src/lib/db.ts`, `src/lib/schema.ts`, `drizzle/` migrations

---

### EPIC_11 — Greenfinch Persistent UUIDs (P0)
**GF-68 · Infrastructure**

**Goal:** Migrate all core entities to Greenfinch-generated UUIDs as primary identifiers, with source IDs as indexed attributes.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| UUID primary keys | All tables use `uuid` as PK (properties, contacts, organizations) |
| Source IDs preserved | `cadAccountNum`, `pdlId`, `pdlCompanyId` as indexed attributes |
| Migration script | `scripts/migrate-uuid-fks.ts` |
| API uses UUIDs | All endpoints reference by UUID |
| Cross-reference | Source-specific IDs queryable but not primary |

**Key Files:** `src/lib/schema.ts`, `scripts/migrate-uuid-fks.ts`

---

### EPIC_12 — Enrichment Pipeline Redesign (P0)
**GF-15 · Data & Enrichment**

**Goal:** Ground-up rethink of enrichment pipeline for higher accuracy at lower cost, scalable across geographies.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| 3-stage pipeline | classify → ownership → contacts (V1) |
| Multi-LLM support | Gemini, OpenAI, Claude adapters in `src/lib/ai/llm/` |
| V2 cascade | SerpAPI + LLM + PDL + browser-use verification |
| V3 unified | Market-parameterized + email verification + phone enrichment |
| A/B routing | `ENRICHMENT_V2_PERCENTAGE`, `ENRICHMENT_V3_PERCENTAGE` env vars |
| Multi-source contacts | PDL → Findymail → Hunter → Apollo waterfall |
| Phone enrichment | `phone-enrichment.ts` (Findymail → Hunter phones) |
| Browser-use verify | Employment verification via headless browser |
| Multi-layer caching | Redis: 30d (PDL), 7d (SERP/cascade), 24h (negative) |
| Residential branch | Stage 2R for deed owner lookup |
| Cost tracking | Per-action, per-org accounting via `cost-tracker.ts` |

**Key Files:** `src/lib/ai/pipeline.ts`, `src/lib/ai/pipeline-v3.ts`, `src/lib/cascade-enrichment-v3.ts`, `src/lib/ai/llm/`, `src/lib/phone-enrichment.ts`

---

### EPIC_13 — Basic Product Walkthroughs (P2)
**GF-59 · Collaboration & Admin**

**Goal:** Contextual tooltips and guided tours for key product features, appearing on first encounter.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Walkthrough system | `src/lib/walkthroughs/` — step definitions + state machine |
| Dismissable tours | `WalkthroughPrompt.tsx` with dismiss/skip |
| Progress tracking | `/api/user/walkthroughs` — per-user completion |
| Context provider | `WalkthroughContext.tsx` — manages active walkthrough |
| Feature tooltips | `FeatureTooltip.tsx` — contextual hints |

**Key Files:** `src/lib/walkthroughs/`, `src/components/WalkthroughPrompt.tsx`, `src/components/FeatureTooltip.tsx`, `src/contexts/WalkthroughContext.tsx`

---

### EPIC_14 — Residential Property Evaluation (P2)
**GF-82 · Segments & Geography**

**Goal:** Add residential property support with appropriate pipeline branching and filter controls.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Residential toggle | `includeResidential` in `FilterState` + toggle button |
| Search exclusion | Conditional filter in search + geojson APIs |
| Pipeline branch | V3 branches on `divisionCd`: residential → Stage 2R |
| Deed owner lookup | `residential-owner.ts` — skip PM search for residential |
| Revenue estimation | `estimateResidentialRevenue()` — outdoor services only |
| Property detail | Hides management company section for residential |

**Key Files:** `src/components/PropertyFilters.tsx`, `src/lib/ai/pipeline-v3.ts`, `src/lib/ai/stages/residential-owner.ts`, `src/components/property/OwnershipSection.tsx`

---

### EPIC_15 — Rollover Credit System (P0)
**GF-46 · Billing & Monetization**

**Goal:** Monthly credit allocation by pricing tier with rollover, forming the core usage-based monetization model.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Credit tiers | `credit_tiers` table: monthlyCredits, rolloverCap, pricing |
| 3-pool system | Current + rollover + purchased balances |
| Monthly allocation | `/api/cron/credit-allocation` — cron-triggered |
| Rollover cap | Configurable per-tier (e.g., 2x monthly) |
| Credit packs | Purchasable burst credits via `creditPacks` table |
| Atomic deduction | `SELECT FOR UPDATE` locking in `credits.ts` |
| Balance visibility | `CreditBalanceIndicator.tsx` in app header |
| Action costs | Configurable per-action in `creditActionCosts` table |
| Transaction ledger | Append-only `creditTransactions` log |

**Key Files:** `src/lib/credits.ts`, `src/lib/credit-guard.ts`, `src/lib/schema.ts`, `src/app/api/billing/`, `src/app/api/cron/credit-allocation/`

---

### EPIC_16 — Customer Status: Manual Flagging (P1)
**GF-10 · Prospecting & Search**

**Goal:** Richer customer status tracking with team-visible flagging to build institutional knowledge about territory.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| 6 flag types | existing_customer, competitor_serviced, do_not_contact, hot_lead, under_contract, past_customer |
| Notes on flags | Optional notes with each flag |
| Map + list visible | `CustomerFlagBadge.tsx` badge display |
| Competitor tracking | `customerStatusFlags` table with competitor info |
| Filter by flag | Customer status filter in `PropertyFilters.tsx` |
| Flag dialog | `CustomerFlagDialog.tsx` UI |

**Key Files:** `src/lib/customer-flags.ts`, `src/components/CustomerFlagBadge.tsx`, `src/components/property/CustomerFlagDialog.tsx`, `src/app/api/properties/[id]/customer-flags/`

---

### EPIC_17 — Seat-Based Licensing (P1)
**GF-45 · Billing & Monetization**

**Goal:** Per-seat pricing on top of base subscription with prorated billing for standard SaaS scaling.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Seat tracking | `seatCount` on `orgSubscriptions`, `seatsIncluded` on `creditTiers` |
| Add/remove seats | POST `/api/billing/seats` with Stripe quantity sync |
| Proration | `previewSeatChange()` via `stripe.invoices.createPreview()` |
| Seat enforcement | `requireSeatAvailable()` guard on invitation route (402 if exceeded) |
| Stripe sync | Webhook syncs `seatCount` from `subscription.items.data[0].quantity` |
| Billing UI | Seat progress bar + Add/Remove buttons in billing page |
| Team UI | Seat badge + disabled invite CTA when full |

**Key Files:** `src/lib/seat-management.ts`, `src/app/api/billing/seats/route.ts`, `src/app/api/org/invitations/route.ts`, `src/app/billing/page.tsx`

---

### EPIC_18 — Basic Onboarding Flow (P1)
**GF-58 · Collaboration & Admin**

**Goal:** Guided first-session experience getting users to first "aha moment" in under 10 minutes.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| 5-step wizard | Services → Territory → Map → Property → Contact Reveal |
| Progress tracking | `onboardingProgress` JSONB field on users table |
| Completion tracking | Per-step completion + skip timestamps |
| Route guards | `OnboardingGuard.tsx` enforces progression |
| Onboarding context | `OnboardingContext.tsx` provider |
| Onboarding checklist | `OnboardingChecklist.tsx` persistent sidebar widget |
| Segment-aware tips | Outdoor services tip in territory step |

**Key Files:** `src/app/onboarding/page.tsx`, `src/lib/onboarding.ts`, `src/components/OnboardingGuard.tsx`, `src/components/OnboardingChecklist.tsx`, `src/contexts/OnboardingContext.tsx`

---

### EPIC_19 — Segments: Tree Trimming & Irrigation (P1)
**GF-80 · Segments & Geography**

**Goal:** Expand service segments beyond landscaping to validate property intelligence value across outdoor services.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Revenue models | Tree trimming + irrigation in `revenue-estimation.ts` |
| Suitability checks | `checkPropertySuitability()` — skips parking garages, warehouses, data centers |
| Filter defaults | Segment-specific presets in `segment-filter-defaults.ts` |
| Service selector | Both selectable in onboarding `ServiceSelector.tsx` |
| Suitability warning | Amber note in `PropertyStats.tsx` for unsuitable properties |
| Onboarding tip | Lot-size tip for outdoor services in territory step |

**Key Files:** `src/lib/revenue-estimation.ts`, `src/lib/segment-filter-defaults.ts`, `src/components/property/PropertyStats.tsx`, `src/app/onboarding/page.tsx`

---

### EPIC_20 — Basic Metric Reporting (P2)
**GF-64 · Reporting & Export**

**Goal:** Dashboard showing key product usage and pipeline metrics for ROI understanding and pricing decisions.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| Metrics dashboard | `src/app/metrics/page.tsx` |
| Org admin analytics | `src/app/org-admin/analytics/page.tsx` |
| Pipeline trends | Weekly created, won, value metrics |
| User breakdown | Properties viewed, contacts discovered, deals won per user |
| CSV export | `/api/metrics/export` endpoint |
| Admin metrics | `/api/admin/metrics` with export |
| Manager scope | Team-scoped analytics with "My Team" label |

**Key Files:** `src/lib/metrics-queries.ts`, `src/app/metrics/page.tsx`, `src/app/org-admin/analytics/page.tsx`, `src/app/api/metrics/`

---

### EPIC_21 — Geography: Dallas Metro Expansion (P0)
**GF-81 · Segments & Geography**

**Goal:** Expand geographic coverage from Dallas County to full DFW metro (Tarrant, Denton, Collin) — roughly tripling the property universe.

**Status: COMPLETE**

| Deliverable | Implementation |
|-------------|---------------|
| 4 counties ingested | DCAD, TAD, CCAD, DENTON with parsers |
| Cross-county search | County filter in search + geojson APIs |
| Map rendering | DFW bounds in `DashboardMap.ts` cover metro |
| Cross-county dedup | `detectCrossCountyDuplicates()` — Tier 0: similarity > 0.85 |
| Market config | `markets-config.json` with county definitions |
| Ingestion status | `/api/admin/ingestion-status` — per-county counts |
| County quality | `/api/admin/metrics/county-quality` — data quality comparison |
| Admin UI | County Ingestion Status + Data Quality tables |

**Key Files:** `src/lib/cad/parsers/`, `src/lib/markets/`, `src/lib/duplicate-detection.ts`, `src/app/api/admin/ingestion-status/route.ts`, `src/app/api/admin/metrics/county-quality/route.ts`

---

## Dependency Map

```
EPIC_11 (UUIDs) ──────┬──► EPIC_01 (Multi-County) ──► EPIC_21 (DFW Expansion)
                       │
EPIC_12 (Pipeline) ────┘

EPIC_15 (Credits) ─────┬──► EPIC_06 (Billing Admin)
                       ├──► EPIC_07 (Plan Management)
                       └──► EPIC_20 (Reporting)

EPIC_17 (Seats) ───────────► EPIC_07 (Plan Management)

EPIC_05 (Territories) ─┬──► EPIC_03 (Manager Role)
                       └──► EPIC_09 (Filter Defaults)

EPIC_04 (Revenue) ─────────► EPIC_19 (Segments)

EPIC_18 (Onboarding) ─────► EPIC_13 (Walkthroughs)
```

---

## Architecture Summary

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React, Tailwind CSS, Mapbox |
| Backend | Next.js API Routes, Drizzle ORM |
| Database | PostgreSQL + PostGIS |
| Cache | Redis (multi-TTL: 30d, 7d, 24h) |
| Auth | Clerk (orgs, roles, invitations) |
| Payments | Stripe (subscriptions, seats, invoices) |
| AI | Gemini + OpenAI + Claude (pluggable adapters) |
| Search | SerpAPI (grounding), pg_trgm (fuzzy) |
| Data Sources | PDL, Findymail, Hunter, Apollo, Crustdata, EnrichLayer |
| Queue | BullMQ (enrichment jobs) |
| Hosting | Railway |

**Total: 22/22 epics complete · 48+ database tables · 100+ API routes · 50+ UI components**
