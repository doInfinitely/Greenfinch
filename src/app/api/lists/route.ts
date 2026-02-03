import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userLists, listItems } from '@/lib/schema';
import { eq, sql, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = session.user.id;
    const searchParams = request.nextUrl.searchParams;
    const typeFilter = searchParams.get('type');

    // Build where conditions
    const conditions = [eq(userLists.userId, userId)];
    if (typeFilter && ['properties', 'contacts'].includes(typeFilter)) {
      conditions.push(eq(userLists.listType, typeFilter));
    }

    const listsWithCount = await db
      .select({
        id: userLists.id,
        listName: userLists.listName,
        listType: userLists.listType,
        createdAt: userLists.createdAt,
        itemCount: sql<number>`count(${listItems.id})::int`,
      })
      .from(userLists)
      .leftJoin(listItems, eq(userLists.id, listItems.listId))
      .where(and(...conditions))
      .groupBy(userLists.id, userLists.listName, userLists.listType, userLists.createdAt)
      .orderBy(userLists.createdAt);

    return NextResponse.json({ lists: listsWithCount });
  } catch (error) {
    console.error('Lists API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch lists' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await request.json();
    const { listName, listType } = body;

    if (!listName || typeof listName !== 'string' || listName.trim().length === 0) {
      return NextResponse.json({ error: 'List name is required' }, { status: 400 });
    }

    if (!listType || !['properties', 'contacts'].includes(listType)) {
      return NextResponse.json({ error: 'List type must be "properties" or "contacts"' }, { status: 400 });
    }

    const [newList] = await db
      .insert(userLists)
      .values({
        userId,
        listName: listName.trim(),
        listType,
      })
      .returning();

    return NextResponse.json({ list: { ...newList, itemCount: 0 } }, { status: 201 });
  } catch (error) {
    console.error('Lists API POST error:', error);
    return NextResponse.json({ error: 'Failed to create list' }, { status: 500 });
  }
}
