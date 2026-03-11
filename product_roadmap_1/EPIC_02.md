# Basic duplicate detection & merge
**Epic ID:** GF-17 | **Phase:** Phase II: Expanded Pilot | **Priority:** P1 — High | **Swim Lane:** Data & Enrichment | **Owner:** Remy | **Build Status:** NEW

**Description:** Admin tooling to identify and resolve duplicate records across contacts, organizations, and properties. As we ingest data from multiple sources (appraisal districts, enrichment providers, user input), duplicates are inevitable — the same PM firm listed under slightly different names, the same contact appearing from multiple providers, or parcels that overlap after a county data update. Semi-automated: the system surfaces likely duplicates using fuzzy matching or AI assistance, and a human confirms the merge.

**Success Criteria:** System identifies 80%+ of true duplicates in contacts and orgs. False positive rate below 20%. Merge preserves the most complete data from both records. Merge history is auditable. Admin can process a batch of duplicate candidates efficiently (not one-by-one).

**Comment (Remy):** Admin tools to identify and merge duplicate contacts, organizations, and properties. Semi-automated — surface likely duplicates, human confirms.
