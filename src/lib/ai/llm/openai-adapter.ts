// ============================================================================
// LLM Adapter — OpenAI
//
// Wraps the OpenAI SDK behind the provider-agnostic LLMProviderAdapter.
// Uses SerpAPI for web grounding (injected into prompt context).
// ============================================================================

import OpenAI from 'openai';
import type { LLMProviderAdapter, LLMCallOptions, LLMResponse, LLMTokenUsage } from './types';
import { runSerpGrounding } from './serp-grounding';
import { rateLimiters } from '../../rate-limiter';
import { computeOpenAICostUsd } from '../../pricing-config';

let _client: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

const DEFAULT_MODEL = 'gpt-4o';

export class OpenAIAdapter implements LLMProviderAdapter {
  readonly provider = 'openai' as const;

  async call(prompt: string, options: LLMCallOptions): Promise<LLMResponse> {
    const client = getOpenAIClient();
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
      // ~$0.01 per SerpAPI query
      groundingCostUsd = groundingQueriesUsed * 0.01;
    }

    const fullPrompt = groundingContext ? `${prompt}${groundingContext}` : prompt;
    const tag = options.stageName || 'unknown';
    console.log(`[OpenAI:${tag}] Calling ${model} (prompt length: ${fullPrompt.length}, grounding queries: ${groundingQueriesUsed})`);

    const callStart = Date.now();

    const response = await rateLimiters.openai.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Use reasoning models differently (o1, o3-mini)
        const isReasoningModel = model.startsWith('o1') || model.startsWith('o3');

        const completion = await client.chat.completions.create(
          {
            model,
            messages: [{ role: 'user', content: fullPrompt }],
            ...(!isReasoningModel && { temperature: options.temperature ?? 1.0 }),
            ...(options.maxOutputTokens && { max_tokens: options.maxOutputTokens }),
          },
          { signal: controller.signal }
        );

        return completion;
      } finally {
        clearTimeout(timer);
      }
    });

    const durationMs = Date.now() - callStart;
    const text = response.choices?.[0]?.message?.content?.trim() || '';
    const finishReason = response.choices?.[0]?.finish_reason || undefined;
    const usage = response.usage;

    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const costUsd = computeOpenAICostUsd(model, inputTokens, outputTokens) + groundingCostUsd;

    console.log(`[OpenAI:${tag}] Response in ${durationMs}ms — tokens: in=${inputTokens} out=${outputTokens} | cost=$${costUsd.toFixed(6)}`);

    const tokenUsage: LLMTokenUsage = {
      inputTokens,
      outputTokens,
      thinkingTokens: 0,
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
