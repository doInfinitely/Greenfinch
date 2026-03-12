import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyContacts, propertyOrganizations, propertyPipeline, territories, customerStatusFlags, type TerritoryDefinition, type TerritoryDefinitionPolygon } from '@/lib/schema';
import { eq, isNotNull, and, or, sql, inArray, gte, lte, isNull, type SQL } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';
import { auth } from '@clerk/nextjs/server';
import { buildTerritoryConditions, filterByPolygon, needsPolygonFilter } from '@/lib/territory-filter';

const SQFT_PER_ACRE = 43560;

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    const searchParams = request.nextUrl.searchParams;
    console.log('[GeoJSON] Request received, orgId:', orgId, 'params:', searchParams.toString());
    
    // Filter parameters
    const categories = searchParams.get('categories')?.split(',').filter(Boolean) || [];
    const subcategories = searchParams.get('subcategories')?.split(',').filter(Boolean) || [];
    const enrichmentStatus = searchParams.get('enrichmentStatus'); // 'researched' | 'not_researched' | null
    const customerStatuses = searchParams.get('customerStatuses')?.split(',').filter(Boolean) || [];
    const zipCodes = searchParams.get('zipCodes')?.split(',').filter(Boolean) || [];
    const counties = searchParams.get('counties')?.split(',').filter(Boolean) || [];
    const buildingClasses = searchParams.get('buildingClasses')?.split(',').filter(Boolean) || [];
    const minLotAcres = searchParams.get('minLotAcres') ? parseFloat(searchParams.get('minLotAcres')!) : null;
    const maxLotAcres = searchParams.get('maxLotAcres') ? parseFloat(searchParams.get('maxLotAcres')!) : null;
    const minNetSqft = searchParams.get('minNetSqft') ? parseFloat(searchParams.get('minNetSqft')!) : null;
    const maxNetSqft = searchParams.get('maxNetSqft') ? parseFloat(searchParams.get('maxNetSqft')!) : null;
    const organizationId = searchParams.get('organizationId');
    const contactId = searchParams.get('contactId');
    const territoryId = searchParams.get('territoryId');
    const customerFlagsParam = searchParams.get('customerFlags')?.split(',').filter(Boolean) || [];
    const includeResidential = searchParams.get('includeResidential') === 'true';

    // Viewport bounds for map-based loading
    const north = searchParams.get('north') ? parseFloat(searchParams.get('north')!) : null;
    const south = searchParams.get('south') ? parseFloat(searchParams.get('south')!) : null;
    const east = searchParams.get('east') ? parseFloat(searchParams.get('east')!) : null;
    const west = searchParams.get('west') ? parseFloat(searchParams.get('west')!) : null;

    // Optional limit - if not provided, return all matching properties
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : null;

    const conditions = [
      isNotNull(properties.lat),
      eq(properties.isActive, true),
      // Only show parent properties on the map (not constituent accounts like parking decks)
      eq(properties.isParentProperty, true),
    ];

    if (!includeResidential) {
      conditions.push(sql`(${properties.assetCategory} IS NULL OR ${properties.assetCategory} != 'Single-Family Residential')`);
    }

    // Viewport bounds filter - only return properties within the visible map area
    if (north !== null && south !== null && east !== null && west !== null) {
      conditions.push(gte(properties.lat, south));
      conditions.push(lte(properties.lat, north));
      conditions.push(gte(properties.lon, west));
      conditions.push(lte(properties.lon, east));
    }

    // Category filter (supports multiple categories including 'Unknown / Unassigned')
    if (categories.length > 0) {
      const hasUnknown = categories.includes('Unknown / Unassigned');
      const regularCategories = categories.filter(c => c !== 'Unknown / Unassigned');
      
      if (hasUnknown && regularCategories.length > 0) {
        conditions.push(or(
          inArray(properties.assetCategory, regularCategories),
          isNull(properties.assetCategory)
        )!);
      } else if (hasUnknown) {
        conditions.push(isNull(properties.assetCategory));
      } else {
        conditions.push(inArray(properties.assetCategory, regularCategories));
      }
    }
    
    // Subcategory filter
    if (subcategories.length > 0) {
      conditions.push(inArray(properties.assetSubcategory, subcategories));
    }
    
    // Enrichment status filter
    if (enrichmentStatus === 'researched') {
      conditions.push(isNotNull(properties.lastEnrichedAt));
    } else if (enrichmentStatus === 'not_researched') {
      conditions.push(isNull(properties.lastEnrichedAt));
    }
    
    // Pipeline status filter (multi-select with proper subqueries)
    if (customerStatuses.length > 0) {
      const statusConditions: SQL[] = [];
      
      if (customerStatuses.includes('prospect')) {
        statusConditions.push(sql`NOT EXISTS (
          SELECT 1 FROM ${propertyPipeline} 
          WHERE ${propertyPipeline.propertyId} = ${properties.id}
          ${orgId ? sql`AND ${propertyPipeline.clerkOrgId} = ${orgId}` : sql``}
        )`);
      }
      
      if (customerStatuses.includes('customer')) {
        statusConditions.push(sql`(
          ${properties.isCurrentCustomer} = true
          OR EXISTS (
            SELECT 1 FROM ${propertyPipeline}
            WHERE ${propertyPipeline.propertyId} = ${properties.id}
            AND ${propertyPipeline.status} = 'won'
            ${orgId ? sql`AND ${propertyPipeline.clerkOrgId} = ${orgId}` : sql``}
          )
        )`);
      }
      
      const pipelineStatuses = customerStatuses.filter(s => s !== 'prospect' && s !== 'customer');
      if (pipelineStatuses.length > 0) {
        statusConditions.push(sql`EXISTS (
          SELECT 1 FROM ${propertyPipeline}
          WHERE ${propertyPipeline.propertyId} = ${properties.id}
          AND ${propertyPipeline.status} IN (${sql.join(pipelineStatuses.map(s => sql`${s}`), sql`, `)})
          ${orgId ? sql`AND ${propertyPipeline.clerkOrgId} = ${orgId}` : sql``}
        )`);
      }
      
      if (statusConditions.length > 0) {
        conditions.push(or(...statusConditions)!);
      }
    }
    
    if (zipCodes.length > 0) {
      conditions.push(sql`LEFT(${properties.zip}, 5) IN (${sql.join(zipCodes.map(z => sql`${z}`), sql`, `)})`);
    }

    if (counties.length > 0) {
      // DCAD properties may have NULL cad_county_code (legacy data)
      if (counties.includes('DCAD')) {
        const otherCounties = counties.filter(c => c !== 'DCAD');
        if (otherCounties.length > 0) {
          conditions.push(or(
            inArray(properties.cadCountyCode, counties),
            isNull(properties.cadCountyCode),
          )!);
        } else {
          conditions.push(or(
            eq(properties.cadCountyCode, 'DCAD'),
            isNull(properties.cadCountyCode),
          )!);
        }
      } else {
        conditions.push(inArray(properties.cadCountyCode, counties));
      }
    }

    // Building class filter - handle "Unknown" for NULL property_class values
    if (buildingClasses.length > 0) {
      const hasUnknown = buildingClasses.includes('Unknown');
      const knownClasses = buildingClasses.filter(c => c !== 'Unknown');
      
      if (hasUnknown && knownClasses.length > 0) {
        // Include both specific classes AND NULL values
        conditions.push(or(
          inArray(properties.propertyClass, knownClasses),
          isNull(properties.propertyClass)
        )!);
      } else if (hasUnknown) {
        // Only Unknown selected - show NULL values only
        conditions.push(isNull(properties.propertyClass));
      } else {
        // Only specific classes selected
        conditions.push(inArray(properties.propertyClass, knownClasses));
      }
    }
    
    // Lot size filters (convert acres to sqft)
    if (minLotAcres !== null) {
      const minSqft = minLotAcres * SQFT_PER_ACRE;
      conditions.push(gte(properties.lotSqft, minSqft));
    }
    if (maxLotAcres !== null) {
      const maxSqft = maxLotAcres * SQFT_PER_ACRE;
      conditions.push(lte(properties.lotSqft, maxSqft));
    }
    
    // Building size filters
    if (minNetSqft !== null) {
      conditions.push(gte(properties.buildingSqft, minNetSqft));
    }
    if (maxNetSqft !== null) {
      conditions.push(lte(properties.buildingSqft, maxNetSqft));
    }
    
    // Organization filter - show only properties linked to the selected organization
    if (organizationId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${propertyOrganizations} 
        WHERE ${propertyOrganizations.propertyId} = ${properties.id} 
        AND ${propertyOrganizations.orgId} = ${organizationId}
      )`);
    }
    
    // Contact filter - show only properties linked to the selected contact
    if (contactId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${propertyContacts}
        WHERE ${propertyContacts.propertyId} = ${properties.id}
        AND ${propertyContacts.contactId} = ${contactId}
      )`);
    }

    // Customer flag filter
    if (customerFlagsParam.length > 0 && orgId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${customerStatusFlags}
        WHERE ${customerStatusFlags.propertyId} = ${properties.id}
        AND ${customerStatusFlags.clerkOrgId} = ${orgId}
        AND ${customerStatusFlags.flagType} IN (${sql.join(customerFlagsParam.map(f => sql`${f}`), sql`, `)})
      )`);
    }

    // Territory filter - filter properties by territory definition
    let territoryRecord: { type: string; definition: TerritoryDefinition } | null = null;
    if (territoryId && orgId) {
      const [t] = await db
        .select({ type: territories.type, definition: territories.definition })
        .from(territories)
        .where(and(
          eq(territories.id, territoryId),
          eq(territories.clerkOrgId, orgId),
          eq(territories.isActive, true)
        ))
        .limit(1);
      if (t) {
        territoryRecord = { type: t.type, definition: t.definition as TerritoryDefinition };
        const territoryConditions = buildTerritoryConditions(territoryRecord.definition, territoryRecord.type);
        conditions.push(...territoryConditions);
      }
    }

    // Build query - with or without limit
    const query = db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        regridAddress: properties.regridAddress,
        validatedAddress: properties.validatedAddress,
        city: properties.city,
        zip: properties.zip,
        lat: properties.lat,
        lon: properties.lon,
        regridOwner: properties.regridOwner,
        commonName: properties.commonName,
        dcadBizName: properties.dcadBizName,
        assetCategory: properties.assetCategory,
        assetSubcategory: properties.assetSubcategory,
        operationalStatus: properties.operationalStatus,
        lastEnrichedAt: properties.lastEnrichedAt,
        lotSqft: properties.lotSqft,
        buildingSqft: properties.buildingSqft,
        propertyClass: properties.propertyClass,
        sourceLlUuid: properties.sourceLlUuid,
        cadCountyCode: properties.cadCountyCode,
        isCurrentCustomer: sql<boolean>`coalesce("properties"."is_current_customer", false)`,
        pipelineStatus: sql<string | null>`(SELECT pp.status FROM property_pipeline pp WHERE pp.property_id = properties.id LIMIT 1)`,
        customerFlags: orgId
          ? sql<string>`COALESCE((SELECT json_agg(json_build_object('flagType', csf.flag_type, 'competitorName', csf.competitor_name)) FROM customer_status_flags csf WHERE csf.property_id = properties.id AND csf.clerk_org_id = ${orgId}), '[]')`
          : sql<string>`'[]'`,
      })
      .from(properties)
      .where(and(...conditions));

    let allProperties = limit
      ? await query.limit(limit)
      : await query;

    // Post-filter for polygon territories (bounding box was pre-filtered in SQL)
    if (territoryRecord && needsPolygonFilter(territoryRecord.type)) {
      allProperties = filterByPolygon(allProperties, territoryRecord.definition as TerritoryDefinitionPolygon);
    }

    const totalCount = allProperties.length;

    const features = allProperties
      .filter(p => p.lat && p.lon)
      .map(p => {
        const address = p.regridAddress || p.validatedAddress || 'No Address';
        const isEnriched = !!p.lastEnrichedAt;
        const displayName = normalizeCommonName(p.commonName || p.dcadBizName || '');

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [p.lon!, p.lat!],
          },
          properties: {
            id: p.id,
            propertyKey: p.propertyKey,
            address,
            city: p.city || '',
            zip: p.zip || '',
            primaryOwner: p.regridOwner || '',
            commonName: displayName,
            category: p.assetCategory || '',
            subcategory: p.assetSubcategory || '',
            propertyClass: p.propertyClass || '',
            operationalStatus: p.operationalStatus || '',
            enriched: isEnriched,
            lotSqft: p.lotSqft || 0,
            buildingSqft: p.buildingSqft || 0,
            llUuid: p.sourceLlUuid || '',
            county: p.cadCountyCode || '',
            isCurrentCustomer: p.isCurrentCustomer || false,
            pipelineStatus: p.pipelineStatus || '',
            customerFlags: typeof p.customerFlags === 'string' ? JSON.parse(p.customerFlags) : (p.customerFlags || []),
          },
        };
      });

    console.log('[GeoJSON] Returning', features.length, 'features of', totalCount, 'total');
    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      totalCount,
    });
  } catch (error) {
    console.error('[GeoJSON] Error:', error);
    return NextResponse.json({ error: 'Failed to load properties' }, { status: 500 });
  }
}
