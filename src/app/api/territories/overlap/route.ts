import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { territories, type TerritoryDefinition, type TerritoryDefinitionZipCodes, type TerritoryDefinitionCounties } from '@/lib/schema';
import { eq, and, ne } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, definition, excludeTerritoryId } = body;

    if (!type || !definition) {
      return NextResponse.json({ error: 'type and definition are required' }, { status: 400 });
    }

    // Fetch all active territories of the same type in the org
    const conditions = [
      eq(territories.clerkOrgId, orgId),
      eq(territories.isActive, true),
      eq(territories.type, type),
    ];
    if (excludeTerritoryId) {
      conditions.push(ne(territories.id, excludeTerritoryId));
    }

    const existingTerritories = await db
      .select({
        id: territories.id,
        name: territories.name,
        definition: territories.definition,
      })
      .from(territories)
      .where(and(...conditions));

    const overlaps: Array<{ territoryId: string; territoryName: string; overlappingValues: string[] }> = [];

    if (type === 'zip_codes') {
      const newZips = new Set((definition as TerritoryDefinitionZipCodes).zipCodes);
      for (const existing of existingTerritories) {
        const existingDef = existing.definition as TerritoryDefinitionZipCodes;
        const common = existingDef.zipCodes?.filter((z: string) => newZips.has(z)) || [];
        if (common.length > 0) {
          overlaps.push({
            territoryId: existing.id,
            territoryName: existing.name,
            overlappingValues: common,
          });
        }
      }
    } else if (type === 'counties') {
      const newCounties = new Set((definition as TerritoryDefinitionCounties).counties.map((c: string) => c.toLowerCase()));
      for (const existing of existingTerritories) {
        const existingDef = existing.definition as TerritoryDefinitionCounties;
        const common = existingDef.counties?.filter((c: string) => newCounties.has(c.toLowerCase())) || [];
        if (common.length > 0) {
          overlaps.push({
            territoryId: existing.id,
            territoryName: existing.name,
            overlappingValues: common,
          });
        }
      }
    }
    // Polygon overlap detection is handled client-side with Turf.js

    return NextResponse.json({
      hasOverlap: overlaps.length > 0,
      overlaps,
    });
  } catch (error) {
    console.error('Error checking territory overlap:', error);
    return NextResponse.json({ error: 'Failed to check overlap' }, { status: 500 });
  }
}
