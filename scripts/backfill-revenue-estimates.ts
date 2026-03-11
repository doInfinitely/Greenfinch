/**
 * Backfill revenue estimates for properties where revenueEstimates IS NULL.
 * Pure computation — no API calls. Idempotent and safe to re-run.
 *
 * Usage: npx tsx scripts/backfill-revenue-estimates.ts
 */

import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { estimateRevenue, type RevenueEstimationInput } from '../src/lib/revenue-estimation';
import { isNull, eq, and, sql } from 'drizzle-orm';

const BATCH_SIZE = 500;

async function backfill() {
  let processed = 0;
  let estimated = 0;
  let skipped = 0;

  // Count total to process
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(properties)
    .where(and(
      isNull(properties.revenueEstimates),
      eq(properties.isActive, true),
    ));

  console.log(`[Backfill] Found ${count} properties without revenue estimates`);

  while (true) {
    const batch = await db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        lotSqft: properties.lotSqft,
        buildingSqft: properties.buildingSqft,
        dcadParkingSqft: properties.dcadParkingSqft,
        dcadRentableArea: properties.dcadRentableArea,
        dcadTotalUnits: properties.dcadTotalUnits,
        yearBuilt: properties.yearBuilt,
        calculatedBuildingClass: properties.calculatedBuildingClass,
        assetCategory: properties.assetCategory,
        assetSubcategory: properties.assetSubcategory,
        numFloors: properties.numFloors,
        dcadTotalVal: properties.dcadTotalVal,
      })
      .from(properties)
      .where(and(
        isNull(properties.revenueEstimates),
        eq(properties.isActive, true),
      ))
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    for (const prop of batch) {
      processed++;

      const input: RevenueEstimationInput = {
        lotSqft: prop.lotSqft,
        buildingSqft: prop.buildingSqft,
        dcadParkingSqft: prop.dcadParkingSqft,
        dcadRentableArea: prop.dcadRentableArea,
        dcadTotalUnits: prop.dcadTotalUnits,
        yearBuilt: prop.yearBuilt,
        calculatedBuildingClass: prop.calculatedBuildingClass,
        assetCategory: prop.assetCategory,
        assetSubcategory: prop.assetSubcategory,
        numFloors: prop.numFloors,
        dcadTotalVal: prop.dcadTotalVal,
      };

      const result = estimateRevenue(input);

      if (result.totalAllServices === 0) {
        // Store empty estimates so we don't re-process
        await db.update(properties)
          .set({
            revenueEstimates: {},
            revenueEstimateTotal: 0,
            revenueEstimateRationale: {},
            revenueEstimatesUpdatedAt: new Date(),
          })
          .where(eq(properties.id, prop.id));
        skipped++;
        continue;
      }

      const estimateValues: Record<string, number> = {};
      const rationaleValues: Record<string, string> = {};
      for (const [svc, est] of Object.entries(result.estimates)) {
        estimateValues[svc] = est!.annualValue;
        rationaleValues[svc] = est!.rationale;
      }

      await db.update(properties)
        .set({
          revenueEstimates: estimateValues,
          revenueEstimateTotal: result.totalAllServices,
          revenueEstimateRationale: rationaleValues,
          revenueEstimatesUpdatedAt: new Date(),
        })
        .where(eq(properties.id, prop.id));

      estimated++;
    }

    console.log(`[Backfill] Processed ${processed}/${count} (${estimated} estimated, ${skipped} empty)`);
  }

  console.log(`[Backfill] Done. ${estimated} estimated, ${skipped} empty out of ${processed} total.`);
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });
