import { db } from '@/lib/db';
import {
  propertyViews,
  propertyContacts,
  propertyActivity,
  propertyPipeline,
  pipelineStageHistory,
  enrichmentCostEvents,
  users,
} from '@/lib/schema';
import { eq, sql, and, gte, inArray } from 'drizzle-orm';

// --- Types ---

export interface WeeklyTrend {
  week: string; // ISO date string for week start
  pipelineCreated: number;
  dealsWon: number;
  wonValue: number;
}

export interface UserBreakdown {
  userId: string;
  userName: string;
  email: string | null;
  propertiesViewed: number;
  contactsDiscovered: number;
  pipelineCreated: number;
  dealsWon: number;
  creditsUsed: number;
}

export interface MetricsData {
  propertiesViewed: number;
  contactsDiscovered: number;
  activeUsers: number;
  pipelineCreated: number;
  stageTransitions: number;
  dealsWon: number;
  dealsWonValue: number;
  dealsLost: number;
  creditsUsed: number;
  enrichmentSpend: number;
  avgDaysToWon: number | null;
  weeklyTrends: WeeklyTrend[];
  userBreakdown?: UserBreakdown[];
}

export interface OrgBreakdown {
  orgId: string;
  orgName: string;
  activeUsers: number;
  propertiesViewed: number;
  pipelineCreated: number;
  dealsWon: number;
  enrichmentSpend: number;
}

export interface CrossOrgMetricsData {
  totalOrgs: number;
  activeUsers: number;
  propertiesViewed: number;
  contactsDiscovered: number;
  pipelineCreated: number;
  stageTransitions: number;
  dealsWon: number;
  dealsWonValue: number;
  dealsLost: number;
  creditsUsed: number;
  enrichmentSpend: number;
  avgDaysToWon: number | null;
  weeklyTrends: WeeklyTrend[];
  orgBreakdown: OrgBreakdown[];
}

// --- Shared Helpers ---

export function getTimeframeStart(timeframe: string): Date | null {
  const now = new Date();
  switch (timeframe) {
    case 'week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter': {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), quarterMonth, 1);
    }
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    case 'all':
      return null;
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

function timeFilter(column: ReturnType<typeof sql>, start: Date | null) {
  return start ? gte(column as any, start) : undefined;
}

// --- Org-Level Metrics ---

