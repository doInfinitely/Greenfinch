import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orgSubscriptions, creditTiers, creditBalances } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (!sub) {
      return NextResponse.json({
        success: true,
        data: { subscription: null, tier: null, balance: null },
      });
    }

    const promises: [
      Promise<(typeof creditTiers.$inferSelect)[]>,
      Promise<(typeof creditBalances.$inferSelect)[]>,
      Promise<(typeof creditTiers.$inferSelect)[] | null>,
    ] = [
      db.select().from(creditTiers).where(eq(creditTiers.id, sub.tierId)).limit(1),
      db.select().from(creditBalances).where(eq(creditBalances.clerkOrgId, orgId)).limit(1),
      sub.pendingTierId
        ? db.select().from(creditTiers).where(eq(creditTiers.id, sub.pendingTierId)).limit(1)
        : Promise.resolve(null),
    ];

    const [tierRows, balanceRows, pendingTierRows] = await Promise.all(promises);
    const tier = tierRows[0] ?? null;
    const balance = balanceRows[0] ?? null;
    const pendingTier = pendingTierRows?.[0] ?? null;

    return NextResponse.json({
      success: true,
      data: {
        subscription: {
          status: sub.status,
          tierId: sub.tierId,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          seatCount: sub.seatCount,
          pendingTierId: sub.pendingTierId,
          pendingChangeEffectiveAt: sub.pendingChangeEffectiveAt,
          pendingTierName: pendingTier?.displayName ?? null,
        },
        tier: tier ? {
          id: tier.id,
          name: tier.name,
          displayName: tier.displayName,
          monthlyCredits: tier.monthlyCredits,
          rolloverCap: tier.rolloverCap,
          monthlyPriceUsd: tier.monthlyPriceUsd,
          seatsIncluded: tier.seatsIncluded,
          features: tier.features,
          sortOrder: tier.sortOrder,
        } : null,
        balance: balance ? {
          currentBalance: balance.currentBalance,
          rolloverBalance: balance.rolloverBalance,
          purchasedBalance: balance.purchasedBalance,
          totalAvailable: balance.currentBalance + balance.rolloverBalance + balance.purchasedBalance,
        } : null,
      },
    });
  } catch (error) {
    console.error('[Billing] Subscription error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
