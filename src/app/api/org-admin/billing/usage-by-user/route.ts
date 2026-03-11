import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { enrichmentCostEvents, users } from '@/lib/schema';
import { sql, desc, eq, gte, and, count, sum, inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (orgRole !== 'org:admin' && orgRole !== 'org:manager') {
      return NextResponse.json({ error: 'Admin or manager access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const orgFilter = and(
      eq(enrichmentCostEvents.clerkOrgId, orgId),
      gte(enrichmentCostEvents.createdAt, since)
    );

    const byUserRows = await db.select({
      triggeredBy: enrichmentCostEvents.triggeredBy,
      totalCalls: count(),
      creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
      estimatedCostUsd: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
      lastActivity: sql<string>`MAX(${enrichmentCostEvents.createdAt})::text`,
    })
      .from(enrichmentCostEvents)
      .where(orgFilter)
      .groupBy(enrichmentCostEvents.triggeredBy)
      .orderBy(desc(sql`SUM(${enrichmentCostEvents.creditsUsed})`));

    // Batch fetch user names
    const userIds = byUserRows
      .map(r => r.triggeredBy)
      .filter((id): id is string => !!id);

    const usersData = userIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];

    const usersMap = new Map(usersData.map(u => [u.id, u]));

    return NextResponse.json({
      byUser: byUserRows.map(row => {
        const user = row.triggeredBy ? usersMap.get(row.triggeredBy) : null;
        let userName = 'System / Automated';
        if (user) {
          userName = user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user.email || 'Unknown User';
        } else if (row.triggeredBy) {
          userName = 'Unknown User';
        }
        return {
          triggeredBy: row.triggeredBy,
          userName,
          totalCalls: Number(row.totalCalls),
          creditsUsed: Number(row.creditsUsed),
          estimatedCostUsd: Number(row.estimatedCostUsd),
          lastActivity: row.lastActivity,
        };
      }),
    });
  } catch (error) {
    console.error('[BillingUsageByUser] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage by user' }, { status: 500 });
  }
}
