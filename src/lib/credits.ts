import { db } from './db';
import { pool } from './db';
import {
  creditBalances,
  creditTransactions,
  creditActionCosts,
  orgSubscriptions,
  creditTiers,
} from './schema';
import { eq } from 'drizzle-orm';
import { cacheGet, cacheSet, cacheDelete } from './redis';

// ============================================================================
// Types
// ============================================================================

export interface OrgBalance {
  currentBalance: number;
  rolloverBalance: number;
  purchasedBalance: number;
  totalAvailable: number;
  rolloverCap: number;
}

export class InsufficientCreditsError extends Error {
  required: number;
  available: number;

  constructor(required: number, available: number) {
    super(`Insufficient credits: required ${required}, available ${available}`);
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.available = available;
  }
}

// ============================================================================
// Action cost cache (in-memory, 5min TTL)
// ============================================================================

let actionCostCache: Map<string, number> | null = null;
let actionCostCacheAt = 0;
const ACTION_COST_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function loadActionCosts(): Promise<Map<string, number>> {
  if (actionCostCache && Date.now() - actionCostCacheAt < ACTION_COST_CACHE_TTL) {
    return actionCostCache;
  }

  const rows = await db
    .select({ action: creditActionCosts.action, creditCost: creditActionCosts.creditCost })
    .from(creditActionCosts)
    .where(eq(creditActionCosts.isActive, true));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.action, row.creditCost);
  }

  actionCostCache = map;
  actionCostCacheAt = Date.now();
  return map;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get cost for a given action. Returns 0 if action not found (free action).
 */
export async function getActionCost(action: string): Promise<number> {
  const costs = await loadActionCosts();
  return costs.get(action) ?? 0;
}

/**
 * Get org balance breakdown. Cached in Redis for 60s.
 */
export async function getOrgBalance(orgId: string): Promise<OrgBalance> {
  const cacheKey = `credit-balance:${orgId}`;
  const cached = await cacheGet<OrgBalance>(cacheKey);
  if (cached) return cached;

  const [row] = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.clerkOrgId, orgId))
    .limit(1);

  const balance: OrgBalance = row
    ? {
        currentBalance: row.currentBalance,
        rolloverBalance: row.rolloverBalance,
        purchasedBalance: row.purchasedBalance,
        totalAvailable: row.currentBalance + row.rolloverBalance + row.purchasedBalance,
        rolloverCap: row.rolloverCap,
      }
    : { currentBalance: 0, rolloverBalance: 0, purchasedBalance: 0, totalAvailable: 0, rolloverCap: 0 };

  await cacheSet(cacheKey, balance, 60);
  return balance;
}

/**
 * Quick check if org has enough credits for a given amount.
 */
export async function hasCredits(orgId: string, amount: number): Promise<boolean> {
  const balance = await getOrgBalance(orgId);
  return balance.totalAvailable >= amount;
}

/**
 * Atomic credit deduction using PostgreSQL SELECT ... FOR UPDATE.
 * Deduction priority: current → rollover → purchased.
 * Returns the new total balance after deduction.
 */
