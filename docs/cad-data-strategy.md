# CAD Data Strategy — Houston Expansion & Regrid Tradeoffs

**Date**: March 2026
**Context**: We've extended the CAD ingestion pipeline to support Houston (Harris + Chambers), processed parcel shapefiles for 7 Houston-area counties into PMTiles, and fixed the map tooltip/hover regression. This doc captures field coverage analysis, CAD vs Regrid tradeoffs, and scaling considerations to inform infrastructure decisions.

---

## 1. Field Coverage — What do we actually have?

### Harris County (HCAD) — Excellent for commercial. Best-in-class alongside Dallas.

| Field | Coverage | Source |
|-------|----------|--------|
| Owner name | 100% of 1.6M accounts | ownership_history.txt |
| Site address | 100% (10% have "0" street number = vacant land) | ownership_history.txt |
| Purchase/deed date | 100% | ownership_history.txt |
| Total appraised value | 98.3% | jur_value.txt |
| Building sqft | 100% of 160K commercial buildings | building_other.txt |
| Year built | 100% of commercial | building_other.txt |
| Construction type | 100% of commercial (e.g. "Masonry Bearing") | building_other.txt |
| Quality grade | 100% of commercial (A/B/C/D) | building_other.txt |
| Net rentable area | 35.6% of commercial (income properties) | building_other.txt |
| Property name | 23.2% of commercial (named properties) | building_other.txt |
| Land area + unit price | 99.9% across 2.4M land records | land.txt |
| City name | ~90% (derived from tax district codes) | jur_value.txt + desc_r_12 |
| ISD/school district | 100% | jur_value.txt |
| ZIP code | **0%** — not in text files, requires geocoding | — |
| Owner mailing address | **0%** in text files, **but available in shapefile** (Parcels.zip has `mail_addr_*` fields) | shapefile only |

### Chambers County — Adequate but thin on building detail. 1,583 commercial parcels.

| Field | Coverage |
|-------|----------|
| Owner, parcel ID, property category | 100% |
| Market value | 97.8% |
| Full property address (number+street+city+zip) | 56.6% (many rural/ag parcels lack street numbers) |
| Acres | 87% |
| Improvement + land value split | Yes (Hs + Nhs components) |
| Year built, building sqft, construction type | **0%** — not in certified roll |

### TNRIS GeoJSON counties (Montgomery, Fort Bend, Liberty, Waller) — Geometry + basic data only.

| Field | Coverage |
|-------|----------|
| Owner name, mailing address | 100% |
| Situs address (with city/zip) | 100% |
| Land/improvement/market values | 100% (but Fort Bend has 38% zero `mkt_value` despite nonzero components) |
| Parcel geometry | 100% |
| `year_built` | **0%** — field exists in schema but always empty |
| `stat_land_use`, `loc_land_use` | **0%** — always empty |

### Galveston — The richest of the non-CAD counties.

| Field | Coverage |
|-------|----------|
| 2025 land/improvement/total values | 100% |
| Owner, situs, mailing address | 100% |
| Land use code, acreage | 100% |
| Geometry | 100% |
| Year built | **0%** |

---

## 2. CAD vs Regrid — Where each wins

### CAD wins big in Harris and Dallas-type counties

- **Building detail is the key differentiator.** Year built, sqft, construction type, quality grade, net rentable area, stories — none of this comes from Regrid's tile data or GeoJSON exports. The TNRIS GeoJSON files have a `year_built` field that is always empty. Regrid's API may fill some of these via enrichment, but that's a per-lookup cost.
- **Valuation granularity**: HCAD gives appraised value by tax district, per-land-parcel unit prices. Useful for tax analysis features down the road.
- **Property use classification**: HCAD uses PTAD codes directly — deterministic classification with no guesswork.
- **Cost**: Free. Harris publishes everything at pdata.hcad.org.

### Regrid wins on

- **Geometry**: CAD text files have no geometry. We still need shapefiles from the county (or Regrid) for the map. We processed both — the shapefiles we have for Harris (1.5M parcels), Galveston (189K), Chambers (37K) plus TNRIS GeoJSON for 4 other counties — and they're now in our combined PMTiles. So geometry is solved for these 7 counties.
- **Standardized schema**: Same fields across the whole US. Our setup now has 7 different field name conventions across the 10 counties in the PMTiles.
- **Mailing addresses**: Available in Regrid universally. HCAD text files don't have them (the shapefile does, but we'd need to join). The TNRIS GeoJSONs do include mailing address.
- **Maintenance**: Regrid handles data freshness. We'd be re-downloading and re-processing annually for each county.

### What about the GeoJSON counties — are we losing tax roll data?

