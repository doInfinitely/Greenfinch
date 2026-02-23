import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, contacts, organizations, propertyContacts, propertyOrganizations } from '@/lib/schema';
import { eq, or } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DCAD_KEY_REGEX = /^[0-9A-Z]{17,20}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json(
        { error: 'Invalid property ID format' },
        { status: 400 }
      );
    }

    // Find property - only compare against UUID column if input is a valid UUID
    const isUuid = UUID_REGEX.test(id);
    const [dbProperty] = await db
      .select()
      .from(properties)
      .where(isUuid ? or(eq(properties.id, id), eq(properties.propertyKey, id)) : eq(properties.propertyKey, id))
      .limit(1);

    if (!dbProperty) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // Get associated contacts
    const propertyContactRows = await db
      .select({
        contact: contacts,
        role: propertyContacts.role,
        relationshipStatus: propertyContacts.relationshipStatus,
        relationshipStatusReason: propertyContacts.relationshipStatusReason,
      })
      .from(propertyContacts)
      .innerJoin(contacts, eq(contacts.id, propertyContacts.contactId))
      .where(eq(propertyContacts.propertyId, dbProperty.id));
    
    console.log(`[PropertyAPI] Property ${dbProperty.id} (${dbProperty.commonName || 'unnamed'}) has ${propertyContactRows.length} raw contact rows`);
    
    const uniqueContacts = new Map<string, { contact: typeof contacts.$inferSelect; role: string | null; relationshipStatus: string | null; relationshipStatusReason: string | null }>();
    for (const row of propertyContactRows) {
      const contactId = row.contact.id;
      if (!uniqueContacts.has(contactId)) {
        uniqueContacts.set(contactId, { contact: row.contact, role: row.role, relationshipStatus: row.relationshipStatus, relationshipStatusReason: row.relationshipStatusReason });
      }
    }
    const dedupedContactRows = Array.from(uniqueContacts.values());
    console.log(`[PropertyAPI] After deduplication: ${dedupedContactRows.length} unique contacts`);

    // Get associated organizations
    const propertyOrgRows = await db
      .select({
        organization: organizations,
        role: propertyOrganizations.role,
      })
      .from(propertyOrganizations)
      .innerJoin(organizations, eq(organizations.id, propertyOrganizations.orgId))
      .where(eq(propertyOrganizations.propertyId, dbProperty.id));

    // Build address with fallback to raw parcel data
    const rawParcels = dbProperty.rawParcelsJson as any[];
    const firstParcel = rawParcels?.[0];
    let address = dbProperty.regridAddress || dbProperty.validatedAddress || '';
    if (!address && firstParcel) {
      const parts = [firstParcel.address, firstParcel.sunit].filter(Boolean);
      address = parts.join(' ');
    }

    const lotSqft = Number(dbProperty.lotSqft) || 0;
    const lotAcres = lotSqft > 0 ? lotSqft / 43560 : 0;

    return NextResponse.json({
      property: {
        id: dbProperty.id,
        propertyKey: dbProperty.propertyKey,
        sourceLlUuid: dbProperty.sourceLlUuid,
        address,
        validatedAddress: dbProperty.validatedAddress,
        city: dbProperty.city,
        state: dbProperty.state,
        zip: dbProperty.zip,
        county: dbProperty.county,
        lat: dbProperty.lat,
        lon: dbProperty.lon,
        lotSqft: dbProperty.lotSqft,
        lotAcres,
        buildingSqft: dbProperty.buildingSqft,
        yearBuilt: dbProperty.yearBuilt,
        numFloors: dbProperty.numFloors,
        assetCategory: dbProperty.assetCategory,
        assetSubcategory: dbProperty.assetSubcategory,
        categoryConfidence: dbProperty.categoryConfidence,
        propertyClass: dbProperty.propertyClass,
        commonName: dbProperty.commonName,
        commonNameConfidence: dbProperty.commonNameConfidence,
        regridOwner: dbProperty.regridOwner,
        dcadOwnerName1: dbProperty.dcadOwnerName1,
        dcadBizName: dbProperty.dcadBizName,
        beneficialOwner: dbProperty.beneficialOwner,
        beneficialOwnerConfidence: dbProperty.beneficialOwnerConfidence,
        beneficialOwnerType: dbProperty.beneficialOwnerType,
        managementType: dbProperty.managementType,
        managementCompany: dbProperty.managementCompany,
        managementCompanyDomain: dbProperty.managementCompanyDomain,
        managementConfidence: dbProperty.managementConfidence,
        propertyWebsite: dbProperty.propertyWebsite,
        propertyPhone: dbProperty.propertyPhone,
        propertyManagerWebsite: dbProperty.propertyManagerWebsite,
        aiRationale: dbProperty.aiRationale,
        enrichmentSources: dbProperty.enrichmentSources,
        searchSuggestionHtml: (dbProperty.enrichmentJson as any)?.searchSuggestionHtml || null,
        enrichmentStatus: dbProperty.enrichmentStatus,
        lastEnrichedAt: dbProperty.lastEnrichedAt,
        rawParcels: dbProperty.rawParcelsJson,
        calculatedBuildingClass: dbProperty.calculatedBuildingClass,
        buildingClassRationale: dbProperty.buildingClassRationale,
        totalParval: dbProperty.dcadTotalVal,
        totalImprovval: dbProperty.dcadImprovVal,
        landval: dbProperty.dcadLandVal,
        isParentProperty: dbProperty.isParentProperty,
        parentPropertyKey: dbProperty.parentPropertyKey,
        constituentAccountNums: dbProperty.constituentAccountNums,
        constituentCount: dbProperty.constituentCount,
        gisParcelId: dbProperty.dcadGisParcelId,
        parcelCount: Array.isArray(dbProperty.rawParcelsJson) ? (dbProperty.rawParcelsJson as any[]).length : 1,
        usedesc: (() => {
          const parcels = Array.isArray(dbProperty.rawParcelsJson) ? (dbProperty.rawParcelsJson as any[]) : [];
          return [...new Set(parcels.map(p => p.usedesc).filter(Boolean))] as string[];
        })(),
        usecode: (() => {
          const parcels = Array.isArray(dbProperty.rawParcelsJson) ? (dbProperty.rawParcelsJson as any[]) : [];
          return [...new Set(parcels.map(p => p.usecode).filter(Boolean))] as string[];
        })(),
      },
      contacts: dedupedContactRows.map(row => ({
        ...row.contact,
        role: row.role,
        relationshipStatus: row.relationshipStatus || 'active',
        relationshipStatusReason: row.relationshipStatusReason || null,
      })),
      organizations: (() => {
        // Aggregate organizations with multiple roles into a single entry with roles array
        const orgMap = new Map<string, { organization: typeof propertyOrgRows[0]['organization']; roles: string[] }>();
        for (const row of propertyOrgRows) {
          const orgId = row.organization.id;
          if (!orgMap.has(orgId)) {
            orgMap.set(orgId, { organization: row.organization, roles: [] });
          }
          if (row.role) {
            const entry = orgMap.get(orgId)!;
            if (!entry.roles.includes(row.role)) {
              entry.roles.push(row.role);
            }
          }
        }
        return Array.from(orgMap.values()).map(({ organization, roles }) => ({
          ...organization,
          roles, // Array of roles (e.g., ['owner', 'property_manager'])
          role: roles[0] || null, // Keep for backward compatibility
        }));
      })(),
      source: 'postgres',
    });
  } catch (error) {
    console.error('Property detail API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch property' },
      { status: 500 }
    );
  }
}
