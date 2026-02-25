import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyContacts } from '@/lib/schema';
import { ilike, or, eq, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q');
    const limit = Math.min(20, parseInt(req.nextUrl.searchParams.get('limit') ?? '8', 10));

    if (!q || q.length < 3) {
      return NextResponse.json({ data: [] });
    }

    const pattern = `%${q}%`;

    const rows = await db
      .select({
        id: properties.id,
        regridAddress: properties.regridAddress,
        validatedAddress: properties.validatedAddress,
        city: properties.city,
        assetCategory: properties.assetCategory,
        dcadOwnerName1: properties.dcadOwnerName1,
        enrichmentStatus: properties.enrichmentStatus,
      })
      .from(properties)
      .where(
        or(
          ilike(properties.regridAddress, pattern),
          ilike(properties.validatedAddress, pattern),
          ilike(properties.dcadOwnerName1, pattern)
        )
      )
      .limit(limit);

    const ids = rows.map(r => r.id);
    let contactCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const counts = await db
        .select({ propertyId: propertyContacts.propertyId, count: sql<number>`count(*)::int` })
        .from(propertyContacts)
        .where(or(...ids.map(id => eq(propertyContacts.propertyId, id))))
        .groupBy(propertyContacts.propertyId);
      for (const c of counts) {
        if (c.propertyId) contactCounts[c.propertyId] = c.count;
      }
    }

    const data = rows.map(r => ({ ...r, contactCount: contactCounts[r.id] ?? 0 }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[Admin] property-search error:', error);
    return NextResponse.json({ data: [], error: 'Search failed' }, { status: 500 });
  }
}
