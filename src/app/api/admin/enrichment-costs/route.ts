import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enrichmentCostEvents } from '@/lib/schema';
import { sql, desc, eq, gte, and, count, sum } from 'drizzle-orm';
import { requireAdminAccess } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requireAdminAccess();
    
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'daily';
    const days = parseInt(searchParams.get('days') || '30', 10);
    const provider = searchParams.get('provider');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [gte(enrichmentCostEvents.createdAt, since)];
    if (provider) {
      conditions.push(eq(enrichmentCostEvents.provider, provider));
    }
    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [summaryByProvider, dailyTrend, recentEvents, totals] = await Promise.all([
      db.select({
        provider: enrichmentCostEvents.provider,
        totalCalls: count(),
        successfulCalls: sql<number>`count(*) filter (where ${enrichmentCostEvents.success} = true)`,
        failedCalls: sql<number>`count(*) filter (where ${enrichmentCostEvents.success} = false)`,
        totalCredits: sum(enrichmentCostEvents.creditsUsed),
        totalCostUsd: sum(enrichmentCostEvents.estimatedCostUsd),
      })
        .from(enrichmentCostEvents)
        .where(whereClause)
        .groupBy(enrichmentCostEvents.provider)
        .orderBy(desc(sum(enrichmentCostEvents.estimatedCostUsd))),

      db.select({
        date: sql<string>`date_trunc(${period}, ${enrichmentCostEvents.createdAt})::date::text`,
        provider: enrichmentCostEvents.provider,
        calls: count(),
        costUsd: sum(enrichmentCostEvents.estimatedCostUsd),
      })
        .from(enrichmentCostEvents)
        .where(whereClause)
        .groupBy(
          sql`date_trunc(${period}, ${enrichmentCostEvents.createdAt})`,
          enrichmentCostEvents.provider
        )
        .orderBy(desc(sql`date_trunc(${period}, ${enrichmentCostEvents.createdAt})`)),

      db.select()
        .from(enrichmentCostEvents)
        .where(whereClause)
        .orderBy(desc(enrichmentCostEvents.createdAt))
        .limit(50),

      db.select({
        totalCalls: count(),
        totalCostUsd: sum(enrichmentCostEvents.estimatedCostUsd),
        totalCredits: sum(enrichmentCostEvents.creditsUsed),
      })
        .from(enrichmentCostEvents)
        .where(whereClause),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        period,
        days,
        totals: totals[0] || { totalCalls: 0, totalCostUsd: 0, totalCredits: 0 },
        byProvider: summaryByProvider,
        trend: dailyTrend,
        recentEvents,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }
    console.error('[Admin] Enrichment costs query error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch enrichment costs' },
      { status: 500 }
    );
  }
}
