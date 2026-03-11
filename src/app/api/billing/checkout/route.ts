import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/permissions';
import { getOrCreateStripeCustomer, createCreditPackCheckout } from '@/lib/stripe-helpers';

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Forbidden — admin:billing required' }, { status: 403 });
    }

    const { packId, returnUrl } = await request.json();

    if (!packId || !returnUrl) {
      return NextResponse.json({ error: 'packId and returnUrl are required' }, { status: 400 });
    }

    const stripeCustomerId = await getOrCreateStripeCustomer(orgId, orgId, '');
    const checkoutUrl = await createCreditPackCheckout(orgId, packId, stripeCustomerId, returnUrl);

    return NextResponse.json({ success: true, data: { url: checkoutUrl } });
  } catch (error) {
    console.error('[Billing] Checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
