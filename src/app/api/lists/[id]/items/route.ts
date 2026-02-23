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

    // Get list with ownership check - filter by userId in SQL to prevent enumeration attacks
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

    const itemIds = items.map(item => item.itemId).filter((id): id is string => id !== null);
    const details: Record<string, unknown> = {};

    if (itemIds.length === 0) {
      return NextResponse.json({ items, details });
    }

    // Try to fetch from the expected table based on list type
    // Also check the other table for any mismatched items (legacy data)
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
          _type: 'property',
        };
      }
      
      // Check for any mismatched contacts in this properties list (legacy data fix)
      const missingIds = itemIds.filter(id => !details[id]);
      if (missingIds.length > 0) {
        const contactRecords = await db
          .select({
            id: contacts.id,
            fullName: contacts.fullName,
            email: contacts.email,
          })
          .from(contacts)
          .where(inArray(contacts.id, missingIds));
        
        for (const contact of contactRecords) {
          details[contact.id] = {
            ...contact,
            _type: 'contact',
            _mismatch: true, // Flag as mismatched type
          };
        }
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
        details[contact.id] = {
          ...contact,
          _type: 'contact',
        };
      }
      
      // Check for any mismatched properties in this contacts list (legacy data fix)
      const missingIds = itemIds.filter(id => !details[id]);
      if (missingIds.length > 0) {
        const propertyRecords = await db
          .select({
            id: properties.id,
            propertyKey: properties.propertyKey,
            regridAddress: properties.regridAddress,
            validatedAddress: properties.validatedAddress,
            commonName: properties.commonName,
          })
          .from(properties)
          .where(inArray(properties.id, missingIds));
        
        for (const prop of propertyRecords) {
          details[prop.id] = {
            ...prop,
            address: prop.validatedAddress || prop.regridAddress,
            _type: 'property',
            _mismatch: true, // Flag as mismatched type
          };
        }
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
    const { itemId, itemIds } = body;

    // Determine if this is a bulk request or single item request
    const isBulk = itemIds !== undefined;
    const idsToAdd = isBulk ? itemIds : (itemId ? [itemId] : []);

    if (!idsToAdd || !Array.isArray(idsToAdd) || idsToAdd.length === 0) {
      return NextResponse.json(
        { error: 'Valid itemId or itemIds array is required' },
        { status: 400 }
      );
    }

    // Validate all IDs have correct format
    for (const id of idsToAdd) {
      if (!id || !UUID_REGEX.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID format' },
          { status: 400 }
        );
      }
    }

    const [existingList] = await db
      .select({ id: userLists.id, listType: userLists.listType })
      .from(userLists)
      .where(and(eq(userLists.id, listId), eq(userLists.userId, session.user.id)));

    if (!existingList) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    // For bulk requests, skip individual type validation and let the database constraints handle it
    // For single requests, validate for better error messages
    if (!isBulk) {
      if (existingList.listType === 'properties') {
        const [propertyExists] = await db
          .select({ id: properties.id })
          .from(properties)
          .where(eq(properties.id, itemId))
          .limit(1);
        
        if (!propertyExists) {
          return NextResponse.json(
            { error: 'Property not found. Cannot add contacts to a properties list.' },
            { status: 400 }
          );
        }
      } else if (existingList.listType === 'contacts') {
        const [contactExists] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.id, itemId))
          .limit(1);
        
        if (!contactExists) {
          return NextResponse.json(
            { error: 'Contact not found. Cannot add properties to a contacts list.' },
            { status: 400 }
          );
        }
      }
    }

    // Get items already in the list with a single query
    const existingItems = await db
      .select({ itemId: listItems.itemId })
      .from(listItems)
      .where(
        and(
          eq(listItems.listId, listId),
          inArray(listItems.itemId, idsToAdd)
        )
      );

    const existingItemIds = new Set(existingItems.map(item => item.itemId));
    const newItemIds = idsToAdd.filter(id => !existingItemIds.has(id));
    const alreadyExistsCount = existingItemIds.size;

    // If bulk request and all items already exist, return early
    if (isBulk && newItemIds.length === 0) {
      return NextResponse.json(
        { added: 0, alreadyExists: alreadyExistsCount },
        { status: 200 }
      );
    }

    // If single item request and it already exists, return error for backward compatibility
    if (!isBulk && alreadyExistsCount > 0) {
      return NextResponse.json({ error: 'Item already in list' }, { status: 409 });
    }

    // Bulk insert all new items
    if (newItemIds.length > 0) {
      await db
        .insert(listItems)
        .values(
          newItemIds.map(id => ({
            listId,
            itemId: id,
          }))
        );
    }

    if (isBulk) {
      return NextResponse.json(
        { added: newItemIds.length, alreadyExists: alreadyExistsCount },
        { status: 201 }
      );
    } else {
      // For single item requests, return the created item for backward compatibility
      const [newItem] = await db
        .select()
        .from(listItems)
        .where(and(eq(listItems.listId, listId), eq(listItems.itemId, itemId)))
        .limit(1);

      return NextResponse.json({ item: newItem }, { status: 201 });
    }
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
