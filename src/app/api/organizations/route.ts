import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, propertyOrganizations, contactOrganizations } from '@/lib/schema';
import { eq, ilike, or, sql, desc, asc, and, isNotNull } from 'drizzle-orm';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getPropertyCountCondition(bucket: string, subquery: any) {
  const countCol = sql<number>`COALESCE(${subquery.count}, 0)`;
  const normalizedBucket = bucket?.trim();
  
  switch (normalizedBucket) {
    case '1':
      return sql`${countCol} = 1`;
    case '2-5':
      return sql`${countCol} >= 2 AND ${countCol} <= 5`;
    case '6-10':
      return sql`${countCol} >= 6 AND ${countCol} <= 10`;
    case '10+':
    case '10':  // Handle '10 ' with trailing space from URL encoding
      return sql`${countCol} >= 10`;  // Changed from 11 to 10 to match label intent
    default:
      return null;
  }
}

function getContactCountCondition(bucket: string, subquery: any) {
  const countCol = sql<number>`COALESCE(${subquery.count}, 0)`;
  const normalizedBucket = bucket?.trim();
  
  switch (normalizedBucket) {
    case '0':
      return sql`${countCol} = 0`;
    case '1-5':
      return sql`${countCol} >= 1 AND ${countCol} <= 5`;
    case '6-10':
      return sql`${countCol} >= 6 AND ${countCol} <= 10`;
    case '10+':
    case '10':  // Handle '10 ' with trailing space from URL encoding
      return sql`${countCol} >= 10`;
    default:
      return null;
  }
}

function getEmployeesCondition(bucket: string) {
  switch (bucket) {
    case '1-10':
      return sql`${organizations.employees} >= 1 AND ${organizations.employees} <= 10`;
    case '11-50':
      return sql`${organizations.employees} >= 11 AND ${organizations.employees} <= 50`;
    case '51-200':
      return sql`${organizations.employees} >= 51 AND ${organizations.employees} <= 200`;
    case '201-500':
      return sql`${organizations.employees} >= 201 AND ${organizations.employees} <= 500`;
    case '500+':
      return sql`${organizations.employees} > 500`;
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();
    const industry = searchParams.get('industry');
    const employeesBucket = searchParams.get('employees');
    const propertyCountBucket = searchParams.get('propertyCount');
    const contactCountBucket = searchParams.get('contactCount');
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
        industry: organizations.industry,
        employees: organizations.employees,
        employeesRange: organizations.employeesRange,
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

    if (industry && industry !== 'all') {
      baseQuery = baseQuery.where(eq(organizations.industry, industry)) as typeof baseQuery;
    }

    if (employeesBucket && employeesBucket !== 'all') {
      const condition = getEmployeesCondition(employeesBucket);
      if (condition) {
        baseQuery = baseQuery.where(condition) as typeof baseQuery;
      }
    }

    if (propertyCountBucket && propertyCountBucket !== 'all') {
      const condition = getPropertyCountCondition(propertyCountBucket, propertyCountSubquery);
      if (condition) {
        baseQuery = baseQuery.where(condition) as typeof baseQuery;
      }
    }

    if (contactCountBucket && contactCountBucket !== 'all') {
      const condition = getContactCountCondition(contactCountBucket, contactCountSubquery);
      if (condition) {
        baseQuery = baseQuery.where(condition) as typeof baseQuery;
      }
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
    } else if (sortBy === 'employees') {
      orderExpression = sortOrder === 'desc'
        ? sql`COALESCE(${organizations.employees}, 0) DESC`
        : sql`COALESCE(${organizations.employees}, 0) ASC`;
    } else {
      const orderColumn = sortBy === 'domain' ? organizations.domain : 
                          sortBy === 'industry' ? organizations.industry :
                          sortBy === 'createdAt' ? organizations.createdAt :
                          organizations.name;
      orderExpression = sortOrder === 'desc' ? desc(orderColumn) : asc(orderColumn);
    }

    const orgs = await baseQuery
      .orderBy(orderExpression)
      .limit(limit)
      .offset(offset);

    // Build count query with same filters
    let countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizations)
      .leftJoin(propertyCountSubquery, eq(organizations.id, propertyCountSubquery.orgId))
      .leftJoin(contactCountSubquery, eq(organizations.id, contactCountSubquery.orgId));
    
    if (query) {
      countQuery = countQuery.where(
        or(
          ilike(organizations.name, `%${query}%`),
          ilike(organizations.domain, `%${query}%`)
        )
      ) as typeof countQuery;
    }

    if (industry && industry !== 'all') {
      countQuery = countQuery.where(eq(organizations.industry, industry)) as typeof countQuery;
    }

    if (employeesBucket && employeesBucket !== 'all') {
      const condition = getEmployeesCondition(employeesBucket);
      if (condition) {
        countQuery = countQuery.where(condition) as typeof countQuery;
      }
    }

    if (propertyCountBucket && propertyCountBucket !== 'all') {
      const condition = getPropertyCountCondition(propertyCountBucket, propertyCountSubquery);
      if (condition) {
        countQuery = countQuery.where(condition) as typeof countQuery;
      }
    }

    if (contactCountBucket && contactCountBucket !== 'all') {
      const condition = getContactCountCondition(contactCountBucket, contactCountSubquery);
      if (condition) {
        countQuery = countQuery.where(condition) as typeof countQuery;
      }
    }

    const [totalResult] = await countQuery;
    const total = totalResult?.count || 0;

    const [industriesResult] = await db
      .select({ industries: sql<string[]>`array_agg(DISTINCT industry) FILTER (WHERE industry IS NOT NULL)` })
      .from(organizations);

    return NextResponse.json({
      organizations: orgs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      availableIndustries: industriesResult?.industries || [],
    });
  } catch (error) {
    console.error('Organizations API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}
