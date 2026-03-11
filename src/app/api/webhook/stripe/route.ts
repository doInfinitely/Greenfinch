import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { db } from '@/lib/db';
import { orgSubscriptions, creditTiers, creditBalances } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { addCredits, processMonthlyRollover } from '@/lib/credits';
import type Stripe from 'stripe';

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Helper to safely extract subscription period timestamps from Stripe objects.
// The newer Stripe SDK moved these under a nested structure;
// we access them via generic record to avoid strict type errors.
function getSubPeriod(sub: Record<string, unknown>): { start: Date | null; end: Date | null } {
  const startTs = (sub.current_period_start ?? (sub as Record<string, unknown>).currentPeriodStart) as number | undefined;
  const endTs = (sub.current_period_end ?? (sub as Record<string, unknown>).currentPeriodEnd) as number | undefined;
  return {
    start: startTs ? new Date(startTs * 1000) : null,
    end: endTs ? new Date(endTs * 1000) : null,
  };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.clerkOrgId;
  const type = session.metadata?.type;

  if (!orgId) {
    console.error('[Stripe Webhook] checkout.session.completed missing clerkOrgId');
    return;
  }

  if (type === 'subscription' && session.subscription) {
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription.id;

    const sub = await stripe!.subscriptions.retrieve(subscriptionId);
    const subData = sub as unknown as Record<string, unknown>;
    const priceId = sub.items.data[0]?.price?.id;
    const period = getSubPeriod(subData);

    const [tier] = priceId
      ? await db.select().from(creditTiers).where(eq(creditTiers.stripePriceId, priceId)).limit(1)
      : [];

    if (!tier) {
      console.error('[Stripe Webhook] No tier found for price:', priceId);
      return;
    }

    const [existing] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (existing) {
      await db.update(orgSubscriptions).set({
        tierId: tier.id,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscriptionId,
        status: 'active',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        updatedAt: new Date(),
      }).where(eq(orgSubscriptions.clerkOrgId, orgId));
    } else {
      await db.insert(orgSubscriptions).values({
        clerkOrgId: orgId,
        tierId: tier.id,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscriptionId,
        status: 'active',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      });
    }

    // Initial credit allocation
    const [bal] = await db
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.clerkOrgId, orgId))
      .limit(1);

    if (!bal) {
      await db.insert(creditBalances).values({
        clerkOrgId: orgId,
        currentBalance: tier.monthlyCredits,
        rolloverBalance: 0,
        purchasedBalance: 0,
        rolloverCap: tier.rolloverCap,
        lastAllocationAt: new Date(),
      });
      await addCredits(orgId, 0, 'allocation', {
        description: `Initial ${tier.displayName} allocation: ${tier.monthlyCredits} credits`,
      });
    }

    console.log(`[Stripe Webhook] Subscription created for org ${orgId}, tier: ${tier.name}`);

  } else if (type === 'credit_pack') {
    const credits = parseInt(session.metadata?.credits ?? '0', 10);
    const packId = session.metadata?.packId;

    if (credits > 0) {
      await addCredits(orgId, credits, 'purchase', {
        description: `Purchased ${credits} credit pack`,
        packId: packId ?? undefined,
      });
      console.log(`[Stripe Webhook] ${credits} credits added to org ${orgId}`);
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const orgId = subscription.metadata?.clerkOrgId;
  if (!orgId) return;

  const subData = subscription as unknown as Record<string, unknown>;
  const period = getSubPeriod(subData);
  const priceId = subscription.items.data[0]?.price?.id;

  const [tier] = priceId
    ? await db.select().from(creditTiers).where(eq(creditTiers.stripePriceId, priceId)).limit(1)
    : [];

  const seatCount = subscription.items.data[0]?.quantity ?? 1;

  const updates: Record<string, unknown> = {
    status: subscription.status === 'active' ? 'active' : subscription.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    seatCount,
    updatedAt: new Date(),
  };

  if (tier) {
    updates.tierId = tier.id;

    // Sync rollover cap when tier changes
    const [existingSub] = await db
      .select({ tierId: orgSubscriptions.tierId })
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (existingSub && existingSub.tierId !== tier.id) {
      // Clear pending downgrade fields since the tier has actually changed
      updates.pendingTierId = null;
      updates.pendingChangeEffectiveAt = null;

      await db.update(creditBalances).set({
        rolloverCap: tier.rolloverCap,
      }).where(eq(creditBalances.clerkOrgId, orgId));
      console.log(`[Stripe Webhook] Tier changed for org ${orgId}, rollover cap updated to ${tier.rolloverCap}`);
    }
  }

  await db.update(orgSubscriptions).set(updates).where(eq(orgSubscriptions.clerkOrgId, orgId));
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const orgId = subscription.metadata?.clerkOrgId;
  if (!orgId) return;

  await db.update(orgSubscriptions).set({
    status: 'canceled',
    canceledAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(orgSubscriptions.clerkOrgId, orgId));

  console.log(`[Stripe Webhook] Subscription canceled for org ${orgId}`);
}

async function handleInvoicePaid(invoiceObj: Stripe.Event.Data.Object) {
  const invoice = invoiceObj as unknown as Record<string, unknown>;
  const subscriptionRef = invoice.subscription;
  if (!subscriptionRef) return;

  const subscriptionId = typeof subscriptionRef === 'string'
    ? subscriptionRef
    : (subscriptionRef as { id: string }).id;

  const [sub] = await db
    .select()
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (!sub) return;

  // Skip initial invoice
  if (invoice.billing_reason === 'subscription_create') return;

  await processMonthlyRollover(sub.clerkOrgId);
  console.log(`[Stripe Webhook] Monthly rollover processed for org ${sub.clerkOrgId}`);
}

async function handlePaymentFailed(invoiceObj: Stripe.Event.Data.Object) {
  const invoice = invoiceObj as unknown as Record<string, unknown>;
  const subscriptionRef = invoice.subscription;
  if (!subscriptionRef) return;

  const subscriptionId = typeof subscriptionRef === 'string'
    ? subscriptionRef
    : (subscriptionRef as { id: string }).id;

  const [sub] = await db
    .select()
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (!sub) return;

  await db.update(orgSubscriptions).set({
    status: 'past_due',
    updatedAt: new Date(),
  }).where(eq(orgSubscriptions.clerkOrgId, sub.clerkOrgId));

  console.log(`[Stripe Webhook] Payment failed for org ${sub.clerkOrgId}`);
}
