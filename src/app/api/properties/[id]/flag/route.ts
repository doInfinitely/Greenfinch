import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { propertyFlags, properties, organizations } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { resolveProperty, isValidPropertyId } from '@/lib/property-resolver';

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

    if (!id || !isValidPropertyId(id)) {
      return NextResponse.json(
        { error: 'Invalid property ID format' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { flagType, suggestedOrganizationId, suggestedOrganizationName, reason, comments } = body;

    if (!flagType) {
      return NextResponse.json(
        { error: 'Flag type is required' },
        { status: 400 }
      );
    }

    const property = await resolveProperty(id);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // If a new organization name is suggested, create it
    let orgId = suggestedOrganizationId;
    if (!orgId && suggestedOrganizationName) {
      const newOrg = await db.insert(organizations).values({
        name: suggestedOrganizationName,
        orgType: flagType === 'management_company' ? 'management' : 'owner',
      }).returning();
      
      if (newOrg[0]) {
        orgId = newOrg[0].id;
      }
    }

    // Create the flag (use property.id which is the database UUID)
    const flag = await db.insert(propertyFlags).values({
      propertyId: property.id,
      flagType,
      suggestedOrganizationId: orgId,
      suggestedOrganizationName: suggestedOrganizationName || null,
      reason,
      comments,
      status: 'pending',
      flaggedByUserId: session.user.id,
    }).returning();

    console.log(`[API] Property flag created for ${id}: ${flagType}`);

    return NextResponse.json({
      success: true,
      message: 'Flag submitted for review',
      flag: flag[0],
    });
  } catch (error) {
    console.error('[API] Property flag error:', error);
    return NextResponse.json(
      { error: 'Failed to create flag' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !isValidPropertyId(id)) {
      return NextResponse.json(
        { error: 'Invalid property ID format' },
        { status: 400 }
      );
    }

    const property = await resolveProperty(id);
    if (!property) {
      return NextResponse.json({ flags: [] });
    }

    const flags = await db.query.propertyFlags.findMany({
      where: eq(propertyFlags.propertyId, property.id),
    });

    return NextResponse.json({ flags });
  } catch (error) {
    console.error('[API] Get property flags error:', error);
    return NextResponse.json(
      { error: 'Failed to get flags' },
      { status: 500 }
    );
  }
}
