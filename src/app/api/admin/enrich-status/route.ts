import { NextResponse } from 'next/server';
import { getQueueStatus, isBatchRunning, getMaxBatchSize } from '@/lib/enrichment-queue';
import { requireRole } from '@/lib/auth';

export async function GET() {
  try {
    await requireRole(['system_admin', 'account_admin']);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  const status = getQueueStatus();
  const isRunning = isBatchRunning();

  if (!status) {
    return NextResponse.json({
      status: 'idle',
      message: 'No batch has been started yet',
      isRunning: false,
      maxBatchSize: getMaxBatchSize(),
    });
  }

  return NextResponse.json({
    batchId: status.batchId,
    status: status.status,
    isRunning,
    progress: status.progress,
    percentComplete: status.progress.total > 0 
      ? Math.round((status.progress.processed / status.progress.total) * 100) 
      : 0,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    errors: status.errors.slice(-10),
    errorCount: status.errors.length,
    maxBatchSize: getMaxBatchSize(),
  });
}
