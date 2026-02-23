import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { getBullMQRedisConfig, isBullMQConfigured } from './bullmq-connection';
import { db } from './db';
import { properties } from './schema';
import { eq, or, and, isNull, inArray } from 'drizzle-orm';
import { CONCURRENCY } from './constants';

const QUEUE_NAME = 'gf-enrichment';
const BATCH_META_PREFIX = 'gf:batch:';

let enrichmentQueue: Queue | null = null;
let enrichmentWorker: Worker | null = null;
let queueEvents: QueueEvents | null = null;
let metaRedis: IORedis | null = null;

function getMetaRedis(): IORedis {
  if (metaRedis) return metaRedis;
  const config = getBullMQRedisConfig();
  metaRedis = new IORedis(config);
  return metaRedis;
}

export interface BullMQBatchStatus {
  batchId: string;
  status: 'running' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    propertiesPerMinute?: number;
    estimatedSecondsRemaining?: number;
  };
  startedAt: Date | null;
  completedAt: Date | null;
  errors: Array<{ propertyKey: string; error: string; stage?: string; retryable?: boolean }>;
  concurrency: number;
}

interface EnrichmentJobData {
  propertyKey: string;
  batchId: string;
}

function getQueue(): Queue {
  if (!enrichmentQueue) {
    enrichmentQueue = new Queue(QUEUE_NAME, {
      connection: getBullMQRedisConfig() as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { count: 1000, age: 3600 },
        removeOnFail: { count: 2000, age: 86400 },
      },
    });
  }
  return enrichmentQueue;
}

