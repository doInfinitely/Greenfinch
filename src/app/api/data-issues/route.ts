import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dataIssueFlags, contacts, properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { entityType, contactId, propertyId, issueDescription } = body;

    if (!entityType || !['contact', 'property'].includes(entityType)) {
      return NextResponse.json({ error: 'entityType must be "contact" or "property"' }, { status: 400 });
    }

    if (entityType === 'contact' && !contactId) {
      return NextResponse.json({ error: 'contactId is required for contact issues' }, { status: 400 });
    }

    if (entityType === 'property' && !propertyId) {
      return NextResponse.json({ error: 'propertyId is required for property issues' }, { status: 400 });
    }

    if (!issueDescription || typeof issueDescription !== 'string' || issueDescription.trim().length < 5) {
      return NextResponse.json({ error: 'Please provide a description of at least 5 characters' }, { status: 400 });
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

    const [flag] = await db.insert(dataIssueFlags).values({
      entityType,
      contactId: entityType === 'contact' ? contactId : null,
      propertyId: entityType === 'property' ? propertyId : null,
      issueDescription: issueDescription.trim(),
      flaggedByUserId: session.user.id,
    }).returning();

    console.log(`[DataIssue] New ${entityType} issue flagged by user ${session.user.id}: ${issueDescription.trim().substring(0, 80)}`);

    return NextResponse.json({
      success: true,
      data: { id: flag.id },
    });
  } catch (error) {
    console.error('[DataIssue] Error creating data issue flag:', error);
    return NextResponse.json({ error: 'Failed to submit data issue' }, { status: 500 });
  }
}
