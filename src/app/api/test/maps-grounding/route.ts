import { NextRequest, NextResponse } from 'next/server';
import { searchPlaces, getPlaceContext } from '@/lib/maps-grounding';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  const address = searchParams.get('address');
  const name = searchParams.get('name');
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');

  if (address) {
    const latitude = lat ? parseFloat(lat) : null;
    const longitude = lng ? parseFloat(lng) : null;
    
    const context = await getPlaceContext(address, name, latitude, longitude);
    
    return NextResponse.json({
      success: !!context,
      address,
      name,
      context,
    });
  }

  if (!query) {
    return NextResponse.json(
      { error: 'Missing query or address parameter' },
      { status: 400 }
    );
  }

  const latitude = lat ? parseFloat(lat) : undefined;
  const longitude = lng ? parseFloat(lng) : undefined;
  const location = latitude && longitude ? { latitude, longitude } : undefined;

  const result = await searchPlaces(query, location);

  return NextResponse.json({
    success: result.success,
    query,
    location,
    summary: result.summary,
    placesCount: result.places?.length || 0,
    places: result.places?.slice(0, 5),
    error: result.error,
  });
}
