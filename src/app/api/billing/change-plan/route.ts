import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/permissions';
import { db } from '@/lib/db';
import { creditTiers, orgSubscriptions, creditBalances } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireStripe } from '@/lib/stripe';
import { getPlanDirection } from '@/lib/plan-config';
import { getOrgSeatInfo } from '@/lib/seat-management';

export async function GET() {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tiers = await db
      .select()
      .from(creditTiers)
      .where(eq(creditTiers.isActive, true))
      .orderBy(creditTiers.sortOrder);

    const [sub] = await db
      .select({ tierId: orgSubscriptions.tierId })
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        tiers: tiers.map(t => ({
          id: t.id,
          name: t.name,
          displayName: t.displayName,
          monthlyCredits: t.monthlyCredits,
          rolloverCap: t.rolloverCap,
          monthlyPriceUsd: t.monthlyPriceUsd,
          seatsIncluded: t.seatsIncluded,
          perSeatPriceUsd: t.perSeatPriceUsd,
          maxSeats: t.maxSeats,
          features: t.features,
          sortOrder: t.sortOrder,
        })),
        currentTierId: sub?.tierId ?? null,
      },
    });
  } catch (error) {
    console.error('[Billing] Get tiers error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { tierId, preview } = await request.json();
    if (!tierId) {
      return NextResponse.json({ error: 'tierId is required' }, { status: 400 });
    }

    const stripe = requireStripe();

    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (!sub?.stripeSubscriptionId || !sub.stripeCustomerId) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    // Look up both current and new tiers
    const [[currentTier], [newTier]] = await Promise.all([
      db.select().from(creditTiers).where(eq(creditTiers.id, sub.tierId)).limit(1),
      db.select().from(creditTiers).where(eq(creditTiers.id, tierId)).limit(1),
    ]);

    if (!newTier?.stripePriceId) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }
    if (!currentTier) {
      return NextResponse.json({ error: 'Current tier not found' }, { status: 400 });
    }

    const direction = getPlanDirection(currentTier.sortOrder ?? 0, newTier.sortOrder ?? 0);

    if (direction === 'same') {
      return NextResponse.json({ error: 'Already on this plan' }, { status: 400 });
    }

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) {
      return NextResponse.json({ error: 'No subscription item found' }, { status: 400 });
    }

    // --- PREVIEW MODE ---
    if (preview) {
      if (direction === 'upgrade') {
        const previewInvoice = await stripe.invoices.createPreview({
          customer: sub.stripeCustomerId,
          subscription: sub.stripeSubscriptionId,
          subscription_details: {
            items: [{ id: itemId, price: newTier.stripePriceId }],
            proration_behavior: 'create_prorations',
          },
        });

        return NextResponse.json({
          success: true,
          data: {
            direction,
            amountDue: previewInvoice.amount_due,
            currency: previewInvoice.currency,
            currentTier: { name: currentTier.displayName, monthlyPriceUsd: currentTier.monthlyPriceUsd },
            newTier: {
              name: newTier.displayName,
              monthlyCredits: newTier.monthlyCredits,
              monthlyPriceUsd: newTier.monthlyPriceUsd,
            },
          },
        });
      } else {
        // Downgrade preview — show effective date (end of current period)
        return NextResponse.json({
          success: true,
          data: {
            direction,
            effectiveDate: sub.currentPeriodEnd,
            currentTier: {
              name: currentTier.displayName,
              monthlyPriceUsd: currentTier.monthlyPriceUsd,
              monthlyCredits: currentTier.monthlyCredits,
              seatsIncluded: currentTier.seatsIncluded,
            },
            newTier: {
              name: newTier.displayName,
              monthlyCredits: newTier.monthlyCredits,
              monthlyPriceUsd: newTier.monthlyPriceUsd,
              seatsIncluded: newTier.seatsIncluded,
            },
          },
        });
      }
    }

    // --- DOWNGRADE SEAT GUARD ---
    if (direction === 'downgrade' && newTier.maxSeats !== null) {
      const seatInfo = await getOrgSeatInfo(orgId);
      if (seatInfo.seatCount > newTier.maxSeats) {
        return NextResponse.json(
          {
            error: `Current seat count (${seatInfo.seatCount}) exceeds the new plan's limit of ${newTier.maxSeats} seats. Remove seats before downgrading.`,
          },
          { status: 400 }
        );
      }
    }

    // --- EXECUTE ---
    if (direction === 'upgrade') {
      // Immediate upgrade with proration
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: itemId, price: newTier.stripePriceId }],
        proration_behavior: 'create_prorations',
      });

      await db
        .update(orgSubscriptions)
        .set({
          tierId: newTier.id,
          pendingTierId: null,
          pendingChangeEffectiveAt: null,
          updatedAt: new Date(),
        })
        .where(eq(orgSubscriptions.clerkOrgId, orgId));

      await db
        .update(creditBalances)
        .set({ rolloverCap: newTier.rolloverCap })
        .where(eq(creditBalances.clerkOrgId, orgId));

      return NextResponse.json({ success: true, message: `Upgraded to ${newTier.displayName}` });
    } else {
      // Downgrade: schedule change at period end using Stripe Subscription Schedules
      // First, cancel any existing schedule
      const existingSchedules = await stripe.subscriptionSchedules.list({
        customer: sub.stripeCustomerId,
        limit: 5,
      });
      for (const sched of existingSchedules.data) {
        if (sched.status === 'active' || sched.status === 'not_started') {
          await stripe.subscriptionSchedules.release(sched.id);
        }
      }

      // Create a new schedule from the existing subscription
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: sub.stripeSubscriptionId,
      });

      // Update the schedule: keep current phase, add new phase starting at period end
      const currentPhaseEnd = sub.currentPeriodEnd
        ? Math.floor(sub.currentPeriodEnd.getTime() / 1000)
        : (schedule.phases[0]?.end_date ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600);

      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: currentTier.stripePriceId!, quantity: stripeSub.items.data[0]?.quantity ?? 1 }],
            start_date: schedule.phases[0]?.start_date,
            end_date: currentPhaseEnd,
          },
          {
            items: [{ price: newTier.stripePriceId, quantity: stripeSub.items.data[0]?.quantity ?? 1 }],
            start_date: currentPhaseEnd,
          },
        ],
      });

      // Store pending change locally
      await db
        .update(orgSubscriptions)
        .set({
          pendingTierId: newTier.id,
          pendingChangeEffectiveAt: sub.currentPeriodEnd,
          updatedAt: new Date(),
        })
        .where(eq(orgSubscriptions.clerkOrgId, orgId));

      return NextResponse.json({
        success: true,
        message: `Plan will change to ${newTier.displayName} on ${sub.currentPeriodEnd?.toLocaleDateString()}`,
      });
    }
  } catch (error) {
    console.error('[Billing] Change plan error:', error);
    return NextResponse.json({ error: 'Failed to change plan' }, { status: 500 });
  }
}

// Cancel a pending downgrade
export async function DELETE() {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const stripe = requireStripe();

    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (!sub?.stripeCustomerId || !sub.pendingTierId) {
      return NextResponse.json({ error: 'No pending plan change to cancel' }, { status: 400 });
    }

    // Release any active subscription schedules
    const schedules = await stripe.subscriptionSchedules.list({
      customer: sub.stripeCustomerId,
      limit: 5,
    });
    for (const sched of schedules.data) {
      if (sched.status === 'active' || sched.status === 'not_started') {
        await stripe.subscriptionSchedules.release(sched.id);
      }
    }

    // Clear pending fields
    await db
      .update(orgSubscriptions)
      .set({
        pendingTierId: null,
        pendingChangeEffectiveAt: null,
        updatedAt: new Date(),
      })
      .where(eq(orgSubscriptions.clerkOrgId, orgId));

    return NextResponse.json({ success: true, message: 'Pending plan change canceled' });
  } catch (error) {
    console.error('[Billing] Cancel pending change error:', error);
    return NextResponse.json({ error: 'Failed to cancel pending change' }, { status: 500 });
  }
}
