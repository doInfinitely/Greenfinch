import axios from 'axios';

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_API_KEY;
const MAPBOX_SEARCHBOX_URL = 'https://api.mapbox.com/search/searchbox/v1';

export interface MapboxPOIResult {
  name: string | null;
  category: string;
  subcategory: string;
  mapboxCategories: string[];
  operationalStatus: 'open' | 'closed' | 'temporarily_closed' | 'unknown';
  confidence: number;
  rawResponse: unknown;
}

interface MapboxFeature {
  type: string;
  properties: {
    name?: string;
    name_preferred?: string;
    mapbox_id?: string;
    feature_type?: string;
    category?: string;
    maki?: string;
    poi_category?: string[];
    poi_category_ids?: string[];
    operational_status?: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
}

interface MapboxCategoryResponse {
  type: string;
  features: MapboxFeature[];
  attribution: string;
}

const MAPBOX_TO_GREENFINCH_CATEGORY: Record<string, { category: string; subcategory: string }> = {
  'office': { category: 'Office', subcategory: 'Office Building' },
  'commercial': { category: 'Retail', subcategory: 'Standalone Retail' },
  'retail': { category: 'Retail', subcategory: 'Standalone Retail' },
  'shopping': { category: 'Retail', subcategory: 'Shopping Center' },
  'shopping_mall': { category: 'Retail', subcategory: 'Shopping Center' },
  'supermarket': { category: 'Retail', subcategory: 'Standalone Retail' },
  'grocery': { category: 'Retail', subcategory: 'Standalone Retail' },
  'convenience_store': { category: 'Retail', subcategory: 'Convenience/Gas Station' },
  'gas_station': { category: 'Retail', subcategory: 'Convenience/Gas Station' },
  'restaurant': { category: 'Retail', subcategory: 'Restaurant/Food Service' },
  'food': { category: 'Retail', subcategory: 'Restaurant/Food Service' },
  'fast_food': { category: 'Retail', subcategory: 'Restaurant/Food Service' },
  'cafe': { category: 'Retail', subcategory: 'Restaurant/Food Service' },
  'coffee': { category: 'Retail', subcategory: 'Restaurant/Food Service' },
  'bar': { category: 'Retail', subcategory: 'Restaurant/Food Service' },
  'bank': { category: 'Office', subcategory: 'Office Building' },
  'financial': { category: 'Office', subcategory: 'Office Building' },
  'hotel': { category: 'Hospitality', subcategory: 'Hotel' },
  'motel': { category: 'Hospitality', subcategory: 'Motel' },
  'lodging': { category: 'Hospitality', subcategory: 'Hotel' },
  'hospital': { category: 'Healthcare', subcategory: 'Hospital' },
  'medical': { category: 'Healthcare', subcategory: 'Medical Center' },
  'doctor': { category: 'Healthcare', subcategory: 'Outpatient Clinic' },
  'dentist': { category: 'Healthcare', subcategory: 'Outpatient Clinic' },
  'pharmacy': { category: 'Healthcare', subcategory: 'Outpatient Clinic' },
  'clinic': { category: 'Healthcare', subcategory: 'Outpatient Clinic' },
  'industrial': { category: 'Industrial', subcategory: 'Other Industrial' },
  'warehouse': { category: 'Industrial', subcategory: 'Warehouse/Distribution' },
  'storage': { category: 'Industrial', subcategory: 'Self-Storage' },
  'factory': { category: 'Industrial', subcategory: 'Manufacturing' },
  'manufacturing': { category: 'Industrial', subcategory: 'Manufacturing' },
  'school': { category: 'Public & Institutional', subcategory: 'School/University' },
  'university': { category: 'Public & Institutional', subcategory: 'School/University' },
  'college': { category: 'Public & Institutional', subcategory: 'School/University' },
  'church': { category: 'Public & Institutional', subcategory: 'Religious' },
  'place_of_worship': { category: 'Public & Institutional', subcategory: 'Religious' },
  'government': { category: 'Public & Institutional', subcategory: 'Government' },
  'city_hall': { category: 'Public & Institutional', subcategory: 'Government' },
  'library': { category: 'Public & Institutional', subcategory: 'Other Institutional' },
  'museum': { category: 'Public & Institutional', subcategory: 'Other Institutional' },
  'park': { category: 'Public & Institutional', subcategory: 'Recreation/Parks' },
  'playground': { category: 'Public & Institutional', subcategory: 'Recreation/Parks' },
  'gym': { category: 'Special Purpose', subcategory: 'Sports/Fitness' },
  'fitness': { category: 'Special Purpose', subcategory: 'Sports/Fitness' },
  'sports': { category: 'Special Purpose', subcategory: 'Sports/Fitness' },
  'parking': { category: 'Special Purpose', subcategory: 'Parking' },
  'car_repair': { category: 'Special Purpose', subcategory: 'Auto Service' },
  'car_dealer': { category: 'Special Purpose', subcategory: 'Auto Service' },
  'car_wash': { category: 'Special Purpose', subcategory: 'Auto Service' },
  'auto': { category: 'Special Purpose', subcategory: 'Auto Service' },
  'cinema': { category: 'Special Purpose', subcategory: 'Entertainment' },
  'theater': { category: 'Special Purpose', subcategory: 'Entertainment' },
  'entertainment': { category: 'Special Purpose', subcategory: 'Entertainment' },
  'apartment': { category: 'Multifamily', subcategory: 'Apartment Complex' },
  'residential': { category: 'Multifamily', subcategory: 'Apartment Complex' },
  'senior_living': { category: 'Multifamily', subcategory: 'Senior Living' },
  'assisted_living': { category: 'Multifamily', subcategory: 'Senior Living' },
  'nursing_home': { category: 'Healthcare', subcategory: 'Assisted Living' },
};

function mapMapboxToGreenfinch(mapboxCategories: string[]): { category: string; subcategory: string } {
  for (const cat of mapboxCategories) {
    const normalized = cat.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    if (MAPBOX_TO_GREENFINCH_CATEGORY[normalized]) {
      return MAPBOX_TO_GREENFINCH_CATEGORY[normalized];
    }
    
    for (const [key, value] of Object.entries(MAPBOX_TO_GREENFINCH_CATEGORY)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return value;
      }
    }
  }
  
