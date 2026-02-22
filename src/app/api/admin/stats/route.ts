import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, contacts } from '@/lib/schema';
import { count, eq, and } from 'drizzle-orm';
import { requireAdminAccess } from '@/lib/auth';

export async function GET() {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const [totalPropertiesResult] = await db
      .select({ count: count() })
      .from(properties)
      .where(eq(properties.isActive, true));

    const [enrichedPropertiesResult] = await db
      .select({ count: count() })
      .from(properties)
      .where(and(
        eq(properties.isActive, true),
        eq(properties.isParentProperty, true),
        eq(properties.enrichmentStatus, 'completed')
      ));

    const [pendingPropertiesResult] = await db
      .select({ count: count() })
      .from(properties)
      .where(and(
        eq(properties.isActive, true),
        eq(properties.isParentProperty, true),
        eq(properties.enrichmentStatus, 'pending')
      ));

    const [totalContactsResult] = await db
      .select({ count: count() })
      .from(contacts);

    const [validatedEmailsResult] = await db
      .select({ count: count() })
      .from(contacts)
      .where(eq(contacts.emailValidationStatus, 'valid'));

    // Parent properties (excludes constituent accounts like parking decks)
    const [parentPropertiesResult] = await db
      .select({ count: count() })
      .from(properties)
      .where(and(
        eq(properties.isActive, true),
        eq(properties.isParentProperty, true)
      ));

    return NextResponse.json({
      totalProperties: totalPropertiesResult.count,
      parentProperties: parentPropertiesResult.count,
      enrichedProperties: enrichedPropertiesResult.count,
      pendingProperties: pendingPropertiesResult.count,
      totalContacts: totalContactsResult.count,
      validatedEmails: validatedEmailsResult.count,
    });
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
