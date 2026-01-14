import { NextRequest, NextResponse } from 'next/server';
import { searchPropertiesFromPostgres, getPropertiesInBoundsFromPostgres } from '@/lib/postgres-queries';

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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const minLatStr = searchParams.get('minLat');
    const maxLatStr = searchParams.get('maxLat');
    const minLonStr = searchParams.get('minLon');
    const maxLonStr = searchParams.get('maxLon');
    const limit = validateLimit(searchParams.get('limit'));

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

      const properties = await getPropertiesInBoundsFromPostgres(
        minLat,
        maxLat,
        minLon,
        maxLon,
        limit
      );
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
