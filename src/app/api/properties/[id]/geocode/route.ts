import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq, or } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DCAD_KEY_REGEX = /^[0-9A-Z]{17,20}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json({ error: 'Invalid property ID' }, { status: 400 });
    }

    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        regridAddress: properties.regridAddress,
        validatedAddress: properties.validatedAddress,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        geocodedLat: properties.geocodedLat,
        geocodedLon: properties.geocodedLon,
      })
      .from(properties)
      .where(
        isUuid
          ? or(eq(properties.id, id), eq(properties.propertyKey, id))
          : eq(properties.propertyKey, id)
      )
      .limit(1);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    if (property.geocodedLat != null && property.geocodedLon != null) {
      return NextResponse.json({
        geocodedLat: property.geocodedLat,
        geocodedLon: property.geocodedLon,
        cached: true,
      });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ geocodedLat: null, geocodedLon: null, error: 'Maps not configured' });
    }

    const streetPart = property.validatedAddress || property.regridAddress;
    if (!streetPart) {
      return NextResponse.json({ geocodedLat: null, geocodedLon: null, error: 'No address available' });
    }

    const addressParts = [streetPart];
    if (property.city) addressParts.push(property.city);
    if (property.state) addressParts.push(property.state);
    if (property.zip) addressParts.push(property.zip);
    const fullAddress = addressParts.join(', ');

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`;
    const geocodeRes = await fetch(geocodeUrl);

    if (!geocodeRes.ok) {
      return NextResponse.json({ geocodedLat: null, geocodedLon: null, error: 'Geocoding request failed' });
    }

    const geocodeData = await geocodeRes.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results?.[0]?.geometry?.location) {
      return NextResponse.json({ geocodedLat: null, geocodedLon: null, error: 'No geocoding results' });
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;

    await db
      .update(properties)
      .set({ geocodedLat: lat, geocodedLon: lng })
      .where(eq(properties.id, property.id));

    return NextResponse.json({ geocodedLat: lat, geocodedLon: lng, cached: false });
  } catch (err) {
    console.error('[geocode] Error:', err);
    return NextResponse.json({ geocodedLat: null, geocodedLon: null, error: 'Internal error' });
  }
}
