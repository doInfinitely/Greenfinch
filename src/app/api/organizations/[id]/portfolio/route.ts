import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, propertyOrganizations, properties } from '@/lib/schema';
import { eq, inArray } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // BFS to collect all descendant org IDs (max depth 10)
    const allOrgIds = new Set<string>([id]);
    let currentLevel = [id];

    for (let depth = 0; depth < 10 && currentLevel.length > 0; depth++) {
      const children = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(inArray(organizations.parentOrgId, currentLevel));

      const newIds: string[] = [];
      for (const child of children) {
        if (!allOrgIds.has(child.id)) {
          allOrgIds.add(child.id);
          newIds.push(child.id);
        }
      }
      currentLevel = newIds;
    }

    const orgIds = Array.from(allOrgIds);

    // Query properties across all orgs in the hierarchy
    const portfolioProperties = await db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        address: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        commonName: properties.commonName,
        assetCategory: properties.assetCategory,
        assetSubcategory: properties.assetSubcategory,
        role: propertyOrganizations.role,
        orgId: propertyOrganizations.orgId,
      })
      .from(propertyOrganizations)
      .innerJoin(properties, eq(propertyOrganizations.propertyId, properties.id))
      .where(inArray(propertyOrganizations.orgId, orgIds));

    // Fetch org names for attribution
    const orgs = await db
      .select({ id: organizations.id, name: organizations.name, domain: organizations.domain })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    const orgMap = new Map(orgs.map(o => [o.id, o]));

    // Deduplicate by property ID, keeping org attribution
    const propertyMap = new Map<string, {
      id: string;
      propertyKey: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      commonName: string | null;
      assetCategory: string | null;
      assetSubcategory: string | null;
      orgs: Array<{ id: string; name: string | null; domain: string | null; role: string | null }>;
    }>();

    for (const p of portfolioProperties) {
      const key = p.propertyKey || p.id;
      if (!propertyMap.has(key)) {
        propertyMap.set(key, {
          id: p.id,
          propertyKey: p.propertyKey,
          address: p.address || p.regridAddress,
          city: p.city,
          state: p.state,
          zip: p.zip,
          commonName: p.commonName,
          assetCategory: p.assetCategory,
          assetSubcategory: p.assetSubcategory,
          orgs: [],
        });
      }

      const org = p.orgId ? orgMap.get(p.orgId) : undefined;
      propertyMap.get(key)!.orgs.push({
        id: p.orgId || '',
        name: org?.name || null,
        domain: org?.domain || null,
        role: p.role,
      });
    }

    return NextResponse.json({
      totalOrgs: orgIds.length,
      totalProperties: propertyMap.size,
      properties: Array.from(propertyMap.values()),
    });
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio' },
      { status: 500 }
    );
  }
}
