import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/permissions';
import { db } from '@/lib/db';
import { orgSubscriptions, cancellationSurveys } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireStripe } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole, userId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const {
      reason,
      feedback,
      retentionOfferShown,
      retentionOfferAccepted,
      retentionOfferType,
      immediate,
    } = await request.json();

    const stripe = requireStripe();

    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (!sub?.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    // Record the cancellation survey
    await db.insert(cancellationSurveys).values({
      clerkOrgId: orgId,
      reason: reason || 'other',
      feedback: feedback || null,
      retentionOfferShown: retentionOfferShown ?? false,
      retentionOfferAccepted: retentionOfferAccepted ?? false,
      retentionOfferType: retentionOfferType || null,
      outcome: retentionOfferAccepted ? 'retained' : 'canceled',
      canceledByUserId: userId || null,
    });

    // If retention offer was accepted, don't cancel
    if (retentionOfferAccepted) {
      return NextResponse.json({
        success: true,
        message: 'Thank you! Your subscription remains active.',
      });
    }

    // Store cancellation reason on subscription
    await db
      .update(orgSubscriptions)
      .set({
        cancellationReason: reason || null,
        cancellationFeedback: feedback || null,
        updatedAt: new Date(),
      })
      .where(eq(orgSubscriptions.clerkOrgId, orgId));

    if (immediate) {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      await db
        .update(orgSubscriptions)
        .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
        .where(eq(orgSubscriptions.clerkOrgId, orgId));
    } else {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      await db
        .update(orgSubscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(orgSubscriptions.clerkOrgId, orgId));
    }

    return NextResponse.json({
      success: true,
      message: immediate ? 'Subscription canceled' : 'Subscription will cancel at period end',
    });
  } catch (error) {
    console.error('[Billing] Cancel error:', error);
    return NextResponse.json({ error: 'Failed to cancel subscription' }, { status: 500 });
  }
}

// Reactivate: clear cancel_at_period_end
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

    if (!sub?.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db
      .update(orgSubscriptions)
      .set({
        cancelAtPeriodEnd: false,
        cancellationReason: null,
        cancellationFeedback: null,
        updatedAt: new Date(),
      })
      .where(eq(orgSubscriptions.clerkOrgId, orgId));

    return NextResponse.json({ success: true, message: 'Subscription reactivated' });
  } catch (error) {
    console.error('[Billing] Reactivate error:', error);
    return NextResponse.json({ error: 'Failed to reactivate subscription' }, { status: 500 });
  }
}
