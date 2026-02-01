import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notifications, users, properties } from '@/lib/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
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
    const unreadOnly = searchParams.get('unread') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    let query = db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        isRead: notifications.isRead,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        propertyId: notifications.propertyId,
        noteId: notifications.noteId,
        actionId: notifications.actionId,
        senderFirstName: users.firstName,
        senderLastName: users.lastName,
        senderProfileImage: users.profileImageUrl,
        propertyAddress: properties.regridAddress,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.senderUserId))
      .leftJoin(properties, eq(properties.id, notifications.propertyId))
      .where(
        and(
          eq(notifications.recipientUserId, session.user.id),
          eq(notifications.clerkOrgId, authData.orgId),
          unreadOnly ? eq(notifications.isRead, false) : sql`1=1`
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    const results = await query;

    const unreadCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, session.user.id),
          eq(notifications.clerkOrgId, authData.orgId),
          eq(notifications.isRead, false)
        )
      );

    return NextResponse.json({
      notifications: results.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        readAt: n.readAt,
        createdAt: n.createdAt,
        propertyId: n.propertyId,
        noteId: n.noteId,
        actionId: n.actionId,
        sender: n.senderFirstName ? {
          firstName: n.senderFirstName,
          lastName: n.senderLastName,
          profileImage: n.senderProfileImage,
        } : null,
        propertyAddress: n.propertyAddress,
      })),
      unreadCount: Number(unreadCount[0]?.count || 0),
    });
  } catch (error) {
    console.error('[Notifications API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
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
    const { notificationIds, markAllRead } = body;

    if (markAllRead) {
      await db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientUserId, session.user.id),
            eq(notifications.clerkOrgId, authData.orgId),
            eq(notifications.isRead, false)
          )
        );
    } else if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      for (const id of notificationIds) {
        await db
          .update(notifications)
          .set({ isRead: true, readAt: new Date() })
          .where(
            and(
              eq(notifications.id, id),
              eq(notifications.recipientUserId, session.user.id)
            )
          );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Notifications API] Error marking read:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