  return { category: 'Unknown', subcategory: 'Unknown' };
}

function parseOperationalStatus(status: string | undefined): MapboxPOIResult['operationalStatus'] {
  if (!status) return 'unknown';
  
  const normalized = status.toLowerCase();
  if (normalized === 'open' || normalized === 'operational') return 'open';
  if (normalized === 'closed' || normalized === 'permanently_closed') return 'closed';
  if (normalized === 'temporarily_closed') return 'temporarily_closed';
  return 'unknown';
}

const poiCache = new Map<string, { result: MapboxPOIResult; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCacheKey(lat: number, lon: number): string {
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLon = Math.round(lon * 10000) / 10000;
  return `${roundedLat},${roundedLon}`;
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200;

async function throttle(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
  }
  
  lastRequestTime = Date.now();
}

export async function enrichWithMapboxPOI(lat: number, lon: number): Promise<MapboxPOIResult> {
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error('MAPBOX_API_KEY not configured');
    return {
      name: null,
      category: 'Unknown',
      subcategory: 'Unknown',
      mapboxCategories: [],
      operationalStatus: 'unknown',
      confidence: 0,
      rawResponse: null,
    };
  }
  
  const cacheKey = getCacheKey(lat, lon);
  const cached = poiCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }
  
  await throttle();
  
  try {
    const url = `${MAPBOX_SEARCHBOX_URL}/reverse`;
    const response = await axios.get<MapboxCategoryResponse>(url, {
      params: {
        longitude: lon,
        latitude: lat,
        access_token: MAPBOX_ACCESS_TOKEN,
        types: 'poi',
        limit: 1,
      },
      timeout: 5000,
    });
    
    const features = response.data.features || [];
    
    if (features.length === 0) {
      const noPoiResult: MapboxPOIResult = {
        name: null,
        category: 'Unknown',
        subcategory: 'Unknown',
        mapboxCategories: [],
        operationalStatus: 'unknown',
        confidence: 0,
        rawResponse: response.data,
      };
      
      poiCache.set(cacheKey, { result: noPoiResult, timestamp: Date.now() });
      return noPoiResult;
    }
    
    const feature = features[0];
    const props = feature.properties;
    
    const mapboxCategories: string[] = [];
    if (props.category) mapboxCategories.push(props.category);
    if (props.poi_category) mapboxCategories.push(...props.poi_category);
    if (props.maki) mapboxCategories.push(props.maki);
    
    const { category, subcategory } = mapMapboxToGreenfinch(mapboxCategories);
    const operationalStatus = parseOperationalStatus(props.operational_status);
    
    const distance = calculateDistance(lat, lon, feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
    const confidence = distance < 50 ? 0.9 : distance < 100 ? 0.7 : distance < 200 ? 0.5 : 0.3;
    
    const result: MapboxPOIResult = {
      name: props.name_preferred || props.name || null,
      category,
      subcategory,
      mapboxCategories,
      operationalStatus,
      confidence,
      rawResponse: response.data,
    };
    
    poiCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        console.warn('Mapbox rate limit hit, waiting...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      console.error('Mapbox API error:', error.response?.status, error.response?.data);
    } else {
      console.error('Mapbox enrichment error:', error);
    }
    
    return {
      name: null,
      category: 'Unknown',
      subcategory: 'Unknown',
      mapboxCategories: [],
      operationalStatus: 'unknown',
      confidence: 0,
      rawResponse: null,
    };
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export async function batchEnrichWithMapboxPOI(
  coordinates: Array<{ lat: number; lon: number; propertyKey: string }>,
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, MapboxPOIResult>> {
  const results = new Map<string, MapboxPOIResult>();
  
  for (let i = 0; i < coordinates.length; i++) {
    const { lat, lon, propertyKey } = coordinates[i];
    
    try {
      const result = await enrichWithMapboxPOI(lat, lon);
      results.set(propertyKey, result);
    } catch (error) {
      console.error(`Failed to enrich ${propertyKey}:`, error);
      results.set(propertyKey, {
        name: null,
        category: 'Unknown',
        subcategory: 'Unknown',
        mapboxCategories: [],
        operationalStatus: 'unknown',
        confidence: 0,
        rawResponse: null,
      });
    }
    
    if (onProgress) {
      onProgress(i + 1, coordinates.length);
    }
  }
  
  return results;
}

export function clearPOICache(): void {
  poiCache.clear();
}

export function getPOICacheStats(): { size: number; oldestMs: number | null } {
  let oldestTs = Infinity;
  
  for (const [, value] of poiCache) {
    if (value.timestamp < oldestTs) {
      oldestTs = value.timestamp;
    }
  }
  
  return {
    size: poiCache.size,
    oldestMs: oldestTs === Infinity ? null : Date.now() - oldestTs,
  };
}
