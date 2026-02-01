import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyPipeline } from '@/lib/schema';
import { sql, ilike, or, and, eq } from 'drizzle-orm';
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
          isCurrentCustomer: properties.isCurrentCustomer,
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
    
    // Get pipeline statuses for the org if authenticated
    let pipelineMap: Record<string, string> = {};
    if (orgId && results.length > 0) {
      const propertyIds = results.map(r => r.propertyId).filter(Boolean) as string[];
      if (propertyIds.length > 0) {
        const pipelineResults = await db
          .select({
            propertyId: propertyPipeline.propertyId,
            status: propertyPipeline.status,
          })
          .from(propertyPipeline)
          .where(and(
            eq(propertyPipeline.clerkOrgId, orgId),
            sql`${propertyPipeline.propertyId} = ANY(${propertyIds})`
          ));
        
        pipelineMap = Object.fromEntries(
          pipelineResults.map(p => [p.propertyId, p.status])
        );
      }
    }
    
    // Add pipeline status to results
    const resultsWithPipeline = results.map(r => ({
      ...r,
      pipelineStatus: r.propertyId ? pipelineMap[r.propertyId] || null : null,
    }));
    
    const total = countResult[0]?.count ?? results.length;
    const hasMore = resultsWithPipeline.length > limit;
    const properties_slice = resultsWithPipeline.slice(0, limit);
    
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
