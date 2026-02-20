import { db } from '@/lib/db';
import { enrichmentCostEvents } from '@/lib/schema';
import type { EnrichmentProvider } from '@/lib/schema';

const COST_PER_CREDIT: Record<EnrichmentProvider, number> = {
  pdl: 0.03,
  apollo: 0.01,
  hunter: 0.01,
  findymail: 0.05,
  crustdata: 0.05,
  zerobounce: 0.008,
  gemini: 0.005,
  mapbox: 0.005,
  serp: 0.01,
  leadmagic: 0.03,
  enrichlayer: 0.02,
};

interface TrackCostParams {
  provider: EnrichmentProvider;
  endpoint: string;
  credits?: number;
  entityType?: string;
  entityId?: string;
  triggeredBy?: string;
  clerkOrgId?: string;
  statusCode?: number;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export async function trackEnrichmentCost(params: TrackCostParams): Promise<void> {
  const credits = params.credits ?? 1;
  const costPerCredit = COST_PER_CREDIT[params.provider] ?? 0.01;
  const estimatedCostUsd = credits * costPerCredit;

  try {
    await db.insert(enrichmentCostEvents).values({
      provider: params.provider,
      endpoint: params.endpoint,
      creditsUsed: credits,
      estimatedCostUsd,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      triggeredBy: params.triggeredBy ?? null,
      clerkOrgId: params.clerkOrgId ?? null,
      statusCode: params.statusCode ?? null,
      success: params.success ?? true,
      errorMessage: params.errorMessage ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (error) {
    console.error('[CostTracker] Failed to log enrichment cost:', error);
  }
}

export function trackCostFireAndForget(params: TrackCostParams): void {
  trackEnrichmentCost(params).catch(() => {});
}
