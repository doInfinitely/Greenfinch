# Future Features & Improvements

This document tracks features and improvements to revisit in future development cycles.

---

## Property Display & Data

### Consolidate Child Parcels in Associated Properties List
**Priority:** Medium  
**Context:** When viewing a contact's Associated Properties, child parcels appear as separate entries (e.g., NorthPark Center shows 5 times for Neiman Marcus Anchor, Nordstrom, main property, etc.)

**Current Behavior:**
- Contact linked to multiple child parcels AND parent property shows all entries separately
- Creates visual clutter and confusion for sales reps

**Proposed Solutions:**
1. **Consolidate to parent properties only** - Show only the parent property (or the property itself if it has no parent). Most relevant for prospecting since sales reps care about the overall property.
2. **Group by address** - Show one entry per unique address with count indicator (e.g., "8687 N Central Expy (4 parcels)")
3. **Visual hierarchy** - Keep all entries but indicate parent vs. child relationship

**Technical Notes:**
- Properties table has `is_parent_property` boolean and `parent_property_key` reference
- Query can be modified to JOIN to parent when `parent_property_key` is set
- Consider whether to consolidate in API response or at display level

---

## UI/UX Improvements

### Standardize Enrichment Completion Detection
**Priority:** Low  
**Context:** Different pages use different mechanisms to detect when enrichment completes:
- Contacts list page uses custom `window.addEventListener('enrichment-complete')` event
- Contact detail and property pages use `EnrichmentQueueContext`

Both work correctly, but standardizing on one approach would improve maintainability.

---

## Data Quality

### Location Enrichment Fallback Chain
**Priority:** Low  
**Context:** Contact location (city, state) is captured from multiple sources in cascade enrichment. Consider adding additional fallback sources or geocoding from company address if contact location is unavailable.

---

*Add new features below as they are identified during development.*
