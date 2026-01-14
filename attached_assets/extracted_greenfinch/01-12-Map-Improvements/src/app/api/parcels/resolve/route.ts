import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parcelToProperty } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const llUuid = searchParams.get('ll_uuid');

  if (!llUuid) {
    return NextResponse.json(
      { error: 'll_uuid parameter is required' },
      { status: 400 }
    );
  }

  try {
    const result = await db
      .select({ propertyKey: parcelToProperty.propertyKey })
      .from(parcelToProperty)
      .where(eq(parcelToProperty.llUuid, llUuid))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Property not found for this parcel' },
        { status: 404 }
      );
    }

    return NextResponse.json({ propertyKey: result[0].propertyKey });
  } catch (error) {
    console.error('Error resolving parcel to property:', error);
    return NextResponse.json(
      { error: 'Failed to resolve parcel' },
      { status: 500 }
    );
  }
}
