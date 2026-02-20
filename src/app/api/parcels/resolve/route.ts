import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parcelnumb = searchParams.get('parcelnumb');

  if (!parcelnumb) {
    return NextResponse.json(
      { error: 'parcelnumb parameter is required' },
      { status: 400 }
    );
  }

  try {
    const directResult = await db
      .select({
        propertyKey: properties.propertyKey,
        gisParcelId: properties.dcadGisParcelId,
        commonName: properties.commonName,
        bizName: properties.dcadBizName,
        address: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        category: properties.assetCategory,
        subcategory: properties.assetSubcategory,
      })
      .from(properties)
      .where(eq(properties.propertyKey, parcelnumb))
      .limit(1);

    if (directResult.length === 0) {
      return NextResponse.json({ found: false });
    }

    const property = directResult[0];

    let resolved = property;
    if (property.gisParcelId && property.gisParcelId !== property.propertyKey) {
      const parentResult = await db
        .select({
          propertyKey: properties.propertyKey,
          gisParcelId: properties.dcadGisParcelId,
          commonName: properties.commonName,
          bizName: properties.dcadBizName,
          address: properties.validatedAddress,
          regridAddress: properties.regridAddress,
          category: properties.assetCategory,
          subcategory: properties.assetSubcategory,
        })
        .from(properties)
        .where(eq(properties.propertyKey, property.gisParcelId))
        .limit(1);

      if (parentResult.length > 0) {
        resolved = parentResult[0];
      }
    }

    const displayName = resolved.commonName
      ? normalizeCommonName(resolved.commonName)
      : resolved.bizName || resolved.address || resolved.regridAddress || 'Unknown Property';

    return NextResponse.json({
      found: true,
      propertyKey: resolved.propertyKey,
      displayName,
      address: resolved.address || resolved.regridAddress,
      category: resolved.category,
      subcategory: resolved.subcategory,
    });
  } catch (error) {
    console.error('Error resolving parcel to property:', error);
    return NextResponse.json(
      { error: 'Failed to resolve parcel' },
      { status: 500 }
    );
  }
}
