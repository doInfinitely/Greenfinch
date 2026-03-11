# Database simplification
**Epic ID:** GF-69 | **Phase:** Phase II: Expanded Pilot | **Priority:** P1 — High | **Swim Lane:** Infrastructure | **Owner:** Remy | **Build Status:** SHIP

**Description:** Evaluate whether to consolidate the current three-layer data stack (GCP + Snowflake + PostgreSQL) to primarily PostgreSQL. The current architecture has Snowflake for bulk property data, PostgreSQL for application data, and GCP for enrichment — this creates operational complexity, multiple data sync points, and higher costs. A unified PostgreSQL approach (possibly with extensions like PostGIS for spatial queries) could simplify operations significantly while the data volume is manageable.

**Success Criteria:** Architecture evaluation documented with clear recommendation. If consolidating: migration plan with rollback strategy. Query performance benchmarked against current stack. Spatial query performance acceptable for map rendering. Cost comparison shows meaningful savings. Decision made and documented regardless of direction.

**Comment (Remy):** Evaluate consolidating from GCP + Snowflake + PostgreSQL to primarily PostgreSQL. Reduce operational complexity and cost.
