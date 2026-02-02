import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, propertyContacts, properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { validateEmail } from '@/lib/zerobounce';

interface CreateContactBody {
  propertyId: string;
  email?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  phone?: string;
  role: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateContactBody = await request.json();
    const { propertyId, email, linkedinUrl, firstName, lastName, fullName, title, phone, role } = body;

    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400 }
      );
    }

    if (!role) {
      return NextResponse.json(
        { error: 'role is required' },
        { status: 400 }
      );
    }

    // Validate that at least firstName+lastName OR fullName is provided
    const contactName = fullName || [firstName, lastName].filter(Boolean).join(' ') || undefined;
    if (!contactName) {
      return NextResponse.json(
        { error: 'Please provide either a full name or both first and last names' },
        { status: 400 }
      );
    }

    // Validate that at least email OR linkedinUrl is provided
    if (!email && !linkedinUrl) {
      return NextResponse.json(
        { error: 'Please provide either an email address or LinkedIn URL' },
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

    // Check for existing contact by email
    const normalizedEmail = email?.toLowerCase().trim();
    if (normalizedEmail) {
      const existingByEmail = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.normalizedEmail, normalizedEmail))
        .limit(1);

      if (existingByEmail.length > 0) {
        return NextResponse.json(
          {
            error: 'A contact with this email already exists',
            existingContactId: existingByEmail[0].id,
            suggestion: 'Use the associate endpoint to link this existing contact to the property'
          },
          { status: 409 }
        );
      }
    }

    // Check for existing contact by LinkedIn URL
    if (linkedinUrl) {
      const normalizedLinkedinUrl = linkedinUrl.toLowerCase().trim();
      const existingByLinkedin = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.linkedinUrl, normalizedLinkedinUrl))
        .limit(1);

      if (existingByLinkedin.length > 0) {
        return NextResponse.json(
          {
            error: 'A contact with this LinkedIn URL already exists',
            existingContactId: existingByLinkedin[0].id,
            suggestion: 'Use the associate endpoint to link this existing contact to the property'
          },
          { status: 409 }
        );
      }
    }

    let emailValidationStatus: string | undefined;
    let emailValidationDetails: any | undefined;

    if (email) {
      try {
        const validation = await validateEmail(email);
        emailValidationStatus = validation.status;
        emailValidationDetails = {
          rawStatus: validation.rawStatus,
          subStatus: validation.subStatus,
          freeEmail: validation.freeEmail,
          mxFound: validation.mxFound,
          smtpProvider: validation.smtpProvider,
        };
      } catch (error) {
        console.warn('[API] Email validation failed, continuing without validation:', error);
        emailValidationStatus = 'pending';
      }
    }

    const normalizedName = contactName?.toLowerCase().replace(/[^a-z0-9]/g, '');

    const [newContact] = await db
      .insert(contacts)
      .values({
        fullName: contactName,
        normalizedName,
        email,
        normalizedEmail,
        emailValidationStatus,
        emailValidationDetails,
        linkedinUrl,
        title,
        phone,
        source: 'manual',
        contactType: 'individual',
      })
      .returning();

    await db.insert(propertyContacts).values({
      propertyId,
      contactId: newContact.id,
      role,
      confidenceScore: 1.0,
      relationshipConfidence: 'high',
    });

    return NextResponse.json({
      success: true,
      contact: {
        id: newContact.id,
        fullName: newContact.fullName,
        email: newContact.email,
        phone: newContact.phone,
        title: newContact.title,
        linkedinUrl: newContact.linkedinUrl,
        emailValidationStatus: newContact.emailValidationStatus,
      },
    });
  } catch (error) {
    console.error('[API] Contact create error:', error);
    return NextResponse.json(
      { error: 'Failed to create contact' },
      { status: 500 }
    );
  }
}
