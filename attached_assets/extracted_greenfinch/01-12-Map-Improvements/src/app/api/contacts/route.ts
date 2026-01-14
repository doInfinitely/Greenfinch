import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, propertyContacts, contactOrganizations, properties, organizations } from '@/lib/schema';
import { eq, ilike, or, sql, desc, asc, and } from 'drizzle-orm';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();
    const emailStatus = searchParams.get('emailStatus');
    const title = searchParams.get('title');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));
    const sortBy = searchParams.get('sortBy') || 'fullName';
    const sortOrder = searchParams.get('sortOrder') || 'asc';
    
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query) {
      conditions.push(
        or(
          ilike(contacts.fullName, `%${query}%`),
          ilike(contacts.email, `%${query}%`),
          ilike(contacts.employerName, `%${query}%`)
        )
      );
    }

    if (emailStatus) {
      conditions.push(eq(contacts.emailStatus, emailStatus));
    }

    if (title) {
      conditions.push(ilike(contacts.title, `%${title}%`));
    }

    const orderColumn = sortBy === 'email' ? contacts.email : 
                        sortBy === 'title' ? contacts.title :
                        sortBy === 'employerName' ? contacts.employerName :
                        sortBy === 'emailStatus' ? contacts.emailStatus :
                        sortBy === 'createdAt' ? contacts.createdAt :
                        contacts.fullName;
    const orderDirection = sortOrder === 'desc' ? desc(orderColumn) : asc(orderColumn);

    let contactsQuery = db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        title: contacts.title,
        employerName: contacts.employerName,
        emailStatus: contacts.emailStatus,
        linkedinUrl: contacts.linkedinUrl,
        source: contacts.source,
        createdAt: contacts.createdAt,
      })
      .from(contacts);

    if (conditions.length > 0) {
      contactsQuery = contactsQuery.where(and(...conditions)) as typeof contactsQuery;
    }

    const contactsList = await contactsQuery
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset);

    const contactsWithRelations = await Promise.all(
      contactsList.map(async (contact) => {
        const propertyRelations = await db
          .select({
            propertyId: propertyContacts.propertyId,
            role: propertyContacts.role,
            propertyKey: properties.propertyKey,
            address: properties.regridAddress,
            city: properties.city,
            state: properties.state,
          })
          .from(propertyContacts)
          .leftJoin(properties, eq(propertyContacts.propertyId, properties.id))
          .where(eq(propertyContacts.contactId, contact.id))
          .limit(5);

        const orgRelations = await db
          .select({
            orgId: contactOrganizations.orgId,
            title: contactOrganizations.title,
            orgName: organizations.name,
            orgDomain: organizations.domain,
          })
          .from(contactOrganizations)
          .leftJoin(organizations, eq(contactOrganizations.orgId, organizations.id))
          .where(eq(contactOrganizations.contactId, contact.id))
          .limit(5);

        return {
          ...contact,
          propertyCount: propertyRelations.length,
          properties: propertyRelations,
          organizationCount: orgRelations.length,
          organizations: orgRelations,
        };
      })
    );

    let countQuery = db.select({ count: sql<number>`count(*)::int` }).from(contacts);
    
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
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
