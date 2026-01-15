import { NextRequest, NextResponse } from 'next/server';
import pLimit from 'p-limit';
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

function mapGoogleTypeToOurType(types: string[]): string {
  if (types.includes('establishment') || types.includes('point_of_interest')) {
    return 'poi';
  }
  if (types.includes('street_address') || types.includes('premise') || types.includes('subpremise')) {
    return 'address';
  }
  if (types.includes('route')) {
    return 'street';
  }
  if (types.includes('locality') || types.includes('administrative_area_level_1')) {
    return 'place';
  }
  if (types.includes('neighborhood') || types.includes('sublocality')) {
    return 'neighborhood';
  }
  if (types.includes('postal_code')) {
    return 'postcode';
  }
  return 'poi';
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

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleApiKey) {
      console.error('GOOGLE_MAPS_API_KEY not configured');
      return NextResponse.json(
        { error: 'API configuration error' },
        { status: 500 }
      );
    }

    const proximity = searchParams.get('proximity') || '-96.797,32.777';
    const [lon, lat] = proximity.split(',').map(Number);

    const autocompleteResponse = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleApiKey,
        },
        body: JSON.stringify({
          input: sanitizedQuery,
          locationBias: {
            circle: {
              center: {
                latitude: lat,
                longitude: lon,
              },
              radius: 50000.0,
            },
          },
          includedPrimaryTypes: [
            'establishment',
            'geocode',
          ],
        }),
      }
    );

    if (!autocompleteResponse.ok) {
      const errorText = await autocompleteResponse.text();
      console.error('Google Places Autocomplete error:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch suggestions' },
        { status: 500 }
      );
    }

    const autocompleteData = await autocompleteResponse.json();
    const predictions = autocompleteData.suggestions || [];

    let suggestions: TypeaheadSuggestion[] = predictions
      .slice(0, 8)
      .map((prediction: any) => {
        const place = prediction.placePrediction;
        if (!place) return null;

        const mainText = place.structuredFormat?.mainText?.text || place.text?.text || '';
        const secondaryText = place.structuredFormat?.secondaryText?.text || '';
        const types = place.types || [];

        return {
          id: place.placeId || '',
          text: mainText,
          place_name: secondaryText ? `${mainText}, ${secondaryText}` : mainText,
          address: secondaryText,
          lat: 0,
          lon: 0,
          type: mapGoogleTypeToOurType(types),
          _placeId: place.placeId,
        };
      })
      .filter(Boolean);

    const limit = pLimit(3);
    
    const detailPromises = suggestions.map((suggestion: any) => {
      return limit(async () => {
        try {
          if (suggestion._placeId) {
            const detailsResponse = await fetch(
              `https://places.googleapis.com/v1/places/${suggestion._placeId}`,
              {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Goog-Api-Key': googleApiKey,
                  'X-Goog-FieldMask': 'location,formattedAddress,types',
                },
              }
            );

            if (detailsResponse.ok) {
              const details = await detailsResponse.json();
              if (details.location) {
                suggestion.lat = details.location.latitude;
                suggestion.lon = details.location.longitude;
              }
              if (details.formattedAddress) {
                suggestion.address = details.formattedAddress;
              }
              if (details.types) {
                suggestion.type = mapGoogleTypeToOurType(details.types);
              }
            }
          }
          
          if (suggestion.type === 'poi' && suggestion.lat && suggestion.lon) {
            const propertyKey = await resolvePoiToProperty(suggestion.lat, suggestion.lon);
            if (propertyKey) {
              suggestion.propertyKey = propertyKey;
            }
          }
          
          delete suggestion._placeId;
          return suggestion;
        } catch (error) {
          console.warn('Failed to retrieve place details:', error);
          delete suggestion._placeId;
          return suggestion;
        }
      });
    });

    suggestions = await Promise.all(detailPromises);

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
