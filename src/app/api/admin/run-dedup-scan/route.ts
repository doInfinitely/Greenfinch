import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { runDuplicateDetection, EntityType } from '@/lib/duplicate-detection';

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();

    const body = await request.json().catch(() => ({}));
    const entityType = body.entityType as EntityType | 'all' | undefined;

    if (entityType && !['contact', 'organization', 'property', 'all'].includes(entityType)) {
      return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 });
    }

    const results = await runDuplicateDetection(entityType || 'all');

    return NextResponse.json({
      success: true,
      data: {
        contacts: results.contact,
        organizations: results.organization,
        properties: results.property,
      },
    });
  } catch (error) {
    console.error('[RunDedupScan] Error:', error);
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (error.message.startsWith('FORBIDDEN')) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to run dedup scan' }, { status: 500 });
  }
}
