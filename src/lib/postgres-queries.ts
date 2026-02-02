import { db } from './db';
import { properties, parcelToProperty } from './schema';
import { and, or, ilike, gte, lte, eq, sql, inArray, asc, desc, isNull } from 'drizzle-orm';

export interface PropertyResult {
  id: string;
  propertyKey: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  lat: number;
  lon: number;
  owner: string;
  primaryOwner: string | null;
  usedesc: string[];
  totalParval: number;
  yearBuilt: number | null;
  lotSqft: number | null;
  buildingSqft: number | null;
  numFloors: number | null;
  assetCategory: string | null;
  commonName: string | null;
  enrichmentStatus: string | null;
  dcadBizName: string | null;
  isParentProperty: boolean;
  parentPropertyKey: string | null;
  constituentAccountNums: string[] | null;
  constituentCount: number;
  sourceLlUuid: string | null;
}

function formatPropertyResult(row: typeof properties.$inferSelect): PropertyResult {
  const rawParcels = row.rawParcelsJson as any[];
  const firstParcel = rawParcels?.[0];
  
  let address = row.regridAddress || row.validatedAddress || '';
  if (!address && firstParcel) {
    const parts = [
      firstParcel.address,
      firstParcel.sunit
    ].filter(Boolean);
    address = parts.join(' ');
  }
  
  const usedescList: string[] = [];
  if (rawParcels) {
    for (const p of rawParcels) {
      if (p.usedesc && !usedescList.includes(p.usedesc)) {
        usedescList.push(p.usedesc);
      }
    }
  }

  let totalParval = 0;
  if (rawParcels) {
    for (const p of rawParcels) {
      totalParval += (p.parval || 0);
    }
  }

  return {
    id: row.id,
    propertyKey: row.propertyKey,
    address: address,
    city: row.city || '',
    state: row.state || '',
    zip: row.zip || '',
    county: row.county || '',
    lat: row.lat || 0,
    lon: row.lon || 0,
    owner: row.regridOwner || '',
    primaryOwner: row.regridOwner,
    usedesc: usedescList,
    totalParval: totalParval,
    yearBuilt: row.yearBuilt,
    lotSqft: row.lotSqft,
    buildingSqft: row.buildingSqft,
    numFloors: row.numFloors,
    assetCategory: row.assetCategory,
    commonName: row.commonName,
    enrichmentStatus: row.enrichmentStatus,
    dcadBizName: row.dcadBizName,
    isParentProperty: row.isParentProperty || false,
    parentPropertyKey: row.parentPropertyKey,
    constituentAccountNums: row.constituentAccountNums as string[] | null,
    constituentCount: row.constituentCount || 0,
    sourceLlUuid: row.sourceLlUuid,
  };
}

interface CursorData {
  id: string;
  sortValue: any;
}

export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function decodeCursor(cursorStr: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursorStr, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function searchPropertiesFromPostgres(
  query: string,
  limit: number = 50
): Promise<PropertyResult[]> {
  const searchTerm = `%${query}%`;
  
  const results = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.isActive, true),
        eq(properties.isParentProperty, true), // Only show parent properties
        or(
          ilike(properties.regridAddress, searchTerm),
          ilike(properties.validatedAddress, searchTerm),
          ilike(properties.city, searchTerm),
          ilike(properties.regridOwner, searchTerm),
          ilike(properties.commonName, searchTerm),
          ilike(properties.propertyKey, searchTerm)
        )
      )
    )
    .limit(limit);
  
  return results.map(formatPropertyResult);
}

