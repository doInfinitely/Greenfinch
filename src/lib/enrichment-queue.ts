import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import { db } from './db';
import { properties } from './schema';
import { eq, or, and, isNull, inArray } from 'drizzle-orm';
import { runFocusedEnrichment } from './ai-enrichment';
import { getPropertyByKey } from './snowflake';
import type { AggregatedProperty } from './snowflake';
import { CONCURRENCY } from './constants';
import { 
  isRedisConfigured, 
  acquireLock, 
  releaseLock, 
  hashSet, 
  hashGet, 
  hashGetAll,
  hashDelete,
  queueStateGet, 
  queueStateSet,
  queueStateDelete 
} from './redis';

const ENRICHMENT_MAX_BATCH_SIZE = parseInt(process.env.ENRICHMENT_MAX_BATCH_SIZE || '200', 10);

// Keys without prefix - queueStateGet/Set adds 'gf:queue:' prefix, acquireLock adds 'gf:lock:' prefix
const REDIS_BATCH_KEY = 'enrichment:batch';
const REDIS_QUEUE_KEY = 'enrichment:items';
const REDIS_LOCK_KEY = 'enrichment:batch';
const REDIS_RATE_LIMIT_KEY = 'enrichment:last_request';

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

// In-memory fallback state (used when Redis is not configured)
let memoryBatch: BatchStatus | null = null;
let memoryQueue: QueueItem[] = [];
let memoryIsProcessing = false;
let memoryLastRequestTime = 0;
let memoryBatchStartLock = false;
const INDIVIDUAL_RATE_LIMIT_MS = 2000; // 2 seconds between individual requests
const BATCH_LOCK_TTL_SECONDS = 300; // 5 minute lock for batch operations

// Redis-backed state management with in-memory fallback
async function getBatchStatus(): Promise<BatchStatus | null> {
  if (isRedisConfigured()) {
    return await queueStateGet<BatchStatus>(REDIS_BATCH_KEY);
  }
  return memoryBatch;
}

async function setBatchStatus(batch: BatchStatus): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateSet(REDIS_BATCH_KEY, batch, 3600); // 1 hour TTL
  }
  memoryBatch = batch;
}

async function clearBatchStatus(): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateDelete(REDIS_BATCH_KEY);
  }
  memoryBatch = null;
}

async function getQueueItems(): Promise<QueueItem[]> {
  if (isRedisConfigured()) {
    const items = await queueStateGet<QueueItem[]>(REDIS_QUEUE_KEY);
    return items || [];
  }
  return memoryQueue;
}

async function setQueueItems(items: QueueItem[]): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateSet(REDIS_QUEUE_KEY, items, 3600);
  }
  memoryQueue = items;
}

async function getLastRequestTime(): Promise<number> {
  if (isRedisConfigured()) {
    const time = await queueStateGet<number>(REDIS_RATE_LIMIT_KEY);
    return time || 0;
  }
  return memoryLastRequestTime;
}

async function setLastRequestTime(time: number): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateSet(REDIS_RATE_LIMIT_KEY, time, 60); // 1 minute TTL
  }
  memoryLastRequestTime = time;
}

export async function getQueueStatus(): Promise<BatchStatus | null> {
  return getBatchStatus();
}

export async function isBatchRunning(): Promise<boolean> {
  const batch = await getBatchStatus();
  if (isRedisConfigured()) {
    return batch?.status === 'running';
  }
  return memoryIsProcessing || (batch?.status === 'running');
}

export async function checkRateLimitForIndividual(): Promise<boolean> {
  const now = Date.now();
  const lastTime = await getLastRequestTime();
  return now - lastTime >= INDIVIDUAL_RATE_LIMIT_MS;
}

export async function updateLastRequestTime(): Promise<void> {
  await setLastRequestTime(Date.now());
}

