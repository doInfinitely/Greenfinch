import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parcelToProperty, properties } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const llUuid = searchParams.get('ll_uuid');
  const parcelnumb = searchParams.get('parcelnumb');

  if (!llUuid && !parcelnumb) {
    return NextResponse.json(
      { error: 'll_uuid or parcelnumb parameter is required' },
      { status: 400 }
    );
  }

  try {
    let propertyKey: string | null = null;

    if (parcelnumb) {
      const normalizedParcel = parcelnumb.replace(/[-\s]/g, '').toUpperCase();
      
      // Strategy 1: Direct match against propertyKey (fast, indexed)
      const directResult = await db
        .select({ propertyKey: properties.propertyKey })
        .from(properties)
        .where(sql`UPPER(REPLACE(REPLACE(${properties.propertyKey}, '-', ''), ' ', '')) = ${normalizedParcel}`)
        .limit(1);

      if (directResult.length > 0) {
        propertyKey = directResult[0].propertyKey;
      } else {
        // Strategy 2: Check if parcelnumb is a constituent using JSONB containment (database-side)
        const constituentResult = await db
          .select({ propertyKey: properties.propertyKey })
          .from(properties)
          .where(sql`${properties.isParentProperty} = true AND ${properties.constituentAccountNums}::jsonb @> ${JSON.stringify([parcelnumb])}::jsonb`)
          .limit(1);

        if (constituentResult.length > 0) {
          propertyKey = constituentResult[0].propertyKey;
        } else {
          // Strategy 3: Prefix match (first 13 chars) for Regrid/DCAD mismatch
          // Regrid parcel numbers like 005457000D01A5800 should match DCAD 005457000D01A0000
          if (normalizedParcel.length >= 13) {
            const prefix = normalizedParcel.substring(0, 13);
            const prefixResult = await db
              .select({ propertyKey: properties.propertyKey })
              .from(properties)
              .where(sql`UPPER(REPLACE(REPLACE(${properties.propertyKey}, '-', ''), ' ', '')) LIKE ${prefix + '%'}`)
              .limit(1);

            if (prefixResult.length > 0) {
              propertyKey = prefixResult[0].propertyKey;
            }
          }
        }
      }
    }

    // Strategy 3: If ll_uuid is provided and no match yet, try parcel mapping table
    if (!propertyKey && llUuid) {
      const parcelResult = await db
        .select({ propertyKey: parcelToProperty.propertyKey })
        .from(parcelToProperty)
        .where(eq(parcelToProperty.llUuid, llUuid))
        .limit(1);

      if (parcelResult.length > 0) {
        propertyKey = parcelResult[0].propertyKey;
      }
    }

    if (!propertyKey) {
      return NextResponse.json(
        { error: 'Property not found for this parcel' },
        { status: 404 }
      );
    }

    const propertyResult = await db
      .select({
        propertyKey: properties.propertyKey,
        address: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        commonName: properties.commonName,
        category: properties.assetCategory,
        subcategory: properties.assetSubcategory,
        isParentProperty: properties.isParentProperty,
        parentPropertyKey: properties.parentPropertyKey,
      })
      .from(properties)
      .where(eq(properties.propertyKey, propertyKey))
      .limit(1);

    if (propertyResult.length === 0) {
      return NextResponse.json({ 
        propertyKey,
        displayName: 'Unknown Property',
      });
    }

    const property = propertyResult[0];
    
    // If this is a constituent, resolve to parent
    if (property.parentPropertyKey) {
      const parentResult = await db
        .select({
          propertyKey: properties.propertyKey,
          address: properties.validatedAddress,
          regridAddress: properties.regridAddress,
          commonName: properties.commonName,
          category: properties.assetCategory,
          subcategory: properties.assetSubcategory,
          isParentProperty: properties.isParentProperty,
        })
        .from(properties)
        .where(eq(properties.propertyKey, property.parentPropertyKey))
        .limit(1);

      if (parentResult.length > 0) {
        const parent = parentResult[0];
        return NextResponse.json({
          propertyKey: parent.propertyKey,
          displayName: parent.commonName || parent.address || parent.regridAddress || 'Unknown Property',
          address: parent.address || parent.regridAddress,
          category: parent.category,
          subcategory: parent.subcategory,
          isParentProperty: parent.isParentProperty,
          resolvedFromConstituent: true,
          constituentPropertyKey: property.propertyKey,
        });
      }
    }

    return NextResponse.json({
      propertyKey: property.propertyKey,
      displayName: property.commonName || property.address || property.regridAddress || 'Unknown Property',
      address: property.address || property.regridAddress,
      category: property.category,
      subcategory: property.subcategory,
      isParentProperty: property.isParentProperty,
    });
  } catch (error) {
    console.error('Error resolving parcel to property:', error);
    return NextResponse.json(
      { error: 'Failed to resolve parcel' },
      { status: 500 }
    );
  }
}
