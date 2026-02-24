import { db } from '@/lib/db';
import { enrichmentCostEvents } from '@/lib/schema';
import type { EnrichmentProvider } from '@/lib/schema';
import type { GeminiTokenUsage } from '@/lib/ai/types';
import { computeGeminiCostUsd } from '@/lib/ai/config';

const COST_PER_CREDIT: Record<EnrichmentProvider, number> = {
  pdl: 0.035,
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

export const PDL_COST = {
  COMPANY_ENRICH_SUCCESS: 0.035,
  PERSON_ENRICH_SUCCESS: 0.07,
} as const;

let lastCostTrackerError = 0;

interface TrackCostParams {
  provider: EnrichmentProvider;
  endpoint: string;
  credits?: number;
  costOverrideUsd?: number;
  tokenUsage?: GeminiTokenUsage;
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

  let estimatedCostUsd: number;
  if (params.costOverrideUsd !== undefined) {
    estimatedCostUsd = params.costOverrideUsd;
  } else if (params.provider === 'gemini' && params.tokenUsage) {
    estimatedCostUsd = computeGeminiCostUsd(params.tokenUsage);
  } else {
    const costPerCredit = COST_PER_CREDIT[params.provider] ?? 0.01;
    estimatedCostUsd = credits * costPerCredit;
  }

  try {
    await db.insert(enrichmentCostEvents).values({
      provider: params.provider,
      endpoint: params.endpoint,
      creditsUsed: credits,
      estimatedCostUsd,
      inputTokens: params.tokenUsage?.promptTokens ?? null,
      outputTokens: params.tokenUsage?.responseTokens ?? null,
      thinkingTokens: params.tokenUsage?.thinkingTokens ?? null,
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
    if (Date.now() - lastCostTrackerError > 60000) {
      console.error('[CostTracker] Failed to log enrichment cost:', error);
      lastCostTrackerError = Date.now();
    }
  }
}

export function trackCostFireAndForget(params: TrackCostParams): void {
  trackEnrichmentCost(params).catch(() => {});
}