export async function addToQueue(items: QueueItem[]): Promise<void> {
  const currentQueue = await getQueueItems();
  await setQueueItems([...currentQueue, ...items]);
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

    const dcadProperty = (property as any).dcad || {
      parcelId: property.propertyKey,
      address: property.address,
      city: property.city,
      zip: property.zip,
      lat: property.lat,
      lon: property.lon,
      usedesc: property.usedesc?.[0] || '',
      usecode: property.usecode?.[0] || '',
      regridYearBuilt: property.yearBuilt || null,
      regridNumStories: property.numFloors || null,
      lotSqft: property.lotSqft || null,
      accountNum: '',
      divisionCd: 'COM',
      bizName: property.primaryOwner || null,
      ownerName1: property.allOwners?.[0] || null,
      ownerName2: property.allOwners?.[1] || null,
      buildingCount: 1,
      totalGrossBldgArea: property.buildingSqft || null,
      buildings: [],
    };
    await runFocusedEnrichment(dcadProperty as any);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

function updateProgressStats(batch: BatchStatus, startTime: number): void {
  const elapsedMs = Date.now() - startTime;
  const elapsedMinutes = elapsedMs / 60000;
  
  if (elapsedMinutes > 0 && batch.progress.processed > 0) {
    batch.progress.propertiesPerMinute = Math.round(
      batch.progress.processed / elapsedMinutes
    );
    
    const remaining = batch.progress.total - batch.progress.processed;
    if (batch.progress.propertiesPerMinute > 0) {
      batch.progress.estimatedSecondsRemaining = Math.round(
        (remaining / batch.progress.propertiesPerMinute) * 60
      );
    }
  }
}

export async function processQueue(): Promise<void> {
  // Check if already processing
  if (await isBatchRunning()) {
    console.log('[EnrichmentQueue] Already processing, skipping');
    return;
  }

  const queue = await getQueueItems();
  if (queue.length === 0) {
    console.log('[EnrichmentQueue] Queue is empty');
    return;
  }

  // For in-memory mode, set the flag
  memoryIsProcessing = true;
  return processQueueInternal();
}

async function processQueueInternal(): Promise<void> {
  const startTime = Date.now();
  let batch = await getBatchStatus();
  const concurrencyLimit = batch?.concurrency || CONCURRENCY.PROPERTIES;
  const limit = pLimit(concurrencyLimit);
  
  console.log(`[EnrichmentQueue] Starting parallel processing with concurrency=${concurrencyLimit}`);

  try {
    const items = await getQueueItems();
    await setQueueItems([]); // Clear queue
    
    const promises = items.map((item, index) =>
      limit(async () => {
        const itemStart = Date.now();
        console.log(`[EnrichmentQueue] [${index + 1}/${items.length}] Processing: ${item.propertyKey}`);
        
        const result = await processPropertyItem(item, startTime);
        
        // Re-fetch batch status to get latest state (for distributed updates)
        batch = await getBatchStatus();
        if (batch) {
          batch.progress.processed++;
          if (result.success) {
            batch.progress.succeeded++;
          } else {
            batch.progress.failed++;
            batch.errors.push({
              propertyKey: item.propertyKey,
              error: result.error || 'Unknown error',
            });
          }
          updateProgressStats(batch, startTime);
          await setBatchStatus(batch); // Persist updated status
        }
        
        const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
        const status = result.success ? 'SUCCESS' : 'FAILED';
        const ppm = batch?.progress.propertiesPerMinute || 0;
        const eta = batch?.progress.estimatedSecondsRemaining;
        const etaStr = eta ? `ETA: ${Math.round(eta / 60)}m ${eta % 60}s` : '';
        
        console.log(`[EnrichmentQueue] [${index + 1}/${items.length}] ${status} (${elapsed}s) | Rate: ${ppm}/min | ${etaStr}`);
        
        return result;
      })
    );

    await Promise.all(promises);

    batch = await getBatchStatus();
    if (batch) {
      batch.status = 'completed';
      batch.completedAt = new Date();
      await setBatchStatus(batch);
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalRate = batch.progress.propertiesPerMinute || 0;
      console.log(`[EnrichmentQueue] Batch complete: ${batch.progress.succeeded}/${batch.progress.total} succeeded in ${totalTime}s (${finalRate}/min)`);
    }
    
    // Release distributed lock if using Redis
    if (isRedisConfigured()) {
      await releaseLock(REDIS_LOCK_KEY);
    }
  } catch (error) {
    console.error('[EnrichmentQueue] Queue processing failed:', error);
    batch = await getBatchStatus();
    if (batch) {
      batch.status = 'failed';
      batch.completedAt = new Date();
      await setBatchStatus(batch);
    }
    if (isRedisConfigured()) {
      await releaseLock(REDIS_LOCK_KEY);
    }
  } finally {
    memoryIsProcessing = false;
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
  // Try to acquire distributed lock (Redis) or in-memory lock
  if (isRedisConfigured()) {
    const lockAcquired = await acquireLock(REDIS_LOCK_KEY, BATCH_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      throw new Error('Another batch start is in progress. Please wait.');
    }
  } else {
    if (memoryBatchStartLock) {
      throw new Error('Another batch start is in progress. Please wait.');
    }
    memoryBatchStartLock = true;
  }
  
  try {
    if (await isBatchRunning()) {
      throw new Error('A batch is already running. Please wait for it to complete.');
    }

    const batchId = uuidv4();
    const batchLimit = Math.min(options.limit || ENRICHMENT_MAX_BATCH_SIZE, ENRICHMENT_MAX_BATCH_SIZE);
    const concurrency = options.concurrency || CONCURRENCY.PROPERTIES;
    
    let propertyKeysToEnrich: string[] = [];

    if (options.propertyKeys && options.propertyKeys.length > 0) {
      propertyKeysToEnrich = options.propertyKeys.slice(0, batchLimit);
    } else if (options.propertyIds && options.propertyIds.length > 0) {
      const propertiesFromDb = await db.query.properties.findMany({
        where: inArray(properties.id, options.propertyIds.slice(0, batchLimit)),
        columns: { propertyKey: true },
      });
      propertyKeysToEnrich = propertiesFromDb.map(p => p.propertyKey);
    } else if (options.onlyUnenriched) {
      // Only enrich parent properties (not constituents like parking decks)
      const unenrichedProperties = await db.query.properties.findMany({
        where: and(
          eq(properties.isParentProperty, true),
          or(
            isNull(properties.enrichmentStatus),
            eq(properties.enrichmentStatus, 'pending'),
            eq(properties.enrichmentStatus, 'enriched')
          )
        ),
        columns: { propertyKey: true },
        limit: batchLimit,
      });
      propertyKeysToEnrich = unenrichedProperties.map(p => p.propertyKey);
    }

    if (propertyKeysToEnrich.length === 0) {
      throw new Error('No properties found to enrich');
    }

    const newBatch: BatchStatus = {
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
    
    // Clear queue and set batch status
    await setQueueItems([]);
    await setBatchStatus(newBatch);

    console.log(`[EnrichmentQueue] Starting batch ${batchId}: ${propertyKeysToEnrich.length} properties with concurrency=${concurrency}`);

    await addToQueue(propertyKeysToEnrich.map(key => ({ propertyKey: key })));

    // Set in-memory processing flag for fallback mode
    memoryIsProcessing = true;
    
    // Start background processing
    processQueueInternal().catch(async (error) => {
      console.error('[EnrichmentQueue] Background processing error:', error);
      memoryIsProcessing = false;
      const batch = await getBatchStatus();
      if (batch) {
        batch.status = 'failed';
        batch.completedAt = new Date();
        await setBatchStatus(batch);
      }
      if (isRedisConfigured()) {
        await releaseLock(REDIS_LOCK_KEY);
      }
    });

    return newBatch;
  } finally {
    // Release in-memory lock (Redis lock is held until processing completes)
    if (!isRedisConfigured()) {
      memoryBatchStartLock = false;
    }
  }
}

export function getMaxBatchSize(): number {
  return ENRICHMENT_MAX_BATCH_SIZE;
}
