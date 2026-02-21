import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, parcelnumbMapping } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';

function formatResolvedProperty(resolved: {
  propertyKey: string;
  commonName: string | null;
  bizName: string | null;
  address: string | null;
  regridAddress: string | null;
  category: string | null;
  subcategory: string | null;
}) {
  const displayName = resolved.commonName
    ? normalizeCommonName(resolved.commonName)
    : resolved.bizName || resolved.address || resolved.regridAddress || 'Unknown Property';

  return {
    found: true,
    propertyKey: resolved.propertyKey,
    displayName,
    address: resolved.address || resolved.regridAddress,
    category: resolved.category,
    subcategory: resolved.subcategory,
  };
}

const PROPERTY_SELECT = {
  propertyKey: properties.propertyKey,
  gisParcelId: properties.dcadGisParcelId,
  commonName: properties.commonName,
  bizName: properties.dcadBizName,
  address: properties.validatedAddress,
  regridAddress: properties.regridAddress,
  category: properties.assetCategory,
  subcategory: properties.assetSubcategory,
};

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
      .select(PROPERTY_SELECT)
      .from(properties)
      .where(eq(properties.propertyKey, parcelnumb))
      .limit(1);

    if (directResult.length > 0) {
      const property = directResult[0];
      let resolved = property;

      if (property.gisParcelId && property.gisParcelId !== property.propertyKey) {
        const parentResult = await db
          .select(PROPERTY_SELECT)
          .from(properties)
          .where(eq(properties.propertyKey, property.gisParcelId))
          .limit(1);

        if (parentResult.length > 0) {
          resolved = parentResult[0];
        }
      }

      return NextResponse.json(formatResolvedProperty(resolved));
    }

    const mappingResult = await db
      .select({
        parentPropertyKey: parcelnumbMapping.parentPropertyKey,
        gisParcelId: parcelnumbMapping.gisParcelId,
      })
      .from(parcelnumbMapping)
      .where(eq(parcelnumbMapping.accountNum, parcelnumb))
      .limit(1);

    if (mappingResult.length > 0 && mappingResult[0].parentPropertyKey) {
      const parentResult = await db
        .select(PROPERTY_SELECT)
        .from(properties)
        .where(eq(properties.propertyKey, mappingResult[0].parentPropertyKey))
        .limit(1);

      if (parentResult.length > 0) {
        return NextResponse.json(formatResolvedProperty(parentResult[0]));
      }
    }

    if (mappingResult.length > 0 && mappingResult[0].gisParcelId) {
      const gisResult = await db
        .select(PROPERTY_SELECT)
        .from(properties)
        .where(eq(properties.propertyKey, mappingResult[0].gisParcelId))
        .limit(1);

      if (gisResult.length > 0) {
        return NextResponse.json(formatResolvedProperty(gisResult[0]));
      }
    }

    return NextResponse.json({ found: false });
  } catch (error) {
    console.error('Error resolving parcel to property:', error);
    return NextResponse.json(
      { error: 'Failed to resolve parcel' },
      { status: 500 }
    );
  }
}
