import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/schema';
import { ilike, or, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ organizations: [] });
    }

    const searchPattern = `%${query}%`;

    const results = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        domain: organizations.domain,
        orgType: organizations.orgType,
      })
      .from(organizations)
      .where(
        or(
          ilike(organizations.name, searchPattern),
          ilike(organizations.domain, searchPattern)
        )
      )
      .limit(10);

    return NextResponse.json({ organizations: results });
  } catch (error) {
    console.error('[API] Organization search error:', error);
    return NextResponse.json(
      { error: 'Failed to search organizations' },
      { status: 500 }
    );
  }
}
