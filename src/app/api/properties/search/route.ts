import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { sql, ilike, or, and, eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('q') || searchParams.get('search'))?.trim();
    
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
        .limit(5000)
    ]);
    
    const total = countResult[0]?.count ?? results.length;
    
    return NextResponse.json({
      properties: results,
      total,
    });
  } catch (error) {
    console.error('Properties search error:', error);
    return NextResponse.json(
      { error: 'Failed to search properties' },
      { status: 500 }
    );
  }
}
