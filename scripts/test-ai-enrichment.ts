import { getCommercialPropertyByParcelId, getCommercialPropertiesByZip } from '../src/lib/snowflake';
import { runFocusedEnrichment, classifyAndVerifyProperty, identifyOwnership, discoverContacts } from '../src/lib/ai';

async function main() {
  const parcelId = process.argv[2] || '005453000K01A0000'; // NorthPark Mall default
  const step = process.argv[3] || 'all';
  
  console.log(`\n=== Testing Focused Enrichment ===`);
  console.log(`Parcel ID: ${parcelId}`);
  console.log(`Step: ${step}\n`);
  
  try {
    let property = await getCommercialPropertyByParcelId(parcelId);
    
    if (!property) {
      console.log(`Property not found: ${parcelId}`);
      console.log('Fetching a sample property from ZIP 75225...');
      const properties = await getCommercialPropertiesByZip('75225', 'COM', 5);
      if (properties.length === 0) {
        throw new Error('No properties found');
      }
      property = properties.find(p => p.buildingCount > 1) || properties[0];
    }
    
    console.log('=== INPUT PROPERTY ===');
    console.log(`Address: ${property.address}, ${property.city}, TX ${property.zip}`);
    console.log(`Buildings: ${property.buildingCount}`);
    console.log(`Total Sqft: ${property.totalGrossBldgArea?.toLocaleString()}`);
    console.log(`Owner: ${property.bizName || property.ownerName1}`);
    console.log('\nBuilding Details:');
    property.buildings?.slice(0, 5).forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.propertyName || 'Unnamed'} - ${b.bldgClassDesc} - ${b.grossBldgArea?.toLocaleString()} sqft`);
    });
    if ((property.buildings?.length || 0) > 5) {
      console.log(`  ... and ${property.buildings!.length - 5} more buildings`);
    }
    
    if (step === 'classify' || step === 'all') {
      console.log('\n=== STEP 1: CLASSIFY PROPERTY ===');
      const startTime = Date.now();
      const classification = await classifyProperty(property);
      const elapsed = Date.now() - startTime;
      console.log(`Time: ${elapsed}ms`);
      console.log(JSON.stringify(classification, null, 2));
      
      if (step === 'all') {
        console.log('\n=== STEP 2: IDENTIFY OWNERSHIP ===');
        const startOwnership = Date.now();
        const ownership = await identifyOwnership(property, classification);
        const elapsedOwnership = Date.now() - startOwnership;
        console.log(`Time: ${elapsedOwnership}ms`);
        console.log(JSON.stringify(ownership, null, 2));
        
        console.log('\n=== STEP 3: DISCOVER CONTACTS ===');
        const startContacts = Date.now();
        const contacts = await discoverContacts(property, classification, ownership);
        const elapsedContacts = Date.now() - startContacts;
        console.log(`Time: ${elapsedContacts}ms`);
        console.log(`Contacts found: ${contacts.length}`);
        console.log(JSON.stringify(contacts, null, 2));
        
        console.log('\n=== SUMMARY ===');
        console.log(`Total time: ${elapsed + elapsedOwnership + elapsedContacts}ms`);
        console.log(`Classification: ${classification.category} - ${classification.subcategory}`);
        console.log(`Property Name: ${classification.propertyName}`);
        console.log(`Beneficial Owner: ${ownership.beneficialOwner?.name || 'Unknown'}`);
        console.log(`Management Co: ${ownership.managementCompany?.name || 'Unknown'}`);
        console.log(`Contacts: ${contacts.length}`);
      }
    }
    
    if (step === 'ownership') {
      const classification = await classifyProperty(property);
      console.log('\n=== STEP 2: IDENTIFY OWNERSHIP ===');
      const startTime = Date.now();
      const ownership = await identifyOwnership(property, classification);
      const elapsed = Date.now() - startTime;
      console.log(`Time: ${elapsed}ms`);
      console.log(JSON.stringify(ownership, null, 2));
    }
    
    if (step === 'contacts') {
      const classification = await classifyProperty(property);
      const ownership = await identifyOwnership(property, classification);
      console.log('\n=== STEP 3: DISCOVER CONTACTS ===');
      const startTime = Date.now();
      const contacts = await discoverContacts(property, classification, ownership);
      const elapsed = Date.now() - startTime;
      console.log(`Time: ${elapsed}ms`);
      console.log(JSON.stringify(contacts, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
