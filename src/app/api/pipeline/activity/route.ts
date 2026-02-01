import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { propertyActions, notifications, users, properties } from '@/lib/schema';
import { eq, and, desc, gte, sql, or } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20);

    const pendingActions = await db
      .select({
        id: propertyActions.id,
        propertyId: propertyActions.propertyId,
        actionType: propertyActions.actionType,
        description: propertyActions.description,
        dueAt: propertyActions.dueAt,
        status: propertyActions.status,
        createdAt: propertyActions.createdAt,
        propertyAddress: properties.regridAddress,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
      })
      .from(propertyActions)
      .innerJoin(properties, eq(properties.id, propertyActions.propertyId))
      .leftJoin(users, eq(users.id, propertyActions.createdByUserId))
      .where(
        and(
          eq(propertyActions.assignedToUserId, session.user.id),
          eq(propertyActions.clerkOrgId, authData.orgId),
          or(
            eq(propertyActions.status, 'pending'),
            eq(propertyActions.status, 'overdue')
          )
        )
      )
      .orderBy(propertyActions.dueAt)
      .limit(limit);

    const recentMentions = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        isRead: notifications.isRead,
        createdAt: notifications.createdAt,
        propertyId: notifications.propertyId,
        propertyAddress: properties.regridAddress,
        senderFirstName: users.firstName,
        senderLastName: users.lastName,
        senderProfileImage: users.profileImageUrl,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.senderUserId))
      .leftJoin(properties, eq(properties.id, notifications.propertyId))
      .where(
        and(
          eq(notifications.recipientUserId, session.user.id),
          eq(notifications.clerkOrgId, authData.orgId),
          eq(notifications.type, 'mention')
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return NextResponse.json({
      pendingActions: pendingActions.map(a => ({
        id: a.id,
        propertyId: a.propertyId,
        actionType: a.actionType,
        description: a.description,
        dueAt: a.dueAt,
        status: a.status,
        createdAt: a.createdAt,
        propertyAddress: a.propertyAddress,
        createdBy: a.creatorFirstName ? {
          firstName: a.creatorFirstName,
          lastName: a.creatorLastName,
        } : null,
      })),
      recentMentions: recentMentions.map(m => ({
        id: m.id,
        type: m.type,
        title: m.title,
        message: m.message,
        isRead: m.isRead,
        createdAt: m.createdAt,
        propertyId: m.propertyId,
        propertyAddress: m.propertyAddress,
        sender: m.senderFirstName ? {
          firstName: m.senderFirstName,
          lastName: m.senderLastName,
          profileImage: m.senderProfileImage,
        } : null,
      })),
    });
  } catch (error) {
    console.error('[Pipeline Activity API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