export async function searchPropertiesWithCursorFromPostgres(
  query: string,
  limit: number = 50,
  cursor: CursorData | null = null,
  sortBy: string = 'address',
  sortOrder: 'asc' | 'desc' = 'asc'
): Promise<{ results: PropertyResult[]; hasMore: boolean; lastResult: PropertyResult | null }> {
  const searchTerm = `%${query}%`;
  
  const conditions = [
    eq(properties.isActive, true),
    eq(properties.isParentProperty, true),
    or(
      ilike(properties.regridAddress, searchTerm),
      ilike(properties.validatedAddress, searchTerm),
      ilike(properties.city, searchTerm),
      ilike(properties.regridOwner, searchTerm),
      ilike(properties.commonName, searchTerm),
      ilike(properties.propertyKey, searchTerm)
    )
  ];

  // Determine sort column
  let sortColumn: any;
  if (sortBy === 'address') {
    sortColumn = properties.regridAddress;
  } else if (sortBy === 'city') {
    sortColumn = properties.city;
  } else if (sortBy === 'owner') {
    sortColumn = properties.regridOwner;
  } else {
    sortColumn = properties.regridAddress;
  }

  const orderExpression = sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn);
  const secondaryOrderExpression = sortOrder === 'desc' ? desc(properties.id) : asc(properties.id);

  // Apply cursor condition if using cursor pagination
  if (cursor) {
    if (sortOrder === 'asc') {
      conditions.push(
        sql`${sortColumn} > ${cursor.sortValue} OR (${sortColumn} = ${cursor.sortValue} AND ${properties.id} > ${cursor.id})`
      );
    } else {
      conditions.push(
        sql`${sortColumn} < ${cursor.sortValue} OR (${sortColumn} = ${cursor.sortValue} AND ${properties.id} < ${cursor.id})`
      );
    }
  }

  const fetchLimit = limit + 1;
  
  const results = await db
    .select()
    .from(properties)
    .where(and(...conditions))
    .orderBy(orderExpression, secondaryOrderExpression)
    .limit(fetchLimit);

  const hasMore = results.length > limit;
  const displayResults = hasMore ? results.slice(0, limit) : results;
  const lastResult = displayResults.length > 0 ? displayResults[displayResults.length - 1] : null;

  return {
    results: displayResults.map(formatPropertyResult),
    hasMore,
    lastResult: lastResult ? formatPropertyResult(lastResult) : null,
  };
}

export async function getPropertiesInBoundsFromPostgres(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  limit: number = 50
): Promise<PropertyResult[]> {
  const results = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.isActive, true),
        eq(properties.isParentProperty, true), // Only show parent properties
        gte(properties.lat, minLat),
        lte(properties.lat, maxLat),
        gte(properties.lon, minLon),
        lte(properties.lon, maxLon)
      )
    )
    .limit(limit);
  
  return results.map(formatPropertyResult);
}

export interface PropertyFilters {
  minLotSqft?: number | null;
  maxLotSqft?: number | null;
  minNetSqft?: number | null;
  maxNetSqft?: number | null;
  categories?: string[];
  subcategories?: string[];
  buildingClasses?: string[];
  acTypes?: string[];
  heatingTypes?: string[];
  organizationId?: string | null;
  contactId?: string | null;
}

