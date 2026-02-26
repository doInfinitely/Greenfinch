import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [property] = await db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        geocodedLat: properties.geocodedLat,
        geocodedLon: properties.geocodedLon,
        validatedAddress: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
      })
      .from(properties)
      .where(eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      const [byId] = await db
        .select({
          id: properties.id,
          propertyKey: properties.propertyKey,
          geocodedLat: properties.geocodedLat,
          geocodedLon: properties.geocodedLon,
          validatedAddress: properties.validatedAddress,
          regridAddress: properties.regridAddress,
          city: properties.city,
          state: properties.state,
          zip: properties.zip,
        })
        .from(properties)
        .where(eq(properties.id, id))
        .limit(1);

      if (!byId) {
        return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 });
      }
      Object.assign(property ?? {}, byId);
      return geocodeProperty(byId);
    }

    return geocodeProperty(property);
  } catch (error) {
    console.error('Geocode error:', error);
    return NextResponse.json({ success: false, error: 'Geocode failed' }, { status: 500 });
  }
}

async function geocodeProperty(property: {
  id: string;
  propertyKey: string;
  geocodedLat: number | null;
  geocodedLon: number | null;
  validatedAddress: string | null;
  regridAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}) {
  if (property.geocodedLat && property.geocodedLon) {
    return NextResponse.json({
      success: true,
      data: { geocodedLat: property.geocodedLat, geocodedLon: property.geocodedLon },
      cached: true,
    });
  }

  const address = property.validatedAddress || property.regridAddress;
  if (!address) {
    return NextResponse.json({ success: false, error: 'No address to geocode' }, { status: 400 });
  }

  const fullAddress = [address, property.city, property.state, property.zip].filter(Boolean).join(', ');

  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleApiKey) {
    return NextResponse.json({ success: false, error: 'Geocoding not configured' }, { status: 500 });
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${googleApiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) {
    console.error('Geocode API response:', data.status, data.error_message);
    return NextResponse.json({ success: false, error: 'Could not geocode address' }, { status: 422 });
  }

  const { lat, lng } = data.results[0].geometry.location;

  await db
    .update(properties)
    .set({ geocodedLat: lat, geocodedLon: lng })
    .where(eq(properties.id, property.id));

  return NextResponse.json({
    success: true,
    data: { geocodedLat: lat, geocodedLon: lng },
    cached: false,
  });
}
