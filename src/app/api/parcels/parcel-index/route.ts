import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { sql } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';

export async function GET() {
  try {
    const rows = await db
      .select({
        propertyKey: properties.propertyKey,
        gisParcelId: properties.dcadGisParcelId,
        llUuid: properties.sourceLlUuid,
        commonName: properties.commonName,
        bizName: properties.dcadBizName,
        address: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        category: properties.assetCategory,
        subcategory: properties.assetSubcategory,
        isParentProperty: properties.isParentProperty,
        parentPropertyKey: properties.parentPropertyKey,
      })
      .from(properties);

    const propertyMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      propertyMap.set(row.propertyKey, row);
    }

    const gisGroups = new Map<string, typeof rows[0][]>();
    for (const row of rows) {
      if (row.gisParcelId) {
        const group = gisGroups.get(row.gisParcelId);
        if (group) {
          group.push(row);
        } else {
          gisGroups.set(row.gisParcelId, [row]);
        }
      }
    }

    const index: Record<string, { pk: string; n: string | null; a: string | null; c: string | null; s: string | null }> = {};

    for (const row of rows) {
      const gisParcelId = row.gisParcelId;

      let resolvedProperty = row;

      if (gisParcelId && gisParcelId !== row.propertyKey) {
        const gisParent = propertyMap.get(gisParcelId);
        if (gisParent) {
          resolvedProperty = gisParent;
        } else {
          const siblings = gisGroups.get(gisParcelId);
          if (siblings && siblings.length > 0) {
            const selfRef = siblings.find(s => s.propertyKey === s.gisParcelId);
            resolvedProperty = selfRef || siblings[0];
          }
        }
      }

      const displayName = resolvedProperty.commonName
        ? normalizeCommonName(resolvedProperty.commonName)
        : resolvedProperty.bizName || null;

      index[row.propertyKey] = {
        pk: resolvedProperty.propertyKey,
        n: displayName,
        a: resolvedProperty.address || resolvedProperty.regridAddress || null,
        c: resolvedProperty.category || null,
        s: resolvedProperty.subcategory || null,
      };
    }

    for (const [gisId, group] of gisGroups.entries()) {
      if (!index[gisId]) {
        const selfRef = group.find(s => s.propertyKey === s.gisParcelId);
        const representative = selfRef || group[0];
        const resolvedProp = propertyMap.get(representative.propertyKey) || representative;
        const name = resolvedProp.commonName
          ? normalizeCommonName(resolvedProp.commonName)
          : resolvedProp.bizName || null;
        index[gisId] = {
          pk: resolvedProp.propertyKey,
          n: name,
          a: resolvedProp.address || resolvedProp.regridAddress || null,
          c: resolvedProp.category || null,
          s: resolvedProp.subcategory || null,
        };
      }
    }

    for (const row of rows) {
      if (row.llUuid && !index[`ll:${row.llUuid}`]) {
        const entry = index[row.propertyKey];
        if (entry) {
          index[`ll:${row.llUuid}`] = entry;
        }
      }
    }

    const response = NextResponse.json(index);
    response.headers.set('Cache-Control', 'private, max-age=300');
    return response;
  } catch (error) {
    console.error('Parcel index error:', error);
    return NextResponse.json({ error: 'Failed to build parcel index' }, { status: 500 });
  }
}
