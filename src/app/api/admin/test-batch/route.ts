import { NextRequest, NextResponse } from 'next/server';
import { isBullMQConfigured } from '@/lib/bullmq-connection';
import { startBullMQBatch, getBullMQBatchStatus, isBullMQBatchRunning, cancelBullMQBatch } from '@/lib/bullmq-enrichment';
import { startBatch, isBatchRunning, cancelBatch, getQueueStatus } from '@/lib/enrichment-queue';
import { rateLimiters } from '@/lib/rate-limiter';
import { getRedis } from '@/lib/redis';

const TEST_SECRET = process.env.BATCH_TEST_SECRET || 'greenfinch-batch-test-2026';

function checkTestAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${TEST_SECRET}`;
}

export async function POST(request: NextRequest) {
  if (!checkTestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { limit = 50, concurrency = 10, onlyUnenriched = true, cancelFirst = false, useLegacy = false } = body;

    const useBullMQ = isBullMQConfigured() && !useLegacy;

    if (useBullMQ) {
      if (cancelFirst) {
        const running = await isBullMQBatchRunning();
        if (running) {
          await cancelBullMQBatch();
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (await isBullMQBatchRunning()) {
        return NextResponse.json(
          { error: 'A batch is already running', checkStatusAt: '/api/admin/test-batch', engine: 'bullmq' },
          { status: 409 }
        );
      }

      const batchStatus = await startBullMQBatch({
        limit: Math.min(limit, 200),
        onlyUnenriched,
        concurrency: Math.min(Math.max(1, concurrency), 50),
      });

      return NextResponse.json({
        success: true,
        message: 'Test batch started (BullMQ)',
        engine: 'bullmq',
        batchId: batchStatus.batchId,
        totalProperties: batchStatus.progress.total,
        concurrency: batchStatus.concurrency,
      });
    }

    if (cancelFirst) {
      const running = await isBatchRunning();
      if (running) {
        await cancelBatch();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (await isBatchRunning()) {
      return NextResponse.json(
        { error: 'A batch is already running', checkStatusAt: '/api/admin/test-batch', engine: 'legacy' },
        { status: 409 }
      );
    }

    const batchStatus = await startBatch({
      limit: Math.min(limit, 200),
      onlyUnenriched,
      concurrency: Math.min(Math.max(1, concurrency), 50),
    });

    return NextResponse.json({
      success: true,
      message: 'Test batch started (legacy)',
      engine: 'legacy',
      batchId: batchStatus.batchId,
      totalProperties: batchStatus.progress.total,
      concurrency: batchStatus.concurrency,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  if (!checkTestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const circuitBreakers: Record<string, { state: string; pending: number }> = {};
  for (const [name, limiter] of Object.entries(rateLimiters)) {
    circuitBreakers[name] = {
      state: limiter.circuitBreakerState,
      pending: limiter.pending,
    };
  }

  const useBullMQ = isBullMQConfigured();

  if (useBullMQ) {
    const status = await getBullMQBatchStatus();
    const isRunning = await isBullMQBatchRunning();

    if (!status) {
      return NextResponse.json({
        status: 'idle',
        isRunning: false,
        engine: 'bullmq',
        circuitBreakers,
      });
    }

    const stageBreakdown: Record<string, number> = {};
    const serviceBreakdown: Record<string, number> = {};
    let retryableCount = 0;
    let permanentCount = 0;

    for (const err of status.errors) {
      if (err.stage) {
        stageBreakdown[err.stage] = (stageBreakdown[err.stage] || 0) + 1;
      }
      const msg = err.error.toLowerCase();
      if (msg.includes('gemini') || msg.includes('google')) serviceBreakdown['gemini'] = (serviceBreakdown['gemini'] || 0) + 1;
      else if (msg.includes('findymail')) serviceBreakdown['findymail'] = (serviceBreakdown['findymail'] || 0) + 1;
      else if (msg.includes('pdl') || msg.includes('people data')) serviceBreakdown['pdl'] = (serviceBreakdown['pdl'] || 0) + 1;
      else if (msg.includes('crustdata')) serviceBreakdown['crustdata'] = (serviceBreakdown['crustdata'] || 0) + 1;
      else if (msg.includes('timeout')) serviceBreakdown['timeout'] = (serviceBreakdown['timeout'] || 0) + 1;
      else if (msg.includes('circuit breaker')) serviceBreakdown['circuit_breaker'] = (serviceBreakdown['circuit_breaker'] || 0) + 1;
      else serviceBreakdown['other'] = (serviceBreakdown['other'] || 0) + 1;
      if (err.retryable) retryableCount++;
      else permanentCount++;
    }

    return NextResponse.json({
      batchId: status.batchId,
      status: status.status,
      isRunning,
      engine: 'bullmq',
      progress: status.progress,
      percentComplete: status.progress.total > 0
        ? Math.round((status.progress.processed / status.progress.total) * 100)
        : 0,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      summary: { stageBreakdown, serviceBreakdown, retryableCount, permanentCount },
      errors: status.errors,
      circuitBreakers,
    });
  }

  const status = await getQueueStatus();
  const isRunning = await isBatchRunning();

  if (!status) {
    return NextResponse.json({
      status: 'idle',
      isRunning: false,
      engine: 'legacy',
      circuitBreakers,
    });
  }

  const stageBreakdown: Record<string, number> = {};
  const serviceBreakdown: Record<string, number> = {};
  let retryableCount = 0;
  let permanentCount = 0;

  for (const err of status.errors) {
    if (err.stage) {
      stageBreakdown[err.stage] = (stageBreakdown[err.stage] || 0) + 1;
    }
    const msg = err.error.toLowerCase();
    if (msg.includes('gemini') || msg.includes('google')) serviceBreakdown['gemini'] = (serviceBreakdown['gemini'] || 0) + 1;
    else if (msg.includes('findymail')) serviceBreakdown['findymail'] = (serviceBreakdown['findymail'] || 0) + 1;
    else if (msg.includes('pdl') || msg.includes('people data')) serviceBreakdown['pdl'] = (serviceBreakdown['pdl'] || 0) + 1;
    else if (msg.includes('crustdata')) serviceBreakdown['crustdata'] = (serviceBreakdown['crustdata'] || 0) + 1;
    else if (msg.includes('timeout')) serviceBreakdown['timeout'] = (serviceBreakdown['timeout'] || 0) + 1;
    else if (msg.includes('circuit breaker')) serviceBreakdown['circuit_breaker'] = (serviceBreakdown['circuit_breaker'] || 0) + 1;
    else serviceBreakdown['other'] = (serviceBreakdown['other'] || 0) + 1;
    if (err.retryable) retryableCount++;
    else permanentCount++;
  }

  return NextResponse.json({
    batchId: status.batchId,
    status: status.status,
    isRunning,
    engine: 'legacy',
    progress: status.progress,
    percentComplete: status.progress.total > 0
      ? Math.round((status.progress.processed / status.progress.total) * 100)
      : 0,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    summary: { stageBreakdown, serviceBreakdown, retryableCount, permanentCount },
    errors: status.errors,
    circuitBreakers,
  });
}

export async function DELETE(request: NextRequest) {
  if (!checkTestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isBullMQConfigured()) {
    const result = await cancelBullMQBatch();
    return NextResponse.json({ ...result, engine: 'bullmq' });
  }

  const result = await cancelBatch();

  const redis = getRedis();
  if (redis) {
    try {
      await redis.del('gf:lock:enrichment:batch');
      await redis.del('gf:state:enrichment:batch');
      await redis.del('gf:state:enrichment:items');
    } catch (e) {
      console.warn('[test-batch] Redis cleanup warning:', e);
    }
  }

  return NextResponse.json({ ...result, lockCleared: true, engine: 'legacy' });
}
