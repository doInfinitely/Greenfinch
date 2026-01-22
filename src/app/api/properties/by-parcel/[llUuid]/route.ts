import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parcelToProperty } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ llUuid: string }> }
) {
  try {
    const { llUuid } = await params;
    
    if (!llUuid) {
      return NextResponse.json({ error: 'Missing llUuid' }, { status: 400 });
    }

    const [lookup] = await db
      .select({ propertyKey: parcelToProperty.propertyKey })
      .from(parcelToProperty)
      .where(eq(parcelToProperty.llUuid, llUuid))
      .limit(1);

    if (!lookup) {
      return NextResponse.json({ propertyKey: null });
    }

    return NextResponse.json({ propertyKey: lookup.propertyKey });
  } catch (error) {
    console.error('Parcel lookup error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
