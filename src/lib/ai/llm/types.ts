// ============================================================================
// LLM Abstraction Layer — Provider-Agnostic Types
//
// Interfaces for multi-provider LLM support (Gemini, OpenAI, Claude).
// All stage calls go through LLMProviderAdapter.call() so prompts and
// JSON parsing remain provider-agnostic.
// ============================================================================

import type { GroundedSource } from '../types';
import type { ThinkingLevel } from '../runtime-config';

/** Supported LLM providers. */
export type LLMProvider = 'gemini' | 'openai' | 'claude';

/** Normalized token usage across all providers. */
export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  costUsd: number;
  groundingCostUsd: number;
  groundingQueriesUsed: number;
}

/** Normalized response from any LLM provider. */
export interface LLMResponse {
  text: string;
  tokenUsage: LLMTokenUsage;
  groundingSources: GroundedSource[];
  finishReason?: string;
  /** Provider-specific raw response for debugging / grounding extraction. */
  raw?: any;
}

/** Options passed to every LLM call. */
export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number;
  timeoutMs?: number;
  stageName: string;
  /** Enable web search grounding (native for Gemini, SerpAPI for others). */
  searchGrounding?: boolean;
  /** Explicit queries for SerpAPI grounding (OpenAI/Claude only). */
  searchQueries?: string[];
  latLng?: { latitude: number; longitude: number };
}

/** Provider adapter interface — each provider implements this. */
export interface LLMProviderAdapter {
  readonly provider: LLMProvider;
  call(prompt: string, options: LLMCallOptions): Promise<LLMResponse>;
}
