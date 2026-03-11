import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { creditTiers } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { isAdmin } from '@/lib/permissions';
import { getOrCreateStripeCustomer, createSubscriptionCheckout } from '@/lib/stripe-helpers';

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Forbidden — admin:billing required' }, { status: 403 });
    }

    const { tierId, returnUrl, orgName, email } = await request.json();

    if (!tierId || !returnUrl) {
      return NextResponse.json({ error: 'tierId and returnUrl are required' }, { status: 400 });
    }

    const [tier] = await db.select().from(creditTiers).where(eq(creditTiers.id, tierId)).limit(1);
    if (!tier || !tier.stripePriceId) {
      return NextResponse.json({ error: 'Tier not found or not configured' }, { status: 404 });
    }

    const stripeCustomerId = await getOrCreateStripeCustomer(orgId, orgName ?? orgId, email ?? '');
    const checkoutUrl = await createSubscriptionCheckout(orgId, tier.stripePriceId, stripeCustomerId, returnUrl, tier.seatsIncluded);

    return NextResponse.json({ success: true, data: { url: checkoutUrl } });
  } catch (error) {
    console.error('[Billing] Subscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
