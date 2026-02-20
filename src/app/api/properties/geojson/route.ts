import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyContacts, propertyOrganizations, propertyPipeline } from '@/lib/schema';
import { eq, isNotNull, and, or, sql, inArray, gte, lte, isNull } from 'drizzle-orm';
import { normalizeCommonName } from '@/lib/normalization';

const SQFT_PER_ACRE = 43560;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Filter parameters
    const categories = searchParams.get('categories')?.split(',').filter(Boolean) || [];
    const subcategories = searchParams.get('subcategories')?.split(',').filter(Boolean) || [];
    const enrichmentStatus = searchParams.get('enrichmentStatus'); // 'researched' | 'not_researched' | null
    const customerStatuses = searchParams.get('customerStatuses')?.split(',').filter(Boolean) || [];
    const zipCodes = searchParams.get('zipCodes')?.split(',').filter(Boolean) || [];
    const buildingClasses = searchParams.get('buildingClasses')?.split(',').filter(Boolean) || [];
    const minLotAcres = searchParams.get('minLotAcres') ? parseFloat(searchParams.get('minLotAcres')!) : null;
    const maxLotAcres = searchParams.get('maxLotAcres') ? parseFloat(searchParams.get('maxLotAcres')!) : null;
    const minNetSqft = searchParams.get('minNetSqft') ? parseFloat(searchParams.get('minNetSqft')!) : null;
    const maxNetSqft = searchParams.get('maxNetSqft') ? parseFloat(searchParams.get('maxNetSqft')!) : null;
    const organizationId = searchParams.get('organizationId');
    const contactId = searchParams.get('contactId');
    
    // Optional limit - if not provided, return all matching properties
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : null;

    const conditions = [
      isNotNull(properties.lat),
      eq(properties.isActive, true),
      // Only show parent properties on the map (not constituent accounts like parking decks)
      eq(properties.isParentProperty, true),
    ];

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
    
    // Pipeline status filter (multi-select, simplified for GeoJSON performance)
    if (customerStatuses.length > 0) {
      // For GeoJSON we use the isCurrentCustomer flag for basic filtering
      if (customerStatuses.includes('won') && !customerStatuses.includes('prospect')) {
        conditions.push(eq(properties.isCurrentCustomer, true));
      } else if (customerStatuses.includes('prospect') && !customerStatuses.includes('won')) {
        conditions.push(or(
          eq(properties.isCurrentCustomer, false),
          isNull(properties.isCurrentCustomer)
        )!);
      }
      // If both or other statuses are included, we don't filter (show all)
    }
    
    // Zip codes filter (supports multiple)
    if (zipCodes.length > 0) {
      conditions.push(inArray(properties.zip, zipCodes));
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

    // Build query - with or without limit
    const query = db
      .select({
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
        isCurrentCustomer: sql<boolean>`coalesce("properties"."is_current_customer", false)`,
        pipelineStatus: sql<string | null>`(SELECT pp.status FROM property_pipeline pp WHERE pp.property_id = properties.id LIMIT 1)`,
      })
      .from(properties)
      .where(and(...conditions));

    const allProperties = limit 
      ? await query.limit(limit)
      : await query;

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
            isCurrentCustomer: p.isCurrentCustomer || false,
            pipelineStatus: p.pipelineStatus || '',
          },
        };
      });

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      totalCount,
    });
  } catch (error) {
    console.error('GeoJSON error:', error);
    return NextResponse.json({ error: 'Failed to load properties' }, { status: 500 });
  }
}
