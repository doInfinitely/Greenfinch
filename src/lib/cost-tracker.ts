import { db } from '@/lib/db';
import { enrichmentCostEvents } from '@/lib/schema';
import type { EnrichmentProvider } from '@/lib/schema';
import type { GeminiTokenUsage } from '@/lib/ai/types';
import {
  computeGeminiCostUsd,
  PDL_PRICING,
  PROVIDER_PRICING,
  DEFAULT_COST_PER_CREDIT,
} from '@/lib/pricing-config';

export { PDL_PRICING as PDL_COST } from '@/lib/pricing-config';

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
    const providerKey = params.provider as keyof typeof PROVIDER_PRICING;
    const costPerCredit = PROVIDER_PRICING[providerKey] ?? DEFAULT_COST_PER_CREDIT;
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
