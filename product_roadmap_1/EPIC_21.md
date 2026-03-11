# Geography: Dallas metro expansion
**Epic ID:** GF-81 | **Phase:** Phase II: Expanded Pilot | **Priority:** P0 — Critical | **Swim Lane:** Segments & Geography | **Owner:** Remy | **Build Status:** NEW

**Description:** Expand geographic coverage from Dallas County to the full DFW metro area by adding Tarrant, Denton, and Collin counties. This roughly triples the property universe and is the first test of the multi-county data ingestion pipeline. These counties are contiguous with Dallas and serve the same service provider market — many landscaping companies operate across all four counties. Geographic expansion is gated on the multi-county ingestion epic in Data & Enrichment.

**Success Criteria:** All four DFW metro counties have complete property data ingested and enriched. Cross-county search and filtering works seamlessly. Map view renders correctly across county boundaries. No degradation in data quality compared to Dallas County. App can distinguish BPP and other non-parent properties and resolve to a single parent property, regardless of county. Users confirm the expanded geography covers their full operating area.

**Comment (Remy):** Add Tarrant, Denton, Collin counties to coverage. Depends on multi-county data ingestion pipeline.
