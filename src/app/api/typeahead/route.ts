import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { sql } from 'drizzle-orm';

interface CacheEntry {
  data: TypeaheadSuggestion[];
  timestamp: number;
}

interface TypeaheadSuggestion {
  id: string;
  text: string;
  place_name: string;
  address: string;
  lat: number;
  lon: number;
  type: string;
  propertyKey?: string;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}

async function resolvePoiToProperty(lat: number, lon: number): Promise<string | undefined> {
  try {
    const result = await db
      .select({ propertyKey: properties.propertyKey })
      .from(properties)
      .where(
        sql`${properties.isParentProperty} = true
          AND ${properties.lat} IS NOT NULL
          AND ${properties.lon} IS NOT NULL
          AND ABS(${properties.lat} - ${lat}) < 0.001
          AND ABS(${properties.lon} - ${lon}) < 0.001`
      )
      .limit(1);

    if (result.length > 0) {
      return result[0].propertyKey;
    }

    return undefined;
  } catch (error) {
    return undefined;
  }
}

function mapMapboxType(placeTypes: string[]): string {
  const type = placeTypes[0];
  switch (type) {
    case 'poi':
    case 'poi.landmark':
      return 'poi';
    case 'address':
      return 'address';
    case 'neighborhood':
    case 'locality':
      return 'neighborhood';
    case 'place':
    case 'district':
    case 'region':
      return 'place';
    case 'postcode':
      return 'postcode';
    default:
      return 'poi';
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query');

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    const sanitizedQuery = query.trim().slice(0, 200);
    const cacheKey = sanitizedQuery.toLowerCase();

    cleanExpiredCache();

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ suggestions: cached.data });
    }

    const mapboxToken = process.env.MAPBOX_API_KEY;
    if (!mapboxToken) {
      console.error('MAPBOX_API_KEY not configured');
      return NextResponse.json(
        { error: 'API configuration error' },
        { status: 500 }
      );
    }

    const proximity = searchParams.get('proximity') || '-96.93,32.97';
    const proximityParts = proximity.split(',');

    if (proximityParts.length !== 2) {
      return NextResponse.json(
        { error: 'Invalid proximity format. Expected "lon,lat"' },
        { status: 400 }
      );
    }

    const [lon, lat] = proximityParts.map(Number);

    if (isNaN(lon) || isNaN(lat)) {
      return NextResponse.json(
        { error: 'Invalid proximity coordinates' },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      access_token: mapboxToken,
      proximity: `${lon},${lat}`,
      limit: '8',
      types: 'poi,address,neighborhood,place,postcode',
      country: 'US',
    });

    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(sanitizedQuery)}.json?${params}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Mapbox Geocoding error:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch suggestions' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const features = data.features || [];

    let suggestions: TypeaheadSuggestion[] = features.map((feature: any) => {
      const [fLon, fLat] = feature.center || [0, 0];
      const type = mapMapboxType(feature.place_type || []);

      // Extract short address context (everything after the main text)
      const address = feature.place_name?.replace(`${feature.text}, `, '') || '';

      return {
        id: feature.id || '',
        text: feature.text || '',
        place_name: feature.place_name || '',
        address,
        lat: fLat,
        lon: fLon,
        type,
      };
    });

    // Resolve POIs to properties in our database
    const resolvePromises = suggestions.map(async (suggestion) => {
      if (suggestion.type === 'poi' && suggestion.lat && suggestion.lon) {
        const propertyKey = await resolvePoiToProperty(suggestion.lat, suggestion.lon);
        if (propertyKey) {
          suggestion.propertyKey = propertyKey;
        }
      }
      return suggestion;
    });

    suggestions = await Promise.all(resolvePromises);

    cache.set(cacheKey, {
      data: suggestions,
      timestamp: Date.now(),
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Typeahead API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suggestions' },
      { status: 500 }
    );
  }
}
