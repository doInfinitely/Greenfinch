import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userLists, listItems } from '@/lib/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid list ID format' }, { status: 400 });
    }

    const [listWithCount] = await db
      .select({
        id: userLists.id,
        userId: userLists.userId,
        listName: userLists.listName,
        listType: userLists.listType,
        createdAt: userLists.createdAt,
        itemCount: sql<number>`count(${listItems.id})::int`,
      })
      .from(userLists)
      .leftJoin(listItems, eq(userLists.id, listItems.listId))
      .where(and(eq(userLists.id, id), eq(userLists.userId, session.user.id)))
      .groupBy(userLists.id, userLists.userId, userLists.listName, userLists.listType, userLists.createdAt);

    if (!listWithCount) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    const items = await db
      .select({
        id: listItems.id,
        itemId: listItems.itemId,
        addedAt: listItems.addedAt,
      })
      .from(listItems)
      .where(eq(listItems.listId, id))
      .orderBy(listItems.addedAt);

    return NextResponse.json({ list: listWithCount, items });
  } catch (error) {
    console.error('List detail API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch list' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid list ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { listName } = body;

    if (!listName || typeof listName !== 'string' || listName.trim().length === 0) {
      return NextResponse.json({ error: 'List name is required' }, { status: 400 });
    }

    const [existingList] = await db
      .select({ id: userLists.id })
      .from(userLists)
      .where(and(eq(userLists.id, id), eq(userLists.userId, session.user.id)));

    if (!existingList) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    const [updatedList] = await db
      .update(userLists)
      .set({ listName: listName.trim() })
      .where(eq(userLists.id, id))
      .returning();

    return NextResponse.json({ list: updatedList });
  } catch (error) {
    console.error('List detail API PUT error:', error);
    return NextResponse.json({ error: 'Failed to update list' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid list ID format' }, { status: 400 });
    }

    const [existingList] = await db
      .select({ id: userLists.id })
      .from(userLists)
      .where(and(eq(userLists.id, id), eq(userLists.userId, session.user.id)));

    if (!existingList) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    await db.delete(listItems).where(eq(listItems.listId, id));
    await db.delete(userLists).where(eq(userLists.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('List detail API DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete list' }, { status: 500 });
  }
}
