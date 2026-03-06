import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq } from 'drizzle-orm';
import { runFocusedEnrichment, classifyAndVerifyProperty, identifyOwnership, discoverContacts } from '../src/lib/ai';
import type { CommercialProperty } from '../src/lib/property-types';

function buildCommercialPropertyFromDb(prop: any): CommercialProperty {
  return {
    parcelId: prop.propertyKey,
    address: prop.regridAddress || '',
    city: prop.city || '',
    zip: prop.zip || '',
    lat: prop.lat || 0,
    lon: prop.lon || 0,
    usedesc: prop.dcadZoning || '',
    usecode: '',
    sptdCode: prop.dcadSptdCode || null,
    regridYearBuilt: prop.yearBuilt || null,
    regridNumStories: prop.numFloors || null,
    regridImprovVal: null,
    regridLandVal: null,
    regridTotalVal: null,
    lotAcres: prop.lotSqft ? prop.lotSqft / 43560 : null,
    lotSqft: prop.lotSqft || null,
    bldgFootprintSqft: null,
    accountNum: prop.dcadAccountNum || '',
    gisParcelId: prop.dcadGisParcelId || null,
    divisionCd: prop.dcadDivisionCd || 'COM',
    dcadImprovVal: prop.dcadImprovVal || null,
    dcadLandVal: prop.dcadLandVal || null,
    dcadTotalVal: prop.dcadTotalVal || null,
    cityJurisDesc: prop.dcadCityJuris || null,
    isdJurisDesc: prop.dcadIsdJuris || null,
    bizName: prop.dcadBizName || null,
    ownerName1: prop.dcadOwnerName1 || null,
    ownerName2: prop.dcadOwnerName2 || null,
    ownerAddressLine1: prop.dcadOwnerAddress || null,
    ownerCity: prop.dcadOwnerCity || null,
    ownerState: prop.dcadOwnerState || null,
    ownerZipcode: prop.dcadOwnerZip || null,
    ownerPhone: prop.dcadOwnerPhone || null,
    deedTxfrDate: prop.dcadDeedTransferDate || null,
    legal1: null,
    legal2: null,
    legal3: null,
    legal4: null,
    dcadZoning: prop.dcadZoning || null,
    frontDim: prop.dcadLandFrontDim || null,
    depthDim: prop.dcadLandDepthDim || null,
    landArea: prop.dcadLandArea || null,
    landAreaUom: prop.dcadLandAreaUom || null,
    landCostPerUom: null,
    buildingCount: prop.dcadBuildingCount || 1,
    oldestYearBuilt: prop.dcadOldestYearBuilt || null,
    newestYearBuilt: prop.dcadNewestYearBuilt || null,
    totalGrossBldgArea: prop.dcadTotalGrossBldgArea || null,
    totalUnits: prop.dcadTotalUnits || null,
    buildings: prop.dcadBuildings || [],
  };
}

async function main() {
  const propertyKey = process.argv[2];
  const step = process.argv[3] || 'all';

  if (!propertyKey) {
    console.log('Usage: npx tsx scripts/test-ai-enrichment.ts <propertyKey> [classify|ownership|contacts|all]');
    process.exit(1);
  }

  console.log(`\n=== Testing Focused Enrichment ===`);
  console.log(`Property Key: ${propertyKey}`);
  console.log(`Step: ${step}\n`);

  try {
    const [prop] = await db.select().from(properties).where(eq(properties.propertyKey, propertyKey));

    if (!prop) {
      console.log(`Property not found: ${propertyKey}`);
      process.exit(1);
    }

    const property = buildCommercialPropertyFromDb(prop);

    console.log('=== INPUT PROPERTY ===');
    console.log(`Address: ${property.address}, ${property.city}, TX ${property.zip}`);
    console.log(`Buildings: ${property.buildingCount}`);
    console.log(`Total Sqft: ${property.totalGrossBldgArea?.toLocaleString()}`);
    console.log(`Owner: ${property.bizName || property.ownerName1}`);

    if (step === 'classify' || step === 'all') {
      console.log('\n=== STEP 1: CLASSIFY PROPERTY ===');
      const startTime = Date.now();
      const classification = await classifyAndVerifyProperty(property);
      console.log(`Time: ${Date.now() - startTime}ms`);
      console.log(JSON.stringify(classification, null, 2));

      if (step === 'all') {
        console.log('\n=== STEP 2: IDENTIFY OWNERSHIP ===');
        const startOwnership = Date.now();
        const ownership = await identifyOwnership(property, classification);
        console.log(`Time: ${Date.now() - startOwnership}ms`);
        console.log(JSON.stringify(ownership, null, 2));

        console.log('\n=== STEP 3: DISCOVER CONTACTS ===');
        const startContacts = Date.now();
        const contacts = await discoverContacts(property, classification, ownership);
        console.log(`Time: ${Date.now() - startContacts}ms`);
        console.log(`Contacts found: ${contacts.length}`);
        console.log(JSON.stringify(contacts, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
