import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orgSubscriptions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { isAdmin } from '@/lib/permissions';
import { createBillingPortalSession } from '@/lib/stripe-helpers';

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Forbidden — admin:billing required' }, { status: 403 });
    }

    const { returnUrl } = await request.json();
    if (!returnUrl) {
      return NextResponse.json({ error: 'returnUrl is required' }, { status: 400 });
    }

    const [sub] = await db
      .select({ stripeCustomerId: orgSubscriptions.stripeCustomerId })
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (!sub?.stripeCustomerId) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
    }

    const portalUrl = await createBillingPortalSession(sub.stripeCustomerId, returnUrl);
    return NextResponse.json({ success: true, data: { url: portalUrl } });
  } catch (error) {
    console.error('[Billing] Portal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
