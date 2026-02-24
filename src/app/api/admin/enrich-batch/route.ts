import { NextRequest, NextResponse } from 'next/server';
import { isBullMQConfigured } from '@/lib/bullmq-connection';
import { startBullMQBatch, isBullMQBatchRunning, cancelBullMQBatch } from '@/lib/bullmq-enrichment';
import { startBatch, isBatchRunning, getMaxBatchSize, cancelBatch } from '@/lib/enrichment-queue';
import { requireSession, isAdmin } from '@/lib/auth';
import { rateLimitMiddleware, checkRateLimit as checkRateLimitFn, addRateLimitHeaders, getIdentifier } from '@/lib/rate-limit';

const NON_ADMIN_BATCH_LIMIT = 100;
const checkRateLimit = rateLimitMiddleware(20, 60);

export async function POST(request: NextRequest) {
  let userIsAdmin = false;
  try {
    const rateResponse = await checkRateLimit(request);
    if (rateResponse) return rateResponse;

    const { user } = await requireSession();
    userIsAdmin = isAdmin(user);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { propertyIds, propertyKeys, limit, concurrency, useLegacy } = body;

    const useBullMQ = isBullMQConfigured() && !useLegacy;
    const maxBatchSize = userIsAdmin ? getMaxBatchSize() : Math.min(getMaxBatchSize(), NON_ADMIN_BATCH_LIMIT);
    const requestedLimit = limit ? Math.min(limit, maxBatchSize) : maxBatchSize;

    if (useBullMQ) {
      if (await isBullMQBatchRunning()) {
        return NextResponse.json(
          { error: 'A batch is already running. Please wait for it to complete or check status at /api/admin/enrich-status', engine: 'bullmq' },
          { status: 409 }
        );
      }

      console.log(`[API] Starting BullMQ batch enrichment with limit: ${requestedLimit}, concurrency: ${concurrency || 'default'}`);

      const batchStatus = await startBullMQBatch({
        propertyIds,
        propertyKeys,
        limit: requestedLimit,
        concurrency: concurrency ? Math.min(Math.max(1, concurrency), 50) : undefined,
      });

      const identifier = getIdentifier(request);
      const route = new URL(request.url).pathname;
      const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

      const response = NextResponse.json({
        success: true,
        message: 'Batch enrichment started (BullMQ - survives restarts)',
        engine: 'bullmq',
        batchId: batchStatus.batchId,
        totalProperties: batchStatus.progress.total,
        concurrency: batchStatus.concurrency,
        maxBatchSize,
        status: batchStatus.status,
        checkStatusAt: '/api/admin/enrich-status',
      });
      addRateLimitHeaders(response, rateInfo);
      return response;
    }

    if (await isBatchRunning()) {
      return NextResponse.json(
        { error: 'A batch is already running. Please wait for it to complete or check status at /api/admin/enrich-status', engine: 'legacy' },
        { status: 409 }
      );
    }

    console.log(`[API] Starting legacy batch enrichment with limit: ${requestedLimit}, concurrency: ${concurrency || 'default'}`);

    const batchStatus = await startBatch({
      propertyIds,
      propertyKeys,
      limit: requestedLimit,
      concurrency: concurrency ? Math.min(Math.max(1, concurrency), 50) : undefined,
    });

    const identifier = getIdentifier(request);
    const route = new URL(request.url).pathname;
    const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

    const response = NextResponse.json({
      success: true,
      message: 'Batch enrichment started (legacy)',
      engine: 'legacy',
      batchId: batchStatus.batchId,
      totalProperties: batchStatus.progress.total,
      concurrency: batchStatus.concurrency,
      maxBatchSize,
      status: batchStatus.status,
      checkStatusAt: '/api/admin/enrich-status',
    });
    addRateLimitHeaders(response, rateInfo);
    return response;
  } catch (error) {
    console.error('[API] Batch enrichment error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST method to start batch enrichment',
    engine: isBullMQConfigured() ? 'bullmq' : 'legacy',
    maxBatchSize: getMaxBatchSize(),
    example: {
      method: 'POST',
      body: {
        propertyIds: ['optional-array-of-property-ids'],
        propertyKeys: ['optional-array-of-property-keys'],
        limit: 50,
        onlyUnenriched: true,
        concurrency: 15,
        useLegacy: false,
      },
    },
    notes: [
      'BullMQ engine is used by default when configured (jobs survive workflow restarts)',
      'Set useLegacy=true to use the old in-process batch engine',
      'If propertyIds or propertyKeys provided, those specific properties will be enriched',
      'If onlyUnenriched=true, properties with null or pending enrichmentStatus will be enriched',
      'limit is capped at ENRICHMENT_MAX_BATCH_SIZE environment variable (default: 200)',
      'concurrency controls parallel property processing (1-50, default: 15)',
    ],
  });
}

export async function DELETE(request: NextRequest) {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    if (isBullMQConfigured()) {
      const result = await cancelBullMQBatch();
      return NextResponse.json({ ...result, engine: 'bullmq' });
    }

    const result = await cancelBatch();
    return NextResponse.json({ ...result, engine: 'legacy' });
  } catch (error) {
    console.error('[API] Batch cancel error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
