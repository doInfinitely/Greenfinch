import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, propertyActivity, users } from '@/lib/schema';
import { eq, sql, gte, and, inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (orgRole !== 'org:admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let teamMemberCount = 0;
    try {
      const clerk = await clerkClient();
      const memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: orgId,
      });
      teamMemberCount = memberships.totalCount || memberships.data?.length || 0;
    } catch (e) {
      console.error('Error fetching org members:', e);
    }

    const [pipelineStats] = await db
      .select({
        totalPipelineValue: sql<number>`COALESCE(SUM(CASE WHEN ${propertyPipeline.status} IN ('qualified', 'attempted_contact', 'active_opportunity') THEN ${propertyPipeline.dealValue} ELSE 0 END), 0)`,
        valueGenerated: sql<number>`COALESCE(SUM(CASE WHEN ${propertyPipeline.status} = 'won' THEN ${propertyPipeline.dealValue} ELSE 0 END), 0)`,
      })
      .from(propertyPipeline)
      .where(eq(propertyPipeline.clerkOrgId, orgId));

    const [activityStats] = await db
      .select({
        propertiesWorkedThisMonth: sql<number>`COUNT(DISTINCT ${propertyActivity.propertyId})`,
      })
      .from(propertyActivity)
      .where(and(
        eq(propertyActivity.clerkOrgId, orgId),
        gte(propertyActivity.createdAt, startOfMonth)
      ));

    const teamActivity = await db
      .select({
        userId: propertyActivity.userId,
        activityCount: sql<number>`COUNT(*)`,
        lastActivity: sql<Date>`MAX(${propertyActivity.createdAt})`,
      })
      .from(propertyActivity)
      .where(eq(propertyActivity.clerkOrgId, orgId))
      .groupBy(propertyActivity.userId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(20);

    // Batch fetch user info (fix N+1)
    const userIds = teamActivity.map(a => a.userId);
    const usersData = userIds.length > 0 ? await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds)) : [];
    
    const usersMap = new Map(usersData.map(u => [u.id, u]));
    
    const enrichedTeamActivity = teamActivity.map((activity) => {
      const user = usersMap.get(activity.userId);
      let userName = 'Unknown User';
      if (user) {
        userName = user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}`
          : user.email || 'Unknown User';
      }
      return {
        ...activity,
        userName,
      };
    });

    return NextResponse.json({
      teamMemberCount,
      propertiesWorkedThisMonth: Number(activityStats?.propertiesWorkedThisMonth) || 0,
      totalPipelineValue: Number(pipelineStats?.totalPipelineValue) || 0,
      valueGenerated: Number(pipelineStats?.valueGenerated) || 0,
      teamActivity: enrichedTeamActivity,
    });
  } catch (error) {
    console.error('Error fetching org analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
