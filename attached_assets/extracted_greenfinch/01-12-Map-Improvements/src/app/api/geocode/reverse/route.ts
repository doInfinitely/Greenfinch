import { NextRequest, NextResponse } from 'next/server';
import { getParcelByPoint } from '@/lib/regrid';
import { resolveParcelToProperty } from '@/lib/postgres-queries';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const latStr = searchParams.get('lat');
    const lonStr = searchParams.get('lon');

    if (!latStr || !lonStr) {
      return NextResponse.json(
        { error: 'lat and lon parameters are required' },
        { status: 400 }
      );
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json(
        { error: 'Invalid lat/lon values' },
        { status: 400 }
      );
    }

    const parcel = await getParcelByPoint(lat, lon);

    if (!parcel || !parcel.llUuid) {
      return NextResponse.json({
        found: false,
        message: 'No parcel found at this location',
        lat,
        lon,
      });
    }

    const resolved = await resolveParcelToProperty(parcel.llUuid);

    if (!resolved) {
      return NextResponse.json({
        found: false,
        message: 'Parcel found but no matching property in database',
        parcel: {
          llUuid: parcel.llUuid,
          address: parcel.address,
          owner: parcel.owner,
          usedesc: parcel.usedesc,
        },
        lat,
        lon,
      });
    }

    return NextResponse.json({
      found: true,
      propertyKey: resolved.propertyKey,
      propertyId: resolved.property.id,
      property: resolved.property,
      parcel: {
        llUuid: parcel.llUuid,
        address: parcel.address,
        owner: parcel.owner,
        usedesc: parcel.usedesc,
      },
      lat,
      lon,
    });
  } catch (error) {
    console.error('Reverse geocode error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve location' },
      { status: 500 }
    );
  }
}
