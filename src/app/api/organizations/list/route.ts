import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/schema';
import { ilike, sql, asc, or } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10));

    let orgQuery = db
      .select({
        id: organizations.id,
        name: organizations.name,
        domain: organizations.domain,
      })
      .from(organizations)
      .orderBy(asc(organizations.name))
      .limit(limit);

    if (query && query.length >= 2) {
      orgQuery = orgQuery.where(
        or(
          ilike(organizations.name, `%${query}%`),
          ilike(organizations.domain, `%${query}%`)
        )
      ) as typeof orgQuery;
    }

    const orgs = await orgQuery;

    return NextResponse.json({
      organizations: orgs,
    });
  } catch (error) {
    console.error('Organizations list API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}
