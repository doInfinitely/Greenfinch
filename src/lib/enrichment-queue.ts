import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { properties } from './schema';
import { eq, or, isNull, inArray } from 'drizzle-orm';
import { enrichAndStoreProperty } from './enrichment';
import { getPropertyByKey } from './snowflake';
import type { AggregatedProperty } from './snowflake';

const ENRICHMENT_MAX_BATCH_SIZE = parseInt(process.env.ENRICHMENT_MAX_BATCH_SIZE || '100', 10);
const RATE_LIMIT_DELAY_MS = 1000;

// Get property from Postgres and convert to AggregatedProperty format for enrichment
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
  
  // Reconstruct aggregated values from rawParcelsJson for enrichment parity with Snowflake
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

  // Also include owners from property record if not in rawParcels
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
}

export interface BatchStatus {
  batchId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: QueueProgress;
  startedAt: Date | null;
  completedAt: Date | null;
  errors: Array<{ propertyKey: string; error: string }>;
}

interface QueueItem {
  propertyKey: string;
  propertyId?: string;
}

let currentBatch: BatchStatus | null = null;
let queue: QueueItem[] = [];
let isProcessing = false;
let lastRequestTime = 0;

export function getQueueStatus(): BatchStatus | null {
  return currentBatch;
}

export function isBatchRunning(): boolean {
  return isProcessing || (currentBatch?.status === 'running');
}

export function addToQueue(items: QueueItem[]): void {
  queue.push(...items);
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    await delay(RATE_LIMIT_DELAY_MS - timeSinceLastRequest);
  }
  lastRequestTime = Date.now();
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

  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      
      try {
        await enforceRateLimit();
        
        console.log(`[EnrichmentQueue] Processing property: ${item.propertyKey}`);
        
        // Try Postgres first (for ingested properties), then fall back to Snowflake
        let property = await getPropertyFromPostgres(item.propertyKey);
        
        if (!property) {
          console.log(`[EnrichmentQueue] Property not in Postgres, trying Snowflake: ${item.propertyKey}`);
          property = await getPropertyByKey(item.propertyKey);
        }
        
        if (!property) {
          console.error(`[EnrichmentQueue] Property not found anywhere: ${item.propertyKey}`);
          if (currentBatch) {
            currentBatch.progress.processed++;
            currentBatch.progress.failed++;
            currentBatch.errors.push({
              propertyKey: item.propertyKey,
              error: 'Property not found in database',
            });
          }
          continue;
        }

        const { result } = await enrichAndStoreProperty(property);
        
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
        }

        console.log(`[EnrichmentQueue] Completed property: ${item.propertyKey} (success: ${result.success})`);
      } catch (error) {
        console.error(`[EnrichmentQueue] Error processing property ${item.propertyKey}:`, error);
        if (currentBatch) {
          currentBatch.progress.processed++;
          currentBatch.progress.failed++;
          currentBatch.errors.push({
            propertyKey: item.propertyKey,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    if (currentBatch) {
      currentBatch.status = 'completed';
      currentBatch.completedAt = new Date();
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
}

export async function startBatch(options: StartBatchOptions): Promise<BatchStatus> {
  if (isBatchRunning()) {
    throw new Error('A batch is already running. Please wait for it to complete.');
  }

  const batchId = uuidv4();
  const limit = Math.min(options.limit || ENRICHMENT_MAX_BATCH_SIZE, ENRICHMENT_MAX_BATCH_SIZE);
  
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
  };

  addToQueue(propertyKeysToEnrich.map(key => ({ propertyKey: key })));

  processQueue().catch(error => {
    console.error('[EnrichmentQueue] Background processing error:', error);
  });

  return currentBatch;
}

export function getMaxBatchSize(): number {
  return ENRICHMENT_MAX_BATCH_SIZE;
}

export async function checkRateLimitForIndividual(): Promise<boolean> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  return timeSinceLastRequest >= RATE_LIMIT_DELAY_MS;
}

export function updateLastRequestTime(): void {
  lastRequestTime = Date.now();
}
