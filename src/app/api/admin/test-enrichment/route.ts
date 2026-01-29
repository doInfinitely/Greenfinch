import { NextRequest, NextResponse } from 'next/server';
import { getCommercialPropertyByParcelId, getCommercialPropertiesByZip, type CommercialProperty } from '@/lib/snowflake';
import { runFocusedEnrichment, classifyAndVerifyProperty, identifyOwnership, discoverContacts } from '@/lib/ai-enrichment';

export async function GET(request: NextRequest) {
  const parcelId = request.nextUrl.searchParams.get('parcelId');
  const zipCode = request.nextUrl.searchParams.get('zip') || '75225';
  const step = request.nextUrl.searchParams.get('step');
  
  try {
    let property;
    
    if (parcelId) {
      property = await getCommercialPropertyByParcelId(parcelId);
      if (!property) {
        return NextResponse.json({ error: `Property not found: ${parcelId}` }, { status: 404 });
      }
    } else {
      const properties = await getCommercialPropertiesByZip(zipCode, 'COM', 5);
      if (properties.length === 0) {
        return NextResponse.json({ error: `No properties found in ZIP ${zipCode}` }, { status: 404 });
      }
      const multiBuilding = properties.find((p: CommercialProperty) => p.buildingCount > 1) || properties[0];
      property = multiBuilding;
    }

    console.log(`[test-enrichment] Testing with property: ${property.parcelId}`);
    console.log(`[test-enrichment] Address: ${property.address}, ${property.city}`);
    console.log(`[test-enrichment] Buildings: ${property.buildingCount}`);

    if (step === 'classify') {
      const startTime = Date.now();
      const stage1 = await classifyAndVerifyProperty(property);
      const elapsed = Date.now() - startTime;
      
      return NextResponse.json({
        step: 'classify',
        property: {
          parcelId: property.parcelId,
          address: property.address,
          city: property.city,
          buildingCount: property.buildingCount,
          totalSqft: property.totalGrossBldgArea,
          buildings: property.buildings?.slice(0, 5)
        },
        result: stage1,
        timing: { ms: elapsed }
      });
    }

    if (step === 'ownership') {
      const stage1 = await classifyAndVerifyProperty(property);
      const startTime = Date.now();
      const ownership = await identifyOwnership(property, stage1.data.classification);
      const elapsed = Date.now() - startTime;
      
      return NextResponse.json({
        step: 'ownership',
        classification: stage1.data.classification,
        result: ownership,
        timing: { ms: elapsed }
      });
    }

    if (step === 'contacts') {
      const stage1 = await classifyAndVerifyProperty(property);
      const ownership = await identifyOwnership(property, stage1.data.classification);
      const startTime = Date.now();
      const contacts = await discoverContacts(property, stage1.data.classification, ownership.data);
      const elapsed = Date.now() - startTime;
      
      return NextResponse.json({
        step: 'contacts',
        classification: stage1.data.classification,
        ownership,
        result: contacts,
        timing: { ms: elapsed }
      });
    }

    const result = await runFocusedEnrichment(property);

    return NextResponse.json({
      success: true,
      input: {
        parcelId: property.parcelId,
        address: property.address,
        city: property.city,
        zip: property.zip,
        buildingCount: property.buildingCount,
        totalSqft: property.totalGrossBldgArea,
        deedOwner: property.bizName || property.ownerName1,
        buildings: property.buildings?.slice(0, 5)
      },
      result,
      timing: result.timing
    });
    
  } catch (error) {
    console.error('[test-enrichment] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
