import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, users } from '@/lib/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';

function getTimeframeStart(timeframe: string): Date {
  const now = new Date();
  switch (timeframe) {
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter':
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), quarterMonth, 1);
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

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
    const timeframe = searchParams.get('timeframe') || 'month';
    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';

    let whereConditions;
    if (ownerFilter === 'all' && isAdmin) {
      whereConditions = eq(propertyPipeline.clerkOrgId, orgId);
    } else if (ownerFilter === 'unassigned' && isAdmin) {
      whereConditions = and(
        eq(propertyPipeline.clerkOrgId, orgId),
        isNull(propertyPipeline.ownerId)
      );
    } else if (ownerFilter && ownerFilter !== 'mine') {
      if (isAdmin) {
        whereConditions = and(
          eq(propertyPipeline.clerkOrgId, orgId),
          eq(propertyPipeline.ownerId, ownerFilter)
        );
      } else {
        whereConditions = and(
          eq(propertyPipeline.clerkOrgId, orgId),
          eq(propertyPipeline.ownerId, currentUserId || '')
        );
      }
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

    const timeframeStart = getTimeframeStart(timeframe);

    const [pipelineStats] = await db
      .select({
        totalPipelineValue: sql<number>`COALESCE(SUM(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity') THEN ${propertyPipeline.dealValue} ELSE 0 END), 0)`,
        activeOpportunities: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity') THEN 1 END)`,
        wonThisMonth: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'won' AND ${propertyPipeline.statusChangedAt} >= ${timeframeStart} THEN 1 END)`,
        wonValue: sql<number>`COALESCE(SUM(CASE WHEN ${propertyPipeline.status} = 'won' AND ${propertyPipeline.statusChangedAt} >= ${timeframeStart} THEN ${propertyPipeline.dealValue} ELSE 0 END), 0)`,
        qualifiedCount: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'qualified' THEN 1 END)`,
        attemptedContactCount: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'attempted_contact' THEN 1 END)`,
        activeOppCount: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'active_opportunity' THEN 1 END)`,
        wonTotal: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'won' THEN 1 END)`,
        lostTotal: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'lost' THEN 1 END)`,
        qualifiedEver: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity', 'won', 'lost') THEN 1 END)`,
        attemptedEver: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} IN ('attempted_contact', 'active_opportunity', 'won', 'lost') THEN 1 END)`,
        activeEver: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} IN ('active_opportunity', 'won', 'lost') THEN 1 END)`,
      })
      .from(propertyPipeline)
      .where(whereConditions);

    const closedTotal = Number(pipelineStats.wonTotal) + Number(pipelineStats.lostTotal);
    const conversionRate = closedTotal > 0 
      ? Math.round((Number(pipelineStats.wonTotal) / closedTotal) * 100) 
      : 0;

    const qualifiedToAttempted = Number(pipelineStats.qualifiedEver) > 0
      ? Math.round((Number(pipelineStats.attemptedEver) / Number(pipelineStats.qualifiedEver)) * 100)
      : 0;

    const attemptedToActive = Number(pipelineStats.attemptedEver) > 0
      ? Math.round((Number(pipelineStats.activeEver) / Number(pipelineStats.attemptedEver)) * 100)
      : 0;

    const activeToWon = Number(pipelineStats.activeEver) > 0
      ? Math.round((Number(pipelineStats.wonTotal) / Number(pipelineStats.activeEver)) * 100)
      : 0;

    return NextResponse.json({
      totalPipelineValue: Number(pipelineStats.totalPipelineValue) || 0,
      activeOpportunities: Number(pipelineStats.activeOpportunities) || 0,
      wonThisMonth: Number(pipelineStats.wonThisMonth) || 0,
      wonValue: Number(pipelineStats.wonValue) || 0,
      conversionRate,
      funnel: {
        qualifiedToAttempted,
        attemptedToActive,
        activeToWon,
      },
      counts: {
        qualified: Number(pipelineStats.qualifiedCount) || 0,
        attemptedContact: Number(pipelineStats.attemptedContactCount) || 0,
        activeOpportunity: Number(pipelineStats.activeOppCount) || 0,
        won: Number(pipelineStats.wonTotal) || 0,
        lost: Number(pipelineStats.lostTotal) || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching pipeline dashboard:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline data' }, { status: 500 });
  }
}
