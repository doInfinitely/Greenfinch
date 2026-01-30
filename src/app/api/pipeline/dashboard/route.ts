import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, users } from '@/lib/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, userId: clerkUserId, orgRole } = await auth();
    
    if (!orgId || !clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUserRecord = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);
    
    const currentUserId = currentUserRecord[0]?.id;

    const searchParams = request.nextUrl.searchParams;
    const ownerFilter = searchParams.get('owner');
    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';

    let whereConditions;
    if (ownerFilter === 'all' && isAdmin) {
      whereConditions = eq(propertyPipeline.clerkOrgId, orgId);
    } else if (ownerFilter === 'unassigned' && isAdmin) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        isNull(propertyPipeline.ownerId)
      );
    } else if (ownerFilter && ownerFilter !== 'mine' && isAdmin) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.ownerId, ownerFilter)
      );
    } else if (currentUserId) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.ownerId, currentUserId)
      );
    } else {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        isNull(propertyPipeline.ownerId)
      );
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

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
      .where(whereConditions);

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
