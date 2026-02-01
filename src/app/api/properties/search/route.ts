import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyPipeline, propertyContacts, propertyOrganizations, organizations } from '@/lib/schema';
import { sql, ilike, or, and, eq, inArray } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

function validateLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('q') || searchParams.get('search'))?.trim();
    const limit = validateLimit(searchParams.get('limit'));
    
    let whereClause = and(
      eq(properties.isActive, true),
      sql`(${properties.assetCategory} IS NULL OR ${properties.assetCategory} != 'Single-Family Residential')`
    );
    
    if (search && search.length > 0) {
      const searchPattern = `%${search}%`;
      whereClause = and(
        whereClause,
        or(
          ilike(properties.commonName, searchPattern),
          ilike(properties.regridAddress, searchPattern),
          ilike(properties.validatedAddress, searchPattern),
          ilike(properties.regridOwner, searchPattern),
          ilike(properties.beneficialOwner, searchPattern),
          ilike(properties.city, searchPattern),
          ilike(properties.zip, searchPattern)
        )
      );
    }
    
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
        .limit(limit + 1)
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
    const hasMore = resultsWithExtras.length > limit;
    const properties_slice = resultsWithExtras.slice(0, limit);
    
    return NextResponse.json({
      properties: properties_slice,
      total,
      hasMore,
      limit,
    });
  } catch (error) {
    console.error('Properties search error:', error);
    return NextResponse.json(
      { error: 'Failed to search properties' },
      { status: 500 }
    );
  }
}
