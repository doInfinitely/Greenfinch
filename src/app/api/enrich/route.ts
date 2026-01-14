import { NextRequest, NextResponse } from 'next/server';
import { getPropertyByKey } from '@/lib/snowflake';
import { enrichAndStoreProperty, enrichProperty } from '@/lib/enrichment';
import { isBatchRunning, checkRateLimitForIndividual, updateLastRequestTime } from '@/lib/enrichment-queue';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import type { AggregatedProperty } from '@/lib/snowflake';

async function getPropertyFromPostgres(propertyKey: string): Promise<AggregatedProperty | null> {
  const [prop] = await db.select().from(properties).where(eq(properties.propertyKey, propertyKey));
  if (!prop) return null;
  
  const rawParcels = Array.isArray(prop.rawParcelsJson) ? prop.rawParcelsJson as any[] : [];
  const allOwners = new Set<string>();
  const usedescSet = new Set<string>();
  const usecodeSet = new Set<string>();
  let totalParval = 0;
  let totalImprovval = 0;
  let maxLandval = 0;
  
  for (const parcel of rawParcels) {
    if (parcel.owner) allOwners.add(parcel.owner);
    if (parcel.owner2) allOwners.add(parcel.owner2);
    if (parcel.usedesc) usedescSet.add(parcel.usedesc);
    if (parcel.usecode) usecodeSet.add(parcel.usecode);
    totalParval += parcel.parval || 0;
    totalImprovval += parcel.improvval || 0;
    maxLandval = Math.max(maxLandval, parcel.landval || 0);
  }
  
  if (prop.regridOwner) allOwners.add(prop.regridOwner);
  if (prop.regridOwner2) allOwners.add(prop.regridOwner2);
  
  return {
    propertyKey: prop.propertyKey,
    sourceLlUuid: prop.sourceLlUuid || '',
    llStackUuid: prop.llStackUuid || null,
    address: prop.regridAddress || prop.validatedAddress || '',
    city: prop.city || '',
    state: prop.state || 'TX',
    zip: prop.zip || '',
    county: prop.county || '',
    lat: prop.lat || 0,
    lon: prop.lon || 0,
    lotSqft: prop.lotSqft || 0,
    buildingSqft: prop.buildingSqft || null,
    yearBuilt: prop.yearBuilt || null,
    numFloors: prop.numFloors || null,
    totalParval,
    totalImprovval,
    landval: maxLandval,
    allOwners: Array.from(allOwners),
    primaryOwner: prop.regridOwner || null,
    usedesc: Array.from(usedescSet),
    usecode: Array.from(usecodeSet),
    zoning: [],
    zoningDescription: [],
    parcelCount: rawParcels.length || 1,
    rawParcelsJson: rawParcels,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (isBatchRunning()) {
      return NextResponse.json(
        { 
          error: 'A batch enrichment is currently running. Individual enrichment requests are blocked to prevent conflicts.',
          checkStatusAt: '/api/admin/enrich-status'
        },
        { status: 409 }
      );
    }

    const canProceed = await checkRateLimitForIndividual();
    if (!canProceed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before making another enrichment request.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { propertyKey, storeResults = true } = body;

    if (!propertyKey) {
      return NextResponse.json(
        { error: 'propertyKey is required' },
        { status: 400 }
      );
    }

    updateLastRequestTime();
    console.log(`[API] Enrichment request for property: ${propertyKey}`);

    // Try PostgreSQL first (already ingested data), fall back to Snowflake
    let property = await getPropertyFromPostgres(propertyKey);
    let source = 'postgres';
    
    if (!property) {
      console.log(`[API] Property not in PostgreSQL, checking Snowflake...`);
      property = await getPropertyByKey(propertyKey);
      source = 'snowflake';
    }

    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    console.log(`[API] Found property from ${source}: ${property.address}, ${property.city}`);

    if (storeResults) {
      // Enrich and store results
      const { result, stored } = await enrichAndStoreProperty(property);

      if (!result.success) {
        return NextResponse.json(
          { 
            error: 'Enrichment failed', 
            details: result.error,
            propertyKey: result.propertyKey
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        propertyKey: result.propertyKey,
        enrichment: {
          property: result.property,
          contacts: result.contacts,
          organizations: result.organizations,
        },
        stored: stored ? {
          propertyId: stored.propertyId,
          contactIds: stored.contactIds,
          orgIds: stored.orgIds,
        } : null,
      });
    } else {
      // Enrich only, don't store
      const result = await enrichProperty(property);

      if (!result.success) {
        return NextResponse.json(
          { 
            error: 'Enrichment failed', 
            details: result.error,
            propertyKey: result.propertyKey
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        propertyKey: result.propertyKey,
        enrichment: {
          property: result.property,
          contacts: result.contacts,
          organizations: result.organizations,
        },
        rawResponse: result.rawResponse,
      });
    }
  } catch (error) {
    console.error('[API] Enrichment error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const propertyKey = searchParams.get('propertyKey');

  if (!propertyKey) {
    return NextResponse.json(
      { error: 'propertyKey query parameter is required' },
      { status: 400 }
    );
  }

  // Redirect to POST with the propertyKey
  return NextResponse.json({
    message: 'Use POST method to trigger enrichment',
    example: {
      method: 'POST',
      body: {
        propertyKey,
        storeResults: true,
      },
    },
  });
}
