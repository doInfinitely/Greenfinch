# Roadmap Gaps Implementation Summary

All six epics from `product_roadmap_1/` have been closed. TypeScript compiles cleanly with zero errors.

---

## New Files (8)

| File | Epic | Purpose |
|------|------|---------|
| `drizzle/0009_seat_billing.sql` | 17+07 | Schema migration: seats_included, seat_count, cancellation fields |
| `src/lib/seat-management.ts` | 17 | Seat info, enforcement, Stripe quantity sync |
| `src/lib/team-scope.ts` | 03 | Manager team user ID resolution via territories |
| `src/app/api/billing/seats/route.ts` | 17 | GET/POST seat management API |
| `src/app/api/billing/change-plan/route.ts` | 07 | GET tiers, POST plan change with proration preview |
| `src/app/api/billing/cancel/route.ts` | 07 | POST cancel (with reason), DELETE reactivate |
| `src/app/api/admin/ingestion-status/route.ts` | 21 | Per-county property counts and coverage |
| `src/app/api/admin/metrics/county-quality/route.ts` | 21 | Per-county address/geocode/contact quality |

---

## Modified Files (26)

| File | Epic | Changes |
|------|------|---------|
| `src/lib/schema.ts` | 17+07 | Added `seatsIncluded`, `seatCount`, cancellation columns |
| `src/lib/permissions.ts` | 03 | Added `team:view-activity`, `territories:assign`, `pipeline:assign` |
| `src/lib/stripe-helpers.ts` | 17 | `quantity` parameter on checkout |
| `src/lib/duplicate-detection.ts` | 21 | `detectCrossCountyDuplicates()` + wired into `runDuplicateDetection` |
| `src/lib/revenue-estimation.ts` | 19+14 | `checkPropertySuitability()` + `estimateResidentialRevenue()` |
| `src/app/api/webhook/stripe/route.ts` | 17+07 | Seat sync, rollover cap sync, canceledAt |
| `src/app/api/org/invitations/route.ts` | 17 | `requireSeatAvailable()` guard before inviting |
| `src/app/api/billing/subscription/route.ts` | 17 | Include `seatCount` + `seatsIncluded` in response |
| `src/app/api/territories/[id]/route.ts` | 03 | Managers can PATCH assignment fields only |
| `src/app/api/pipeline/board/route.ts` | 03 | `owner=team` filter with manager team scope |
| `src/app/api/pipeline/dashboard/route.ts` | 03 | Same `owner=team` filter |
| `src/app/api/org-admin/analytics/route.ts` | 03 | Manager team-scoped metrics |
| `src/app/api/properties/search/route.ts` | 14 | Conditional residential exclusion |
| `src/app/api/properties/geojson/route.ts` | 14 | Conditional residential exclusion |
| `src/app/billing/page.tsx` | 17+07 | Seat card, plan comparison, cancel flow UI |
| `src/app/org-admin/team/page.tsx` | 17 | Seat badge, disable invite when full |
| `src/app/org-admin/territories/page.tsx` | 03 | Manager assign dropdown via Select |
| `src/app/org-admin/analytics/page.tsx` | 03 | "My Team" label for managers |
| `src/app/admin/page.tsx` | 21 | County Ingestion Status card |
| `src/app/admin/metrics/page.tsx` | 21 | County Data Quality section |
| `src/components/PropertyFilters.tsx` | 14 | `includeResidential` toggle + serialization |
| `src/app/dashboard/map/page.tsx` | 14 | Pass `includeResidential` to geojson URL |
| `src/components/property/PropertyStats.tsx` | 19 | Suitability warning note |
| `src/app/onboarding/page.tsx` | 19 | Segment-aware lot-size tip |
| `src/app/property/[id]/page.tsx` | 14 | Pass `isResidential` to OwnershipSection |
| `src/components/property/OwnershipSection.tsx` | 14 | Hide PM company for residential |

---

## Epic Breakdown

### Epic 17 — Seat-Based Licensing

