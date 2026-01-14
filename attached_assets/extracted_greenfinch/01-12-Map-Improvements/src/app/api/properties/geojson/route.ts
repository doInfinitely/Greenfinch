import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq, isNotNull, and, or, sql } from 'drizzle-orm';

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
        assetCategory: properties.assetCategory,
        assetSubcategory: properties.assetSubcategory,
        operationalStatus: properties.operationalStatus,
        lastEnrichedAt: properties.lastEnrichedAt,
        lotSqft: properties.lotSqft,
        rawParcelsJson: properties.rawParcelsJson,
      })
      .from(properties)
      .where(and(...conditions));

    const features = allProperties
      .filter(p => p.lat && p.lon)
      .map(p => {
        const rawParcels = p.rawParcelsJson as any[] | null;
        const firstParcel = rawParcels?.[0];
        
        let address = p.regridAddress || p.validatedAddress || '';
        if (!address && firstParcel) {
          address = firstParcel.address || '';
        }

        let totalParval = 0;
        if (rawParcels) {
          for (const parcel of rawParcels) {
            totalParval += (parcel.parval || 0);
          }
        }

        const isEnriched = !!p.lastEnrichedAt;

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [p.lon!, p.lat!],
          },
          properties: {
            propertyKey: p.propertyKey,
            address: address || 'No Address',
            city: p.city || '',
            zip: p.zip || '',
            totalParval: totalParval,
            primaryOwner: p.regridOwner || '',
            commonName: p.commonName || '',
            category: p.assetCategory || '',
            subcategory: p.assetSubcategory || '',
            operationalStatus: p.operationalStatus || '',
            enriched: isEnriched,
            lotSqft: p.lotSqft || 0,
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
