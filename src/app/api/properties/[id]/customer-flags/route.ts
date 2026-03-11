import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { customerStatusFlags, propertyActivity, users, CUSTOMER_FLAG_TYPES, CUSTOMER_FLAG_LABELS, type CustomerFlagType } from '@/lib/schema';
import { eq, and, desc } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';
import { resolveProperty, isValidPropertyId } from '@/lib/property-resolver';

function isValidFlagType(value: string): value is CustomerFlagType {
  return (CUSTOMER_FLAG_TYPES as readonly string[]).includes(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !isValidPropertyId(id)) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const property = await resolveProperty(id);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const flags = await db
      .select({
        id: customerStatusFlags.id,
        flagType: customerStatusFlags.flagType,
        competitorName: customerStatusFlags.competitorName,
        notes: customerStatusFlags.notes,
        createdAt: customerStatusFlags.createdAt,
        updatedAt: customerStatusFlags.updatedAt,
        createdByUserId: customerStatusFlags.createdByUserId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(customerStatusFlags)
      .leftJoin(users, eq(users.id, customerStatusFlags.createdByUserId))
      .where(
        and(
          eq(customerStatusFlags.propertyId, property.id),
          eq(customerStatusFlags.clerkOrgId, authData.orgId)
        )
      )
      .orderBy(desc(customerStatusFlags.createdAt));

    return NextResponse.json({
      flags: flags.map(f => ({
        id: f.id,
        flagType: f.flagType,
        competitorName: f.competitorName,
        notes: f.notes,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        createdBy: {
          id: f.createdByUserId,
          firstName: f.userFirstName,
          lastName: f.userLastName,
        },
      })),
    });
  } catch (error) {
    console.error('[API] Get customer flags error:', error);
    return NextResponse.json({ error: 'Failed to get customer flags' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !isValidPropertyId(id)) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { flagType, competitorName, notes } = body;

    if (!flagType || !isValidFlagType(flagType)) {
      return NextResponse.json({ error: `Invalid flag type. Must be one of: ${CUSTOMER_FLAG_TYPES.join(', ')}` }, { status: 400 });
    }

    const property = await resolveProperty(id);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // Check for existing flag (unique constraint)
    const existing = await db
      .select({ id: customerStatusFlags.id })
      .from(customerStatusFlags)
      .where(
        and(
          eq(customerStatusFlags.clerkOrgId, authData.orgId),
          eq(customerStatusFlags.propertyId, property.id),
          eq(customerStatusFlags.flagType, flagType)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: 'Flag already exists for this property' }, { status: 409 });
    }

    const [flag] = await db.insert(customerStatusFlags).values({
      propertyId: property.id,
      clerkOrgId: authData.orgId,
      flagType,
      competitorName: flagType === 'competitor_serviced' ? competitorName || null : null,
      notes: notes || null,
      createdByUserId: session.user.id,
    }).returning();

    // Log activity
    await db.insert(propertyActivity).values({
      propertyId: property.id,
      clerkOrgId: authData.orgId,
      userId: session.user.id,
      activityType: 'customer_flag_added',
      newValue: CUSTOMER_FLAG_LABELS[flagType],
      metadata: { flagType, competitorName: competitorName || null },
    });

    return NextResponse.json({ flag }, { status: 201 });
  } catch (error) {
    console.error('[API] Add customer flag error:', error);
    return NextResponse.json({ error: 'Failed to add customer flag' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !isValidPropertyId(id)) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { flagType, competitorName, notes } = body;

    if (!flagType || !isValidFlagType(flagType)) {
      return NextResponse.json({ error: 'Invalid flag type' }, { status: 400 });
    }

    const property = await resolveProperty(id);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (notes !== undefined) updates.notes = notes || null;
    if (flagType === 'competitor_serviced' && competitorName !== undefined) {
      updates.competitorName = competitorName || null;
    }

    const [updated] = await db
      .update(customerStatusFlags)
      .set(updates)
      .where(
        and(
          eq(customerStatusFlags.clerkOrgId, authData.orgId),
          eq(customerStatusFlags.propertyId, property.id),
          eq(customerStatusFlags.flagType, flagType)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
    }

    return NextResponse.json({ flag: updated });
  } catch (error) {
    console.error('[API] Update customer flag error:', error);
    return NextResponse.json({ error: 'Failed to update customer flag' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !isValidPropertyId(id)) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const flagType = searchParams.get('flagType');

    if (!flagType || !isValidFlagType(flagType)) {
      return NextResponse.json({ error: 'Invalid flag type' }, { status: 400 });
    }

    const property = await resolveProperty(id);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const [deleted] = await db
      .delete(customerStatusFlags)
      .where(
        and(
          eq(customerStatusFlags.clerkOrgId, authData.orgId),
          eq(customerStatusFlags.propertyId, property.id),
          eq(customerStatusFlags.flagType, flagType)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
    }

    // Log activity
    await db.insert(propertyActivity).values({
      propertyId: property.id,
      clerkOrgId: authData.orgId,
      userId: session.user.id,
      activityType: 'customer_flag_removed',
      previousValue: CUSTOMER_FLAG_LABELS[flagType as CustomerFlagType],
      metadata: { flagType },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Delete customer flag error:', error);
    return NextResponse.json({ error: 'Failed to delete customer flag' }, { status: 500 });
  }
}
