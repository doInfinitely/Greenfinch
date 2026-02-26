import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq, or } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        streetviewPanoId: properties.streetviewPanoId,
        validatedAddress: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        lat: properties.lat,
        lon: properties.lon,
        geocodedLat: properties.geocodedLat,
        geocodedLon: properties.geocodedLon,
      })
      .from(properties)
      .where(isUuid ? or(eq(properties.id, id), eq(properties.propertyKey, id)) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      console.log(`[StreetView] Property not found: ${id}`);
      return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 });
    }

    if (property.streetviewPanoId) {
      return NextResponse.json({
        success: true,
        data: {
          panoId: property.streetviewPanoId,
          lat: property.geocodedLat || property.lat,
          lon: property.geocodedLon || property.lon,
        },
        cached: true,
      });
    }

    const address = property.validatedAddress || property.regridAddress;
    if (!address) {
      console.log(`[StreetView] No address for property: ${id}`);
      return NextResponse.json({ success: false, error: 'No address available' }, { status: 400 });
    }

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleApiKey) {
      console.log(`[StreetView] GOOGLE_MAPS_API_KEY not configured`);
      return NextResponse.json({ success: false, error: 'Not configured' }, { status: 500 });
    }

    const fullAddress = [address, property.city, property.state, property.zip].filter(Boolean).join(', ');

    const metadataUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(fullAddress)}&preference=nearest&source=outdoor&key=${googleApiKey}`;
    const response = await fetch(metadataUrl);
    const data = await response.json();

    if (data.status !== 'OK' || !data.pano_id) {
      console.log(`[StreetView] No panorama for "${fullAddress}": status=${data.status}`);
      return NextResponse.json({ success: false, error: 'No street view available' }, { status: 404 });
    }

    await db
      .update(properties)
      .set({ streetviewPanoId: data.pano_id })
      .where(eq(properties.id, property.id));

    return NextResponse.json({
      success: true,
      data: {
        panoId: data.pano_id,
        lat: data.location?.lat || property.geocodedLat || property.lat,
        lon: data.location?.lng || property.geocodedLon || property.lon,
      },
      cached: false,
    });
  } catch (error) {
    console.error('Street view metadata error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch street view' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const isUuid = UUID_REGEX.test(id);
    await db
      .update(properties)
      .set({ streetviewPanoId: null })
      .where(isUuid ? or(eq(properties.id, id), eq(properties.propertyKey, id)) : eq(properties.propertyKey, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Street view cache clear error:', error);
    return NextResponse.json({ success: false, error: 'Failed to clear cache' }, { status: 500 });
  }
}
