import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { isBullMQConfigured } from '@/lib/bullmq-connection';
import { flushBullMQData } from '@/lib/bullmq-enrichment';

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();

    if (!isBullMQConfigured()) {
      return NextResponse.json({
        success: false,
        error: 'BullMQ is not configured',
      });
    }

    const result = await flushBullMQData();

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[FlushQueue] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
