import { classifyProperty, identifyOwnership, discoverContacts, type PropertyClassification } from '../src/lib/focused-enrichment';
import type { CommercialProperty, DCADBuilding } from '../src/lib/property-types';

const mockBuildings: DCADBuilding[] = [
  {
    taxObjId: '005453000K01A0001',
    propertyName: 'NORTHPARK MALL',
    bldgClassDesc: 'REGIONAL MALL',
    yearBuilt: 1965,
    remodelYear: 2004,
    grossBldgArea: 2100000,
    numStories: 2,
    numUnits: 235,
    netLeaseArea: 1800000,
    constructionType: 'B-REINFORCED CONCRETE FRAME',
    foundationType: 'CONCRETE SLAB',
    heatingType: 'CENTRAL HVAC',
    acType: 'CENTRAL AC',
    qualityGrade: 'EXCELLENT',
    conditionGrade: 'GOOD'
  },
  {
    taxObjId: '005453000K01A0002',
    propertyName: 'NORTHPARK MALL',
    bldgClassDesc: 'PARKING GARAGE',
    yearBuilt: 1973,
    remodelYear: null,
    grossBldgArea: 364416,
    numStories: 4,
    numUnits: null,
    netLeaseArea: null,
    constructionType: 'B-REINFORCED CONCRETE FRAME',
    foundationType: 'CONCRETE',
    heatingType: null,
    acType: null,
    qualityGrade: 'GOOD',
    conditionGrade: 'GOOD'
  },
  {
    taxObjId: '005453000K01A0003',
    propertyName: 'NORTHPARK MALL',
    bldgClassDesc: 'PARKING GARAGE',
    yearBuilt: 1973,
    remodelYear: null,
    grossBldgArea: 191898,
    numStories: 4,
    numUnits: null,
    netLeaseArea: null,
    constructionType: 'B-REINFORCED CONCRETE FRAME',
    foundationType: 'CONCRETE',
    heatingType: null,
    acType: null,
    qualityGrade: 'GOOD',
    conditionGrade: 'GOOD'
  },
  {
    taxObjId: '005453000K01A0004',
    propertyName: 'NORTHPARK MALL',
    bldgClassDesc: 'RESTAURANT',
    yearBuilt: 1965,
    remodelYear: 2010,
    grossBldgArea: 39197,
    numStories: 1,
    numUnits: 12,
    netLeaseArea: 35000,
    constructionType: 'C-MASONRY, BLOCK, TILT-WALL',
    foundationType: 'CONCRETE SLAB',
    heatingType: 'CENTRAL HVAC',
    acType: 'CENTRAL AC',
    qualityGrade: 'EXCELLENT',
    conditionGrade: 'GOOD'
  }
];

const mockProperty: CommercialProperty = {
  parcelId: '005453000K01A0000',
  address: '8687 N CENTRAL EXPY',
  city: 'DALLAS',
  zip: '75225',
  lat: 32.8681,
  lon: -96.7724,
  usedesc: 'REGIONAL MALL',
  usecode: 'C1',
  regridYearBuilt: 1965,
  regridNumStories: 2,
  regridImprovVal: 350000000,
  regridLandVal: 50000000,
  regridTotalVal: 400000000,
  lotAcres: 100.5,
  lotSqft: 4377780,
  bldgFootprintSqft: 900000,
  
  accountNum: '00545300000K01A0000',
  divisionCd: 'COM',
  dcadImprovVal: 380000000,
  dcadLandVal: 55000000,
  dcadTotalVal: 435000000,
  cityJurisDesc: 'DALLAS',
  isdJurisDesc: 'HIGHLAND PARK ISD',
  
  bizName: 'NP HOLDING LLC',
  ownerName1: 'NORTHPARK PARTNERS LP',
  ownerName2: 'C/O NASHER COMPANY',
  ownerAddressLine1: '8687 N CENTRAL EXPY STE 2100',
  ownerCity: 'DALLAS',
  ownerState: 'TX',
  ownerZipcode: '75225',
  ownerPhone: '2143631000',
  deedTxfrDate: '2018-05-15',
  
  dcadZoning: 'PD',
  frontDim: 1200,
  depthDim: 2400,
  landArea: 100.5,
  landAreaUom: 'AC',
  landCostPerUom: 500000,
  
  buildingCount: 14,
  oldestYearBuilt: 1965,
  newestYearBuilt: 2004,
  totalGrossBldgArea: 4157377,
  totalUnits: 247,
  
  buildings: mockBuildings
};

async function main() {
  console.log('=== TESTING FOCUSED ENRICHMENT WITH MOCK DATA ===\n');
  console.log('Property: NorthPark Mall, Dallas TX');
  console.log(`Buildings: ${mockProperty.buildingCount}`);
  console.log(`Total Sqft: ${mockProperty.totalGrossBldgArea?.toLocaleString()}\n`);
  
  try {
    console.log('=== STEP 1: CLASSIFY PROPERTY ===');
    const startClassify = Date.now();
    const classification = await classifyProperty(mockProperty);
    const classifyTime = Date.now() - startClassify;
    console.log(`Time: ${classifyTime}ms`);
    console.log(JSON.stringify(classification, null, 2));
    
    console.log('\n=== STEP 2: IDENTIFY OWNERSHIP ===');
    const startOwnership = Date.now();
    const ownership = await identifyOwnership(mockProperty, classification);
    const ownershipTime = Date.now() - startOwnership;
    console.log(`Time: ${ownershipTime}ms`);
    console.log(JSON.stringify(ownership, null, 2));
    
    console.log('\n=== STEP 3: DISCOVER CONTACTS ===');
    const startContacts = Date.now();
    const contacts = await discoverContacts(mockProperty, classification, ownership);
    const contactsTime = Date.now() - startContacts;
    console.log(`Time: ${contactsTime}ms`);
    console.log(`Contacts found: ${contacts.length}`);
    console.log(JSON.stringify(contacts, null, 2));
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total time: ${classifyTime + ownershipTime + contactsTime}ms`);
    console.log(`Property Name: ${classification.propertyName}`);
    console.log(`Category: ${classification.category} - ${classification.subcategory}`);
    console.log(`Confidence: ${classification.confidence}`);
    console.log(`Rationale: ${classification.rationale}`);
    console.log(`\nBeneficial Owner: ${ownership.beneficialOwner?.name || 'Unknown'} (${ownership.beneficialOwner?.type || 'Unknown type'})`);
    console.log(`Owner Confidence: ${ownership.beneficialOwner?.confidence}`);
    console.log(`Management Co: ${ownership.managementCompany?.name || 'Unknown'}`);
    console.log(`Mgmt Confidence: ${ownership.managementCompany?.confidence}`);
    console.log(`\nContacts: ${contacts.length}`);
    contacts.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name} - ${c.title} @ ${c.company}`);
      if (c.email) console.log(`     Email: ${c.email}`);
      if (c.linkedinUrl) console.log(`     LinkedIn: ${c.linkedinUrl}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
