import { NextRequest, NextResponse } from 'next/server';
import { mergeProperties } from '@/lib/deduplication';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keepPropertyId, mergePropertyId } = body;

    if (!keepPropertyId || !mergePropertyId) {
      return NextResponse.json({ success: false, error: 'Missing keepPropertyId or mergePropertyId' }, { status: 400 });
    }

    if (keepPropertyId === mergePropertyId) {
      return NextResponse.json({ success: false, error: 'Cannot merge a property with itself' }, { status: 400 });
    }

    await mergeProperties(keepPropertyId, mergePropertyId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin] merge-properties POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to merge properties' }, { status: 500 });
  }
}