async function getBatchMeta(batchId: string): Promise<BullMQBatchStatus | null> {
  try {
    const redis = getMetaRedis();
    const raw = await redis.get(`${BATCH_META_PREFIX}${batchId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setBatchMeta(batch: BullMQBatchStatus): Promise<void> {
  try {
    const redis = getMetaRedis();
    await redis.set(
      `${BATCH_META_PREFIX}${batch.batchId}`,
      JSON.stringify(batch),
      'EX',
      7200
    );
  } catch (err) {
    console.error('[BullMQ] Error saving batch meta:', err);
  }
}

async function getActiveBatchId(): Promise<string | null> {
  try {
    const redis = getMetaRedis();
    return await redis.get('gf:active_batch_id');
  } catch {
    return null;
  }
}

async function setActiveBatchId(batchId: string | null): Promise<void> {
  try {
    const redis = getMetaRedis();
    if (batchId) {
      await redis.set('gf:active_batch_id', batchId, 'EX', 7200);
    } else {
      await redis.del('gf:active_batch_id');
    }
  } catch (err) {
    console.error('[BullMQ] Error setting active batch:', err);
  }
}

async function updateBatchProgress(batchId: string, propertyKey: string, success: boolean, error?: string, failedStage?: string, isRetryable?: boolean): Promise<void> {
  const batch = await getBatchMeta(batchId);
  if (!batch) return;

  batch.progress.processed++;
  if (success) {
    batch.progress.succeeded++;
  } else {
    batch.progress.failed++;
    batch.errors.push({
      propertyKey,
      error: error || 'Unknown error',
      stage: failedStage,
      retryable: isRetryable,
    });
  }

  const elapsedMs = Date.now() - new Date(batch.startedAt!).getTime();
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

  if (batch.progress.processed >= batch.progress.total) {
    batch.status = 'completed';
    batch.completedAt = new Date();
    await setActiveBatchId(null);
    console.log(`[BullMQ] Batch ${batchId} completed: ${batch.progress.succeeded}/${batch.progress.total} succeeded`);
  }

  await setBatchMeta(batch);
}

async function processJobHandler(job: Job<EnrichmentJobData>): Promise<{ propertyKey: string; success: boolean }> {
  const { propertyKey, batchId } = job.data;
  const maxAttempts = job.opts?.attempts || 3;
  const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
  const itemStart = Date.now();

  console.log(`[BullMQ Worker] Processing job ${job.id}: ${propertyKey} (attempt ${job.attemptsMade + 1}/${maxAttempts}, batch: ${batchId})`);

  const { processPropertyItem } = await import('./enrichment-queue');

  const result = await processPropertyItem(
    { propertyKey, retryAttempt: job.attemptsMade },
    itemStart
  );

  const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);

  if (result.success) {
    await updateBatchProgress(batchId, propertyKey, true);
    console.log(`[BullMQ Worker] SUCCESS ${propertyKey} in ${elapsed}s`);
    return { propertyKey, success: true };
  }

  if (isFinalAttempt) {
    await updateBatchProgress(batchId, propertyKey, false, result.error, result.failedStage, result.isRetryable);
    console.log(`[BullMQ Worker] FAILED (final) ${propertyKey} in ${elapsed}s: ${result.error}`);
  } else {
    console.log(`[BullMQ Worker] FAILED (will retry) ${propertyKey} in ${elapsed}s: ${result.error}`);
  }

  throw new Error(result.error || 'Enrichment failed');
}

function createWorker(concurrency: number): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    processJobHandler,
    {
      connection: getBullMQRedisConfig() as any,
      concurrency,
      lockDuration: 600000,
      stalledInterval: 300000,
    }
  );

  worker.on('ready', () => {
    console.log(`[BullMQ] Worker ready (concurrency=${concurrency}, lockDuration=600s, stalledInterval=300s)`);
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { propertyKey } = job.data as EnrichmentJobData;
    console.error(`[BullMQ Worker] Job failed (attempt ${job.attemptsMade}/${job.opts?.attempts || 3}): ${propertyKey} - ${err.message}`);
  });

  worker.on('stalled', (jobId: string) => {
    console.warn(`[BullMQ Worker] Job stalled (lock expired): ${jobId} — this usually means a Gemini call exceeded the lock duration`);
  });

  worker.on('error', (err) => {
    console.error('[BullMQ Worker] Error:', err.message);
  });

  return worker;
}

export function initEnrichmentWorker(): void {
  if (!isBullMQConfigured()) {
    console.log('[BullMQ] Not configured, skipping worker init');
    return;
  }

  if (enrichmentWorker) {
    console.log('[BullMQ] Worker already initialized');
    return;
  }

  enrichmentWorker = createWorker(CONCURRENCY.PROPERTIES);
  console.log('[BullMQ] Enrichment worker initialized');
}

export interface StartBullMQBatchOptions {
  propertyIds?: string[];
  propertyKeys?: string[];
  limit?: number;
  onlyUnenriched?: boolean;
  concurrency?: number;
}

const ENRICHMENT_MAX_BATCH_SIZE = parseInt(process.env.ENRICHMENT_MAX_BATCH_SIZE || '200', 10);

export async function startBullMQBatch(options: StartBullMQBatchOptions): Promise<BullMQBatchStatus> {
  if (!isBullMQConfigured()) {
    throw new Error('BullMQ is not configured. Set UPSTASH_REDIS_HOST and UPSTASH_REDIS_PASSWORD.');
  }

  const existingBatchId = await getActiveBatchId();
  if (existingBatchId) {
    const existingBatch = await getBatchMeta(existingBatchId);
    if (existingBatch && existingBatch.status === 'running') {
      throw new Error(`Batch ${existingBatchId} is already running. Wait for it to complete or cancel it.`);
    }
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
    const unenrichedProperties = await db.query.properties.findMany({
      where: and(
        eq(properties.isParentProperty, true),
        or(
          isNull(properties.enrichmentStatus),
          eq(properties.enrichmentStatus, 'pending'),
          eq(properties.enrichmentStatus, 'partial')
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

  if (enrichmentWorker) {
    await enrichmentWorker.close();
    enrichmentWorker = null;
  }
  enrichmentWorker = createWorker(concurrency);

  const batch: BullMQBatchStatus = {
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

  await setBatchMeta(batch);
  await setActiveBatchId(batchId);

  const queue = getQueue();
  const jobs = propertyKeysToEnrich.map((propertyKey, index) => ({
    name: 'enrich-property',
    data: { propertyKey, batchId } as EnrichmentJobData,
    opts: {
      jobId: `${batchId}--${propertyKey}`,
      priority: index,
    },
  }));

  await queue.addBulk(jobs);

  console.log(`[BullMQ] Batch ${batchId}: enqueued ${propertyKeysToEnrich.length} properties with concurrency=${concurrency}`);

  return batch;
}

export async function getBullMQBatchStatus(): Promise<BullMQBatchStatus | null> {
  if (!isBullMQConfigured()) return null;

  const batchId = await getActiveBatchId();
  if (!batchId) {
    const redis = getMetaRedis();
    const keys = await redis.keys(`${BATCH_META_PREFIX}*`);
    if (keys.length === 0) return null;

    keys.sort().reverse();
    const raw = await redis.get(keys[0]);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  return getBatchMeta(batchId);
}

export async function isBullMQBatchRunning(): Promise<boolean> {
  if (!isBullMQConfigured()) return false;

  const batchId = await getActiveBatchId();
  if (!batchId) return false;

  const batch = await getBatchMeta(batchId);
  if (!batch) return false;

  if (batch.status !== 'running') return false;

  const startedAt = batch.startedAt ? new Date(batch.startedAt).getTime() : 0;
  const elapsed = Date.now() - startedAt;
  const STALE_TIMEOUT = 30 * 60 * 1000;
  if (elapsed > STALE_TIMEOUT && batch.progress.processed === 0) {
    console.warn(`[BullMQ] Stale batch ${batchId} detected (${Math.round(elapsed / 1000)}s with 0 progress). Marking failed.`);
    batch.status = 'failed';
    batch.completedAt = new Date();
    batch.errors.push({ propertyKey: '', error: 'Batch became stale (no progress)' });
    await setBatchMeta(batch);
    await setActiveBatchId(null);
    return false;
  }

  return true;
}

export async function cancelBullMQBatch(): Promise<{ cancelled: boolean; message: string }> {
  if (!isBullMQConfigured()) {
    return { cancelled: false, message: 'BullMQ not configured' };
  }

  const batchId = await getActiveBatchId();
  if (!batchId) {
    return { cancelled: false, message: 'No active batch to cancel' };
  }

  const batch = await getBatchMeta(batchId);
  if (!batch || batch.status !== 'running') {
    await setActiveBatchId(null);
    return { cancelled: false, message: 'No running batch to cancel' };
  }

  const queue = getQueue();

  const waiting = await queue.getWaiting();
  let removed = 0;
  for (const job of waiting) {
    if (job.data.batchId === batchId) {
      await job.remove();
      removed++;
    }
  }

  const delayed = await queue.getDelayed();
  for (const job of delayed) {
    if (job.data.batchId === batchId) {
      await job.remove();
      removed++;
    }
  }

  batch.status = 'failed';
  batch.completedAt = new Date();
  batch.errors.push({ propertyKey: '', error: 'Manually cancelled by admin' });
  await setBatchMeta(batch);
  await setActiveBatchId(null);

  console.log(`[BullMQ] Batch ${batchId} cancelled. Removed ${removed} pending jobs. Processed ${batch.progress.processed}/${batch.progress.total}.`);

  return {
    cancelled: true,
    message: `Batch ${batchId} cancelled. Removed ${removed} pending jobs. Processed ${batch.progress.processed}/${batch.progress.total}.`,
  };
}

export async function shutdownBullMQ(): Promise<void> {
  if (enrichmentWorker) {
    await enrichmentWorker.close();
    enrichmentWorker = null;
  }
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (enrichmentQueue) {
    await enrichmentQueue.close();
    enrichmentQueue = null;
  }
  if (metaRedis) {
    await metaRedis.quit();
    metaRedis = null;
  }
}
