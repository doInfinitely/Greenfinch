import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq, isNotNull, and, or, sql } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const subcategory = searchParams.get('subcategory');
    const enriched = searchParams.get('enriched');
    const zipCode = searchParams.get('zipCode');

    const conditions = [
      isNotNull(properties.lat),
      eq(properties.isActive, true),
      // Only show parent properties on the map (not constituent accounts like parking decks)
      eq(properties.isParentProperty, true),
    ];

    if (category) {
      conditions.push(eq(properties.assetCategory, category));
    }
    if (subcategory) {
      conditions.push(eq(properties.assetSubcategory, subcategory));
    }
    if (enriched === 'true') {
      conditions.push(isNotNull(properties.lastEnrichedAt));
    } else if (enriched === 'false') {
      conditions.push(sql`${properties.lastEnrichedAt} IS NULL`);
    }
    if (zipCode) {
      conditions.push(eq(properties.zip, zipCode));
    }

    const allProperties = await db
      .select({
        propertyKey: properties.propertyKey,
        regridAddress: properties.regridAddress,
        validatedAddress: properties.validatedAddress,
        city: properties.city,
        zip: properties.zip,
        lat: properties.lat,
        lon: properties.lon,
        regridOwner: properties.regridOwner,
        commonName: properties.commonName,
        dcadBizName: properties.dcadBizName,
        assetCategory: properties.assetCategory,
        assetSubcategory: properties.assetSubcategory,
        operationalStatus: properties.operationalStatus,
        lastEnrichedAt: properties.lastEnrichedAt,
        lotSqft: properties.lotSqft,
        propertyClass: properties.propertyClass,
        sourceLlUuid: properties.sourceLlUuid,
      })
      .from(properties)
      .where(and(...conditions));

    const features = allProperties
      .filter(p => p.lat && p.lon)
      .map(p => {
        const address = p.regridAddress || p.validatedAddress || 'No Address';
        const isEnriched = !!p.lastEnrichedAt;
        const displayName = normalizeCommonName(p.commonName || p.dcadBizName || '');

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [p.lon!, p.lat!],
          },
          properties: {
            propertyKey: p.propertyKey,
            address,
            city: p.city || '',
            zip: p.zip || '',
            primaryOwner: p.regridOwner || '',
            commonName: displayName,
            category: p.assetCategory || '',
            subcategory: p.assetSubcategory || '',
            propertyClass: p.propertyClass || '',
            operationalStatus: p.operationalStatus || '',
            enriched: isEnriched,
            lotSqft: p.lotSqft || 0,
            llUuid: p.sourceLlUuid || '',
          },
        };
      });

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (error) {
    console.error('GeoJSON error:', error);
    return NextResponse.json({ error: 'Failed to load properties' }, { status: 500 });
  }
}
