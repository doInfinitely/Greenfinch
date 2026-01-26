import { NextRequest, NextResponse } from 'next/server';
import { searchPropertiesFromPostgres, getPropertiesInBoundsFromPostgres, getPropertiesByKeys, getFilteredPropertiesFromPostgres, PropertyFilters } from '@/lib/postgres-queries';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function validateLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function validateCoordinate(value: string | null, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseFilters(searchParams: URLSearchParams): PropertyFilters {
  const parseNumber = (val: string | null) => {
    if (!val) return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  };
  
  const parseArray = (val: string | null) => {
    if (!val) return [];
    return val.split(',').map(s => s.trim()).filter(s => s.length > 0);
  };

  return {
    minLotSqft: parseNumber(searchParams.get('minLotSqft')),
    maxLotSqft: parseNumber(searchParams.get('maxLotSqft')),
    minNetSqft: parseNumber(searchParams.get('minNetSqft')),
    maxNetSqft: parseNumber(searchParams.get('maxNetSqft')),
    categories: parseArray(searchParams.get('categories')),
    subcategories: parseArray(searchParams.get('subcategories')),
    buildingClasses: parseArray(searchParams.get('buildingClasses')),
    acTypes: parseArray(searchParams.get('acTypes')),
    heatingTypes: parseArray(searchParams.get('heatingTypes')),
    organizationId: searchParams.get('organizationId') || null,
    contactId: searchParams.get('contactId') || null,
  };
}

function hasActiveFilters(filters: PropertyFilters): boolean {
  return !!(
    filters.minLotSqft ||
    filters.maxLotSqft ||
    filters.minNetSqft ||
    filters.maxNetSqft ||
    (filters.categories && filters.categories.length > 0) ||
    (filters.subcategories && filters.subcategories.length > 0) ||
    (filters.buildingClasses && filters.buildingClasses.length > 0) ||
    (filters.acTypes && filters.acTypes.length > 0) ||
    (filters.heatingTypes && filters.heatingTypes.length > 0) ||
    filters.organizationId ||
    filters.contactId
  );
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const minLatStr = searchParams.get('minLat');
    const maxLatStr = searchParams.get('maxLat');
    const minLonStr = searchParams.get('minLon');
    const maxLonStr = searchParams.get('maxLon');
    const limit = validateLimit(searchParams.get('limit'));
    const filters = parseFilters(searchParams);

    if (minLatStr && maxLatStr && minLonStr && maxLonStr) {
      const minLat = validateCoordinate(minLatStr, -90, 90);
      const maxLat = validateCoordinate(maxLatStr, -90, 90);
      const minLon = validateCoordinate(minLonStr, -180, 180);
      const maxLon = validateCoordinate(maxLonStr, -180, 180);

      if (minLat === null || maxLat === null || minLon === null || maxLon === null) {
        return NextResponse.json(
          { error: 'Invalid coordinate parameters' },
          { status: 400 }
        );
      }

      if (minLat >= maxLat || minLon >= maxLon) {
        return NextResponse.json(
          { error: 'Invalid bounds: min must be less than max' },
          { status: 400 }
        );
      }

      // Use filtered query if any filters are active
      if (hasActiveFilters(filters)) {
        const properties = await getFilteredPropertiesFromPostgres(
          minLat,
          maxLat,
          minLon,
          maxLon,
          filters,
          limit
        );
        return NextResponse.json({ properties });
      }

      const properties = await getPropertiesInBoundsFromPostgres(
        minLat,
        maxLat,
        minLon,
        maxLon,
        limit
      );
      return NextResponse.json({ properties });
    }

    // Fetch multiple properties by property keys (for constituent properties)
    const keysParam = searchParams.get('keys');
    if (keysParam) {
      const keys = keysParam.split(',').map(k => k.trim()).filter(k => k.length > 0).slice(0, 50);
      if (keys.length === 0) {
        return NextResponse.json({ error: 'No valid property keys provided' }, { status: 400 });
      }
      const properties = await getPropertiesByKeys(keys);
      return NextResponse.json({ properties });
    }

    if (query) {
      const sanitizedQuery = query.trim().slice(0, 200);
      if (sanitizedQuery.length < 2) {
        return NextResponse.json(
          { error: 'Query must be at least 2 characters' },
          { status: 400 }
        );
      }
      const properties = await searchPropertiesFromPostgres(sanitizedQuery, limit);
      return NextResponse.json({ properties });
    }

    return NextResponse.json({ error: 'Query or bounds required' }, { status: 400 });
  } catch (error) {
    console.error('Properties API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch properties' },
      { status: 500 }
    );
  }
}
