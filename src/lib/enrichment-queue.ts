import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import { db } from './db';
import { properties } from './schema';
import { eq, or, isNull, inArray } from 'drizzle-orm';
import { enrichAndStoreProperty } from './enrichment';
import { getPropertyByKey } from './snowflake';
import type { AggregatedProperty } from './snowflake';
import { CONCURRENCY } from './constants';

const ENRICHMENT_MAX_BATCH_SIZE = parseInt(process.env.ENRICHMENT_MAX_BATCH_SIZE || '200', 10);

async function getPropertyFromPostgres(propertyKey: string): Promise<AggregatedProperty | null> {
  const [dbProperty] = await db
    .select()
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  if (!dbProperty) {
    return null;
  }

  const rawParcels = (dbProperty.rawParcelsJson as any[]) || [];
  
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

  if (dbProperty.regridOwner && !allOwners.includes(dbProperty.regridOwner)) {
    allOwners.unshift(dbProperty.regridOwner);
  }
  if (dbProperty.regridOwner2 && !allOwners.includes(dbProperty.regridOwner2)) {
    allOwners.push(dbProperty.regridOwner2);
  }

  return {
    propertyKey: dbProperty.propertyKey,
    sourceLlUuid: dbProperty.sourceLlUuid || dbProperty.propertyKey,
    llStackUuid: dbProperty.llStackUuid || null,
    address: dbProperty.regridAddress || '',
    city: dbProperty.city || '',
    state: dbProperty.state || 'TX',
    zip: dbProperty.zip || '',
    county: dbProperty.county || '',
    lat: dbProperty.lat || 0,
    lon: dbProperty.lon || 0,
    lotSqft: dbProperty.lotSqft || 0,
    buildingSqft: dbProperty.buildingSqft || null,
    yearBuilt: dbProperty.yearBuilt || null,
    numFloors: dbProperty.numFloors || null,
    totalParval,
    totalImprovval,
    landval: maxLandval,
    allOwners,
    primaryOwner: allOwners[0] || dbProperty.regridOwner || null,
    usedesc,
    usecode,
    zoning,
    zoningDescription,
    parcelCount: rawParcels.length || 1,
    rawParcelsJson: rawParcels,
  };
}

export interface QueueProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  propertiesPerMinute?: number;
  estimatedSecondsRemaining?: number;
}

export interface BatchStatus {
  batchId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: QueueProgress;
  startedAt: Date | null;
  completedAt: Date | null;
  errors: Array<{ propertyKey: string; error: string }>;
  concurrency: number;
}

interface QueueItem {
  propertyKey: string;
  propertyId?: string;
}

let currentBatch: BatchStatus | null = null;
let queue: QueueItem[] = [];
let isProcessing = false;

export function getQueueStatus(): BatchStatus | null {
  return currentBatch;
}

export function isBatchRunning(): boolean {
  return isProcessing || (currentBatch?.status === 'running');
}

export function addToQueue(items: QueueItem[]): void {
  queue.push(...items);
}

