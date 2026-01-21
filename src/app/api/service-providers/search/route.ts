import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serviceProviders } from '@/lib/schema';
import { ilike, or, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const serviceCategory = searchParams.get('category');

    if (!query || query.length < 2) {
      return NextResponse.json({ providers: [] });
    }

    const searchPattern = `%${query}%`;

    let results = await db
      .select({
        id: serviceProviders.id,
        name: serviceProviders.name,
        domain: serviceProviders.domain,
        servicesOffered: serviceProviders.servicesOffered,
        phone: serviceProviders.phone,
      })
      .from(serviceProviders)
      .where(
        or(
          ilike(serviceProviders.name, searchPattern),
          ilike(serviceProviders.domain, searchPattern)
        )
      )
      .limit(15);

    // Filter by service category if provided
    if (serviceCategory) {
      results = results.filter(p => 
        p.servicesOffered && (p.servicesOffered as string[]).includes(serviceCategory)
      );
    }

    return NextResponse.json({ providers: results });
  } catch (error) {
    console.error('[API] Service provider search error:', error);
    return NextResponse.json(
      { error: 'Failed to search service providers' },
      { status: 500 }
    );
  }
}
