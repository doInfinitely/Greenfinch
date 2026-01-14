import { NextRequest, NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import { SearchBoxCore } from '@mapbox/search-js-core';
import { getParcelByPoint } from '@/lib/regrid';
import { resolveParcelToProperty } from '@/lib/postgres-queries';

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
    const parcel = await getParcelByPoint(lat, lon);
    
    if (!parcel || !parcel.llUuid) {
      return undefined;
    }

    const resolved = await resolveParcelToProperty(parcel.llUuid);
    
    if (resolved && resolved.propertyKey) {
      return resolved.propertyKey;
    }

    return undefined;
  } catch (error) {
    console.warn(`Error resolving POI at ${lat}, ${lon}:`, error);
    return undefined;
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

    const proximity = searchParams.get('proximity') || '-96.797,32.777';
    const [lon, lat] = proximity.split(',').map(Number);

    const searchBox = new SearchBoxCore({
      accessToken: mapboxToken,
      types: 'poi,address,street,place,neighborhood,postcode',
      language: 'en',
    });

    const result = await searchBox.suggest(sanitizedQuery, {
      proximity: [lon, lat],
      sessionToken: uuidv4(),
      limit: 8,
    });

    let suggestions: TypeaheadSuggestion[] = (result.suggestions || [])
      .slice(0, 8)
      .map((suggestion: any) => {
        const suggestionType = Array.isArray(suggestion.feature_type)
          ? suggestion.feature_type
          : suggestion.type || 'unknown';

        const name = suggestion.name || '';
        const fullAddress = suggestion.full_address || suggestion.place_formatted || '';
        const placeName = fullAddress 
          ? `${name}, ${fullAddress}` 
          : name;

        return {
          id: suggestion.mapbox_id || '',
          text: name,
          place_name: placeName,
          address: fullAddress,
          lat: 0,
          lon: 0,
          type: suggestionType,
          _mapboxId: suggestion.mapbox_id,
        };
      });

    // Retrieve coordinates for each suggestion
    const limit = pLimit(3);
    const sessionToken = uuidv4();
    
    const retrievePromises = suggestions.map((suggestion: any) => {
      return limit(async () => {
        try {
          if (suggestion._mapboxId) {
            const retrieved = await searchBox.retrieve(
              { mapbox_id: suggestion._mapboxId } as any,
              { sessionToken }
            );
            
            if (retrieved.features && retrieved.features.length > 0) {
              const feature = retrieved.features[0];
              const coords = feature.geometry?.coordinates;
              if (coords) {
                suggestion.lat = coords[1];
                suggestion.lon = coords[0];
              }
            }
          }
          
          // Resolve POI types to properties in our database
          if (suggestion.type === 'poi' && suggestion.lat && suggestion.lon) {
            const propertyKey = await resolvePoiToProperty(suggestion.lat, suggestion.lon);
            if (propertyKey) {
              suggestion.propertyKey = propertyKey;
            }
          }
          
          delete suggestion._mapboxId;
          return suggestion;
        } catch (error) {
          console.warn('Failed to retrieve suggestion:', error);
          delete suggestion._mapboxId;
          return suggestion;
        }
      });
    });

    suggestions = await Promise.all(retrievePromises);

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
