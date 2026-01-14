import { NextRequest, NextResponse } from 'next/server';
import { startBatch, isBatchRunning, getMaxBatchSize } from '@/lib/enrichment-queue';
import { requireRole } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    await requireRole(['system_admin']);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'System admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { propertyIds, propertyKeys, limit, onlyUnenriched } = body;

    if (isBatchRunning()) {
      return NextResponse.json(
        { error: 'A batch is already running. Please wait for it to complete or check status at /api/admin/enrich-status' },
        { status: 409 }
      );
    }

    const maxBatchSize = getMaxBatchSize();
    const requestedLimit = limit ? Math.min(limit, maxBatchSize) : maxBatchSize;

    console.log(`[API] Starting batch enrichment with limit: ${requestedLimit}`);

    const batchStatus = await startBatch({
      propertyIds,
      propertyKeys,
      limit: requestedLimit,
      onlyUnenriched: onlyUnenriched ?? false,
    });

    return NextResponse.json({
      success: true,
      message: 'Batch enrichment started',
      batchId: batchStatus.batchId,
      totalProperties: batchStatus.progress.total,
      maxBatchSize,
      status: batchStatus.status,
      checkStatusAt: '/api/admin/enrich-status',
    });
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
    maxBatchSize: getMaxBatchSize(),
    example: {
      method: 'POST',
      body: {
        propertyIds: ['optional-array-of-property-ids'],
        propertyKeys: ['optional-array-of-property-keys'],
        limit: 50,
        onlyUnenriched: true,
      },
    },
    notes: [
      'If propertyIds or propertyKeys provided, those specific properties will be enriched',
      'If onlyUnenriched=true, properties with null or pending enrichmentStatus will be enriched',
      'limit is capped at ENRICHMENT_MAX_BATCH_SIZE environment variable (default: 100)',
    ],
  });
}