export async function queryOrgMetrics(
  orgId: string,
  timeframe: string,
  options?: { userId?: string; includeUserBreakdown?: boolean }
): Promise<MetricsData> {
  const start = getTimeframeStart(timeframe);
  const userId = options?.userId;

  const timeCondition = (col: any) => start ? gte(col, start) : undefined;

  const orgEq = (col: any) => eq(col, orgId);
  const userEq = (col: any) => userId ? eq(col, userId) : undefined;

  const conditions = (orgCol: any, timeCol: any, userCol?: any) => {
    const parts = [eq(orgCol, orgId)];
    if (start) parts.push(gte(timeCol, start));
    if (userId && userCol) parts.push(eq(userCol, userId));
    return and(...parts);
  };

  const [
    viewsResult,
    contactsResult,
    activeUsersResult,
    pipelineResult,
    transitionsResult,
    wonResult,
    lostResult,
    creditsResult,
    avgDaysResult,
    trendCreated,
    trendWon,
  ] = await Promise.all([
    // 1. Properties Viewed
    db.select({
      count: sql<number>`COUNT(DISTINCT ${propertyViews.propertyId})`,
    })
      .from(propertyViews)
      .where(conditions(propertyViews.clerkOrgId, propertyViews.lastViewedAt, propertyViews.userId)),

    // 2. Contacts Discovered (join through propertyPipeline for org scoping)
    db.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(propertyContacts)
      .innerJoin(propertyPipeline, eq(propertyContacts.propertyId, propertyPipeline.propertyId))
      .where(and(
        eq(propertyPipeline.clerkOrgId, orgId),
        start ? gte(propertyContacts.discoveredAt, start) : undefined,
        userId ? eq(propertyPipeline.ownerId, userId) : undefined,
      )),

    // 3. Active Users
    db.select({
      count: sql<number>`COUNT(DISTINCT ${propertyActivity.userId})`,
    })
      .from(propertyActivity)
      .where(and(
        eq(propertyActivity.clerkOrgId, orgId),
        start ? gte(propertyActivity.createdAt, start) : undefined,
      )),

    // 4. Pipeline Created
    db.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(propertyPipeline)
      .where(conditions(propertyPipeline.clerkOrgId, propertyPipeline.createdAt, propertyPipeline.ownerId)),

    // 5. Stage Transitions
    db.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(pipelineStageHistory)
      .where(conditions(pipelineStageHistory.clerkOrgId, pipelineStageHistory.transitionedAt, pipelineStageHistory.userId)),

    // 6. Deals Won + Value
    db.select({
      count: sql<number>`COUNT(*)`,
      value: sql<number>`COALESCE(SUM(${propertyPipeline.dealValue}), 0)`,
    })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.status, 'won'),
        start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
        userId ? eq(propertyPipeline.ownerId, userId) : undefined,
      )),

    // 7. Deals Lost
    db.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.status, 'lost'),
        start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
        userId ? eq(propertyPipeline.ownerId, userId) : undefined,
      )),

    // 8 & 9. Credits Used + Enrichment Spend
    db.select({
      creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
      enrichmentSpend: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
    })
      .from(enrichmentCostEvents)
      .where(and(
        eq(enrichmentCostEvents.clerkOrgId, orgId),
        start ? gte(enrichmentCostEvents.createdAt, start) : undefined,
        userId ? eq(enrichmentCostEvents.triggeredBy, userId) : undefined,
      )),

    // 10. Avg Days to Won
    db.select({
      avgMs: sql<number>`AVG(total_ms)`,
    }).from(
      db.select({
        totalMs: sql<number>`SUM(${pipelineStageHistory.durationInStageMs})`.as('total_ms'),
      })
        .from(pipelineStageHistory)
        .innerJoin(propertyPipeline, eq(pipelineStageHistory.pipelineId, propertyPipeline.id))
        .where(and(
          eq(pipelineStageHistory.clerkOrgId, orgId),
          eq(propertyPipeline.status, 'won'),
          start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
          userId ? eq(propertyPipeline.ownerId, userId) : undefined,
        ))
        .groupBy(pipelineStageHistory.pipelineId)
        .as('deal_durations')
    ),

    // Weekly trend: pipeline created
    db.select({
      week: sql<string>`date_trunc('week', ${propertyPipeline.createdAt})::text`.as('week'),
      count: sql<number>`COUNT(*)`,
    })
      .from(propertyPipeline)
      .where(conditions(propertyPipeline.clerkOrgId, propertyPipeline.createdAt, propertyPipeline.ownerId))
      .groupBy(sql`date_trunc('week', ${propertyPipeline.createdAt})`)
      .orderBy(sql`date_trunc('week', ${propertyPipeline.createdAt})`),

    // Weekly trend: deals won
    db.select({
      week: sql<string>`date_trunc('week', ${propertyPipeline.statusChangedAt})::text`.as('week'),
      count: sql<number>`COUNT(*)`,
      value: sql<number>`COALESCE(SUM(${propertyPipeline.dealValue}), 0)`,
    })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.clerkOrgId, orgId),
        eq(propertyPipeline.status, 'won'),
        start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
        userId ? eq(propertyPipeline.ownerId, userId) : undefined,
      ))
      .groupBy(sql`date_trunc('week', ${propertyPipeline.statusChangedAt})`)
      .orderBy(sql`date_trunc('week', ${propertyPipeline.statusChangedAt})`),
  ]);

  // Merge weekly trends
  const weekMap = new Map<string, WeeklyTrend>();
  for (const row of trendCreated) {
    const w = row.week.split('T')[0];
    weekMap.set(w, { week: w, pipelineCreated: Number(row.count), dealsWon: 0, wonValue: 0 });
  }
  for (const row of trendWon) {
    const w = row.week.split('T')[0];
    const existing = weekMap.get(w) || { week: w, pipelineCreated: 0, dealsWon: 0, wonValue: 0 };
    existing.dealsWon = Number(row.count);
    existing.wonValue = Number(row.value);
    weekMap.set(w, existing);
  }
  const weeklyTrends = Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week));

  const avgMs = avgDaysResult[0]?.avgMs;
  const avgDaysToWon = avgMs ? Number(avgMs) / (1000 * 60 * 60 * 24) : null;

  const result: MetricsData = {
    propertiesViewed: Number(viewsResult[0]?.count) || 0,
    contactsDiscovered: Number(contactsResult[0]?.count) || 0,
    activeUsers: Number(activeUsersResult[0]?.count) || 0,
    pipelineCreated: Number(pipelineResult[0]?.count) || 0,
    stageTransitions: Number(transitionsResult[0]?.count) || 0,
    dealsWon: Number(wonResult[0]?.count) || 0,
    dealsWonValue: Number(wonResult[0]?.value) || 0,
    dealsLost: Number(lostResult[0]?.count) || 0,
    creditsUsed: Number(creditsResult[0]?.creditsUsed) || 0,
    enrichmentSpend: Number(creditsResult[0]?.enrichmentSpend) || 0,
    avgDaysToWon: avgDaysToWon ? Math.round(avgDaysToWon * 10) / 10 : null,
    weeklyTrends,
  };

  // User breakdown for org view
  if (options?.includeUserBreakdown) {
    result.userBreakdown = await queryUserBreakdown(orgId, start);
  }

  return result;
}

