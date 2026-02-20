import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parcelToProperty, properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';

export async function GET() {
  try {
    const rows = await db
      .select({
        llUuid: parcelToProperty.llUuid,
        propertyKey: parcelToProperty.propertyKey,
        commonName: properties.commonName,
        category: properties.assetCategory,
        subcategory: properties.assetSubcategory,
      })
      .from(parcelToProperty)
      .innerJoin(properties, eq(parcelToProperty.propertyKey, properties.propertyKey));

    const mapping: Record<string, { pk: string; n: string | null; c: string | null; s: string | null }> = {};
    for (const row of rows) {
      mapping[row.llUuid] = {
        pk: row.propertyKey,
        n: row.commonName ? normalizeCommonName(row.commonName) : null,
        c: row.category || null,
        s: row.subcategory || null,
      };
    }

    const response = NextResponse.json(mapping);
    response.headers.set('Cache-Control', 'private, max-age=300');
    return response;
  } catch (error) {
    console.error('Bulk parcel lookup error:', error);
    return NextResponse.json({ error: 'Failed to load parcel mappings' }, { status: 500 });
  }
}
