import { requireStripe } from './stripe';
import { db } from './db';
import { orgSubscriptions, creditPacks } from './schema';
import { eq } from 'drizzle-orm';

export async function getOrCreateStripeCustomer(
  orgId: string,
  orgName: string,
  email: string
): Promise<string> {
  const stripe = requireStripe();

  // Check if we already have a Stripe customer for this org
  const [sub] = await db
    .select({ stripeCustomerId: orgSubscriptions.stripeCustomerId })
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.clerkOrgId, orgId))
    .limit(1);

  if (sub?.stripeCustomerId) {
    return sub.stripeCustomerId;
  }

  // Create a new Stripe customer
  const customer = await stripe.customers.create({
    name: orgName,
    email,
    metadata: { clerkOrgId: orgId },
  });

  return customer.id;
}

export async function createSubscriptionCheckout(
  orgId: string,
  stripePriceId: string,
  stripeCustomerId: string,
  returnUrl: string,
  quantity: number = 1
): Promise<string> {
  const stripe = requireStripe();

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: stripePriceId, quantity }],
    success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnUrl,
    metadata: { clerkOrgId: orgId, type: 'subscription' },
    subscription_data: {
      metadata: { clerkOrgId: orgId },
    },
  });

  return session.url!;
}

export async function createCreditPackCheckout(
  orgId: string,
  packId: string,
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const stripe = requireStripe();

  const [pack] = await db
    .select()
    .from(creditPacks)
    .where(eq(creditPacks.id, packId))
    .limit(1);

  if (!pack || !pack.stripePriceId) {
    throw new Error('Credit pack not found or not configured');
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnUrl,
    metadata: {
      clerkOrgId: orgId,
      type: 'credit_pack',
      packId: pack.id,
      credits: String(pack.credits),
    },
  });

  return session.url!;
}

export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const stripe = requireStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
