import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline } from '@/lib/schema';
import { eq, sql, and, gte } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await auth();
    
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const activeStatuses = ['qualified', 'attempted_contact', 'active_opportunity'];

    const [pipelineStats] = await db
      .select({
        totalPipelineValue: sql<number>`COALESCE(SUM(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity') THEN ${propertyPipeline.dealValue} ELSE 0 END), 0)`,
        activeOpportunities: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity') THEN 1 END)`,
        wonThisMonth: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'won' AND ${propertyPipeline.statusChangedAt} >= ${startOfMonth} THEN 1 END)`,
        wonValue: sql<number>`COALESCE(SUM(CASE WHEN ${propertyPipeline.status} = 'won' AND ${propertyPipeline.statusChangedAt} >= ${startOfMonth} THEN ${propertyPipeline.dealValue} ELSE 0 END), 0)`,
        qualifiedTotal: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity', 'won', 'lost') THEN 1 END)`,
        wonTotal: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'won' THEN 1 END)`,
      })
      .from(propertyPipeline)
      .where(eq(propertyPipeline.clerkOrgId, orgId));

    const conversionRate = pipelineStats.qualifiedTotal > 0 
      ? Math.round((pipelineStats.wonTotal / pipelineStats.qualifiedTotal) * 100) 
      : 0;

    return NextResponse.json({
      totalPipelineValue: Number(pipelineStats.totalPipelineValue) || 0,
      activeOpportunities: Number(pipelineStats.activeOpportunities) || 0,
      wonThisMonth: Number(pipelineStats.wonThisMonth) || 0,
      wonValue: Number(pipelineStats.wonValue) || 0,
      conversionRate,
    });
  } catch (error) {
    console.error('Error fetching pipeline dashboard:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline data' }, { status: 500 });
  }
}
