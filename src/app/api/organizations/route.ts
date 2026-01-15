import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, propertyOrganizations, contactOrganizations } from '@/lib/schema';
import { eq, ilike, or, sql, desc, asc } from 'drizzle-orm';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();
    const type = searchParams.get('type');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));
    const sortBy = searchParams.get('sortBy') || 'name';
    const sortOrder = searchParams.get('sortOrder') || 'asc';
    
    const offset = (page - 1) * limit;

    const propertyCountSubquery = db
      .select({
        orgId: propertyOrganizations.orgId,
        count: sql<number>`count(*)::int`.as('property_count'),
      })
      .from(propertyOrganizations)
      .groupBy(propertyOrganizations.orgId)
      .as('property_counts');

    const contactCountSubquery = db
      .select({
        orgId: contactOrganizations.orgId,
        count: sql<number>`count(*)::int`.as('contact_count'),
      })
      .from(contactOrganizations)
      .groupBy(contactOrganizations.orgId)
      .as('contact_counts');

    let baseQuery = db
      .select({
        id: organizations.id,
        name: organizations.name,
        domain: organizations.domain,
        orgType: organizations.orgType,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        propertyCount: sql<number>`COALESCE(${propertyCountSubquery.count}, 0)`.as('property_count'),
        contactCount: sql<number>`COALESCE(${contactCountSubquery.count}, 0)`.as('contact_count'),
      })
      .from(organizations)
      .leftJoin(propertyCountSubquery, eq(organizations.id, propertyCountSubquery.orgId))
      .leftJoin(contactCountSubquery, eq(organizations.id, contactCountSubquery.orgId));

    if (query) {
      baseQuery = baseQuery.where(
        or(
          ilike(organizations.name, `%${query}%`),
          ilike(organizations.domain, `%${query}%`)
        )
      ) as typeof baseQuery;
    }
    
    if (type) {
      baseQuery = baseQuery.where(eq(organizations.orgType, type)) as typeof baseQuery;
    }

    let orderExpression;
    if (sortBy === 'propertyCount') {
      orderExpression = sortOrder === 'desc' 
        ? sql`COALESCE(${propertyCountSubquery.count}, 0) DESC`
        : sql`COALESCE(${propertyCountSubquery.count}, 0) ASC`;
    } else if (sortBy === 'contactCount') {
      orderExpression = sortOrder === 'desc'
        ? sql`COALESCE(${contactCountSubquery.count}, 0) DESC`
        : sql`COALESCE(${contactCountSubquery.count}, 0) ASC`;
    } else {
      const orderColumn = sortBy === 'domain' ? organizations.domain : 
                          sortBy === 'type' ? organizations.orgType :
                          sortBy === 'createdAt' ? organizations.createdAt :
                          organizations.name;
      orderExpression = sortOrder === 'desc' ? desc(orderColumn) : asc(orderColumn);
    }

    const orgs = await baseQuery
      .orderBy(orderExpression)
      .limit(limit)
      .offset(offset);

    let countQuery = db.select({ count: sql<number>`count(*)::int` }).from(organizations);
    
    if (query) {
      countQuery = countQuery.where(
        or(
          ilike(organizations.name, `%${query}%`),
          ilike(organizations.domain, `%${query}%`)
        )
      ) as typeof countQuery;
    }
    
    if (type) {
      countQuery = countQuery.where(eq(organizations.orgType, type)) as typeof countQuery;
    }

    const [totalResult] = await countQuery;
    const total = totalResult?.count || 0;

    const [typesResult] = await db
      .select({ types: sql<string[]>`array_agg(DISTINCT org_type) FILTER (WHERE org_type IS NOT NULL)` })
      .from(organizations);

    return NextResponse.json({
      organizations: orgs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      availableTypes: typesResult?.types || [],
    });
  } catch (error) {
    console.error('Organizations API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}
