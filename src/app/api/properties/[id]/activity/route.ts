import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { propertyActivity, users } from '@/lib/schema';
import { eq, and, desc } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { resolveProperty, isValidPropertyId } from '@/lib/property-resolver';

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

    const activities = await db
      .select({
        id: propertyActivity.id,
        activityType: propertyActivity.activityType,
        previousValue: propertyActivity.previousValue,
        newValue: propertyActivity.newValue,
        metadata: propertyActivity.metadata,
        createdAt: propertyActivity.createdAt,
        userId: propertyActivity.userId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userProfileImage: users.profileImageUrl,
      })
      .from(propertyActivity)
      .leftJoin(users, eq(users.id, propertyActivity.userId))
      .where(
        and(
          eq(propertyActivity.propertyId, property.id),
          eq(propertyActivity.clerkOrgId, authData.orgId)
        )
      )
      .orderBy(desc(propertyActivity.createdAt))
      .limit(50);

    return NextResponse.json({
      activities: activities.map(a => ({
        id: a.id,
        activityType: a.activityType,
        previousValue: a.previousValue,
        newValue: a.newValue,
        metadata: a.metadata,
        createdAt: a.createdAt,
        user: {
          id: a.userId,
          firstName: a.userFirstName,
          lastName: a.userLastName,
          profileImage: a.userProfileImage,
        },
      })),
    });
  } catch (error) {
    console.error('[Activity API] Error fetching activity:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
