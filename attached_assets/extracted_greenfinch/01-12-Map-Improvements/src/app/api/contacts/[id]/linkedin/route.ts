import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { findLinkedInUrl, CONFIDENCE } from '@/lib/enrichment';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid contact ID format' },
        { status: 400 }
      );
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (contact.linkedinUrl) {
      return NextResponse.json({
        success: true,
        linkedinUrl: contact.linkedinUrl,
        confidence: contact.linkedinConfidence,
        message: 'LinkedIn profile already exists',
        alreadyExists: true,
      });
    }

    if (!contact.fullName) {
      return NextResponse.json(
        { error: 'Contact name is required to find LinkedIn profile' },
        { status: 400 }
      );
    }

    console.log(`[API] Finding LinkedIn for contact: ${contact.fullName}`);

    const result = await findLinkedInUrl(
      contact.fullName,
      contact.title,
      contact.employerName,
      contact.companyDomain
    );

    if (result.linkedinUrl && result.confidence >= CONFIDENCE.LINKEDIN_THRESHOLD) {
      await db
        .update(contacts)
        .set({
          linkedinUrl: result.linkedinUrl,
          linkedinConfidence: result.confidence,
          linkedinStatus: 'discovered',
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));

      console.log(`[API] Found and saved LinkedIn for ${contact.fullName}: ${result.linkedinUrl}`);

      return NextResponse.json({
        success: true,
        linkedinUrl: result.linkedinUrl,
        confidence: result.confidence,
        message: 'LinkedIn profile discovered successfully',
      });
    }

    await db
      .update(contacts)
      .set({
        linkedinStatus: 'not_found',
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id));

    return NextResponse.json({
      success: false,
      message: 'Could not find LinkedIn profile with high confidence',
    });
  } catch (error) {
    console.error('[API] LinkedIn discovery error:', error);
    return NextResponse.json(
      { error: 'Failed to search for LinkedIn profile' },
      { status: 500 }
    );
  }
}
