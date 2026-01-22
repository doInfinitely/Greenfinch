import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, contactLinkedinFlags } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession();

    // Require authentication for mutations
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid contact ID format' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { originalUrl, selectedUrl, selectedIndex, markAsIncorrect } = body;

    // Get current contact to verify it exists
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Handle marking as incorrect (clears the LinkedIn URL)
    if (markAsIncorrect) {
      await db.insert(contactLinkedinFlags).values({
        contactId: id,
        originalLinkedinUrl: originalUrl,
        selectedLinkedinUrl: null,
        selectedAlternativeIndex: null,
        status: 'marked_incorrect',
        flaggedByUserId: session.user.id,
      });

      await db
        .update(contacts)
        .set({
          linkedinUrl: null,
          linkedinConfidence: null,
          linkedinFlagged: true,
          linkedinStatus: 'marked_incorrect',
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));

      console.log(`[API] LinkedIn marked as incorrect for contact ${id}: ${originalUrl}`);

      return NextResponse.json({
        success: true,
        message: 'LinkedIn profile marked as incorrect',
        linkedinUrl: null,
      });
    }

    if (!selectedUrl) {
      return NextResponse.json(
        { error: 'Selected URL is required' },
        { status: 400 }
      );
    }

    // Create a flag record for audit trail
    await db.insert(contactLinkedinFlags).values({
      contactId: id,
      originalLinkedinUrl: originalUrl,
      selectedLinkedinUrl: selectedUrl,
      selectedAlternativeIndex: selectedIndex,
      status: 'resolved',
      flaggedByUserId: session.user.id,
    });

    // Update the contact with the new LinkedIn URL
    await db
      .update(contacts)
      .set({
        linkedinUrl: selectedUrl,
        linkedinFlagged: true,
        linkedinStatus: 'user_selected',
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id));

    console.log(`[API] LinkedIn profile updated for contact ${id}: ${originalUrl} -> ${selectedUrl}`);

    return NextResponse.json({
      success: true,
      message: 'LinkedIn profile updated successfully',
      linkedinUrl: selectedUrl,
    });
  } catch (error) {
    console.error('[API] LinkedIn flag error:', error);
    return NextResponse.json(
      { error: 'Failed to update LinkedIn profile' },
      { status: 500 }
    );
  }
}
