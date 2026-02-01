import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userLists, listItems, properties, contacts } from '@/lib/schema';
import { eq, and, inArray } from 'drizzle-orm';
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

    const { id: listId } = await params;

    if (!listId || !UUID_REGEX.test(listId)) {
      return NextResponse.json({ error: 'Invalid list ID format' }, { status: 400 });
    }

    // Get list with ownership check
    const [list] = await db
      .select({
        id: userLists.id,
        listType: userLists.listType,
        listName: userLists.listName,
      })
      .from(userLists)
      .where(and(eq(userLists.id, listId), eq(userLists.userId, session.user.id)));

    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    // Get all list items
    const items = await db
      .select({
        id: listItems.id,
        itemId: listItems.itemId,
        addedAt: listItems.addedAt,
      })
      .from(listItems)
      .where(eq(listItems.listId, listId))
      .orderBy(listItems.addedAt);

    if (items.length === 0) {
      return NextResponse.json({ items: [], details: {} });
    }

    const itemIds = items.map(item => item.itemId);
    const details: Record<string, unknown> = {};

    if (list.listType === 'properties') {
      // Batch fetch all properties
      const propertyRecords = await db
        .select({
          id: properties.id,
          propertyKey: properties.propertyKey,
          regridAddress: properties.regridAddress,
          validatedAddress: properties.validatedAddress,
          city: properties.city,
          state: properties.state,
          assetCategory: properties.assetCategory,
          assetSubcategory: properties.assetSubcategory,
          commonName: properties.commonName,
          enrichmentStatus: properties.enrichmentStatus,
        })
        .from(properties)
        .where(inArray(properties.id, itemIds));

      for (const prop of propertyRecords) {
        details[prop.id] = {
          ...prop,
          address: prop.validatedAddress || prop.regridAddress,
        };
      }
    } else if (list.listType === 'contacts') {
      // Batch fetch all contacts
      const contactRecords = await db
        .select({
          id: contacts.id,
          fullName: contacts.fullName,
          email: contacts.email,
          emailStatus: contacts.emailStatus,
          emailValidationStatus: contacts.emailValidationStatus,
          title: contacts.title,
          employerName: contacts.employerName,
          phone: contacts.phone,
          phoneLabel: contacts.phoneLabel,
          enrichmentPhoneWork: contacts.enrichmentPhoneWork,
          enrichmentPhonePersonal: contacts.enrichmentPhonePersonal,
          aiPhone: contacts.aiPhone,
          aiPhoneLabel: contacts.aiPhoneLabel,
          linkedinUrl: contacts.linkedinUrl,
        })
        .from(contacts)
        .where(inArray(contacts.id, itemIds));

      for (const contact of contactRecords) {
        details[contact.id] = contact;
      }
    }

    return NextResponse.json({ items, details });
  } catch (error) {
    console.error('List items API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch list items' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id: listId } = await params;

    if (!listId || !UUID_REGEX.test(listId)) {
      return NextResponse.json({ error: 'Invalid list ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { itemId } = body;

    if (!itemId || !UUID_REGEX.test(itemId)) {
      return NextResponse.json({ error: 'Valid itemId is required' }, { status: 400 });
    }

    const [existingList] = await db
      .select({ id: userLists.id })
      .from(userLists)
      .where(and(eq(userLists.id, listId), eq(userLists.userId, session.user.id)));

    if (!existingList) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    const [existingItem] = await db
      .select({ id: listItems.id })
      .from(listItems)
      .where(and(eq(listItems.listId, listId), eq(listItems.itemId, itemId)));

    if (existingItem) {
      return NextResponse.json({ error: 'Item already in list' }, { status: 409 });
    }

    const [newItem] = await db
      .insert(listItems)
      .values({
        listId,
        itemId,
      })
      .returning();

    return NextResponse.json({ item: newItem }, { status: 201 });
  } catch (error) {
    console.error('List items API POST error:', error);
    return NextResponse.json({ error: 'Failed to add item to list' }, { status: 500 });
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

    const { id: listId } = await params;

    if (!listId || !UUID_REGEX.test(listId)) {
      return NextResponse.json({ error: 'Invalid list ID format' }, { status: 400 });
    }

    const [existingList] = await db
      .select({ id: userLists.id })
      .from(userLists)
      .where(and(eq(userLists.id, listId), eq(userLists.userId, session.user.id)));

    if (!existingList) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const itemId = searchParams.get('itemId');

    if (!itemId || !UUID_REGEX.test(itemId)) {
      return NextResponse.json({ error: 'Valid itemId is required' }, { status: 400 });
    }

    const [existingItem] = await db
      .select({ id: listItems.id })
      .from(listItems)
      .where(and(eq(listItems.listId, listId), eq(listItems.itemId, itemId)));

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found in list' }, { status: 404 });
    }

    await db
      .delete(listItems)
      .where(and(eq(listItems.listId, listId), eq(listItems.itemId, itemId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('List items API DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove item from list' }, { status: 500 });
  }
}
