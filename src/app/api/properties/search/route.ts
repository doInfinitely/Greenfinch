import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyPipeline, propertyContacts, propertyOrganizations, organizations } from '@/lib/schema';
import { sql, ilike, or, and, eq, inArray, isNotNull, isNull, gte, lte, type SQL } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;
const SQFT_PER_ACRE = 43560;

function validateLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function validatePage(value: string | null): number {
  if (!value) return 1;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return 1;
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('q') || searchParams.get('search'))?.trim();
    const limit = validateLimit(searchParams.get('limit'));
    const page = validatePage(searchParams.get('page'));
    const offset = (page - 1) * limit;
    
    // Filter parameters (matching geojson API)
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
    
    const conditions: ReturnType<typeof eq>[] = [
      eq(properties.isActive, true),
      eq(properties.isParentProperty, true), // Only show parent properties (exclude constituent accounts)
      sql`(${properties.assetCategory} IS NULL OR ${properties.assetCategory} != 'Single-Family Residential')`,
    ];
    
    // Text search
    if (search && search.length > 0) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(properties.commonName, searchPattern),
          ilike(properties.regridAddress, searchPattern),
          ilike(properties.validatedAddress, searchPattern),
          ilike(properties.regridOwner, searchPattern),
          ilike(properties.beneficialOwner, searchPattern),
          ilike(properties.city, searchPattern),
          ilike(properties.zip, searchPattern)
        )!
      );
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
    
    // Pipeline status filter (multi-select)
    if (customerStatuses.length > 0) {
      const statusConditions: SQL[] = [];
      
      if (customerStatuses.includes('prospect')) {
        statusConditions.push(sql`NOT EXISTS (
          SELECT 1 FROM ${propertyPipeline} 
          WHERE ${propertyPipeline.propertyId} = ${properties.id} 
          AND ${propertyPipeline.clerkOrgId} = ${orgId}
        )`);
      }
      
      if (customerStatuses.includes('customer')) {
        statusConditions.push(sql`(
          ${properties.isCurrentCustomer} = true
          OR EXISTS (
            SELECT 1 FROM ${propertyPipeline}
            WHERE ${propertyPipeline.propertyId} = ${properties.id}
            AND ${propertyPipeline.status} = 'won'
            AND ${propertyPipeline.clerkOrgId} = ${orgId}
          )
        )`);
      }
      
      const pipelineStatuses = customerStatuses.filter(s => s !== 'prospect' && s !== 'customer');
      if (pipelineStatuses.length > 0) {
        statusConditions.push(sql`EXISTS (
          SELECT 1 FROM ${propertyPipeline} 
          WHERE ${propertyPipeline.propertyId} = ${properties.id} 
          AND ${propertyPipeline.clerkOrgId} = ${orgId}
          AND ${propertyPipeline.status} IN (${sql.join(pipelineStatuses.map(s => sql`${s}`), sql`, `)})
        )`);
      }
      
      if (statusConditions.length > 0) {
        conditions.push(or(...statusConditions)!);
      }
    }
    
    if (zipCodes.length > 0) {
      conditions.push(sql`LEFT(${properties.zip}, 5) IN (${sql.join(zipCodes.map(z => sql`${z}`), sql`, `)})`);
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
    
    const whereClause = and(...conditions);
    
    // Run count and data queries in parallel
    const [countResult, results] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(whereClause),
      db
        .select({
          propertyKey: properties.propertyKey,
          propertyId: properties.id,
          address: sql<string>`COALESCE(${properties.validatedAddress}, ${properties.regridAddress}, 'Unknown Address')`,
          city: properties.city,
          zip: properties.zip,
          commonName: properties.commonName,
          category: properties.assetCategory,
          subcategory: properties.assetSubcategory,
          enrichmentStatus: properties.enrichmentStatus,
          enriched: sql<boolean>`${properties.enrichmentStatus} = 'completed' OR ${properties.lastEnrichedAt} IS NOT NULL`,
          primaryOwner: sql<string>`COALESCE(${properties.beneficialOwner}, ${properties.regridOwner})`,
          lotSqft: properties.lotSqft,
          buildingSqft: properties.buildingSqft,
        })
        .from(properties)
        .where(whereClause)
        .orderBy(
          sql`CASE WHEN ${properties.commonName} IS NOT NULL THEN 0 ELSE 1 END`,
          properties.commonName,
          properties.regridAddress
        )
        .limit(limit)
        .offset(offset)
    ]);
    
    // Get property IDs for batch queries
    const propertyIds = results.map(r => r.propertyId).filter(Boolean) as string[];
    
    // Get pipeline statuses and customer status for the org if authenticated
    let pipelineMap: Record<string, { status: string; isCurrentCustomer: boolean }> = {};
    if (orgId && propertyIds.length > 0) {
      const pipelineResults = await db
        .select({
          propertyId: propertyPipeline.propertyId,
          status: propertyPipeline.status,
          isCurrentCustomer: propertyPipeline.isCurrentCustomer,
        })
        .from(propertyPipeline)
        .where(and(
          eq(propertyPipeline.clerkOrgId, orgId),
          inArray(propertyPipeline.propertyId, propertyIds)
        ));
      
      pipelineMap = Object.fromEntries(
        pipelineResults.map(p => [p.propertyId, { 
          status: p.status, 
          isCurrentCustomer: p.isCurrentCustomer ?? false 
        }])
      );
    }
    
    // Get contact counts and organizations for properties
    
    let contactCountMap: Record<string, number> = {};
    let organizationsMap: Record<string, Array<{ id: string; name: string }>> = {};
    
    if (propertyIds.length > 0) {
      // Get contact counts
      const contactCounts = await db
        .select({
          propertyId: propertyContacts.propertyId,
          count: sql<number>`count(*)::int`,
        })
        .from(propertyContacts)
        .where(inArray(propertyContacts.propertyId, propertyIds))
        .groupBy(propertyContacts.propertyId);
      
      contactCountMap = Object.fromEntries(
        contactCounts.map(c => [c.propertyId, c.count])
      );
      
      // Get organizations
      const orgResults = await db
        .select({
          propertyId: propertyOrganizations.propertyId,
          orgId: organizations.id,
          orgName: organizations.name,
        })
        .from(propertyOrganizations)
        .innerJoin(organizations, eq(propertyOrganizations.orgId, organizations.id))
        .where(inArray(propertyOrganizations.propertyId, propertyIds));
      
      for (const org of orgResults) {
        if (!org.propertyId) continue;
        if (!organizationsMap[org.propertyId]) {
          organizationsMap[org.propertyId] = [];
        }
        if (org.orgId && org.orgName) {
          organizationsMap[org.propertyId].push({ id: org.orgId, name: org.orgName });
        }
      }
    }
    
    // Add pipeline status, customer status, contact count, and organizations to results
    const resultsWithExtras = results.map(r => {
      const pipelineData = r.propertyId ? pipelineMap[r.propertyId] : null;
      return {
        ...r,
        pipelineStatus: pipelineData?.status || null,
        isCurrentCustomer: pipelineData?.isCurrentCustomer ?? false,
        contactCount: r.propertyId ? (contactCountMap[r.propertyId] || 0) : 0,
        organizations: r.propertyId ? (organizationsMap[r.propertyId] || []) : [],
      };
    });
    
    const total = countResult[0]?.count ?? results.length;
    const totalPages = Math.ceil(total / limit);
    
    return NextResponse.json({
      properties: resultsWithExtras,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Properties search error:', error);
    return NextResponse.json(
      { error: 'Failed to search properties' },
      { status: 500 }
    );
  }
}
