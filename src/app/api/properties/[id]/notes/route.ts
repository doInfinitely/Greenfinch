import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyNotes, propertyActivity, users, notifications } from '@/lib/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
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
      .select({ id: properties.id })
      .from(properties)
      .where(isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const notes = await db
      .select({
        id: propertyNotes.id,
        content: propertyNotes.content,
        createdAt: propertyNotes.createdAt,
        updatedAt: propertyNotes.updatedAt,
        userId: propertyNotes.userId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userProfileImage: users.profileImageUrl,
      })
      .from(propertyNotes)
      .leftJoin(users, eq(users.id, propertyNotes.userId))
      .where(
        and(
          eq(propertyNotes.propertyId, property.id),
          eq(propertyNotes.clerkOrgId, authData.orgId)
        )
      )
      .orderBy(desc(propertyNotes.createdAt));

    return NextResponse.json({
      notes: notes.map(n => ({
        id: n.id,
        content: n.content,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        user: {
          id: n.userId,
          firstName: n.userFirstName,
          lastName: n.userLastName,
          profileImage: n.userProfileImage,
        },
      })),
    });
  } catch (error) {
    console.error('[Notes API] Error fetching notes:', error);
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
    const { content, mentionedUserIds } = body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Note content is required' }, { status: 400 });
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

    const [note] = await db
      .insert(propertyNotes)
      .values({
        propertyId: property.id,
        clerkOrgId: authData.orgId,
        userId: session.user.id,
        content: content.trim(),
      })
      .returning();

    await db.insert(propertyActivity).values({
      propertyId: property.id,
      clerkOrgId: authData.orgId,
      userId: session.user.id,
      activityType: 'note_added',
      newValue: content.trim().substring(0, 100),
    });

    if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      const validUserIds = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, mentionedUserIds));
      
      const validIds = new Set(validUserIds.map(u => u.id));
      
      const senderName = [session.user.firstName, session.user.lastName].filter(Boolean).join(' ') || 'Someone';
      const addressPreview = property.regridAddress || 'a property';
      
      for (const userId of mentionedUserIds) {
        if (userId !== session.user.id && validIds.has(userId)) {
          await db.insert(notifications).values({
            clerkOrgId: authData.orgId,
            recipientUserId: userId,
            senderUserId: session.user.id,
            type: 'mention',
            propertyId: property.id,
            noteId: note.id,
            title: `${senderName} mentioned you`,
            message: `In a note on ${addressPreview}: "${content.trim().substring(0, 100)}${content.length > 100 ? '...' : ''}"`,
          });
        }
      }
    }

    return NextResponse.json({
      note: {
        id: note.id,
        content: note.content,
        createdAt: note.createdAt,
        user: {
          id: session.user.id,
          firstName: session.user.firstName,
          lastName: session.user.lastName,
          profileImage: session.user.profileImageUrl,
        },
      },
    });
  } catch (error) {
    console.error('[Notes API] Error creating note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
