import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, propertyContacts, contactOrganizations, properties, organizations } from '@/lib/schema';
import { eq, ilike, or, sql, desc, asc, and, inArray } from 'drizzle-orm';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface CursorData {
  id: string;
  sortValue: any;
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

function decodeCursor(cursorStr: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursorStr, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();
    const emailStatus = searchParams.get('emailStatus');
    const title = searchParams.get('title');
    const organizationId = searchParams.get('organizationId');
    const propertyCount = searchParams.get('propertyCount');
    const hasValidEmail = searchParams.get('hasValidEmail') === 'true';
    const hasPhone = searchParams.get('hasPhone') === 'true';
    const hasLinkedIn = searchParams.get('hasLinkedIn') === 'true';
    const cursor = searchParams.get('cursor');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));
    const sortBy = searchParams.get('sortBy') || 'fullName';
    const sortOrder = searchParams.get('sortOrder') || 'asc';
    
    // Determine if using cursor or offset pagination
    const useCursor = !!cursor;
    let offset = 0;
    let decodedCursor: CursorData | null = null;

    if (useCursor) {
      decodedCursor = decodeCursor(cursor);
      if (!decodedCursor) {
        return NextResponse.json(
          { error: 'Invalid cursor' },
          { status: 400 }
        );
      }
    } else {
      offset = (page - 1) * limit;
    }

    const conditions = [];

    if (query) {
      conditions.push(
        or(
          ilike(contacts.fullName, `%${query}%`),
          ilike(contacts.email, `%${query}%`),
          ilike(contacts.phone, `%${query}%`),
          ilike(contacts.employerName, `%${query}%`),
          ilike(contacts.title, `%${query}%`)
        )
      );
    }

    if (emailStatus) {
      conditions.push(eq(contacts.emailStatus, emailStatus));
    }

    if (title) {
      conditions.push(ilike(contacts.title, `%${title}%`));
    }

    // Filter by organization - find contacts linked to a specific org
    if (organizationId) {
      const contactIdsInOrg = db
        .select({ contactId: contactOrganizations.contactId })
        .from(contactOrganizations)
        .where(eq(contactOrganizations.orgId, organizationId));
      conditions.push(sql`${contacts.id} IN (${contactIdsInOrg})`);
    }

    // Filter by contact info availability
    if (hasValidEmail) {
      conditions.push(eq(contacts.emailValidationStatus, 'valid'));
    }

    if (hasPhone) {
      conditions.push(
        or(
          sql`${contacts.enrichmentPhoneWork} IS NOT NULL AND ${contacts.enrichmentPhoneWork} != ''`,
          sql`${contacts.enrichmentPhonePersonal} IS NOT NULL AND ${contacts.enrichmentPhonePersonal} != ''`,
          sql`${contacts.aiPhone} IS NOT NULL AND ${contacts.aiPhone} != '' AND ${contacts.aiPhoneLabel} != 'office'`,
          sql`${contacts.phone} IS NOT NULL AND ${contacts.phone} != '' AND ${contacts.phoneLabel} != 'office'`
        )
      );
    }

    if (hasLinkedIn) {
      conditions.push(sql`${contacts.linkedinUrl} IS NOT NULL AND ${contacts.linkedinUrl} != ''`);
    }

    // Property count filter will be applied after subquery join
    let propertyCountCondition: any = null;
    if (propertyCount && propertyCount !== 'all') {
      if (propertyCount === '1') {
        propertyCountCondition = sql`COALESCE(property_counts.property_count, 0) = 1`;
      } else if (propertyCount === '2-5') {
        propertyCountCondition = sql`COALESCE(property_counts.property_count, 0) >= 2 AND COALESCE(property_counts.property_count, 0) <= 5`;
      } else if (propertyCount === '6-10') {
        propertyCountCondition = sql`COALESCE(property_counts.property_count, 0) >= 6 AND COALESCE(property_counts.property_count, 0) <= 10`;
      } else if (propertyCount === '10+') {
        propertyCountCondition = sql`COALESCE(property_counts.property_count, 0) > 10`;
      }
    }

    const propertyCountSubquery = db
      .select({
        contactId: propertyContacts.contactId,
        count: sql<number>`count(*)::int`.as('property_count'),
      })
      .from(propertyContacts)
      .groupBy(propertyContacts.contactId)
      .as('property_counts');

    const orgCountSubquery = db
      .select({
        contactId: contactOrganizations.contactId,
        count: sql<number>`count(*)::int`.as('org_count'),
      })
      .from(contactOrganizations)
      .groupBy(contactOrganizations.contactId)
      .as('org_counts');

    let baseQuery = db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        phoneLabel: contacts.phoneLabel,
        phoneExtension: contacts.phoneExtension,
        aiPhone: contacts.aiPhone,
        aiPhoneLabel: contacts.aiPhoneLabel,
        enrichmentPhoneWork: contacts.enrichmentPhoneWork,
        enrichmentPhonePersonal: contacts.enrichmentPhonePersonal,
        title: contacts.title,
        employerName: contacts.employerName,
        emailStatus: contacts.emailStatus,
        emailValidationStatus: contacts.emailValidationStatus,
        linkedinUrl: contacts.linkedinUrl,
        photoUrl: contacts.photoUrl,
        location: contacts.location,
        source: contacts.source,
        createdAt: contacts.createdAt,
        propertyCount: sql<number>`COALESCE(${propertyCountSubquery.count}, 0)`.as('property_count'),
        organizationCount: sql<number>`COALESCE(${orgCountSubquery.count}, 0)`.as('org_count'),
      })
      .from(contacts)
      .leftJoin(propertyCountSubquery, eq(contacts.id, propertyCountSubquery.contactId))
      .leftJoin(orgCountSubquery, eq(contacts.id, orgCountSubquery.contactId));

    // Apply filter conditions
    const allConditions = [...conditions];
    if (propertyCountCondition) {
      allConditions.push(propertyCountCondition);
    }
    if (allConditions.length > 0) {
      baseQuery = baseQuery.where(and(...allConditions)) as typeof baseQuery;
    }

    // Determine sort column and expression
    let sortColumn: any;
    let orderExpression: any;
    let isCountSort = false;

    if (sortBy === 'propertyCount') {
      sortColumn = 'propertyCount';
      isCountSort = true;
      orderExpression = sortOrder === 'desc' 
        ? sql`COALESCE(${propertyCountSubquery.count}, 0) DESC`
        : sql`COALESCE(${propertyCountSubquery.count}, 0) ASC`;
    } else if (sortBy === 'organizationCount') {
      sortColumn = 'organizationCount';
      isCountSort = true;
      orderExpression = sortOrder === 'desc'
        ? sql`COALESCE(${orgCountSubquery.count}, 0) DESC`
        : sql`COALESCE(${orgCountSubquery.count}, 0) ASC`;
    } else {
      if (sortBy === 'email') {
        sortColumn = contacts.email;
      } else if (sortBy === 'title') {
        sortColumn = contacts.title;
      } else if (sortBy === 'employerName') {
        sortColumn = contacts.employerName;
      } else if (sortBy === 'emailStatus') {
        sortColumn = contacts.emailStatus;
      } else if (sortBy === 'createdAt') {
        sortColumn = contacts.createdAt;
      } else {
        sortColumn = contacts.fullName;
      }
      orderExpression = sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn);
    }

    // Apply cursor condition if using cursor pagination
    if (useCursor && decodedCursor) {
      let cursorCondition;
      if (isCountSort) {
        const countExpr = sortColumn === 'propertyCount' ? propertyCountSubquery.count : orgCountSubquery.count;
        if (sortOrder === 'asc') {
          cursorCondition = sql`COALESCE(${countExpr}, 0) > ${decodedCursor.sortValue} 
            OR (COALESCE(${countExpr}, 0) = ${decodedCursor.sortValue} AND ${contacts.id} > ${decodedCursor.id})`;
        } else {
          cursorCondition = sql`COALESCE(${countExpr}, 0) < ${decodedCursor.sortValue} 
            OR (COALESCE(${countExpr}, 0) = ${decodedCursor.sortValue} AND ${contacts.id} < ${decodedCursor.id})`;
        }
      } else {
        if (sortOrder === 'asc') {
          cursorCondition = sql`${sortColumn} > ${decodedCursor.sortValue} OR (${sortColumn} = ${decodedCursor.sortValue} AND ${contacts.id} > ${decodedCursor.id})`;
        } else {
          cursorCondition = sql`${sortColumn} < ${decodedCursor.sortValue} OR (${sortColumn} = ${decodedCursor.sortValue} AND ${contacts.id} < ${decodedCursor.id})`;
        }
      }
      baseQuery = baseQuery.where(cursorCondition) as typeof baseQuery;
    }

    // Fetch one extra to determine if there are more items
    const fetchLimit = useCursor ? limit + 1 : limit;
    
    const contactsList = await baseQuery
      .orderBy(orderExpression)
      .limit(fetchLimit)
      .offset(!useCursor ? offset : 0);

    // Check if there are more items for cursor pagination
    let hasMore = false;
    let displayList = contactsList;
    
    if (useCursor && contactsList.length > limit) {
      hasMore = true;
      displayList = contactsList.slice(0, limit);
    }

    // Batch fetch property relations for all contacts (fix N+1)
    const contactIds = displayList.map(c => c.id);
    
    const allPropertyRelations = contactIds.length > 0 ? await db
      .select({
        contactId: propertyContacts.contactId,
        propertyId: propertyContacts.propertyId,
        role: propertyContacts.role,
        propertyKey: properties.propertyKey,
        address: properties.regridAddress,
        city: properties.city,
        state: properties.state,
      })
      .from(propertyContacts)
      .leftJoin(properties, eq(propertyContacts.propertyId, properties.id))
      .where(inArray(propertyContacts.contactId, contactIds)) : [];

    // Batch fetch org relations for all contacts (fix N+1)
    const allOrgRelations = contactIds.length > 0 ? await db
      .select({
        contactId: contactOrganizations.contactId,
        orgId: contactOrganizations.orgId,
        title: contactOrganizations.title,
        orgName: organizations.name,
        orgDomain: organizations.domain,
      })
      .from(contactOrganizations)
      .leftJoin(organizations, eq(contactOrganizations.orgId, organizations.id))
      .where(inArray(contactOrganizations.contactId, contactIds)) : [];

    // Group relations by contactId
    const propsByContact = new Map<string, typeof allPropertyRelations>();
    for (const rel of allPropertyRelations) {
      if (!rel.contactId) continue;
      const existing = propsByContact.get(rel.contactId) || [];
      if (existing.length < 5) { // Limit to 5 per contact
        existing.push(rel);
        propsByContact.set(rel.contactId, existing);
      }
    }

    const orgsByContact = new Map<string, typeof allOrgRelations>();
    for (const rel of allOrgRelations) {
      if (!rel.contactId) continue;
      const existing = orgsByContact.get(rel.contactId) || [];
      if (existing.length < 5) { // Limit to 5 per contact
        existing.push(rel);
        orgsByContact.set(rel.contactId, existing);
      }
    }

    const contactsWithRelations = displayList.map((contact) => ({
      ...contact,
      properties: (propsByContact.get(contact.id) || []).map(({ contactId, ...rest }) => rest),
      organizations: (orgsByContact.get(contact.id) || []).map(({ contactId, ...rest }) => rest),
    }));

    // Generate next cursor if there are more items
    let nextCursor: string | null = null;
    if (hasMore && displayList.length > 0) {
      const lastItem = displayList[displayList.length - 1];
      let sortValue;

      if (sortBy === 'propertyCount') {
        sortValue = lastItem.propertyCount;
      } else if (sortBy === 'organizationCount') {
        sortValue = lastItem.organizationCount;
      } else if (sortBy === 'email') {
        sortValue = lastItem.email;
      } else if (sortBy === 'title') {
        sortValue = lastItem.title;
      } else if (sortBy === 'employerName') {
        sortValue = lastItem.employerName;
      } else if (sortBy === 'emailStatus') {
        sortValue = lastItem.emailStatus;
      } else if (sortBy === 'createdAt') {
        sortValue = lastItem.createdAt;
      } else {
        sortValue = lastItem.fullName;
      }

      nextCursor = encodeCursor({
        id: lastItem.id,
        sortValue,
      });
    }

    // Build count query with proper JOINs for property count filter
    let countQuery;
    if (propertyCountCondition) {
      // Need to include the JOIN for property count filtering
      const countSubquery = db
        .select({
          contactId: propertyContacts.contactId,
          count: sql<number>`count(*)::int`.as('property_count'),
        })
        .from(propertyContacts)
        .groupBy(propertyContacts.contactId)
        .as('property_counts');
      
      let countQueryWithJoin = db
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .leftJoin(countSubquery, eq(contacts.id, countSubquery.contactId));
      
      if (allConditions.length > 0) {
        countQueryWithJoin = countQueryWithJoin.where(and(...allConditions)) as typeof countQueryWithJoin;
      }
      countQuery = countQueryWithJoin;
    } else {
      let simpleCountQuery = db.select({ count: sql<number>`count(*)::int` }).from(contacts);
      if (conditions.length > 0) {
        simpleCountQuery = simpleCountQuery.where(and(...conditions)) as typeof simpleCountQuery;
      }
      countQuery = simpleCountQuery;
    }

    const [totalResult] = await countQuery;
    const total = totalResult?.count || 0;

    const [statusesResult] = await db
      .select({ statuses: sql<string[]>`array_agg(DISTINCT email_status) FILTER (WHERE email_status IS NOT NULL)` })
      .from(contacts);

    const [titlesResult] = await db
      .select({ titles: sql<string[]>`array_agg(DISTINCT title) FILTER (WHERE title IS NOT NULL)` })
      .from(contacts);

    return NextResponse.json({
      contacts: contactsWithRelations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore,
        nextCursor,
      },
      availableStatuses: statusesResult?.statuses || [],
      availableTitles: (titlesResult?.titles || []).slice(0, 50),
    });
  } catch (error) {
    console.error('Contacts API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contacts' },
      { status: 500 }
    );
  }
}
