import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dataIssues, contacts, properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DESCRIPTION_LENGTH = 2000;

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { entityType, contactId, propertyId, issueDescription } = body;

    if (!entityType || !['contact', 'property'].includes(entityType)) {
      return NextResponse.json({ error: 'entityType must be "contact" or "property"' }, { status: 400 });
    }

    if (entityType === 'contact') {
      if (!contactId) {
        return NextResponse.json({ error: 'contactId is required for contact issues' }, { status: 400 });
      }
      if (typeof contactId !== 'string' || !UUID_REGEX.test(contactId)) {
        return NextResponse.json({ error: 'Invalid contactId format' }, { status: 400 });
      }
    }

    if (entityType === 'property') {
      if (!propertyId) {
        return NextResponse.json({ error: 'propertyId is required for property issues' }, { status: 400 });
      }
      if (typeof propertyId !== 'string' || !UUID_REGEX.test(propertyId)) {
        return NextResponse.json({ error: 'Invalid propertyId format' }, { status: 400 });
      }
    }

    if (!issueDescription || typeof issueDescription !== 'string') {
      return NextResponse.json({ error: 'Please provide a description' }, { status: 400 });
    }

    const trimmedDescription = issueDescription.trim();
    if (trimmedDescription.length < 5) {
      return NextResponse.json({ error: 'Please provide a description of at least 5 characters' }, { status: 400 });
    }
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` }, { status: 400 });
    }

    if (entityType === 'contact') {
      const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
      if (!existing) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
    }

    if (entityType === 'property') {
      const [existing] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId)).limit(1);
      if (!existing) {
        return NextResponse.json({ error: 'Property not found' }, { status: 404 });
      }
    }

    const [inserted] = await db.insert(dataIssues).values({
      entityType,
      contactId: entityType === 'contact' ? contactId : null,
      propertyId: entityType === 'property' ? propertyId : null,
      issueDescription: trimmedDescription,
      userId: userId,
      status: 'open',
    }).returning();

    console.log(`[DataIssue] New ${entityType} issue flagged by user ${userId}: ${trimmedDescription.substring(0, 80)}`);

    return NextResponse.json({
      success: true,
      data: { id: inserted.id },
    });
  } catch (error: any) {
    console.error('[DataIssue] Error creating data issue:', error);
    return NextResponse.json({ error: 'Failed to submit data issue' }, { status: 500 });
  }
}