The TNRIS GeoJSON files (Montgomery, Fort Bend, Liberty, Waller) are essentially Regrid-quality data: owner, address, values, geometry. But they're missing building characteristics (`year_built` empty, no land use codes). We are **not** losing tax roll data because there is no separate tax roll data for these counties in our possession. We only have the GeoJSON. To get richer data for these counties, we'd either need to source their CAD exports directly (each county's appraisal district) or get it through Regrid's enriched API.

---

## 3. Data Freshness

- **Texas CAD text files** (Harris, Dallas-type): Updated **annually** after the appraisal roll is certified (typically July-August). Some districts publish interim extracts during the year.
- **TNRIS GeoJSON**: Snapshots from data.texas.gov — updated quarterly-ish. The ones we have are `tax_year: 2025`.
- **County shapefiles**: Updated annually alongside the tax roll, sometimes with mid-year geometry corrections.
- **Ownership changes**: Lag real-time transactions by weeks to months. A property sold today won't show the new owner until the county processes the deed transfer.
- **Regrid**: Claims monthly-to-quarterly county-level updates. For Texas, they pull from the same CAD sources but do it systematically.

**Bottom line**: For our use case, annual refresh of CAD data is probably fine. Commercial property characteristics (sqft, year built, quality) change rarely. Ownership changes matter more, but even Regrid has the same lag to the county data.

---

## 4. Scale: 100 / 1,000 / 10,000 counties

**Current state**: 6 custom parsers for 6 Texas counties. Each is 100-200 lines of custom code because every county uses different file formats, column names, and layouts. Even within Texas we have CSV, pipe-delimited, tab-delimited, fixed-width, and certified-roll CSV formats.

**At 100 counties**: Manageable. Texas has 254 counties but the top ~20 metro counties cover the vast majority of commercial property. Figure 2-4 dev hours per new parser, 1-2 hours when a county changes their format (happens rarely). A part-time data eng task.

**At 1,000 counties**: Full-time data engineering role. You're now crossing state lines — California assessor data looks nothing like Texas CAD data. Some counties only publish PDFs. You're building format detection, validation, and monitoring infrastructure.

**At 10,000 counties**: You're building Regrid. They have a team dedicated to this across ~150M parcels. Not a feature, a company.

**The practical ceiling for DIY is probably 30-50 counties** — the major metros where the data is rich enough to justify the effort.

---

## 5. Maintenance Cost vs Regrid

### Our cost per county

- Initial parser: 2-4 dev hours
- Annual data refresh: 30 min per county (re-download + re-run + rebuild PMTiles)
- Format change response: 1-2 hours when it happens
- For current 6 parsered counties + 4 TNRIS counties: ~$1,500 initial, ~$300/year ongoing

### Regrid pricing (estimates from public info)

- Starter API: ~$200/month
- Pro/Enterprise with bulk data + tiles: $1,000-3,000/month
- National dataset license: $10,000-50,000/year

**For < 20 counties, rolling our own is dramatically cheaper.** The crossover is probably 50-100 counties factoring in opportunity cost.

---

## 6. Features Gained/Lost

### Gained

- Rich commercial building data (sqft, year built, quality, construction, NRA) — directly feeds property cards and enrichment
- Fine-grained valuation and tax district data
- Deterministic property classification via PTAD codes
- No per-API-call costs
- Full dataset available for analytics/ML

### Tooltip / hover — FIXED

This was a field name mismatch bug, not an architectural limitation. When we switched from Regrid tiles to self-hosted PMTiles, the hover code was still looking for Regrid field names (`parcelnumb`, `ll_uuid`). Our tiles use `Acct` (Dallas), `TAXPIN` (Tarrant), `HCAD_NUM` (Harris), etc. Fixed in two places in DashboardMap.ts. Also regenerated PMTiles with `--generate-ids` so the hover highlight fill works via Mapbox feature-state.

### Still missing / limitations

- No mailing addresses from HCAD text files (available in the shapefile — could join)
- No ZIP codes from HCAD text files (need geocoding pass)
- Houston parcels won't resolve to enriched property records via the tooltip until we run the CAD ingestion pipeline — but they show owner name and address from the tile data in the meantime

---

## 7. Current Tile Inventory

Combined PMTiles file (`data/gis/all_parcels.pmtiles`, 1.3 GB) serving ~4M parcels across 10 counties:

| County | Source | Parcels | Key ID Field |
|--------|--------|---------|--------------|
| Dallas (DCAD) | Shapefile | ~600K | `Acct` |
| Tarrant (TAD) | Shapefile | ~600K | `TAXPIN` |
| Collin (CCAD) | Shapefile | ~300K | `PROP_ID` |
| Harris (HCAD) | Shapefile | 1,534,573 | `HCAD_NUM` |
| Chambers | Shapefile | 37,466 | `Parcel_CAM` |
| Galveston | Shapefile | 188,666 | `GEOID` |
| Montgomery | GeoJSON (TNRIS) | 320,915 | `prop_id` |
| Fort Bend | GeoJSON (TNRIS) | 375,100 | `prop_id` |
| Liberty | GeoJSON (TNRIS) | 164,178 | `prop_id` |
| Waller | GeoJSON (TNRIS) | 48,151 | `prop_id` |

**Not yet included**: Brazoria (nested zip, needs double-extraction).

---

## 8. Recommendation

### Tiered approach

**Tier 1 — Full CAD ingestion** for Harris, Dallas, Tarrant, Collin, Denton (and eventually Fort Bend, Travis/Austin when they publish usable exports). These counties have building-level detail that is genuinely unavailable elsewhere and feeds directly into our property intelligence. This is a competitive advantage in data depth.

**Tier 2 — Regrid as base layer** for everything else. Use their tiles + API for geometry, owner, address, basic values. Supplement with CAD only when a county becomes strategically important enough to justify a custom parser.

### Tile strategy

We're now serving a combined PMTiles file (DFW + 7 Houston counties, ~4M parcels, 1.3 GB). This scales to maybe 20-30 metro areas before the file size becomes unwieldy. At that point, switching to Regrid tiles as the universal map layer (with our enriched data overlaid as property markers) would make more sense. Or hosting the PMTiles on S3/R2 with range requests rather than bundling locally.

### Key decision point

**How many markets are we planning to launch in the next 6-12 months?** If it's 3-5 Texas metros, DIY is clearly the right call. If it's 20+ markets across multiple states, we should plan the Regrid integration now as the base layer and only do custom CAD parsing for the top-value counties.
