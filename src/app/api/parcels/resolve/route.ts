import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parcelToProperty, properties } from '@/lib/schema';
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
    const parcelResult = await db
      .select({ propertyKey: parcelToProperty.propertyKey })
      .from(parcelToProperty)
      .where(eq(parcelToProperty.llUuid, llUuid))
      .limit(1);

    if (parcelResult.length === 0) {
      return NextResponse.json(
        { error: 'Property not found for this parcel' },
        { status: 404 }
      );
    }

    const propertyKey = parcelResult[0].propertyKey;

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
