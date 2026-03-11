import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { orgSubscriptions, creditBalances } from '@/lib/schema';
import { eq, and, lt, isNotNull } from 'drizzle-orm';
import { processMonthlyRollover } from '@/lib/credits';

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();

    // Find orgs whose billing period has passed but credits haven't been allocated
    const staleOrgs = await db
      .select({
        clerkOrgId: orgSubscriptions.clerkOrgId,
        currentPeriodStart: orgSubscriptions.currentPeriodStart,
        lastAllocationAt: creditBalances.lastAllocationAt,
      })
      .from(orgSubscriptions)
      .innerJoin(creditBalances, eq(orgSubscriptions.clerkOrgId, creditBalances.clerkOrgId))
      .where(
        and(
          eq(orgSubscriptions.status, 'active'),
          isNotNull(orgSubscriptions.currentPeriodStart),
          lt(creditBalances.lastAllocationAt, orgSubscriptions.currentPeriodStart)
        )
      );

    let processed = 0;
    for (const org of staleOrgs) {
      try {
        await processMonthlyRollover(org.clerkOrgId);
        processed++;
        console.log(`[Credit Cron] Processed rollover for org ${org.clerkOrgId}`);
      } catch (error) {
        console.error(`[Credit Cron] Failed for org ${org.clerkOrgId}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      data: { checked: staleOrgs.length, processed },
    });
  } catch (error) {
    console.error('[Credit Cron] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
