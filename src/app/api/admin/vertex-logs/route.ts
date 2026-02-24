import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getVertexDebugLog, clearVertexDebugLog } from '@/lib/ai';

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const entries = getVertexDebugLog();

  return NextResponse.json({
    success: true,
    data: {
      entries: entries.reverse(),
      count: entries.length,
      maxEntries: 200,
    },
  });
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  clearVertexDebugLog();

  return NextResponse.json({ success: true, data: { cleared: true } });
}
