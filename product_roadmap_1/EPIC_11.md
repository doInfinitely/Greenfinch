# Greenfinch persistent UUIDs
**Epic ID:** GF-68 | **Phase:** Phase II: Expanded Pilot | **Priority:** P0 — Critical | **Swim Lane:** Infrastructure | **Owner:** Remy | **Build Status:** NEW

**Description:** Migrate all core entities (parcels, contacts, organizations) to Greenfinch-generated UUIDs as primary identifiers. Source-specific IDs (DCAD appraisal ID, PDL ID, LinkedIn URL, domain) become attributes/foreign keys rather than primary keys. This is foundational infrastructure for multi-county and multi-source data — without stable Greenfinch IDs, merging data from Tarrant County and Dallas County creates identity conflicts. Also enables future capabilities like cross-source deduplication, entity resolution, and stable API references.

**Success Criteria:** All parcels, contacts, and orgs have Greenfinch UUIDs as primary keys. Source-specific IDs preserved as indexed attributes. All application code references UUIDs, not source IDs. No data loss during migration. API endpoints use UUIDs. Migration is reversible if issues arise.

**Comment (Remy):** Migrate all core entities (parcels, contacts, orgs) to Greenfinch-generated UUIDs as primary identifiers. Source-specific IDs (DCAD, PDL, LinkedIn) become attributes. Critical for multi-county and multi-source data.
