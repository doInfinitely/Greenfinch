import { NextResponse } from 'next/server';
import { isBullMQConfigured } from '@/lib/bullmq-connection';
import { getBullMQBatchStatus, isBullMQBatchRunning } from '@/lib/bullmq-enrichment';
import { getQueueStatus, isBatchRunning, getMaxBatchSize } from '@/lib/enrichment-queue';
import { requireSession } from '@/lib/auth';
import { rateLimiters } from '@/lib/rate-limiter';

function buildBatchSummary(errors: Array<{ propertyKey: string; error: string; stage?: string; retryable?: boolean }>) {
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

function getCircuitBreakerStatus() {
  const services: Record<string, { state: string; pending: number }> = {};
  for (const [name, limiter] of Object.entries(rateLimiters)) {
    services[name] = {
      state: limiter.circuitBreakerState,
      pending: limiter.pending,
    };
  }
  return services;
}

export async function GET() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  const circuitBreakers = getCircuitBreakerStatus();
  const hasBullMQ = isBullMQConfigured();

  const bullmqStatus = hasBullMQ ? await getBullMQBatchStatus() : null;
  const bullmqRunning = hasBullMQ ? await isBullMQBatchRunning() : false;
  const legacyStatus = await getQueueStatus();
  const legacyRunning = await isBatchRunning();

  let status = bullmqStatus || legacyStatus;
  let isRunning = bullmqRunning || legacyRunning;
  let engine: string = bullmqStatus ? 'bullmq' : 'legacy';

  if (bullmqStatus && legacyStatus) {
    const bullmqTime = bullmqStatus.startedAt ? new Date(bullmqStatus.startedAt).getTime() : 0;
    const legacyTime = legacyStatus.startedAt ? new Date(legacyStatus.startedAt).getTime() : 0;
    if (legacyTime > bullmqTime) {
      status = legacyStatus;
      isRunning = legacyRunning;
      engine = 'legacy';
    }
  }

  if (!status) {
    return NextResponse.json({
      status: 'idle',
      message: 'No batch has been started yet',
      isRunning: false,
      engine: hasBullMQ ? 'bullmq' : 'legacy',
      maxBatchSize: getMaxBatchSize(),
      circuitBreakers,
    });
  }

  const summary = buildBatchSummary(status.errors);

  return NextResponse.json({
    batchId: status.batchId,
    status: status.status,
    isRunning,
    engine,
    progress: status.progress,
    percentComplete: status.progress.total > 0 
      ? Math.round((status.progress.processed / status.progress.total) * 100) 
      : 0,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    errors: status.errors.slice(-10),
    errorCount: status.errors.length,
    summary,
    circuitBreakers,
    maxBatchSize: getMaxBatchSize(),
  });
}
