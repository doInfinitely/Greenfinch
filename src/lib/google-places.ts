import { cacheGet, cacheSet, isRedisConfigured } from './redis';

export interface CommonNameResult {
  commonName: string | null;
  rawResponse: unknown;
}

// In-memory fallback cache
const memoryNameCache = new Map<string, { result: CommonNameResult; timestamp: number }>();
const NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NAME_CACHE_TTL_SECONDS = 86400; // 24 hours for Redis

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 100;

async function throttle(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
  }
  
  lastRequestTime = Date.now();
}

function getNameCacheKey(lat: number, lon: number): string {
  const roundedLat = Math.round(lat * 100000) / 100000;
  const roundedLon = Math.round(lon * 100000) / 100000;
  return `gplaces:${roundedLat},${roundedLon}`;
}

export async function getCommonNameFromGooglePlaces(lat: number, lon: number): Promise<CommonNameResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('[Google Places] No API key configured');
    return { commonName: null, rawResponse: null };
  }
  
  const cacheKey = getNameCacheKey(lat, lon);
  
  // Check cache (Redis with in-memory fallback)
  if (isRedisConfigured()) {
    const redisCached = await cacheGet<CommonNameResult>(cacheKey);
    if (redisCached) {
      return redisCached;
    }
  } else {
    const memoryCached = memoryNameCache.get(cacheKey);
    if (memoryCached && Date.now() - memoryCached.timestamp < NAME_CACHE_TTL_MS) {
      return memoryCached.result;
    }
  }
  
  await throttle();
  
  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName',
        },
        body: JSON.stringify({
          maxResultCount: 1,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 10.0,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Places] Common name lookup error:', errorText);
      return { commonName: null, rawResponse: null };
    }

    const data = await response.json();
    const places = data.places || [];

    if (places.length === 0) {
      const noResult: CommonNameResult = { commonName: null, rawResponse: data };
      if (isRedisConfigured()) {
        await cacheSet(cacheKey, noResult, NAME_CACHE_TTL_SECONDS);
      } else {
        memoryNameCache.set(cacheKey, { result: noResult, timestamp: Date.now() });
      }
      return noResult;
    }

    const firstPlace = places[0];
    const commonName = firstPlace.displayName?.text || null;

    const result: CommonNameResult = { commonName, rawResponse: data };
    if (isRedisConfigured()) {
      await cacheSet(cacheKey, result, NAME_CACHE_TTL_SECONDS);
    } else {
      memoryNameCache.set(cacheKey, { result, timestamp: Date.now() });
    }
    return result;
  } catch (error) {
    console.error('[Google Places] Error getting common name:', error);
    return { commonName: null, rawResponse: null };
  }
}

export function clearNameCache(): void {
  memoryNameCache.clear();
}

interface ContainingPlaceResult {
  containingPlace: string | null;
  containingPlaceType: string | null;
  confidence: number;
}

interface NearbyPlace {
  displayName?: { text: string };
  types?: string[];
  primaryType?: string;
}

const CONTAINING_PLACE_TYPES = [
  'shopping_mall',
  'school',
  'university',
  'hospital',
  'hotel',
  'parking',
];

export async function findContainingPlace(
  lat: number,
  lon: number
): Promise<ContainingPlaceResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('[Google Places] No API key configured');
    return { containingPlace: null, containingPlaceType: null, confidence: 0 };
  }

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType',
        },
        body: JSON.stringify({
          includedTypes: CONTAINING_PLACE_TYPES,
          maxResultCount: 1,
          rankPreference: 'POPULARITY',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 25.0,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Places] Nearby search error:', errorText);
      return { containingPlace: null, containingPlaceType: null, confidence: 0 };
    }

    const data = await response.json();
    const places: NearbyPlace[] = data.places || [];

    if (places.length === 0) {
      return { containingPlace: null, containingPlaceType: null, confidence: 0 };
    }

    const prioritizedTypes = [
      'shopping_mall',
      'hospital',
      'airport',
      'university',
      'convention_center',
    ];

    for (const preferredType of prioritizedTypes) {
      const match = places.find(
        (p) => p.primaryType === preferredType || p.types?.includes(preferredType)
      );
      if (match && match.displayName?.text) {
        return {
          containingPlace: match.displayName.text,
          containingPlaceType: match.primaryType || preferredType,
          confidence: 0.85,
        };
      }
    }

    const firstPlace = places[0];
    if (firstPlace && firstPlace.displayName?.text) {
      return {
        containingPlace: firstPlace.displayName.text,
        containingPlaceType: firstPlace.primaryType || null,
        confidence: 0.7,
      };
    }

    return { containingPlace: null, containingPlaceType: null, confidence: 0 };
  } catch (error) {
    console.error('[Google Places] Error finding containing place:', error);
    return { containingPlace: null, containingPlaceType: null, confidence: 0 };
  }
}

export async function getPlaceDetails(
  lat: number,
  lon: number
): Promise<{ placeName: string | null; placeType: string | null; containingPlace: string | null }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    return { placeName: null, placeType: null, containingPlace: null };
  }

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType',
        },
        body: JSON.stringify({
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 50.0,
            },
          },
          maxResultCount: 1,
        }),
      }
    );

    if (!response.ok) {
      return { placeName: null, placeType: null, containingPlace: null };
    }

    const data = await response.json();
    const places: NearbyPlace[] = data.places || [];

    if (places.length === 0) {
      return { placeName: null, placeType: null, containingPlace: null };
    }

    const place = places[0];
    const placeName = place.displayName?.text || null;
    const placeType = place.primaryType || null;

    const isContainingPlaceType = placeType && CONTAINING_PLACE_TYPES.includes(placeType);

    if (isContainingPlaceType) {
      return { placeName, placeType, containingPlace: placeName };
    }

    const containingResult = await findContainingPlace(lat, lon);

    return {
      placeName,
      placeType,
      containingPlace: containingResult.containingPlace,
    };
  } catch (error) {
    console.error('[Google Places] Error getting place details:', error);
    return { placeName: null, placeType: null, containingPlace: null };
  }
}
