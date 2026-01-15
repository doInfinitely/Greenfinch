import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq, or, isNull, ne } from 'drizzle-orm';
import { enrichAndStoreProperty } from '../src/lib/enrichment';

const BATCH_SIZE = 10;
const RATE_LIMIT_DELAY_MS = 2000;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBatchEnrichment() {
  console.log('[BatchEnrichment] Starting batch enrichment...');
  
  const unenrichedProperties = await db
    .select({
      id: properties.id,
      propertyKey: properties.propertyKey,
      enrichmentStatus: properties.enrichmentStatus,
    })
    .from(properties)
    .where(
      or(
        isNull(properties.enrichmentStatus),
        ne(properties.enrichmentStatus, 'completed')
      )
    )
    .limit(BATCH_SIZE);

  console.log(`[BatchEnrichment] Found ${unenrichedProperties.length} properties to enrich`);

  let succeeded = 0;
  let failed = 0;

  for (const prop of unenrichedProperties) {
    try {
      console.log(`[BatchEnrichment] Enriching property: ${prop.propertyKey}`);
      
      const dbProperty = await db
        .select()
        .from(properties)
        .where(eq(properties.propertyKey, prop.propertyKey))
        .limit(1);

      if (!dbProperty[0]) {
        console.log(`[BatchEnrichment] Property not found: ${prop.propertyKey}`);
        failed++;
        continue;
      }

      const rawParcels = (dbProperty[0].rawParcelsJson as any[]) || [];
      
      let totalParval = 0;
      let totalImprovval = 0;
      let maxLandval = 0;
      const usedesc: string[] = [];
      const usecode: string[] = [];
      const zoning: string[] = [];
      const zoningDescription: string[] = [];
      const allOwners: string[] = [];

      for (const parcel of rawParcels) {
        totalParval += parcel.parval || 0;
        totalImprovval += parcel.improvval || 0;
        maxLandval = Math.max(maxLandval, parcel.landval || 0);
        
        if (parcel.usedesc && !usedesc.includes(parcel.usedesc)) {
          usedesc.push(parcel.usedesc);
        }
        if (parcel.usecode && !usecode.includes(parcel.usecode)) {
          usecode.push(parcel.usecode);
        }
        if (parcel.zoning && !zoning.includes(parcel.zoning)) {
          zoning.push(parcel.zoning);
        }
        if (parcel.zoningDescription && !zoningDescription.includes(parcel.zoningDescription)) {
          zoningDescription.push(parcel.zoningDescription);
        }
        if (parcel.owner && !allOwners.includes(parcel.owner)) {
          allOwners.push(parcel.owner);
        }
        if (parcel.owner2 && !allOwners.includes(parcel.owner2)) {
          allOwners.push(parcel.owner2);
        }
      }

      if (dbProperty[0].regridOwner && !allOwners.includes(dbProperty[0].regridOwner)) {
        allOwners.unshift(dbProperty[0].regridOwner);
      }
      if (dbProperty[0].regridOwner2 && !allOwners.includes(dbProperty[0].regridOwner2)) {
        allOwners.push(dbProperty[0].regridOwner2);
      }

      const aggregatedProperty = {
        propertyKey: dbProperty[0].propertyKey,
        sourceLlUuid: dbProperty[0].sourceLlUuid || dbProperty[0].propertyKey,
        llStackUuid: dbProperty[0].llStackUuid || null,
        address: dbProperty[0].regridAddress || '',
        city: dbProperty[0].city || '',
        state: dbProperty[0].state || 'TX',
        zip: dbProperty[0].zip || '',
        county: dbProperty[0].county || '',
        lat: dbProperty[0].lat || 0,
        lon: dbProperty[0].lon || 0,
        lotSqft: dbProperty[0].lotSqft || 0,
        buildingSqft: dbProperty[0].buildingSqft || null,
        yearBuilt: dbProperty[0].yearBuilt || null,
        numFloors: dbProperty[0].numFloors || null,
        totalParval,
        totalImprovval,
        landval: maxLandval,
        allOwners,
        primaryOwner: allOwners[0] || dbProperty[0].regridOwner || null,
        usedesc,
        usecode,
        zoning,
        zoningDescription,
        parcelCount: rawParcels.length || 1,
        rawParcelsJson: rawParcels,
      };

      await enrichAndStoreProperty(aggregatedProperty);
      succeeded++;
      console.log(`[BatchEnrichment] Successfully enriched: ${prop.propertyKey}`);
      
      await delay(RATE_LIMIT_DELAY_MS);
    } catch (error) {
      failed++;
      console.error(`[BatchEnrichment] Failed to enrich ${prop.propertyKey}:`, error);
    }
  }

  console.log(`[BatchEnrichment] Completed. Succeeded: ${succeeded}, Failed: ${failed}`);
  process.exit(0);
}

runBatchEnrichment().catch(console.error);