export async function getFilteredPropertiesFromPostgres(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  filters: PropertyFilters,
  limit: number = 50
): Promise<PropertyResult[]> {
  const conditions = [
    eq(properties.isActive, true),
    eq(properties.isParentProperty, true),
    gte(properties.lat, minLat),
    lte(properties.lat, maxLat),
    gte(properties.lon, minLon),
    lte(properties.lon, maxLon),
  ];

  // Size filters
  if (filters.minLotSqft) {
    conditions.push(gte(properties.lotSqft, filters.minLotSqft));
  }
  if (filters.maxLotSqft) {
    conditions.push(lte(properties.lotSqft, filters.maxLotSqft));
  }
  if (filters.minNetSqft) {
    conditions.push(gte(properties.buildingSqft, filters.minNetSqft));
  }
  if (filters.maxNetSqft) {
    conditions.push(lte(properties.buildingSqft, filters.maxNetSqft));
  }

  // Category filters
  if (filters.categories && filters.categories.length > 0) {
    conditions.push(inArray(properties.assetCategory, filters.categories));
  }
  if (filters.subcategories && filters.subcategories.length > 0) {
    conditions.push(inArray(properties.assetSubcategory, filters.subcategories));
  }

  // Building class filter - handle 'Unknown' as NULL values
  if (filters.buildingClasses && filters.buildingClasses.length > 0) {
    const hasUnknown = filters.buildingClasses.includes('Unknown');
    const knownClasses = filters.buildingClasses.filter(c => c !== 'Unknown');
    
    if (hasUnknown && knownClasses.length > 0) {
      // Both unknown (NULL) and specific classes selected
      conditions.push(
        or(
          isNull(properties.calculatedBuildingClass),
          inArray(properties.calculatedBuildingClass, knownClasses)
        )!
      );
    } else if (hasUnknown) {
      // Only unknown (NULL) selected
      conditions.push(isNull(properties.calculatedBuildingClass));
    } else {
      // Only specific classes selected
      conditions.push(inArray(properties.calculatedBuildingClass, knownClasses));
    }
  }

  // HVAC filters
  if (filters.acTypes && filters.acTypes.length > 0) {
    conditions.push(inArray(properties.dcadPrimaryAcType, filters.acTypes));
  }
  if (filters.heatingTypes && filters.heatingTypes.length > 0) {
    conditions.push(inArray(properties.dcadPrimaryHeatingType, filters.heatingTypes));
  }

  // Organization filter - use subquery to filter before LIMIT
  if (filters.organizationId) {
    conditions.push(
      sql`${properties.propertyKey} IN (SELECT DISTINCT property_key FROM property_organizations WHERE organization_id = ${filters.organizationId})`
    );
  }

  // Contact filter - use subquery to filter before LIMIT
  if (filters.contactId) {
    conditions.push(
      sql`${properties.propertyKey} IN (SELECT DISTINCT property_key FROM property_contacts WHERE contact_id = ${filters.contactId})`
    );
  }

  const results = await db
    .select()
    .from(properties)
    .where(and(...conditions))
    .limit(limit);

  return results.map(formatPropertyResult);
}

export async function getPropertyByIdFromPostgres(
  id: string
): Promise<PropertyResult | null> {
  const results = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id))
    .limit(1);
  
  if (results.length === 0) return null;
  return formatPropertyResult(results[0]);
}

export async function getPropertyByKeyFromPostgres(
  propertyKey: string
): Promise<PropertyResult | null> {
  const results = await db
    .select()
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);
  
  if (results.length === 0) return null;
  return formatPropertyResult(results[0]);
}

export async function getPropertiesByKeys(
  propertyKeys: string[]
): Promise<PropertyResult[]> {
  if (propertyKeys.length === 0) return [];
  
  const results = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.isActive, true),
        inArray(properties.propertyKey, propertyKeys)
      )
    );
  
  return results.map(formatPropertyResult);
}

export async function resolveParcelToProperty(
  llUuid: string
): Promise<{ propertyKey: string; property: PropertyResult } | null> {
  const parcelMapping = await db
    .select()
    .from(parcelToProperty)
    .where(eq(parcelToProperty.llUuid, llUuid))
    .limit(1);
  
  if (parcelMapping.length === 0) return null;
  
  const property = await getPropertyByKeyFromPostgres(parcelMapping[0].propertyKey);
  if (!property) return null;
  
  return {
    propertyKey: parcelMapping[0].propertyKey,
    property,
  };
}

export async function getPropertyStats(): Promise<{
  totalProperties: number;
  totalParcels: number;
  enrichedCount: number;
  pendingCount: number;
}> {
  const [propCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(properties)
    .where(eq(properties.isActive, true));
  
  const [parcelCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(parcelToProperty);
  
  const [enrichedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(properties)
    .where(and(
      eq(properties.isActive, true),
      eq(properties.enrichmentStatus, 'enriched')
    ));
  
  const [pendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(properties)
    .where(and(
      eq(properties.isActive, true),
      eq(properties.enrichmentStatus, 'pending')
    ));
  
  return {
    totalProperties: propCount?.count || 0,
    totalParcels: parcelCount?.count || 0,
    enrichedCount: enrichedCount?.count || 0,
    pendingCount: pendingCount?.count || 0,
  };
}
