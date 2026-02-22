import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, parcelnumbMapping } from '@/lib/schema';
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

    const props: Record<string, [string | null, string | null, string | null, string | null]> = {};
    const m: Record<string, string> = {};

    const resolveParent = (row: typeof rows[0]) => {
      if (row.gisParcelId && row.gisParcelId !== row.propertyKey) {
        const gisParent = propertyMap.get(row.gisParcelId);
        if (gisParent) return gisParent;
      }
      return row;
    };

    const ensureProp = (p: typeof rows[0]) => {
      if (!props[p.propertyKey]) {
        const displayName = p.commonName
          ? normalizeCommonName(p.commonName)
          : p.bizName || null;
        props[p.propertyKey] = [
          displayName,
          p.address || p.regridAddress || null,
          p.category || null,
          p.subcategory || null,
        ];
      }
    };

    for (const row of rows) {
      const parent = resolveParent(row);
      ensureProp(parent);
      m[row.propertyKey] = parent.propertyKey;
    }

    const mappingRows = await db
      .select({
        accountNum: parcelnumbMapping.accountNum,
        parentPropertyKey: parcelnumbMapping.parentPropertyKey,
      })
      .from(parcelnumbMapping);

    for (const mapping of mappingRows) {
      if (m[mapping.accountNum]) continue;

      if (mapping.parentPropertyKey) {
        const parent = propertyMap.get(mapping.parentPropertyKey);
        if (parent) {
          ensureProp(parent);
          m[mapping.accountNum] = parent.propertyKey;
        }
      }
    }

    const response = NextResponse.json({ p: props, m });
    response.headers.set('Cache-Control', 'private, max-age=300');
    return response;
  } catch (error) {
    console.error('Parcel index error:', error);
    return NextResponse.json({ error: 'Failed to build parcel index' }, { status: 500 });
  }
}
