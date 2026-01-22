import { NextResponse } from 'next/server';

export async function GET() {
  const regridToken = process.env.REGRID_API_KEY || '';
  
  return NextResponse.json({
    mapboxToken: process.env.MAPBOX_API_KEY || '',
    regridToken: regridToken,
    // Use direct Regrid URL to bypass proxy caching issues
    regridTileUrl: regridToken 
      ? `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${regridToken}`
      : '/api/tiles/regrid/{z}/{x}/{y}',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
}
