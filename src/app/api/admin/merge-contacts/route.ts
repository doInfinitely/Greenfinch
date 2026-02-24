import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { mergeContacts } from '@/lib/deduplication';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keepContactId, mergeContactId } = body;

    if (!keepContactId || !mergeContactId) {
      return NextResponse.json({ success: false, error: 'Missing keepContactId or mergeContactId' }, { status: 400 });
    }

    if (keepContactId === mergeContactId) {
      return NextResponse.json({ success: false, error: 'Cannot merge a contact with itself' }, { status: 400 });
    }

    const [keepContact] = await db.select().from(contacts).where(eq(contacts.id, keepContactId));
    const [mergeContact] = await db.select().from(contacts).where(eq(contacts.id, mergeContactId));

    if (!keepContact || !mergeContact) {
      return NextResponse.json({ success: false, error: 'One or both contacts not found' }, { status: 404 });
    }

    const result = await mergeContacts([{
      key: `admin_merge_${keepContactId}_${mergeContactId}`,
      items: [keepContact, mergeContact],
      keepId: keepContactId,
      deleteIds: [mergeContactId],
    }]);

    if (result.errors.length > 0) {
      return NextResponse.json({ success: false, error: result.errors.join('; ') }, { status: 500 });
    }

    return NextResponse.json({ success: true, merged: result.merged });
  } catch (error) {
    console.error('[Admin] merge-contacts POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to merge contacts' }, { status: 500 });
  }
}