export async function deductCredits(
  orgId: string,
  action: string,
  entityType: string | null,
  entityId: string | null,
  userId: string | null
): Promise<number> {
  const cost = await getActionCost(action);
  if (cost === 0) return 0; // free action

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the balance row
    const { rows } = await client.query(
      `SELECT id, current_balance, rollover_balance, purchased_balance
       FROM credit_balances
       WHERE clerk_org_id = $1
       FOR UPDATE`,
      [orgId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      throw new InsufficientCreditsError(cost, 0);
    }

    const row = rows[0];
    let current = row.current_balance as number;
    let rollover = row.rollover_balance as number;
    let purchased = row.purchased_balance as number;
    const total = current + rollover + purchased;

    if (total < cost) {
      await client.query('ROLLBACK');
      throw new InsufficientCreditsError(cost, total);
    }

    // Deduct from pools in priority order
    let remaining = cost;
    const deductions: { pool: string; amount: number }[] = [];

    if (remaining > 0 && current > 0) {
      const deduct = Math.min(remaining, current);
      current -= deduct;
      remaining -= deduct;
      deductions.push({ pool: 'current', amount: deduct });
    }
    if (remaining > 0 && rollover > 0) {
      const deduct = Math.min(remaining, rollover);
      rollover -= deduct;
      remaining -= deduct;
      deductions.push({ pool: 'rollover', amount: deduct });
    }
    if (remaining > 0 && purchased > 0) {
      const deduct = Math.min(remaining, purchased);
      purchased -= deduct;
      remaining -= deduct;
      deductions.push({ pool: 'purchased', amount: deduct });
    }

    const newTotal = current + rollover + purchased;

    // Update balance
    await client.query(
      `UPDATE credit_balances
       SET current_balance = $1, rollover_balance = $2, purchased_balance = $3, updated_at = NOW()
       WHERE clerk_org_id = $4`,
      [current, rollover, purchased, orgId]
    );

    // Log transaction(s)
    for (const d of deductions) {
      await client.query(
        `INSERT INTO credit_transactions
         (clerk_org_id, type, action, amount, balance_after, pool, entity_type, entity_id, user_id, description)
         VALUES ($1, 'debit', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [orgId, action, -d.amount, newTotal, d.pool, entityType, entityId, userId, `${action} deduction`]
      );
    }

    await client.query('COMMIT');

    // Invalidate cache
    await cacheDelete(`credit-balance:${orgId}`);

    return newTotal;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Add credits to a specific pool.
 */
export async function addCredits(
  orgId: string,
  amount: number,
  source: 'allocation' | 'purchase' | 'rollover' | 'adjustment',
  metadata?: { userId?: string; description?: string; packId?: string }
): Promise<void> {
  const pool_ = source === 'purchase' ? 'purchased' : source === 'rollover' ? 'rollover' : 'current';

  // Upsert balance row
  const [existing] = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.clerkOrgId, orgId))
    .limit(1);

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (pool_ === 'current') updates.currentBalance = existing.currentBalance + amount;
    else if (pool_ === 'rollover') updates.rolloverBalance = existing.rolloverBalance + amount;
    else updates.purchasedBalance = existing.purchasedBalance + amount;

    if (source === 'allocation') updates.lastAllocationAt = new Date();

    await db.update(creditBalances).set(updates).where(eq(creditBalances.clerkOrgId, orgId));
  } else {
    const values: Record<string, unknown> = {
      clerkOrgId: orgId,
      currentBalance: 0,
      rolloverBalance: 0,
      purchasedBalance: 0,
      rolloverCap: 0,
    };
    if (pool_ === 'current') values.currentBalance = amount;
    else if (pool_ === 'rollover') values.rolloverBalance = amount;
    else values.purchasedBalance = amount;

    if (source === 'allocation') values.lastAllocationAt = new Date();

    await db.insert(creditBalances).values(values as typeof creditBalances.$inferInsert);
  }

  // Recalculate total for transaction log
  const [updated] = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.clerkOrgId, orgId))
    .limit(1);

  const balanceAfter = updated
    ? updated.currentBalance + updated.rolloverBalance + updated.purchasedBalance
    : amount;

  // Log transaction
  await db.insert(creditTransactions).values({
    clerkOrgId: orgId,
    type: source === 'purchase' ? 'credit' : source,
    action: null,
    amount,
    balanceAfter,
    pool: pool_,
    userId: metadata?.userId ?? null,
    description: metadata?.description ?? `${source} of ${amount} credits`,
    metadata: metadata ? { packId: metadata.packId } : null,
  });

  await cacheDelete(`credit-balance:${orgId}`);
}

/**
 * Process monthly rollover for an org.
 * - Unused current credits roll over (up to cap)
 * - currentBalance resets to monthly allocation
 * - Expired credits beyond cap are logged
 */
export async function processMonthlyRollover(orgId: string): Promise<void> {
  const [sub] = await db
    .select({
      tierId: orgSubscriptions.tierId,
      currentPeriodStart: orgSubscriptions.currentPeriodStart,
    })
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.clerkOrgId, orgId))
    .limit(1);

  if (!sub) return;

  const [tier] = await db
    .select()
    .from(creditTiers)
    .where(eq(creditTiers.id, sub.tierId))
    .limit(1);

  if (!tier) return;

  const [balance] = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.clerkOrgId, orgId))
    .limit(1);

  if (!balance) {
    // First allocation — just set current balance
    await addCredits(orgId, tier.monthlyCredits, 'allocation', {
      description: 'Initial credit allocation',
    });
    await db
      .update(creditBalances)
      .set({ rolloverCap: tier.rolloverCap })
      .where(eq(creditBalances.clerkOrgId, orgId));
    return;
  }

  // Calculate rollover
  const unusedCurrent = balance.currentBalance;
  const newRollover = Math.min(unusedCurrent + balance.rolloverBalance, tier.rolloverCap);
  const expired = (unusedCurrent + balance.rolloverBalance) - newRollover;

  // Update balances
  await db
    .update(creditBalances)
    .set({
      currentBalance: tier.monthlyCredits,
      rolloverBalance: newRollover,
      rolloverCap: tier.rolloverCap,
      lastAllocationAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(creditBalances.clerkOrgId, orgId));

  const newTotal = tier.monthlyCredits + newRollover + balance.purchasedBalance;

  // Log allocation
  await db.insert(creditTransactions).values({
    clerkOrgId: orgId,
    type: 'allocation',
    amount: tier.monthlyCredits,
    balanceAfter: newTotal,
    pool: 'current',
    description: `Monthly allocation of ${tier.monthlyCredits} credits`,
  });

  // Log rollover
  if (newRollover > 0) {
    await db.insert(creditTransactions).values({
      clerkOrgId: orgId,
      type: 'rollover',
      amount: newRollover,
      balanceAfter: newTotal,
      pool: 'rollover',
      description: `Rolled over ${newRollover} credits (cap: ${tier.rolloverCap})`,
    });
  }

  // Log expired credits
  if (expired > 0) {
    await db.insert(creditTransactions).values({
      clerkOrgId: orgId,
      type: 'expired',
      amount: -expired,
      balanceAfter: newTotal,
      pool: 'rollover',
      description: `${expired} credits expired (exceeded rollover cap)`,
    });
  }

  await cacheDelete(`credit-balance:${orgId}`);
}
