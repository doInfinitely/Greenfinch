import { db } from './db';
import { orgSubscriptions, creditTiers } from './schema';
import { eq } from 'drizzle-orm';
import { requireStripe } from './stripe';
import { clerkClient } from '@clerk/nextjs/server';

export class SeatLimitExceededError extends Error {
  constructor(
    public readonly currentSeats: number,
    public readonly maxSeats: number
  ) {
    super(`Seat limit exceeded: ${currentSeats}/${maxSeats} seats used`);
    this.name = 'SeatLimitExceededError';
  }
}

export interface SeatInfo {
  seatCount: number;
  seatsIncluded: number;
  perSeatPriceUsd: number;
  maxSeats: number | null;
  activeMemberCount: number;
  pendingInvitations: number;
  totalUsed: number;
  available: number;
}

export async function getOrgSeatInfo(orgId: string): Promise<SeatInfo> {
  const [sub] = await db
    .select({
      seatCount: orgSubscriptions.seatCount,
      seatsIncluded: creditTiers.seatsIncluded,
      perSeatPriceUsd: creditTiers.perSeatPriceUsd,
      tierMaxSeats: creditTiers.maxSeats,
    })
    .from(orgSubscriptions)
    .innerJoin(creditTiers, eq(orgSubscriptions.tierId, creditTiers.id))
    .where(eq(orgSubscriptions.clerkOrgId, orgId))
    .limit(1);

  const maxSeats = sub?.seatCount ?? sub?.seatsIncluded ?? 1;

  const client = await clerkClient();
  const members = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 500,
  });
  const activeMemberCount = members.data.length;

  const invitations = await client.organizations.getOrganizationInvitationList({
    organizationId: orgId,
    limit: 100,
  });
  const pendingInvitations = invitations.data.filter(i => i.status === 'pending').length;

  const totalUsed = activeMemberCount + pendingInvitations;

  return {
    seatCount: maxSeats,
    seatsIncluded: sub?.seatsIncluded ?? 1,
    perSeatPriceUsd: sub?.perSeatPriceUsd ?? 0,
    maxSeats: sub?.tierMaxSeats ?? null,
    activeMemberCount,
    pendingInvitations,
    totalUsed,
    available: Math.max(0, maxSeats - totalUsed),
  };
}

export async function requireSeatAvailable(orgId: string): Promise<void> {
  const info = await getOrgSeatInfo(orgId);
  if (info.totalUsed >= info.seatCount) {
    throw new SeatLimitExceededError(info.totalUsed, info.seatCount);
  }
}

export async function updateSeatCount(orgId: string, newCount: number): Promise<void> {
  const stripe = requireStripe();

  const [sub] = await db
    .select({
      id: orgSubscriptions.id,
      clerkOrgId: orgSubscriptions.clerkOrgId,
      stripeSubscriptionId: orgSubscriptions.stripeSubscriptionId,
      stripeCustomerId: orgSubscriptions.stripeCustomerId,
      status: orgSubscriptions.status,
      seatCount: orgSubscriptions.seatCount,
      tierId: orgSubscriptions.tierId,
      seatsIncluded: creditTiers.seatsIncluded,
      maxSeats: creditTiers.maxSeats,
    })
    .from(orgSubscriptions)
    .innerJoin(creditTiers, eq(orgSubscriptions.tierId, creditTiers.id))
    .where(eq(orgSubscriptions.clerkOrgId, orgId))
    .limit(1);

  if (!sub?.stripeSubscriptionId) {
    throw new Error('No active subscription found');
  }

  if (sub.status !== 'active') {
    throw new Error('Subscription must be active to change seats');
  }

  if (newCount < sub.seatsIncluded) {
    throw new Error(`Cannot go below ${sub.seatsIncluded} seats (included in plan)`);
  }

  if (sub.maxSeats !== null && newCount > sub.maxSeats) {
    throw new Error(`Cannot exceed ${sub.maxSeats} seats on this plan`);
  }

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new Error('No subscription item found');

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: itemId, quantity: newCount }],
    proration_behavior: 'create_prorations',
  });

  await db
    .update(orgSubscriptions)
    .set({ seatCount: newCount, updatedAt: new Date() })
    .where(eq(orgSubscriptions.clerkOrgId, orgId));
}

export async function previewSeatChange(
  orgId: string,
  newCount: number
): Promise<{ amountDue: number; currency: string; prorationDate: number }> {
  const stripe = requireStripe();

  const [sub] = await db
    .select()
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.clerkOrgId, orgId))
    .limit(1);

  if (!sub?.stripeSubscriptionId || !sub.stripeCustomerId) {
    throw new Error('No active subscription found');
  }

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new Error('No subscription item found');

  const prorationDate = Math.floor(Date.now() / 1000);
  const preview = await stripe.invoices.createPreview({
    customer: sub.stripeCustomerId,
    subscription: sub.stripeSubscriptionId,
    subscription_details: {
      items: [{ id: itemId, quantity: newCount }],
      proration_date: prorationDate,
    },
  });

  return {
    amountDue: preview.amount_due,
    currency: preview.currency,
    prorationDate,
  };
}
