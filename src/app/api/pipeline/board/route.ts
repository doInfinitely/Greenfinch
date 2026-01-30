import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, properties } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pipelineItems = await db
      .select({
        id: propertyPipeline.id,
        propertyId: propertyPipeline.propertyId,
        status: propertyPipeline.status,
        dealValue: propertyPipeline.dealValue,
        statusChangedAt: propertyPipeline.statusChangedAt,
        propertyAddress: properties.regridAddress,
        propertyCity: properties.city,
        propertyState: properties.state,
        propertyZip: properties.zip,
        commonName: properties.commonName,
        category: properties.assetCategory,
        subcategory: properties.assetSubcategory,
      })
      .from(propertyPipeline)
      .innerJoin(properties, eq(propertyPipeline.propertyId, properties.id))
      .where(eq(propertyPipeline.clerkOrgId, orgId))
      .orderBy(desc(propertyPipeline.statusChangedAt));

    const grouped: Record<string, typeof pipelineItems> = {
      new: [],
      qualified: [],
      attempted_contact: [],
      active_opportunity: [],
      won: [],
      lost: [],
      disqualified: [],
    };

    for (const item of pipelineItems) {
      if (grouped[item.status]) {
        grouped[item.status].push(item);
      }
    }

    const counts: Record<string, number> = {};
    for (const status of Object.keys(grouped)) {
      counts[status] = grouped[status].length;
    }

    return NextResponse.json({
      items: grouped,
      counts,
    });
  } catch (error) {
    console.error('Error fetching pipeline board:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline board data' }, { status: 500 });
  }
}
