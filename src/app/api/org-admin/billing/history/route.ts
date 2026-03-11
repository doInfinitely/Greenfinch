import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { enrichmentCostEvents } from '@/lib/schema';
import { sql, desc, eq, gte, and, count, sum } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (orgRole !== 'org:admin' && orgRole !== 'org:manager') {
      return NextResponse.json({ error: 'Admin or manager access required' }, { status: 403 });
    }

    // Last 12 months
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    const monthTrunc = sql`date_trunc('month', ${enrichmentCostEvents.createdAt})`;

    const monthlyRows = await db.select({
      month: sql<string>`${monthTrunc}::date::text`,
      creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
      estimatedCostUsd: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
      totalCalls: count(),
      topProvider: sql<string>`(array_agg(${enrichmentCostEvents.provider} ORDER BY ${enrichmentCostEvents.creditsUsed} DESC NULLS LAST))[1]`,
    })
      .from(enrichmentCostEvents)
      .where(and(
        eq(enrichmentCostEvents.clerkOrgId, orgId),
        gte(enrichmentCostEvents.createdAt, since)
      ))
      .groupBy(monthTrunc)
      .orderBy(desc(monthTrunc));

    return NextResponse.json({
      months: monthlyRows.map(row => ({
        month: row.month?.substring(0, 7) || '',
        creditsUsed: Number(row.creditsUsed),
        estimatedCostUsd: Number(row.estimatedCostUsd),
        totalCalls: Number(row.totalCalls),
        topProvider: row.topProvider,
      })),
    });
  } catch (error) {
    console.error('[BillingHistory] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch billing history' }, { status: 500 });
  }
}
