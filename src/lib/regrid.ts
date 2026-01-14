import axios from 'axios';

const REGRID_API_BASE = 'https://app.regrid.com/api/v2';

export interface RegridTypeaheadResult {
  llUuid: string;
  address: string;
  context: string;
  path: string;
  coordinates: [number, number];
  score: number;
}

export interface RegridParcelPoint {
  llUuid: string;
  address: string;
  owner: string;
  usedesc: string;
  parval: number;
  lat: number;
  lon: number;
}

export async function typeaheadSearch(query: string): Promise<RegridTypeaheadResult[]> {
  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    throw new Error('REGRID_API_KEY is not set');
  }

  try {
    const response = await axios.get(`${REGRID_API_BASE}/parcels/typeahead`, {
      params: { query, token: apiKey },
    });

    const features = response.data?.features || [];
    
    return features.map((f: any) => ({
      llUuid: f.properties?.ll_uuid || '',
      address: f.properties?.address || '',
      context: f.properties?.context || '',
      path: f.properties?.path || '',
      coordinates: f.geometry?.coordinates || [0, 0],
      score: f.properties?.score || 0,
    }));
  } catch (error) {
    console.error('Regrid typeahead error:', error);
    return [];
  }
}

export async function getParcelByPoint(lat: number, lon: number): Promise<RegridParcelPoint | null> {
  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    throw new Error('REGRID_API_KEY is not set');
  }

  try {
    const response = await axios.get(`${REGRID_API_BASE}/parcels/point`, {
      params: { lat, lon, token: apiKey },
    });

    const feature = response.data?.features?.[0];
    if (!feature) return null;

    const props = feature.properties || {};
    
    return {
      llUuid: props.ll_uuid || '',
      address: props.address || '',
      owner: props.owner || '',
      usedesc: props.usedesc || '',
      parval: props.parval || 0,
      lat: feature.geometry?.coordinates?.[1] || lat,
      lon: feature.geometry?.coordinates?.[0] || lon,
    };
  } catch (error) {
    console.error('Regrid point lookup error:', error);
    return null;
  }
}

export function getTileUrl(): string {
  const apiKey = process.env.REGRID_API_KEY;
  return `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${apiKey}`;
}
