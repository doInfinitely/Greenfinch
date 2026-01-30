import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, properties, users } from '@/lib/schema';
import { eq, desc, and, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, userId: clerkUserId, orgRole } = await auth();
    
    if (!orgId || !clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUserRecord = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);
    
    const currentUserId = currentUserRecord[0]?.id;

    const searchParams = request.nextUrl.searchParams;
    const ownerFilter = searchParams.get('owner');
    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';

    let whereConditions;
    if (ownerFilter === 'all' && isAdmin) {
      whereConditions = eq(propertyPipeline.clerkOrgId, orgId);
    } else if (ownerFilter === 'unassigned' && isAdmin) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        isNull(propertyPipeline.ownerId)
      );
    } else if (ownerFilter && ownerFilter !== 'mine' && isAdmin) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.ownerId, ownerFilter)
      );
    } else if (currentUserId) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.ownerId, currentUserId)
      );
    } else {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        isNull(propertyPipeline.ownerId)
      );
    }

    const pipelineItems = await db
      .select({
        id: propertyPipeline.id,
        propertyId: propertyPipeline.propertyId,
        status: propertyPipeline.status,
        dealValue: propertyPipeline.dealValue,
        statusChangedAt: propertyPipeline.statusChangedAt,
        ownerId: propertyPipeline.ownerId,
        propertyAddress: properties.regridAddress,
        propertyCity: properties.city,
        propertyState: properties.state,
        propertyZip: properties.zip,
        commonName: properties.commonName,
        category: properties.assetCategory,
        subcategory: properties.assetSubcategory,
        ownerFirstName: users.firstName,
        ownerLastName: users.lastName,
        ownerProfileImageUrl: users.profileImageUrl,
      })
      .from(propertyPipeline)
      .innerJoin(properties, eq(propertyPipeline.propertyId, properties.id))
      .leftJoin(users, eq(propertyPipeline.ownerId, users.id))
      .where(whereConditions)
      .orderBy(desc(propertyPipeline.statusChangedAt));

    const grouped: Record<string, typeof pipelineItems> = {
      new: [],
      qualified: [],
      attempted_contact: [],
      active_opportunity: [],
      won: [],
      lost: [],
      disqualified: [],
    };

    for (const item of pipelineItems) {
      if (grouped[item.status]) {
        grouped[item.status].push(item);
      }
    }

    const counts: Record<string, number> = {};
    for (const status of Object.keys(grouped)) {
      counts[status] = grouped[status].length;
    }

    return NextResponse.json({
      items: grouped,
      counts,
    });
  } catch (error) {
    console.error('Error fetching pipeline board:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline board data' }, { status: 500 });
  }
}
