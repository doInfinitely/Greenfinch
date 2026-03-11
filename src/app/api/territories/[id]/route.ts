import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { territories, type TerritoryType, TERRITORY_TYPES } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const [territory] = await db
      .select()
      .from(territories)
      .where(and(
        eq(territories.id, id),
        eq(territories.clerkOrgId, orgId)
      ))
      .limit(1);

    if (!territory) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    return NextResponse.json({ territory });
  } catch (error) {
    console.error('Error fetching territory:', error);
    return NextResponse.json({ error: 'Failed to fetch territory' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdminRole = orgRole === 'org:admin' || orgRole === 'org:super_admin';
    const isManagerRole = orgRole === 'org:manager';

    if (!isAdminRole && !isManagerRole) {
      return NextResponse.json({ error: 'Admin or manager access required' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, color, type, definition, assignedUserId, assignedClerkUserId } = body;

    // Managers can only update assignment fields
    if (isManagerRole && !isAdminRole) {
      const disallowed = [name, color, type, definition].filter(v => v !== undefined);
      if (disallowed.length > 0) {
        return NextResponse.json(
          { error: 'Managers can only assign users to territories' },
          { status: 403 }
        );
      }
    }

    // Validate type if provided
    if (type && !TERRITORY_TYPES.includes(type as TerritoryType)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${TERRITORY_TYPES.join(', ')}` }, { status: 400 });
    }

    // Validate definition if type+definition are both provided
    if (type && definition) {
      if (type === 'zip_codes' && (!definition.zipCodes || !Array.isArray(definition.zipCodes) || definition.zipCodes.length === 0)) {
        return NextResponse.json({ error: 'zip_codes type requires definition.zipCodes array' }, { status: 400 });
      }
      if (type === 'counties' && (!definition.counties || !Array.isArray(definition.counties) || definition.counties.length === 0)) {
        return NextResponse.json({ error: 'counties type requires definition.counties array' }, { status: 400 });
      }
      if (type === 'polygon' && (!definition.geometry || definition.geometry.type !== 'Polygon')) {
        return NextResponse.json({ error: 'polygon type requires definition.geometry as a GeoJSON Polygon' }, { status: 400 });
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined && isAdminRole) updateData.name = name;
    if (color !== undefined && isAdminRole) updateData.color = color;
    if (type !== undefined && isAdminRole) updateData.type = type;
    if (definition !== undefined && isAdminRole) updateData.definition = definition;
    if (assignedUserId !== undefined) updateData.assignedUserId = assignedUserId || null;
    if (assignedClerkUserId !== undefined) updateData.assignedClerkUserId = assignedClerkUserId || null;

    const [updated] = await db
      .update(territories)
      .set(updateData)
      .where(and(
        eq(territories.id, id),
        eq(territories.clerkOrgId, orgId)
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    return NextResponse.json({ territory: updated });
  } catch (error) {
    console.error('Error updating territory:', error);
    return NextResponse.json({ error: 'Failed to update territory' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;

    // Soft delete
    const [deleted] = await db
      .update(territories)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(territories.id, id),
        eq(territories.clerkOrgId, orgId)
      ))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting territory:', error);
    return NextResponse.json({ error: 'Failed to delete territory' }, { status: 500 });
  }
}
