# Org hierarchy & affiliations
**Epic ID:** GF-70 | **Phase:** Phase II: Expanded Pilot | **Priority:** P2 — Medium | **Swim Lane:** Infrastructure | **Owner:** Remy | **Build Status:** NEW

**Description:** Data model support for org-to-org relationships: parent companies and subsidiaries, franchise networks, PM firms managing properties on behalf of owner entities, and joint ventures. A single property might be owned by 'ABC Holdings LLC', managed by 'XYZ Property Management', with the actual PM firm being a subsidiary of a larger company. Without hierarchy support, portfolio-level views are impossible and users can't see the full picture of who controls a property.

**Success Criteria:** Org entities can be linked in parent-child relationships. Portfolio view shows all properties managed by an org and its subsidiaries. Hierarchy is navigable in the UI (click through parent → child orgs). Data model supports at least 3 levels of hierarchy. Enrichment pipeline populates hierarchy data where discoverable.

**Comment (Remy):** Data model support for org-to-org relationships: parent companies, subsidiaries, franchises, PM firms managing on behalf of owners.
