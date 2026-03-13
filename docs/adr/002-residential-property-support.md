# ADR-002: Residential Property Support

**Status:** Accepted
**Date:** 2026-03-12
**Epic:** GF-14

## Context

The platform was built exclusively for commercial real estate (CRE) prospecting. County appraisal data (CAD) includes both commercial and residential parcels, and the existing database already contains residential records tagged with `divisionCd = 'RES'`.

Users and stakeholders have requested the ability to surface residential properties for owner-occupied outreach, deed owner identification, and multi-family property management targeting.

Two options were considered:

1. **Separate system** — Build a dedicated residential module with its own schema, pipeline, and UI.
2. **Extend existing pipeline** — Add residential support within the current enrichment pipeline and property model, gated per market.

## Decision

**BUILD residential MVP within the existing pipeline.** Residential properties share enough structure with commercial properties (address, ownership, valuation, contacts) that a separate system is not justified at this stage.

### Implementation

- **UI filter toggle** — Users can toggle a "Residential" filter on the map and list views to include/exclude residential properties. Default: commercial only.
- **Pipeline branching** — The V3 enrichment pipeline (`pipeline-v3.ts`) branches on `divisionCd`:
  - `COM` → Stage 2 (commercial ownership identification with PM/asset manager search)
  - `RES` → Stage 2R (`residential-owner.ts`) — deed owner lookup, skip property management search
- **Per-market gating** — Each market configuration has a `residentialEnabled: boolean` flag. Residential properties are only visible and enrichable in markets where this is explicitly enabled.
- **Market config** — Controlled via `markets-config.json` at runtime, with defaults in `src/lib/markets/defaults.ts`.

### What is included in MVP

- Residential properties displayed on map/list when filter is active
- Deed owner name and mailing address from CAD data
- Basic contact enrichment (PDL person lookup using owner name + address)
- Market-level enable/disable via configuration

### What is NOT included

- HOA detection or HOA board contact discovery
- Rental vs. owner-occupied classification
- Separate database schema for residential-specific fields
- Tenant identification or lease history
- MLS data integration

## Consequences

- **Minimal schema change** — Only addition: optional `state?: string` field on `CommercialProperty` for multi-state support. No new tables required.
- **Pipeline complexity** — The V3 orchestrator now has a branch point. Stage 2R is a simpler path than Stage 2 (no PM search), so this adds minimal maintenance burden.
- **Rollout risk** — Gated per-market via `residentialEnabled`. Can be enabled incrementally (e.g., Dallas first, then Tarrant County) without affecting existing commercial workflows.
- **Future expansion** — If residential grows beyond deed owner lookup, a dedicated residential pipeline stage or module can be extracted without changing the commercial path.