async function processPropertyItem(
  item: QueueItem,
  startTime: number
): Promise<{ success: boolean; error?: string }> {
  try {
    let property = await getPropertyFromPostgres(item.propertyKey);
    
    if (!property) {
      console.log(`[EnrichmentQueue] Property not in Postgres, trying Snowflake: ${item.propertyKey}`);
      property = await getPropertyByKey(item.propertyKey);
    }
    
    if (!property) {
      return { success: false, error: 'Property not found in database' };
    }

    const { result } = await enrichAndStoreProperty(property);
    return { success: result.success, error: result.error };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

function updateProgressStats(startTime: number): void {
  if (!currentBatch) return;
  
  const elapsedMs = Date.now() - startTime;
  const elapsedMinutes = elapsedMs / 60000;
  
  if (elapsedMinutes > 0 && currentBatch.progress.processed > 0) {
    currentBatch.progress.propertiesPerMinute = Math.round(
      currentBatch.progress.processed / elapsedMinutes
    );
    
    const remaining = currentBatch.progress.total - currentBatch.progress.processed;
    if (currentBatch.progress.propertiesPerMinute > 0) {
      currentBatch.progress.estimatedSecondsRemaining = Math.round(
        (remaining / currentBatch.progress.propertiesPerMinute) * 60
      );
    }
  }
}

export async function processQueue(): Promise<void> {
  if (isProcessing) {
    console.log('[EnrichmentQueue] Already processing, skipping');
    return;
  }

  if (queue.length === 0) {
    console.log('[EnrichmentQueue] Queue is empty');
    return;
  }

  isProcessing = true;
  const startTime = Date.now();
  const concurrencyLimit = currentBatch?.concurrency || CONCURRENCY.PROPERTIES;
  const limit = pLimit(concurrencyLimit);
  
  console.log(`[EnrichmentQueue] Starting parallel processing with concurrency=${concurrencyLimit}`);

  try {
    const items = [...queue];
    queue = [];
    
    const promises = items.map((item, index) =>
      limit(async () => {
        const itemStart = Date.now();
        console.log(`[EnrichmentQueue] [${index + 1}/${items.length}] Processing: ${item.propertyKey}`);
        
        const result = await processPropertyItem(item, startTime);
        
        if (currentBatch) {
          currentBatch.progress.processed++;
          if (result.success) {
            currentBatch.progress.succeeded++;
          } else {
            currentBatch.progress.failed++;
            currentBatch.errors.push({
              propertyKey: item.propertyKey,
              error: result.error || 'Unknown error',
            });
          }
          updateProgressStats(startTime);
        }
        
        const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
        const status = result.success ? 'SUCCESS' : 'FAILED';
        const ppm = currentBatch?.progress.propertiesPerMinute || 0;
        const eta = currentBatch?.progress.estimatedSecondsRemaining;
        const etaStr = eta ? `ETA: ${Math.round(eta / 60)}m ${eta % 60}s` : '';
        
        console.log(`[EnrichmentQueue] [${index + 1}/${items.length}] ${status} (${elapsed}s) | Rate: ${ppm}/min | ${etaStr}`);
        
        return result;
      })
    );

    await Promise.all(promises);

    if (currentBatch) {
      currentBatch.status = 'completed';
      currentBatch.completedAt = new Date();
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalRate = currentBatch.progress.propertiesPerMinute || 0;
      console.log(`[EnrichmentQueue] Batch complete: ${currentBatch.progress.succeeded}/${currentBatch.progress.total} succeeded in ${totalTime}s (${finalRate}/min)`);
    }
  } catch (error) {
    console.error('[EnrichmentQueue] Queue processing failed:', error);
    if (currentBatch) {
      currentBatch.status = 'failed';
      currentBatch.completedAt = new Date();
    }
  } finally {
    isProcessing = false;
  }
}

export interface StartBatchOptions {
  propertyIds?: string[];
  propertyKeys?: string[];
  limit?: number;
  onlyUnenriched?: boolean;
  concurrency?: number;
}

export async function startBatch(options: StartBatchOptions): Promise<BatchStatus> {
  if (isBatchRunning()) {
    throw new Error('A batch is already running. Please wait for it to complete.');
  }

  const batchId = uuidv4();
  const limit = Math.min(options.limit || ENRICHMENT_MAX_BATCH_SIZE, ENRICHMENT_MAX_BATCH_SIZE);
  const concurrency = options.concurrency || CONCURRENCY.PROPERTIES;
  
  let propertyKeysToEnrich: string[] = [];

  if (options.propertyKeys && options.propertyKeys.length > 0) {
    propertyKeysToEnrich = options.propertyKeys.slice(0, limit);
  } else if (options.propertyIds && options.propertyIds.length > 0) {
    const propertiesFromDb = await db.query.properties.findMany({
      where: inArray(properties.id, options.propertyIds.slice(0, limit)),
      columns: { propertyKey: true },
    });
    propertyKeysToEnrich = propertiesFromDb.map(p => p.propertyKey);
  } else if (options.onlyUnenriched) {
    const unenrichedProperties = await db.query.properties.findMany({
      where: or(
        isNull(properties.enrichmentStatus),
        eq(properties.enrichmentStatus, 'pending'),
        eq(properties.enrichmentStatus, 'enriched')
      ),
      columns: { propertyKey: true },
      limit,
    });
    propertyKeysToEnrich = unenrichedProperties.map(p => p.propertyKey);
  }

  if (propertyKeysToEnrich.length === 0) {
    throw new Error('No properties found to enrich');
  }

  queue = [];
  currentBatch = {
    batchId,
    status: 'running',
    progress: {
      total: propertyKeysToEnrich.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
    },
    startedAt: new Date(),
    completedAt: null,
    errors: [],
    concurrency,
  };

  console.log(`[EnrichmentQueue] Starting batch ${batchId}: ${propertyKeysToEnrich.length} properties with concurrency=${concurrency}`);

  addToQueue(propertyKeysToEnrich.map(key => ({ propertyKey: key })));

  processQueue().catch(error => {
    console.error('[EnrichmentQueue] Background processing error:', error);
  });

  return currentBatch;
}

export function getMaxBatchSize(): number {
  return ENRICHMENT_MAX_BATCH_SIZE;
}
