import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getProfilePicture } from '@/lib/enrichlayer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (contact.photoUrl) {
      return NextResponse.json({ 
        success: true, 
        url: contact.photoUrl,
        cached: true 
      });
    }

    if (!contact.linkedinUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'No LinkedIn URL available to fetch profile photo' 
      });
    }

    const result = await getProfilePicture(contact.linkedinUrl);

    if (result.success && result.url) {
      await db.update(contacts)
        .set({ 
          photoUrl: result.url,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, id));

      return NextResponse.json({ 
        success: true, 
        url: result.url,
        cached: false 
      });
    }

    return NextResponse.json({ 
      success: false, 
      error: result.error || 'Failed to fetch profile photo' 
    });
  } catch (error) {
    console.error('[API] Profile photo fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile photo' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (!contact.linkedinUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'No LinkedIn URL available to fetch profile photo' 
      });
    }

    const result = await getProfilePicture(contact.linkedinUrl);

    if (result.success && result.url) {
      await db.update(contacts)
        .set({ 
          photoUrl: result.url,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, id));

      return NextResponse.json({ 
        success: true, 
        url: result.url,
        refreshed: true 
      });
    }

    return NextResponse.json({ 
      success: false, 
      error: result.error || 'Failed to fetch profile photo' 
    });
  } catch (error) {
    console.error('[API] Profile photo refresh error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh profile photo' },
      { status: 500 }
    );
  }
}
