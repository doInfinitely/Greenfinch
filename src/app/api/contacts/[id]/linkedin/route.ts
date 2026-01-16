import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, propertyContacts, properties } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
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

    // Get contact with city from associated property
    const queryResult = await db.execute(sql`
      SELECT 
        c.*,
        p.city as property_city
      FROM contacts c
      LEFT JOIN property_contacts pc ON pc.contact_id = c.id
      LEFT JOIN properties p ON p.id = pc.property_id
      WHERE c.id = ${id}
      LIMIT 1
    `);

    const contactResult = queryResult.rows?.[0];
    if (!contactResult) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const contact = contactResult as {
      id: string;
      full_name: string | null;
      title: string | null;
      employer_name: string | null;
      company_domain: string | null;
      linkedin_url: string | null;
      linkedin_confidence: number | null;
      property_city: string | null;
    };

    if (contact.linkedin_url) {
      return NextResponse.json({
        success: true,
        linkedinUrl: contact.linkedin_url,
        confidence: contact.linkedin_confidence,
        message: 'LinkedIn profile already exists',
        alreadyExists: true,
      });
    }

    if (!contact.full_name) {
      return NextResponse.json(
        { error: 'Contact name is required to find LinkedIn profile' },
        { status: 400 }
      );
    }

    console.log(`[API] Finding LinkedIn for contact: ${contact.full_name} (${contact.employer_name || 'unknown company'}, ${contact.company_domain || 'no domain'}, ${contact.property_city || 'unknown city'})`);

    const result = await findLinkedInUrl(
      contact.full_name,
      contact.title,
      contact.employer_name,
      contact.company_domain,
      contact.property_city
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

      console.log(`[API] Found and saved LinkedIn for ${contact.full_name}: ${result.linkedinUrl}`);

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
