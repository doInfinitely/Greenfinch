// ============================================================================
// LLM Adapter — Gemini (Vertex AI)
//
// Wraps the existing streamGeminiResponse / client.ts infrastructure behind
// the provider-agnostic LLMProviderAdapter interface.  Gemini uses native
// Google Search grounding rather than SerpAPI.
// ============================================================================

import type { LLMProviderAdapter, LLMCallOptions, LLMResponse, LLMTokenUsage } from './types';
import { getGeminiClient, streamGeminiResponse, callGeminiOnce, withTimeout } from '../client';
import { getSearchGroundingTools, computeGeminiCostUsd } from '../config';
import { extractGroundedSources, extractGroundingQuality } from '../parsers';
import type { StageKey } from '../runtime-config';
import { GEMINI_MODEL } from '../../constants';

/** Map stage names to StageKey for search grounding config lookup. */
function stageNameToKey(stageName: string): StageKey | null {
  const map: Record<string, StageKey> = {
    'stage1-classify': 'stage1_classify',
    'stage2-ownership': 'stage2_ownership',
    'stage3-contacts': 'stage3_contacts',
    'summary-cleanup': 'summary_cleanup',
    'replacement-search': 'replacement_search',
    'stage2-retry-property-website': 'domain_retry',
    'stage2-retry-company-domain': 'domain_retry',
    'domain-retry': 'domain_retry',
  };
  return map[stageName] || null;
}

export class GeminiAdapter implements LLMProviderAdapter {
  readonly provider = 'gemini' as const;

  async call(prompt: string, options: LLMCallOptions): Promise<LLMResponse> {
    const client = getGeminiClient();
    const model = options.model || GEMINI_MODEL;

    // Determine search grounding tools
    let tools: any[] | undefined;
    if (options.searchGrounding !== false) {
      const stageKey = stageNameToKey(options.stageName);
      if (stageKey) {
        tools = getSearchGroundingTools(stageKey);
      } else if (options.searchGrounding === true) {
        tools = [{ googleSearch: {} }];
      }
    }

    const timeoutMs = options.timeoutMs || 120_000;

    const response = await withTimeout(
      callGeminiOnce(() =>
        streamGeminiResponse(client, prompt, {
          tools,
          temperature: options.temperature,
          thinkingLevel: options.thinkingLevel,
          latLng: options.latLng,
          stageName: options.stageName,
          model,
        })
      ),
      timeoutMs,
      options.stageName
    );

    // Convert Gemini-specific response to provider-agnostic LLMResponse
    const text = response.text?.trim() || '';
    const sources = extractGroundedSources(response);
    const groundingQuality = extractGroundingQuality(response);

    const geminiUsage = response.tokenUsage;
    const costUsd = computeGeminiCostUsd(geminiUsage);

    const tokenUsage: LLMTokenUsage = {
      inputTokens: geminiUsage?.promptTokens ?? 0,
      outputTokens: geminiUsage?.responseTokens ?? 0,
      thinkingTokens: geminiUsage?.thinkingTokens ?? 0,
      totalTokens: geminiUsage?.totalTokens ?? 0,
      costUsd,
      groundingCostUsd: geminiUsage?.searchGroundingCostUsd ?? 0,
      groundingQueriesUsed: geminiUsage?.searchGroundingQueryCount ?? 0,
    };

    return {
      text,
      tokenUsage,
      groundingSources: sources,
      finishReason: response.finishReason,
      // Pass raw response for downstream grounding quality extraction
      raw: {
        candidates: response.candidates,
        tokenUsage: geminiUsage,
        groundingQuality,
      },
    };
  }
}
