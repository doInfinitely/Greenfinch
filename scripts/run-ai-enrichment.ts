import { db } from '../src/lib/db';
import { properties, contacts, organizations, propertyOrganizations, propertyContacts } from '../src/lib/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { runFocusedEnrichment, FocusedEnrichmentResult } from '../src/lib/ai-enrichment';
import type { CommercialProperty, DCADBuilding } from '../src/lib/snowflake';

async function getPropertiesToEnrich(limit: number = 10) {
  return db
    .select()
    .from(properties)
    .where(
      or(
        eq(properties.enrichmentStatus, 'pending'),
        isNull(properties.enrichmentStatus)
      )
    )
    .orderBy(sql`${properties.dcadTotalVal} DESC NULLS LAST`)
    .limit(limit);
}

function dbPropertyToCommercialProperty(dbProp: any): CommercialProperty {
  const buildings: DCADBuilding[] = Array.isArray(dbProp.dcadBuildings) 
    ? dbProp.dcadBuildings 
    : [];
  
  return {
    parcelId: dbProp.propertyKey,
    gisParcelId: dbProp.dcadGisParcelId || null,
    sptdCode: dbProp.dcadSptdCode || null,
    address: dbProp.regridAddress || '',
    city: dbProp.city || '',
    zip: dbProp.zip || '',
    lat: dbProp.lat || 0,
    lon: dbProp.lon || 0,
    usedesc: '',
    usecode: '',
    regridYearBuilt: dbProp.yearBuilt,
    regridNumStories: dbProp.numFloors,
    regridImprovVal: null,
    regridLandVal: null,
    regridTotalVal: null,
    lotAcres: null,
    lotSqft: dbProp.lotSqft,
    bldgFootprintSqft: null,
    accountNum: dbProp.dcadAccountNum || '',
    divisionCd: dbProp.dcadDivisionCd || 'COM',
    dcadImprovVal: dbProp.dcadImprovVal,
    dcadLandVal: dbProp.dcadLandVal,
    dcadTotalVal: dbProp.dcadTotalVal,
    cityJurisDesc: dbProp.dcadCityJuris,
    isdJurisDesc: dbProp.dcadIsdJuris,
    bizName: dbProp.dcadBizName,
    ownerName1: dbProp.dcadOwnerName1,
    ownerName2: dbProp.dcadOwnerName2,
    ownerAddressLine1: dbProp.dcadOwnerAddress,
    ownerCity: dbProp.dcadOwnerCity,
    ownerState: dbProp.dcadOwnerState,
    ownerZipcode: dbProp.dcadOwnerZip,
    ownerPhone: dbProp.dcadOwnerPhone,
    deedTxfrDate: dbProp.dcadDeedTransferDate,
    dcadZoning: dbProp.dcadZoning,
    frontDim: dbProp.dcadLandFrontDim,
    depthDim: dbProp.dcadLandDepthDim,
    landArea: dbProp.dcadLandArea,
    landAreaUom: dbProp.dcadLandAreaUom,
    landCostPerUom: null,
    buildingCount: dbProp.dcadBuildingCount || 1,
    oldestYearBuilt: dbProp.dcadOldestYearBuilt,
    newestYearBuilt: dbProp.dcadNewestYearBuilt,
    totalGrossBldgArea: dbProp.dcadTotalGrossBldgArea,
    totalUnits: dbProp.dcadTotalUnits,
    legal1: dbProp.dcadLegal1 || null,
    legal2: dbProp.dcadLegal2 || null,
    legal3: dbProp.dcadLegal3 || null,
    legal4: dbProp.dcadLegal4 || null,
    buildings,
  };
}

