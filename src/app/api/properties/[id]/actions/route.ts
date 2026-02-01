import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyActions, users, notifications } from '@/lib/schema';
import { eq, and, desc } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DCAD_KEY_REGEX = /^[0-9A-Z]{17,20}$/i;

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
    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({ id: properties.id, regridAddress: properties.regridAddress })
      .from(properties)
      .where(isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const actions = await db
      .select({
        id: propertyActions.id,
        actionType: propertyActions.actionType,
        description: propertyActions.description,
        dueAt: propertyActions.dueAt,
        status: propertyActions.status,
        completedAt: propertyActions.completedAt,
        createdAt: propertyActions.createdAt,
        createdByUserId: propertyActions.createdByUserId,
        assignedToUserId: propertyActions.assignedToUserId,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
        creatorProfileImage: users.profileImageUrl,
      })
      .from(propertyActions)
      .leftJoin(users, eq(users.id, propertyActions.createdByUserId))
      .where(
        and(
          eq(propertyActions.propertyId, property.id),
          eq(propertyActions.clerkOrgId, authData.orgId)
        )
      )
      .orderBy(desc(propertyActions.dueAt));

    return NextResponse.json({
      actions: actions.map(a => ({
        id: a.id,
        actionType: a.actionType,
        description: a.description,
        dueAt: a.dueAt,
        status: a.status,
        completedAt: a.completedAt,
        createdAt: a.createdAt,
        assignedToUserId: a.assignedToUserId,
        createdBy: {
          id: a.createdByUserId,
          firstName: a.creatorFirstName,
          lastName: a.creatorLastName,
          profileImage: a.creatorProfileImage,
        },
      })),
    });
  } catch (error) {
    console.error('[Actions API] Error fetching actions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { actionType, description, dueAt, assignedToUserId } = body;

    if (!actionType || !dueAt) {
      return NextResponse.json({ error: 'Action type and due date are required' }, { status: 400 });
    }

    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({ id: properties.id, regridAddress: properties.regridAddress })
      .from(properties)
      .where(isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const assignTo = assignedToUserId || session.user.id;

    const [action] = await db
      .insert(propertyActions)
      .values({
        propertyId: property.id,
        clerkOrgId: authData.orgId,
        createdByUserId: session.user.id,
        assignedToUserId: assignTo,
        actionType,
        description: description || null,
        dueAt: new Date(dueAt),
      })
      .returning();

    if (assignTo !== session.user.id) {
      await db.insert(notifications).values({
        clerkOrgId: authData.orgId,
        recipientUserId: assignTo,
        senderUserId: session.user.id,
        type: 'action_assigned',
        propertyId: property.id,
        actionId: action.id,
        title: 'New follow-up assigned',
        message: `${session.user.firstName} assigned you a follow-up for ${property.regridAddress || 'a property'}`,
      });
    }

    return NextResponse.json({
      action: {
        id: action.id,
        actionType: action.actionType,
        description: action.description,
        dueAt: action.dueAt,
        status: action.status,
        createdAt: action.createdAt,
        assignedToUserId: action.assignedToUserId,
        createdBy: {
          id: session.user.id,
          firstName: session.user.firstName,
          lastName: session.user.lastName,
          profileImage: session.user.profileImageUrl,
        },
      },
    });
  } catch (error) {
    console.error('[Actions API] Error creating action:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { actionId, status } = body;

    if (!actionId || !status) {
      return NextResponse.json({ error: 'Action ID and status are required' }, { status: 400 });
    }

    const updateData: { status: string; completedAt?: Date | null } = { status };
    if (status === 'completed') {
      updateData.completedAt = new Date();
    } else if (status === 'pending') {
      updateData.completedAt = null;
    }

    const [updated] = await db
      .update(propertyActions)
      .set(updateData)
      .where(
        and(
          eq(propertyActions.id, actionId),
          eq(propertyActions.clerkOrgId, authData.orgId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json({ action: updated });
  } catch (error) {
    console.error('[Actions API] Error updating action:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
