import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { findLinkedInByEmail } from '@/lib/findymail';

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
      email: string | null;
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
        allResults: [],
        message: 'LinkedIn profile already exists',
        alreadyExists: true,
      });
    }

    if (!contact.email) {
      return NextResponse.json(
        { error: 'Contact email is required to find LinkedIn profile via reverse lookup' },
        { status: 400 }
      );
    }

    console.log(`[API] Finding LinkedIn for contact via Findymail reverse lookup: ${contact.full_name} (${contact.email})`);

    const result = await findLinkedInByEmail(contact.email);

    if (result.found && result.linkedinUrl) {
      await db
        .update(contacts)
        .set({
          linkedinUrl: result.linkedinUrl,
          linkedinConfidence: 90,
          linkedinStatus: 'discovered',
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));

      console.log(`[API] Found and saved LinkedIn for ${contact.full_name}: ${result.linkedinUrl}`);

      return NextResponse.json({
        success: true,
        linkedinUrl: result.linkedinUrl,
        confidence: 90,
        allResults: [],
        message: 'LinkedIn profile discovered via reverse email lookup',
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
      message: 'Could not find LinkedIn profile via reverse email lookup',
      allResults: [],
    });
  } catch (error) {
    console.error('[API] LinkedIn discovery error:', error);
    return NextResponse.json(
      { error: 'Failed to search for LinkedIn profile' },
      { status: 500 }
    );
  }
}
