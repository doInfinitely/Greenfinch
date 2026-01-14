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

    const conditions = [];

    if (query) {
      conditions.push(
        or(
          ilike(organizations.name, `%${query}%`),
          ilike(organizations.domain, `%${query}%`)
        )
      );
    }

    if (type) {
      conditions.push(eq(organizations.orgType, type));
    }

    const whereClause = conditions.length > 0 ? sql`${conditions.reduce((acc, cond, i) => i === 0 ? cond : sql`${acc} AND ${cond}`, sql``)}` : undefined;

    const orderColumn = sortBy === 'domain' ? organizations.domain : 
                        sortBy === 'type' ? organizations.orgType :
                        sortBy === 'createdAt' ? organizations.createdAt :
                        organizations.name;
    const orderDirection = sortOrder === 'desc' ? desc(orderColumn) : asc(orderColumn);

    const orgsQuery = db
      .select({
        id: organizations.id,
        name: organizations.name,
        domain: organizations.domain,
        orgType: organizations.orgType,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      })
      .from(organizations);

    let filteredQuery = orgsQuery;
    
    if (query) {
      filteredQuery = filteredQuery.where(
        or(
          ilike(organizations.name, `%${query}%`),
          ilike(organizations.domain, `%${query}%`)
        )
      ) as typeof filteredQuery;
    }
    
    if (type) {
      filteredQuery = filteredQuery.where(eq(organizations.orgType, type)) as typeof filteredQuery;
    }

    const orgs = await filteredQuery
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset);

    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const [propertyCountResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(propertyOrganizations)
          .where(eq(propertyOrganizations.orgId, org.id));

        const [contactCountResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(contactOrganizations)
          .where(eq(contactOrganizations.orgId, org.id));

        return {
          ...org,
          propertyCount: propertyCountResult?.count || 0,
          contactCount: contactCountResult?.count || 0,
        };
      })
    );

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
      organizations: orgsWithCounts,
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
