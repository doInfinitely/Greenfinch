# ADR-001: Database Consolidation to PostgreSQL

**Status:** Accepted
**Date:** 2026-03-10
**Epic:** GF-69

## Context

The platform originally used three data stores:

1. **Snowflake** — Hosted Regrid parcel data and DCAD appraisal data. Used as the ingestion source during initial development.
2. **GCP (Vertex AI / Gemini)** — Used for AI inference (classification, ownership research, contact discovery). Stateless — not a data layer.
3. **PostgreSQL (Neon)** — Application database for properties, contacts, organizations, pipeline, and all operational data.

Over time, Snowflake was eliminated as a data layer:

- County appraisal data (DCAD and others) is now downloaded directly from county websites and loaded into PostgreSQL staging tables (`cad_account_info`, `cad_appraisal_values`, `cad_buildings`, `cad_land`, `cad_downloads`).
- The `snowflake.ts` client module was deleted in a prior sprint.
- All ingestion queries now run against local PostgreSQL staging tables via `src/lib/cad/query.ts`.

## Decision

**Consolidate to PostgreSQL (Neon) as the sole data store.** Remove all remaining Snowflake artifacts.

### What was removed

- `snowflake-sdk` npm dependency
- `scripts/verify-snowflake-coverage.ts` and `scripts/list-snowflake-dbs.ts`
- `serverExternalPackages: ['snowflake-sdk']` from `next.config.mjs`
- `SNOWFLAKE_*` environment variables from `.env.local` and `.replit`
- All Snowflake naming remnants in source code (`totalFromSnowflake` → `totalFromStaging`, comments, UI copy)
- Snowflake references in documentation

### What was added

- Composite `(lat, lon)` index on the `properties` table for bounding-box queries

### PostGIS evaluation

PostGIS was evaluated and **not needed** at current scale:

- ~100K property records with `real` lat/lon columns
- Only bounding-box queries (`WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`)
- No radius, polygon, or spatial join queries exist
- A simple B-tree composite index on `(lat, lon)` is sufficient

**Reconsider PostGIS** if:
- Record count exceeds 500K+
- Radius or polygon queries are needed (e.g., "properties within 2 miles of X")
- Spatial joins are required (e.g., properties intersecting school districts)

### GCP status

GCP is retained for **stateless AI inference only** (Gemini via Vertex AI / Google GenAI SDK). It is not a data layer and requires no consolidation.

## Current Architecture

```
County Websites (DCAD, TCAD, etc.)
    │ (ZIP downloads)
    ▼
PostgreSQL staging tables (cad_*)
    │
    ▼
Ingestion pipeline (dcad-ingestion.ts)
    │
    ▼
PostgreSQL (Neon) — sole data store
  ├── ~40 tables, 90+ indexes
  ├── properties, contacts, organizations
  ├── pipeline, activity, notes
  └── enrichment costs, audit logs

GCP — AI inference only (Gemini)
Redis (Upstash) — caching, queues, rate limiting
```

## Consequences

- **Cost savings**: Snowflake compute and storage costs eliminated
- **Simpler ops**: Single database to manage, back up, and monitor
- **Faster ingestion**: No cross-network queries to Snowflake; all data is local
- **Trade-off**: County data downloads must be managed manually (mitigated by `cad_downloads` tracking table)
