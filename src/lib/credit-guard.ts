import { auth } from '@clerk/nextjs/server';
import { INTERNAL_ORG_SLUG } from './permissions';
import { getActionCost, deductCredits, getOrgBalance, InsufficientCreditsError } from './credits';

/**
 * Enforce credit check and deduction for an API action.
 * Call at the top of credit-consuming API routes (after auth).
 *
 * - Skips deduction for internal org (greenfinch)
 * - Throws InsufficientCreditsError (caught by route to return 402)
 */
export async function requireCredits(
  action: string,
  entityType?: string,
  entityId?: string
): Promise<void> {
  const { orgId, orgSlug, userId } = await auth();

  if (!orgId) {
    throw new Error('UNAUTHORIZED');
  }

  // Internal org bypasses credit checks
  if (orgSlug === INTERNAL_ORG_SLUG) {
    return;
  }

  const cost = await getActionCost(action);
  if (cost === 0) return;

  // Quick balance check before attempting atomic deduction
  const balance = await getOrgBalance(orgId);
  if (balance.totalAvailable < cost) {
    throw new InsufficientCreditsError(cost, balance.totalAvailable);
  }

  await deductCredits(orgId, action, entityType ?? null, entityId ?? null, userId);
}