async function queryUserBreakdown(orgId: string, start: Date | null): Promise<UserBreakdown[]> {
  const timeFilter = (col: any) => start ? gte(col, start) : undefined;

  const [viewsByUser, pipelineByUser, creditsByUser] = await Promise.all([
    // Properties viewed per user
    db.select({
      userId: propertyViews.userId,
      count: sql<number>`COUNT(DISTINCT ${propertyViews.propertyId})`,
    })
      .from(propertyViews)
      .where(and(eq(propertyViews.clerkOrgId, orgId), timeFilter(propertyViews.lastViewedAt)))
      .groupBy(propertyViews.userId),

    // Pipeline + won per user
    db.select({
      userId: propertyPipeline.ownerId,
      pipelineCreated: sql<number>`COUNT(*)`,
      dealsWon: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'won' THEN 1 END)`,
    })
      .from(propertyPipeline)
      .where(and(eq(propertyPipeline.clerkOrgId, orgId), timeFilter(propertyPipeline.createdAt)))
      .groupBy(propertyPipeline.ownerId),

    // Credits per user
    db.select({
      userId: enrichmentCostEvents.triggeredBy,
      credits: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
    })
      .from(enrichmentCostEvents)
      .where(and(eq(enrichmentCostEvents.clerkOrgId, orgId), timeFilter(enrichmentCostEvents.createdAt)))
      .groupBy(enrichmentCostEvents.triggeredBy),
  ]);

  // Collect all user IDs
  const allUserIds = new Set<string>();
  viewsByUser.forEach(r => { if (r.userId) allUserIds.add(r.userId); });
  pipelineByUser.forEach(r => { if (r.userId) allUserIds.add(r.userId); });
  creditsByUser.forEach(r => { if (r.userId) allUserIds.add(r.userId); });

  if (allUserIds.size === 0) return [];

  // Fetch user names
  const userRecords = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users)
    .where(inArray(users.id, Array.from(allUserIds)));

  const userMap = new Map(userRecords.map(u => [u.id, u]));
  const viewsMap = new Map(viewsByUser.map(r => [r.userId, Number(r.count)]));
  const pipelineMap = new Map(pipelineByUser.map(r => [r.userId, r]));
  const creditsMap = new Map(creditsByUser.map(r => [r.userId, Number(r.credits)]));

  return Array.from(allUserIds).map(uid => {
    const user = userMap.get(uid);
    const pipeline = pipelineMap.get(uid);
    return {
      userId: uid,
      userName: user
        ? (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email || 'Unknown')
        : 'Unknown',
      email: user?.email || null,
      propertiesViewed: viewsMap.get(uid) || 0,
      contactsDiscovered: 0, // contacts table doesn't track user
      pipelineCreated: Number(pipeline?.pipelineCreated) || 0,
      dealsWon: Number(pipeline?.dealsWon) || 0,
      creditsUsed: creditsMap.get(uid) || 0,
    };
  });
}

// --- Cross-Org Metrics ---

export async function queryCrossOrgMetrics(
  timeframe: string,
  filterOrgId?: string
): Promise<CrossOrgMetricsData> {
  const start = getTimeframeStart(timeframe);

  const orgFilter = (col: any) => filterOrgId ? eq(col, filterOrgId) : undefined;
  const timeCondition = (col: any) => start ? gte(col, start) : undefined;

  const conditions = (orgCol: any, timeCol: any) => {
    const parts: any[] = [];
    if (filterOrgId) parts.push(eq(orgCol, filterOrgId));
    if (start) parts.push(gte(timeCol, start));
    return parts.length ? and(...parts) : undefined;
  };

  const [
    viewsResult,
    contactsResult,
    activeUsersResult,
    pipelineResult,
    transitionsResult,
    wonResult,
    lostResult,
    creditsResult,
    avgDaysResult,
    trendCreated,
    trendWon,
    orgBreakdownResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`COUNT(DISTINCT ${propertyViews.propertyId})` })
      .from(propertyViews)
      .where(and(orgFilter(propertyViews.clerkOrgId), timeCondition(propertyViews.lastViewedAt))),

    db.select({ count: sql<number>`COUNT(*)` })
      .from(propertyContacts)
      .innerJoin(propertyPipeline, eq(propertyContacts.propertyId, propertyPipeline.propertyId))
      .where(and(
        orgFilter(propertyPipeline.clerkOrgId),
        start ? gte(propertyContacts.discoveredAt, start) : undefined,
      )),

    db.select({ count: sql<number>`COUNT(DISTINCT ${propertyActivity.userId})` })
      .from(propertyActivity)
      .where(conditions(propertyActivity.clerkOrgId, propertyActivity.createdAt)),

    db.select({ count: sql<number>`COUNT(*)` })
      .from(propertyPipeline)
      .where(conditions(propertyPipeline.clerkOrgId, propertyPipeline.createdAt)),

    db.select({ count: sql<number>`COUNT(*)` })
      .from(pipelineStageHistory)
      .where(conditions(pipelineStageHistory.clerkOrgId, pipelineStageHistory.transitionedAt)),

    db.select({
      count: sql<number>`COUNT(*)`,
      value: sql<number>`COALESCE(SUM(${propertyPipeline.dealValue}), 0)`,
    })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.status, 'won'),
        orgFilter(propertyPipeline.clerkOrgId),
        start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
      )),

    db.select({ count: sql<number>`COUNT(*)` })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.status, 'lost'),
        orgFilter(propertyPipeline.clerkOrgId),
        start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
      )),

    db.select({
      creditsUsed: sql<number>`COALESCE(SUM(${enrichmentCostEvents.creditsUsed}), 0)`,
      enrichmentSpend: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
    })
      .from(enrichmentCostEvents)
      .where(conditions(enrichmentCostEvents.clerkOrgId, enrichmentCostEvents.createdAt)),

    db.select({ avgMs: sql<number>`AVG(total_ms)` }).from(
      db.select({
        totalMs: sql<number>`SUM(${pipelineStageHistory.durationInStageMs})`.as('total_ms'),
      })
        .from(pipelineStageHistory)
        .innerJoin(propertyPipeline, eq(pipelineStageHistory.pipelineId, propertyPipeline.id))
        .where(and(
          eq(propertyPipeline.status, 'won'),
          orgFilter(pipelineStageHistory.clerkOrgId),
          start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
        ))
        .groupBy(pipelineStageHistory.pipelineId)
        .as('deal_durations')
    ),

    db.select({
      week: sql<string>`date_trunc('week', ${propertyPipeline.createdAt})::text`.as('week'),
      count: sql<number>`COUNT(*)`,
    })
      .from(propertyPipeline)
      .where(conditions(propertyPipeline.clerkOrgId, propertyPipeline.createdAt))
      .groupBy(sql`date_trunc('week', ${propertyPipeline.createdAt})`)
      .orderBy(sql`date_trunc('week', ${propertyPipeline.createdAt})`),

    db.select({
      week: sql<string>`date_trunc('week', ${propertyPipeline.statusChangedAt})::text`.as('week'),
      count: sql<number>`COUNT(*)`,
      value: sql<number>`COALESCE(SUM(${propertyPipeline.dealValue}), 0)`,
    })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.status, 'won'),
        orgFilter(propertyPipeline.clerkOrgId),
        start ? gte(propertyPipeline.statusChangedAt, start) : undefined,
      ))
      .groupBy(sql`date_trunc('week', ${propertyPipeline.statusChangedAt})`)
      .orderBy(sql`date_trunc('week', ${propertyPipeline.statusChangedAt})`),

    // Org breakdown
    db.select({
      orgId: propertyPipeline.clerkOrgId,
      activeUsers: sql<number>`COUNT(DISTINCT ${propertyPipeline.ownerId})`,
      pipelineCreated: sql<number>`COUNT(*)`,
      dealsWon: sql<number>`COUNT(CASE WHEN ${propertyPipeline.status} = 'won' THEN 1 END)`,
    })
      .from(propertyPipeline)
      .where(conditions(propertyPipeline.clerkOrgId, propertyPipeline.createdAt))
      .groupBy(propertyPipeline.clerkOrgId),
  ]);

  // Merge weekly trends
  const weekMap = new Map<string, WeeklyTrend>();
  for (const row of trendCreated) {
    const w = row.week.split('T')[0];
    weekMap.set(w, { week: w, pipelineCreated: Number(row.count), dealsWon: 0, wonValue: 0 });
  }
  for (const row of trendWon) {
    const w = row.week.split('T')[0];
    const existing = weekMap.get(w) || { week: w, pipelineCreated: 0, dealsWon: 0, wonValue: 0 };
    existing.dealsWon = Number(row.count);
    existing.wonValue = Number(row.value);
    weekMap.set(w, existing);
  }
  const weeklyTrends = Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week));

  // Enrich org breakdown with spend data
  const spendByOrg = await db.select({
    orgId: enrichmentCostEvents.clerkOrgId,
    spend: sql<number>`COALESCE(SUM(${enrichmentCostEvents.estimatedCostUsd}), 0)`,
  })
    .from(enrichmentCostEvents)
    .where(conditions(enrichmentCostEvents.clerkOrgId, enrichmentCostEvents.createdAt))
    .groupBy(enrichmentCostEvents.clerkOrgId);

  const spendMap = new Map(spendByOrg.map(r => [r.orgId, Number(r.spend)]));

  // Get property views per org for breakdown
  const viewsByOrg = await db.select({
    orgId: propertyViews.clerkOrgId,
    count: sql<number>`COUNT(DISTINCT ${propertyViews.propertyId})`,
  })
    .from(propertyViews)
    .where(and(orgFilter(propertyViews.clerkOrgId), timeCondition(propertyViews.lastViewedAt)))
    .groupBy(propertyViews.clerkOrgId);

  const viewsOrgMap = new Map(viewsByOrg.map(r => [r.orgId, Number(r.count)]));

  const orgBreakdown: OrgBreakdown[] = orgBreakdownResult.map(row => ({
    orgId: row.orgId,
    orgName: row.orgId, // Will be resolved by the API route via Clerk
    activeUsers: Number(row.activeUsers) || 0,
    propertiesViewed: viewsOrgMap.get(row.orgId) || 0,
    pipelineCreated: Number(row.pipelineCreated) || 0,
    dealsWon: Number(row.dealsWon) || 0,
    enrichmentSpend: spendMap.get(row.orgId) || 0,
  }));

  const avgMs = avgDaysResult[0]?.avgMs;
  const avgDaysToWon = avgMs ? Number(avgMs) / (1000 * 60 * 60 * 24) : null;

  return {
    totalOrgs: new Set(orgBreakdownResult.map(r => r.orgId)).size,
    activeUsers: Number(activeUsersResult[0]?.count) || 0,
    propertiesViewed: Number(viewsResult[0]?.count) || 0,
    contactsDiscovered: Number(contactsResult[0]?.count) || 0,
    pipelineCreated: Number(pipelineResult[0]?.count) || 0,
    stageTransitions: Number(transitionsResult[0]?.count) || 0,
    dealsWon: Number(wonResult[0]?.count) || 0,
    dealsWonValue: Number(wonResult[0]?.value) || 0,
    dealsLost: Number(lostResult[0]?.count) || 0,
    creditsUsed: Number(creditsResult[0]?.creditsUsed) || 0,
    enrichmentSpend: Number(creditsResult[0]?.enrichmentSpend) || 0,
    avgDaysToWon: avgDaysToWon ? Math.round(avgDaysToWon * 10) / 10 : null,
    weeklyTrends,
    orgBreakdown,
  };
}