async function saveEnrichmentResults(
  propertyId: string,
  propertyKey: string,
  result: FocusedEnrichmentResult
) {
  // Access .data from the StageResult wrapper types
  const classificationData = result.classification.data;
  const ownershipData = result.ownership.data;
  const contactsData = result.contacts.data;

  await db
    .update(properties)
    .set({
      commonName: classificationData.propertyName || null,
      assetCategory: classificationData.category,
      assetSubcategory: classificationData.subcategory,
      categoryConfidence: classificationData.confidence,
      categoryRationale: result.classification.summary,
      managementCompany: ownershipData.managementCompany?.name || null,
      managementCompanyDomain: ownershipData.managementCompany?.domain || null,
      managementConfidence: ownershipData.managementCompany?.confidence || null,
      beneficialOwner: ownershipData.beneficialOwner?.name || null,
      beneficialOwnerConfidence: ownershipData.beneficialOwner?.confidence || null,
      beneficialOwnerType: ownershipData.beneficialOwner?.type || null,
      enrichmentStatus: 'enriched',
      lastEnrichedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(properties.id, propertyId));

  if (ownershipData.managementCompany?.name) {
    const existingOrg = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, ownershipData.managementCompany.name))
      .limit(1);

    let orgId: string;
    if (existingOrg.length > 0) {
      orgId = existingOrg[0].id;
    } else {
      const [newOrg] = await db
        .insert(organizations)
        .values({
          name: ownershipData.managementCompany.name,
          domain: ownershipData.managementCompany.domain,
          orgType: 'Management Company',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: organizations.id });
      orgId = newOrg.id;
    }

    const existingLink = await db
      .select()
      .from(propertyOrganizations)
      .where(
        and(
          eq(propertyOrganizations.propertyId, propertyId),
          eq(propertyOrganizations.orgId, orgId)
        )
      )
      .limit(1);

    if (existingLink.length === 0) {
      await db.insert(propertyOrganizations).values({
        propertyId,
        orgId,
        role: 'Property Manager',
      });
    }
  }

  for (const contact of contactsData.contacts) {
    if (!contact.name) continue;

    const existingContact = await db
      .select()
      .from(contacts)
      .where(eq(contacts.fullName, contact.name))
      .limit(1);

    let contactId: string;
    if (existingContact.length > 0) {
      contactId = existingContact[0].id;
    } else {
      const [newContact] = await db
        .insert(contacts)
        .values({
          fullName: contact.name,
          normalizedName: contact.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
          title: contact.title,
          employerName: contact.company,
          email: contact.email,
          emailStatus: contact.email ? 'unverified' : null,
          phone: contact.phone,
          phoneLabel: contact.phoneLabel,
          contactType: contact.contactType,
          linkedinUrl: null, // Will be discovered later
          linkedinStatus: 'pending',
          source: 'ai_enrichment',
          nameConfidence: contact.roleConfidence,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: contacts.id });
      contactId = newContact.id;
    }

    const existingPropContact = await db
      .select()
      .from(propertyContacts)
      .where(
        and(
          eq(propertyContacts.propertyId, propertyId),
          eq(propertyContacts.contactId, contactId)
        )
      )
      .limit(1);

    if (existingPropContact.length === 0) {
      const roleMap: Record<string, string> = {
        property_manager: 'Property Manager',
        facilities_manager: 'Facilities Manager',
        owner: 'Owner',
        leasing: 'Leasing',
        other: 'Other',
      };
      const relType = roleMap[contact.role] || 'Other';

      await db.insert(propertyContacts).values({
        propertyId,
        contactId,
        role: relType,
        confidenceScore: contact.roleConfidence,
        discoveredAt: new Date(),
      });
    }
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '10', 10);
  
  console.log('=== AI ENRICHMENT RUN ===');
  console.log(`Processing up to ${limit} properties\n`);
  
  const propsToEnrich = await getPropertiesToEnrich(limit);
  console.log(`Found ${propsToEnrich.length} properties to enrich\n`);
  
  let success = 0;
  let errors = 0;
  
  for (let i = 0; i < propsToEnrich.length; i++) {
    const dbProp = propsToEnrich[i];
    const propName = dbProp.commonName || dbProp.dcadBizName || dbProp.regridAddress || 'Unknown';
    
    console.log(`[${i + 1}/${propsToEnrich.length}] ${propName}`);
    
    try {
      const commercialProp = dbPropertyToCommercialProperty(dbProp);
      const result = await runFocusedEnrichment(commercialProp);
      
      await saveEnrichmentResults(dbProp.id, dbProp.propertyKey, result);
      
      console.log(`  Category: ${result.classification.data.category} - ${result.classification.data.subcategory}`);
      console.log(`  Mgmt Co: ${result.ownership.data.managementCompany?.name || 'Not found'}`);
      console.log(`  Contacts: ${result.contacts.data.contacts.length}`);
      console.log(`  Time: ${result.timing.totalMs}ms\n`);
      
      success++;
      
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (error) {
      errors++;
      console.error(`  ERROR: ${error instanceof Error ? error.message : error}\n`);
      
      await db
        .update(properties)
        .set({
          enrichmentStatus: 'error',
          updatedAt: new Date(),
        })
        .where(eq(properties.id, dbProp.id));
    }
  }
  
  console.log('=== ENRICHMENT COMPLETE ===');
  console.log(`Success: ${success}`);
  console.log(`Errors: ${errors}`);
  
  const contactCount = await db.select({ count: sql<number>`count(*)` }).from(contacts);
  const orgCount = await db.select({ count: sql<number>`count(*)` }).from(organizations);
  
  console.log(`\nDatabase now has:`);
  console.log(`  Contacts: ${contactCount[0].count}`);
  console.log(`  Organizations: ${orgCount[0].count}`);
}

main().catch(console.error);
