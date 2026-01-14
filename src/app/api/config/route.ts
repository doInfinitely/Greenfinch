import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    mapboxToken: process.env.MAPBOX_API_KEY || '',
    regridToken: process.env.REGRID_API_KEY || '',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
}
