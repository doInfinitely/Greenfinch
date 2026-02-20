import * as fs from 'fs';
import { startBatch, getQueueStatus, isBatchRunning, cancelBatch } from '../src/lib/enrichment-queue';

const BATCH_SIZE = 50;
const CONCURRENCY = 10;
const POLL_INTERVAL_MS = 15000;
const LOG_FILE = '/tmp/batch-test-50.log';

function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

async function pollStatus(): Promise<boolean> {
  const status = await getQueueStatus();
  if (!status) {
    log('[Test] No batch status found');
    return false;
  }

  const pct = status.progress.total > 0 
    ? Math.round((status.progress.processed / status.progress.total) * 100) 
    : 0;
  
  const elapsed = status.startedAt 
    ? Math.round((Date.now() - new Date(status.startedAt).getTime()) / 1000) 
    : 0;
  const elapsedMin = Math.floor(elapsed / 60);
  const elapsedSec = elapsed % 60;

  log(`[Test] Status: ${status.status} | ${pct}% (${status.progress.processed}/${status.progress.total}) | OK: ${status.progress.succeeded} | FAIL: ${status.progress.failed} | Elapsed: ${elapsedMin}m ${elapsedSec}s`);

  if ((status.progress as any).propertiesPerMinute) {
    log(`[Test] Rate: ${(status.progress as any).propertiesPerMinute}/min | ETA: ${(status.progress as any).estimatedSecondsRemaining ? Math.round((status.progress as any).estimatedSecondsRemaining) + 's' : 'unknown'}`);
  }

  if (status.errors.length > 0) {
    const recentErrors = status.errors.slice(-3);
    for (const err of recentErrors) {
      log(`[Test] ERROR: ${err.propertyKey} | stage: ${err.stage || 'unknown'} | retryable: ${err.retryable ?? 'unknown'} | ${err.error.substring(0, 120)}`);
    }
  }

  if (status.status === 'completed' || status.status === 'failed') {
    return true;
  }

  return false;
}

function buildSummary(errors: Array<{ propertyKey: string; error: string; stage?: string; retryable?: boolean }>) {
  const stageBreakdown: Record<string, number> = {};
  const serviceBreakdown: Record<string, number> = {};
  let retryableCount = 0;
  let permanentCount = 0;

  for (const err of errors) {
    if (err.stage) {
      stageBreakdown[err.stage] = (stageBreakdown[err.stage] || 0) + 1;
    }

    const msg = err.error.toLowerCase();
    if (msg.includes('gemini') || msg.includes('google')) {
      serviceBreakdown['gemini'] = (serviceBreakdown['gemini'] || 0) + 1;
    } else if (msg.includes('findymail')) {
      serviceBreakdown['findymail'] = (serviceBreakdown['findymail'] || 0) + 1;
    } else if (msg.includes('pdl') || msg.includes('people data')) {
      serviceBreakdown['pdl'] = (serviceBreakdown['pdl'] || 0) + 1;
    } else if (msg.includes('crustdata')) {
      serviceBreakdown['crustdata'] = (serviceBreakdown['crustdata'] || 0) + 1;
    } else if (msg.includes('timeout')) {
      serviceBreakdown['timeout'] = (serviceBreakdown['timeout'] || 0) + 1;
    } else if (msg.includes('circuit breaker')) {
      serviceBreakdown['circuit_breaker'] = (serviceBreakdown['circuit_breaker'] || 0) + 1;
    } else {
      serviceBreakdown['other'] = (serviceBreakdown['other'] || 0) + 1;
    }

    if (err.retryable) retryableCount++;
    else permanentCount++;
  }

  return { stageBreakdown, serviceBreakdown, retryableCount, permanentCount };
}

const mode = process.argv[2] || 'start';

async function main() {
  if (mode === 'status') {
    const done = await pollStatus();
    if (done) {
      log('[Test] Batch is finished.');
      const finalStatus = await getQueueStatus();
      if (finalStatus) printFinalReport(finalStatus);
    }
    process.exit(0);
  }

  if (mode === 'cancel') {
    log('[Test] Cancelling any running batch...');
    const result = await cancelBatch();
    log(`[Test] ${JSON.stringify(result)}`);
    process.exit(0);
  }

  fs.writeFileSync(LOG_FILE, '');

  log('='.repeat(80));
  log(`[Test] Starting batch enrichment test: ${BATCH_SIZE} properties, concurrency=${CONCURRENCY}`);
  log('='.repeat(80));

  const running = await isBatchRunning();
  if (running) {
    log('[Test] A batch is already running. Cancelling stale batch first...');
    await cancelBatch();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  try {
    const batch = await startBatch({
      limit: BATCH_SIZE,
      onlyUnenriched: true,
      concurrency: CONCURRENCY,
    });
    log(`[Test] Batch started: ${batch.batchId}`);
    log(`[Test] Properties queued: ${batch.progress.total}`);
    log(`[Test] Concurrency: ${batch.concurrency}`);
  } catch (error) {
    log(`[Test] Failed to start batch: ${error}`);
    process.exit(1);
  }

  log(`[Test] Polling every ${POLL_INTERVAL_MS / 1000}s...`);
  log('-'.repeat(80));

  let done = false;
  while (!done) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    done = await pollStatus();
  }

  log('-'.repeat(80));
  const finalStatus = await getQueueStatus();
  if (finalStatus) printFinalReport(finalStatus);

  log('='.repeat(80));
  log('[Test] Test complete');
  log('='.repeat(80));
}

function printFinalReport(finalStatus: any) {
  log('[Test] Batch finished. Final report:');
  log('-'.repeat(80));

  const elapsed = finalStatus.startedAt && finalStatus.completedAt
    ? Math.round((new Date(finalStatus.completedAt).getTime() - new Date(finalStatus.startedAt).getTime()) / 1000)
    : 0;
  const elapsedMin = Math.floor(elapsed / 60);
  const elapsedSec = elapsed % 60;

  log(`[Test] Total time: ${elapsedMin}m ${elapsedSec}s`);
  log(`[Test] Processed: ${finalStatus.progress.processed}/${finalStatus.progress.total}`);
  log(`[Test] Succeeded: ${finalStatus.progress.succeeded}`);
  log(`[Test] Failed: ${finalStatus.progress.failed}`);
  log(`[Test] Success rate: ${finalStatus.progress.total > 0 ? Math.round((finalStatus.progress.succeeded / finalStatus.progress.total) * 100) : 0}%`);
  log(`[Test] Final rate: ${(finalStatus.progress as any).propertiesPerMinute || 0}/min`);

  if (finalStatus.errors.length > 0) {
    const summary = buildSummary(finalStatus.errors);
    log(`\n[Test] Failure breakdown by stage:`);
    for (const [stage, count] of Object.entries(summary.stageBreakdown)) {
      log(`  ${stage}: ${count}`);
    }
    log(`\n[Test] Failure breakdown by service:`);
    for (const [service, count] of Object.entries(summary.serviceBreakdown)) {
      log(`  ${service}: ${count}`);
    }
    log(`\n[Test] Retryable: ${summary.retryableCount} | Permanent: ${summary.permanentCount}`);

    log(`\n[Test] All errors:`);
    for (const err of finalStatus.errors) {
      log(`  ${err.propertyKey} | stage: ${err.stage || '?'} | retryable: ${err.retryable ?? '?'} | ${err.error.substring(0, 200)}`);
    }
  } else {
    log(`\n[Test] No errors - all properties enriched successfully!`);
  }
}

main().catch(err => {
  log(`[Test] Fatal error: ${err}`);
  process.exit(1);
});
