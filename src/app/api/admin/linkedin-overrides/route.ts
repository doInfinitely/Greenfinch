import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { isNotNull, eq, sql } from 'drizzle-orm';

export async function GET() {
  try {
    const rows = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        employerName: contacts.employerName,
        linkedinUrl: contacts.linkedinUrl,
        linkedinRejectedUrl: contacts.linkedinRejectedUrl,
        linkedinRejectedSource: contacts.linkedinRejectedSource,
      })
      .from(contacts)
      .where(isNotNull(contacts.linkedinRejectedUrl))
      .orderBy(contacts.fullName);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('[Admin] linkedin-overrides GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch overrides' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactId, action, linkedinUrl } = body;

    if (!contactId || !action) {
      return NextResponse.json({ success: false, error: 'Missing contactId or action' }, { status: 400 });
    }

    if (action === 'approve') {
      const [contact] = await db.select({ rejectedUrl: contacts.linkedinRejectedUrl }).from(contacts).where(eq(contacts.id, contactId));
      if (!contact?.rejectedUrl) {
        return NextResponse.json({ success: false, error: 'No rejected URL found' }, { status: 404 });
      }
      await db.update(contacts)
        .set({ linkedinUrl: contact.rejectedUrl, linkedinRejectedUrl: null, linkedinRejectedSource: null, linkedinStatus: 'admin_approved', linkedinConfidence: 0.70 })
        .where(eq(contacts.id, contactId));

    } else if (action === 'set') {
      if (!linkedinUrl) {
        return NextResponse.json({ success: false, error: 'Missing linkedinUrl for set action' }, { status: 400 });
      }
      await db.update(contacts)
        .set({ linkedinUrl, linkedinRejectedUrl: null, linkedinRejectedSource: null, linkedinStatus: 'admin_set', linkedinConfidence: 0.90 })
        .where(eq(contacts.id, contactId));

    } else if (action === 'dismiss') {
      await db.update(contacts)
        .set({ linkedinRejectedUrl: null, linkedinRejectedSource: null })
        .where(eq(contacts.id, contactId));

    } else {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin] linkedin-overrides POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to process override' }, { status: 500 });
  }
}
