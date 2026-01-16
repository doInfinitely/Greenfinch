import axios from 'axios';

const MAPS_GROUNDING_ENDPOINT = 'https://mapstools.googleapis.com/mcp';

export interface PlaceView {
  place: string;
  id: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  googleMapsLinks?: {
    placeUrl?: string;
    directionsUrl?: string;
    reviewsUrl?: string;
    photosUrl?: string;
  };
}

export interface SearchPlacesResponse {
  places: PlaceView[];
  summary: string;
  nextPageToken?: string;
}

export interface MapsGroundingResult {
  success: boolean;
  summary?: string;
  places?: PlaceView[];
  error?: string;
}

export async function searchPlaces(
  query: string,
  location?: { latitude: number; longitude: number },
  radiusMeters?: number
): Promise<MapsGroundingResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.error('[MapsGrounding] GOOGLE_MAPS_API_KEY not configured');
    return { success: false, error: 'API key not configured' };
  }

  const arguments_: Record<string, unknown> = {
    textQuery: query,
  };

  if (location) {
    arguments_.locationBias = {
      circle: {
        center: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        ...(radiusMeters && { radiusMeters }),
      },
    };
  }

  const requestBody = {
    method: 'tools/call',
    params: {
      name: 'search_places',
      arguments: arguments_,
    },
    jsonrpc: '2.0',
    id: 1,
  };

  try {
    console.log(`[MapsGrounding] Searching: "${query}"${location ? ` near (${location.latitude}, ${location.longitude})` : ''}`);
    const startTime = Date.now();

    const response = await axios.post(MAPS_GROUNDING_ENDPOINT, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'X-Goog-Api-Key': apiKey,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const data = response.data;
    
    if (data?.result?.isError) {
      const errorContent = data.result.content?.[0];
      const errorMsg = errorContent?.text || JSON.stringify(errorContent) || 'Unknown MCP error';
      console.error(`[MapsGrounding] MCP error:`, errorMsg);
      return { success: false, error: errorMsg };
    }

    if (data?.result?.content) {
      const content = data.result.content[0];
      if (content?.text) {
        try {
          const parsed = JSON.parse(content.text) as SearchPlacesResponse;
          console.log(`[MapsGrounding] Found ${parsed.places?.length || 0} places in ${elapsed}s`);
          return {
            success: true,
            summary: parsed.summary,
            places: parsed.places || [],
          };
        } catch {
          console.log(`[MapsGrounding] Response: ${content.text.substring(0, 200)}`);
          return { success: true, summary: content.text, places: [] };
        }
      }
    }

    if (data?.error) {
      console.error(`[MapsGrounding] API error:`, data.error);
      return { success: false, error: data.error.message || 'Unknown error' };
    }

    console.log(`[MapsGrounding] Unexpected response:`, JSON.stringify(data).substring(0, 300));
    return { success: false, error: 'Unexpected response format' };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[MapsGrounding] Request failed:`, error.response?.data || error.message);
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
    console.error(`[MapsGrounding] Error:`, error);
    return { success: false, error: String(error) };
  }
}

export async function getPlaceContext(
  address: string,
  commonName?: string | null,
  latitude?: number | null,
  longitude?: number | null
): Promise<string | null> {
  const query = commonName 
    ? `${commonName} at ${address}`
    : `business or property at ${address}`;

  const location = latitude && longitude 
    ? { latitude, longitude } 
    : undefined;

  const result = await searchPlaces(query, location, 100);

  if (!result.success || !result.summary) {
    return null;
  }

  let context = `Google Maps Context:\n${result.summary}`;
  
  if (result.places && result.places.length > 0) {
    const placeDetails = result.places.slice(0, 3).map((p, i) => {
      const parts = [`[${i}] Place ID: ${p.id}`];
      if (p.googleMapsLinks?.placeUrl) {
        parts.push(`Maps: ${p.googleMapsLinks.placeUrl}`);
      }
      return parts.join(' | ');
    }).join('\n');
    
    context += `\n\nPlace References:\n${placeDetails}`;
  }

  return context;
}
