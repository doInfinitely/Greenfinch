import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, propertyContacts, properties } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

interface AssociateContactBody {
  propertyId: string;
  contactId: string;
  role: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: AssociateContactBody = await request.json();
    const { propertyId, contactId, role } = body;

    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400 }
      );
    }

    if (!contactId) {
      return NextResponse.json(
        { error: 'contactId is required' },
        { status: 400 }
      );
    }

    if (!role) {
      return NextResponse.json(
        { error: 'role is required' },
        { status: 400 }
      );
    }

    const existingProperty = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);

    if (existingProperty.length === 0) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const existingContact = await db
      .select({ id: contacts.id, fullName: contacts.fullName })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (existingContact.length === 0) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }

    const existingAssociation = await db
      .select({ id: propertyContacts.id })
      .from(propertyContacts)
      .where(
        and(
          eq(propertyContacts.propertyId, propertyId),
          eq(propertyContacts.contactId, contactId)
        )
      )
      .limit(1);

    if (existingAssociation.length > 0) {
      return NextResponse.json(
        { error: 'Contact is already associated with this property' },
        { status: 409 }
      );
    }

    await db.insert(propertyContacts).values({
      propertyId,
      contactId,
      role,
      confidenceScore: 1.0,
      relationshipConfidence: 'high',
    }).onConflictDoNothing();

    return NextResponse.json({
      success: true,
      message: `Contact ${existingContact[0].fullName || contactId} associated with property`,
    });
  } catch (error) {
    console.error('[API] Contact associate error:', error);
    return NextResponse.json(
      { error: 'Failed to associate contact' },
      { status: 500 }
    );
  }
}
