import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orgSubscriptions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireStripe } from '@/lib/stripe';
import { isAdmin } from '@/lib/permissions';

export async function GET() {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const stripe = requireStripe();

    const [sub] = await db
      .select({ stripeCustomerId: orgSubscriptions.stripeCustomerId })
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.clerkOrgId, orgId))
      .limit(1);

    if (!sub?.stripeCustomerId) {
      return NextResponse.json({ data: [] });
    }

    const invoices = await stripe.invoices.list({
      customer: sub.stripeCustomerId,
      limit: 24,
    });

    const data = invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      created: new Date(inv.created * 1000).toISOString(),
      periodStart: new Date((inv.period_start ?? inv.created) * 1000).toISOString(),
      periodEnd: new Date((inv.period_end ?? inv.created) * 1000).toISOString(),
      pdfUrl: inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[Billing/Invoices] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}
