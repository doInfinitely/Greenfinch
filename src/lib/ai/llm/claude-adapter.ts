// ============================================================================
// LLM Adapter — Claude (Anthropic)
//
// Wraps the Anthropic SDK behind the provider-agnostic LLMProviderAdapter.
// Uses SerpAPI for web grounding (injected into prompt context).
// Supports extended thinking for Claude models.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProviderAdapter, LLMCallOptions, LLMResponse, LLMTokenUsage } from './types';
import { runSerpGrounding } from './serp-grounding';
import { rateLimiters } from '../../rate-limiter';
import { computeClaudeCostUsd } from '../../pricing-config';

let _client: Anthropic | null = null;

function getClaudeClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Map our ThinkingLevel names to Anthropic budget_tokens values. */
function thinkingBudget(level?: string): number | null {
  switch (level) {
    case 'NONE': return null;
    case 'MINIMAL': return 1024;
    case 'LOW': return 4096;
    case 'MEDIUM': return 8192;
    case 'HIGH': return 16384;
    default: return null;
  }
}

export class ClaudeAdapter implements LLMProviderAdapter {
  readonly provider = 'claude' as const;

  async call(prompt: string, options: LLMCallOptions): Promise<LLMResponse> {
    const client = getClaudeClient();
    const model = options.model || DEFAULT_MODEL;
    const timeoutMs = options.timeoutMs || 120_000;

    // Run SerpAPI grounding if search is enabled
    let groundingContext = '';
    let groundingSources: LLMResponse['groundingSources'] = [];
    let groundingCostUsd = 0;
    let groundingQueriesUsed = 0;

    if (options.searchGrounding) {
      const grounding = await runSerpGrounding(prompt, {
        searchQueries: options.searchQueries,
        latLng: options.latLng,
      });
      groundingContext = grounding.contextBlock;
      groundingSources = grounding.sources;
      groundingQueriesUsed = grounding.queriesUsed.length;
      groundingCostUsd = groundingQueriesUsed * 0.01;
    }

    const fullPrompt = groundingContext ? `${prompt}${groundingContext}` : prompt;
    const tag = options.stageName || 'unknown';
    console.log(`[Claude:${tag}] Calling ${model} (prompt length: ${fullPrompt.length}, grounding queries: ${groundingQueriesUsed})`);

    const callStart = Date.now();
    const budget = thinkingBudget(options.thinkingLevel);

    const response = await rateLimiters.claude.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const maxTokens = options.maxOutputTokens || 8192;

        if (budget) {
          // Extended thinking mode
          return await client.messages.create(
            {
              model,
              max_tokens: maxTokens + budget,
              thinking: { type: 'enabled', budget_tokens: budget },
              messages: [{ role: 'user', content: fullPrompt }],
            },
            { signal: controller.signal }
          );
        } else {
          return await client.messages.create(
            {
              model,
              max_tokens: maxTokens,
              temperature: options.temperature ?? 1.0,
              messages: [{ role: 'user', content: fullPrompt }],
            },
            { signal: controller.signal }
          );
        }
      } finally {
        clearTimeout(timer);
      }
    });

    const durationMs = Date.now() - callStart;

    // Extract text from response content blocks
    let text = '';
    let thinkingTokensEstimate = 0;
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'thinking') {
        // Count thinking tokens from the thinking block length as estimate
        thinkingTokensEstimate = Math.ceil((block as any).thinking?.length ?? 0 / 4);
      }
    }
    text = text.trim();

    const finishReason = response.stop_reason || undefined;
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costUsd = computeClaudeCostUsd(model, inputTokens, outputTokens) + groundingCostUsd;

    console.log(`[Claude:${tag}] Response in ${durationMs}ms — tokens: in=${inputTokens} out=${outputTokens} | cost=$${costUsd.toFixed(6)}`);

    const tokenUsage: LLMTokenUsage = {
      inputTokens,
      outputTokens,
      thinkingTokens: thinkingTokensEstimate,
      totalTokens: inputTokens + outputTokens,
      costUsd,
      groundingCostUsd,
      groundingQueriesUsed,
    };

    return {
      text,
      tokenUsage,
      groundingSources,
      finishReason,
      raw: response,
    };
  }
}
