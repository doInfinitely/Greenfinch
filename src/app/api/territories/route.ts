import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { territories, users, type TerritoryDefinition, type TerritoryType, TERRITORY_TYPES } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = await db
      .select({
        id: territories.id,
        name: territories.name,
        color: territories.color,
        type: territories.type,
        definition: territories.definition,
        assignedUserId: territories.assignedUserId,
        assignedClerkUserId: territories.assignedClerkUserId,
        isActive: territories.isActive,
        createdAt: territories.createdAt,
        updatedAt: territories.updatedAt,
        // Join assigned user info
        assignedUserFirstName: users.firstName,
        assignedUserLastName: users.lastName,
        assignedUserEmail: users.email,
        assignedUserProfileImage: users.profileImageUrl,
      })
      .from(territories)
      .leftJoin(users, eq(territories.assignedUserId, users.id))
      .where(and(
        eq(territories.clerkOrgId, orgId),
        eq(territories.isActive, true)
      ))
      .orderBy(territories.name);

    const formatted = results.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      type: r.type,
      definition: r.definition as TerritoryDefinition,
      assignedUserId: r.assignedUserId,
      assignedClerkUserId: r.assignedClerkUserId,
      isActive: r.isActive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      assignedUser: r.assignedUserId ? {
        id: r.assignedUserId,
        firstName: r.assignedUserFirstName,
        lastName: r.assignedUserLastName,
        email: r.assignedUserEmail,
        profileImageUrl: r.assignedUserProfileImage,
        displayName: [r.assignedUserFirstName, r.assignedUserLastName].filter(Boolean).join(' ') || r.assignedUserEmail || 'Unknown',
      } : null,
    }));

    return NextResponse.json({ territories: formatted });
  } catch (error) {
    console.error('Error fetching territories:', error);
    return NextResponse.json({ error: 'Failed to fetch territories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole, userId: clerkUserId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, color, type, definition, assignedUserId, assignedClerkUserId } = body;

    if (!name || !type || !definition) {
      return NextResponse.json({ error: 'name, type, and definition are required' }, { status: 400 });
    }

    if (!TERRITORY_TYPES.includes(type as TerritoryType)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${TERRITORY_TYPES.join(', ')}` }, { status: 400 });
    }

    // Validate definition shape based on type
    if (type === 'zip_codes' && (!definition.zipCodes || !Array.isArray(definition.zipCodes) || definition.zipCodes.length === 0)) {
      return NextResponse.json({ error: 'zip_codes type requires definition.zipCodes array' }, { status: 400 });
    }
    if (type === 'counties' && (!definition.counties || !Array.isArray(definition.counties) || definition.counties.length === 0)) {
      return NextResponse.json({ error: 'counties type requires definition.counties array' }, { status: 400 });
    }
    if (type === 'polygon' && (!definition.geometry || definition.geometry.type !== 'Polygon')) {
      return NextResponse.json({ error: 'polygon type requires definition.geometry as a GeoJSON Polygon' }, { status: 400 });
    }

    // Look up the creating user's DB id
    let createdByUserId: string | null = null;
    if (clerkUserId) {
      const [dbUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      createdByUserId = dbUser?.id ?? null;
    }

    const [newTerritory] = await db
      .insert(territories)
      .values({
        clerkOrgId: orgId,
        name,
        color: color || '#16a34a',
        type,
        definition,
        assignedUserId: assignedUserId || null,
        assignedClerkUserId: assignedClerkUserId || null,
        createdByUserId,
      })
      .returning();

    return NextResponse.json({ territory: newTerritory }, { status: 201 });
  } catch (error) {
    console.error('Error creating territory:', error);
    return NextResponse.json({ error: 'Failed to create territory' }, { status: 500 });
  }
}