- **Schema**: `seats_included` on `credit_tiers`, `seat_count` on `org_subscriptions`
- **Backend**: `seat-management.ts` with `getOrgSeatInfo`, `requireSeatAvailable`, `updateSeatCount`, `previewSeatChange`
- **API**: `GET/POST /api/billing/seats`
- **Guard**: Invitation route checks `requireSeatAvailable()` before creating invitation (returns 402 if exceeded)
- **Stripe**: Checkout accepts `quantity` param; webhook syncs `seatCount` from `subscription.items.data[0].quantity`
- **UI**: Seat progress bar in billing page, seat badge + disabled invite CTA on team page

### Epic 07 — Plan Management: Upgrade/Downgrade/Cancel

- **Schema**: `cancellation_reason`, `cancellation_feedback`, `canceled_at` on `org_subscriptions`
- **APIs**: `GET/POST /api/billing/change-plan` (proration preview + execute), `POST/DELETE /api/billing/cancel` (cancel with reason / reactivate)
- **Webhook**: Detects tier change → syncs `rolloverCap` in `creditBalances`; sets `canceledAt` on subscription delete
- **UI**: Plan comparison cards with upgrade/downgrade buttons, proration preview dialog, cancel dialog with reason radio buttons + retention offer

### Epic 03 — Manager Role

- **Permissions**: Added `team:view-activity`, `territories:assign`, `pipeline:assign` to both `org:admin` and `org:manager`
- **Team scope**: `team-scope.ts` resolves manager's team via shared territory assignments (falls back to all non-admin members)
- **Territory PATCH**: Managers allowed but restricted to assignment-only fields (`assignedUserId`, `assignedClerkUserId`)
- **Pipeline**: `owner=team` filter on board + dashboard routes calls `getManagerTeamUserIds()`
- **Analytics**: Manager sees team-scoped metrics with "My Team Activity" label
- **UI**: Inline Select dropdown for territory rep assignment (visible to managers)

### Epic 21 — DFW Metro Expansion

- **Cross-county dedup**: `detectCrossCountyDuplicates()` — Tier 0: same address (similarity > 0.85) + different `cadCountyCode`, confidence 0.90+. Wired into `runDuplicateDetection()` property branch
- **Ingestion status API**: `GET /api/admin/ingestion-status` — GROUP BY `cad_county_code` with total, enriched, in-progress counts
- **County quality API**: `GET /api/admin/metrics/county-quality` — per-county address quality, geocoded %, avg contacts, revenue estimate coverage
- **UI**: County Ingestion Status table on admin page; County Data Quality table on admin metrics page

### Epic 19 — Segments: Tree Trimming & Irrigation

- **Suitability check**: `checkPropertySuitability(service, category, subcategory, lotSqft)` — returns `{ suitable, reason }` based on `UNSUITABLE_SUBCATEGORIES` map (parking garages, warehouses, data centers skip tree/irrigation) and minimum lot size
- **PropertyStats**: Amber suitability warning shown when user's selected service is unsuitable for the property
- **Onboarding**: Segment-aware tip in territory step when outdoor services selected

### Epic 14 — Residential Property Evaluation

- **Filter**: `includeResidential: boolean` added to `FilterState` with serialization/parsing + toggle button in filter bar
- **Search API**: Residential exclusion conditional on `includeResidential` param (both search + geojson)
- **Map**: `includeResidential` passed through `buildGeojsonUrl`
- **Revenue**: `estimateResidentialRevenue()` limits to outdoor services only (landscaping, tree trimming, irrigation, pest control)
- **Property detail**: Detects `isResidential` from `assetCategory`, passes to `OwnershipSection` which hides management company section

---

## Verification Checklist

- [ ] Run `drizzle/0009_seat_billing.sql` against database
- [ ] Seat enforcement: invite a member when at limit → verify 402 response
- [ ] Plan change: preview proration → execute upgrade → verify Stripe subscription + credit reallocation
- [ ] Cancel: verify reason capture, period-end scheduling, reactivation
- [ ] Manager: verify territory assignment works but create/delete blocked; verify `owner=team` pipeline filter
- [ ] County dedup: run dedup scan → verify cross-county matches surface
- [ ] Residential: toggle filter on/off → verify search results change; verify property detail hides PM section
- [ ] Suitability: view a parking structure with tree_trimming selected → verify amber note
