import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { normalizeCommonName } from '@/lib/normalization';

export async function GET() {
  try {
    const rows = await db
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
      .from(properties);

    const propertyMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      propertyMap.set(row.propertyKey, row);
    }

    const index: Record<string, { pk: string; n: string | null; a: string | null; c: string | null; s: string | null }> = {};

    for (const row of rows) {
      const gisParcelId = row.gisParcelId;

      let parentProperty = row;

      if (gisParcelId && gisParcelId !== row.propertyKey) {
        const gisParent = propertyMap.get(gisParcelId);
        if (gisParent) {
          parentProperty = gisParent;
        }
      }

      const displayName = parentProperty.commonName
        ? normalizeCommonName(parentProperty.commonName)
        : parentProperty.bizName || null;

      index[row.propertyKey] = {
        pk: parentProperty.propertyKey,
        n: displayName,
        a: parentProperty.address || parentProperty.regridAddress || null,
        c: parentProperty.category || null,
        s: parentProperty.subcategory || null,
      };
    }

    const response = NextResponse.json(index);
    response.headers.set('Cache-Control', 'private, max-age=300');
    return response;
  } catch (error) {
    console.error('Parcel index error:', error);
    return NextResponse.json({ error: 'Failed to build parcel index' }, { status: 500 });
  }
}
