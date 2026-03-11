# Multi-county data ingestion
**Epic ID:** GF-16 | **Phase:** Phase II: Expanded Pilot | **Priority:** P0 — Critical | **Swim Lane:** Data & Enrichment | **Owner:** Remy | **Build Status:** NEW

**Description:** Generalize the data ingestion pipeline beyond the Dallas County Appraisal District (DCAD). Today, property data ingestion is hardcoded to DCAD's schema and Snowflake export. To expand to Tarrant, Denton, and Collin counties, we need a pluggable data source adapter pattern where each county's appraisal data maps into a common Greenfinch schema. This is the gating infrastructure for all geographic expansion — without it, every new county requires custom ETL work.

**Success Criteria:** At least 3 additional counties (Tarrant, Denton, Collin) ingested successfully. Data source adapter pattern documented and reusable. New county onboarding takes days, not weeks. Data quality is comparable to Dallas County across all ingested markets. Geographic filtering in the UI works across counties.

**Comment (Remy):** Generalize the data ingestion pipeline beyond DCAD. Abstract "county appraisal district" into a pluggable data source adapter. Prove with Tarrant + Denton + Collin counties. Key requirements: Data source adapter pattern that works across counties; Multi-source Snowflake/PostgreSQL schema; Geographic filtering in UI (county/MSA selector).
