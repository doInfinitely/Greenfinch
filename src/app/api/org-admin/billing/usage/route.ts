import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { enrichmentCostEvents, orgCreditAllocations, ENRICHMENT_PROVIDER_LABELS } from '@/lib/schema';
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

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const periodParam = searchParams.get('period') || 'daily';

    const periodMap: Record<string, string> = { daily: 'day', week: 'week', month: 'month' };
    const pgInterval = periodMap[periodParam] || 'day';

    const since = new Date();
    since.setDate(since.getDate() - days);

    const orgFilter = and(
      eq(enrichmentCostEvents.clerkOrgId, orgId),
      gte(enrichmentCostEvents.createdAt, since)
    );

    const dateTruncExpr = sql`date_trunc(${sql.raw(`'${pgInterval}'`)}, ${enrichmentCostEvents.createdAt})`;

    const [allocationRows, totalsRows, byProviderRows, byActionRows, trendRows] = await Promise.all([
      // Allocation lookup
      db.select()
        .from(orgCreditAllocations)
        .where(eq(orgCreditAllocations.clerkOrgId, orgId))
        .limit(1),

      // Current period totals
      db.select({
        totalCalls: count(),
        successfulCalls: sql<number>`count(*) filter (where ${enrichmentCostEvents.success} = true)`,
        failedCalls: sql<number>`count(*) filter (where ${enrichmentCostEvents.success} = false)`,
        creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
        estimatedCostUsd: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
      })
        .from(enrichmentCostEvents)
        .where(orgFilter),

      // By provider
      db.select({
        provider: enrichmentCostEvents.provider,
        totalCalls: count(),
        creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
        estimatedCostUsd: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
      })
        .from(enrichmentCostEvents)
        .where(orgFilter)
        .groupBy(enrichmentCostEvents.provider)
        .orderBy(desc(sql`SUM(${enrichmentCostEvents.creditsUsed})`)),

      // By action type (endpoint + provider)
      db.select({
        endpoint: enrichmentCostEvents.endpoint,
        provider: enrichmentCostEvents.provider,
        totalCalls: count(),
        creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
      })
        .from(enrichmentCostEvents)
        .where(orgFilter)
        .groupBy(enrichmentCostEvents.endpoint, enrichmentCostEvents.provider)
        .orderBy(desc(count()))
        .limit(20),

      // Trend
      db.select({
        date: sql<string>`${dateTruncExpr}::date::text`,
        creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
        calls: count(),
      })
        .from(enrichmentCostEvents)
        .where(orgFilter)
        .groupBy(dateTruncExpr)
        .orderBy(dateTruncExpr),
    ]);

    const allocation = allocationRows[0] || null;
    const currentPeriod = totalsRows[0] || { totalCalls: 0, successfulCalls: 0, failedCalls: 0, creditsUsed: 0, estimatedCostUsd: 0 };

    const creditsUsed = Number(currentPeriod.creditsUsed) || 0;
    const monthlyCredits = allocation ? Number(allocation.monthlyCredits) || 0 : 0;
    const rolloverCredits = allocation ? Number(allocation.rolloverCredits) || 0 : 0;
    const totalAvailable = monthlyCredits + rolloverCredits;
    const creditsRemaining = Math.max(0, totalAvailable - creditsUsed);
    const usagePercentage = totalAvailable > 0 ? Math.round((creditsUsed / totalAvailable) * 100) : 0;

    return NextResponse.json({
      allocation: allocation ? {
        planName: allocation.planName,
        monthlyCredits: allocation.monthlyCredits,
        rolloverCredits: allocation.rolloverCredits,
        billingPeriodStart: allocation.billingPeriodStart,
        billingPeriodEnd: allocation.billingPeriodEnd,
      } : null,
      currentPeriod: {
        creditsUsed,
        estimatedCostUsd: Number(currentPeriod.estimatedCostUsd) || 0,
        totalCalls: Number(currentPeriod.totalCalls) || 0,
        successfulCalls: Number(currentPeriod.successfulCalls) || 0,
        failedCalls: Number(currentPeriod.failedCalls) || 0,
      },
      creditsRemaining,
      usagePercentage,
      isWarning: usagePercentage >= 80,
      byProvider: byProviderRows.map(row => ({
        provider: row.provider,
        providerLabel: ENRICHMENT_PROVIDER_LABELS[row.provider as keyof typeof ENRICHMENT_PROVIDER_LABELS] || row.provider,
        totalCalls: Number(row.totalCalls),
        creditsUsed: Number(row.creditsUsed),
        estimatedCostUsd: Number(row.estimatedCostUsd),
      })),
      byActionType: byActionRows.map(row => ({
        endpoint: row.endpoint,
        provider: row.provider,
        totalCalls: Number(row.totalCalls),
        creditsUsed: Number(row.creditsUsed),
      })),
      trend: trendRows.map(row => ({
        date: row.date,
        creditsUsed: Number(row.creditsUsed),
        calls: Number(row.calls),
      })),
    });
  } catch (error) {
    console.error('[BillingUsage] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage data' }, { status: 500 });
  }
}
