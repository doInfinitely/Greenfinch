import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichPersonPDL } from '@/lib/pdl';

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

    if (!contact.linkedinUrl && !contact.email) {
      return NextResponse.json({ 
        success: false, 
        error: 'No LinkedIn URL or email available to fetch profile photo' 
      });
    }

    const result = await enrichPersonPDL(
      '',
      '',
      '',
      {
        email: contact.email || undefined,
        linkedinUrl: contact.linkedinUrl || undefined,
      }
    );

    if (result?.found && result.photoUrl) {
      await db.update(contacts)
        .set({ 
          photoUrl: result.photoUrl,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, id));

      return NextResponse.json({ 
        success: true, 
        url: result.photoUrl,
        cached: false 
      });
    }

    return NextResponse.json({ 
      success: false, 
      error: 'No profile photo found via PDL' 
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

    if (!contact.linkedinUrl && !contact.email) {
      return NextResponse.json({ 
        success: false, 
        error: 'No LinkedIn URL or email available to fetch profile photo' 
      });
    }

    const result = await enrichPersonPDL(
      '',
      '',
      '',
      {
        email: contact.email || undefined,
        linkedinUrl: contact.linkedinUrl || undefined,
      }
    );

    if (result?.found && result.photoUrl) {
      await db.update(contacts)
        .set({ 
          photoUrl: result.photoUrl,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, id));

      return NextResponse.json({ 
        success: true, 
        url: result.photoUrl,
        refreshed: true 
      });
    }

    return NextResponse.json({ 
      success: false, 
      error: 'No profile photo found via PDL' 
    });
  } catch (error) {
    console.error('[API] Profile photo refresh error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh profile photo' },
      { status: 500 }
    );
  }
}
