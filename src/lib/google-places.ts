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
