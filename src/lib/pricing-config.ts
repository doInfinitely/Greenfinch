// ============================================================================
// Centralized Pricing Configuration
//
// All external service costs live here.  When a provider changes their
// pricing, update the single entry below — every cost calculation in the
// app reads from this config.
//
// Last reviewed: Feb 2026
// ============================================================================

import type { GeminiTokenUsage } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Gemini (Google AI)
//
// Model: gemini-3-flash-preview via Vertex AI
// Source: https://ai.google.dev/gemini-api/docs/pricing
// Thinking tokens are billed at the OUTPUT rate.
// Tool-use prompt tokens (search grounding) are billed at the INPUT rate.
// ---------------------------------------------------------------------------

export const GEMINI_PRICING = {
  INPUT_PER_1M_TOKENS: 0.50,
  OUTPUT_PER_1M_TOKENS: 3.00,
} as const;

const GEMINI_INPUT_PER_TOKEN = GEMINI_PRICING.INPUT_PER_1M_TOKENS / 1_000_000;
const GEMINI_OUTPUT_PER_TOKEN = GEMINI_PRICING.OUTPUT_PER_1M_TOKENS / 1_000_000;

export function computeGeminiCostUsd(usage: GeminiTokenUsage | undefined): number {
  if (!usage) return 0;
  const inputCost = usage.promptTokens * GEMINI_INPUT_PER_TOKEN;
  const outputCost = (usage.responseTokens + usage.thinkingTokens) * GEMINI_OUTPUT_PER_TOKEN;
  return inputCost + outputCost;
}

// ---------------------------------------------------------------------------
// People Data Labs (PDL)
//
// Charged per successful API call (not-found results are free).
// Source: PDL pricing page / contract
// ---------------------------------------------------------------------------

export const PDL_PRICING = {
  PERSON_ENRICH_SUCCESS: 0.07,
  COMPANY_ENRICH_SUCCESS: 0.035,
  NOT_FOUND: 0,
} as const;

// ---------------------------------------------------------------------------
// Other Enrichment Providers
//
// Flat per-credit (per-call) pricing.  Most providers charge 1 credit per
// API call regardless of outcome.
// ---------------------------------------------------------------------------

export const PROVIDER_PRICING = {
  apollo: 0.01,
  hunter: 0.01,
  findymail: 0.05,
  crustdata: 0.05,
  zerobounce: 0.008,
  mapbox: 0.005,
  serp: 0.01,
  leadmagic: 0.03,
  enrichlayer: 0.02,
} as const;

// ---------------------------------------------------------------------------
// Default cost per credit
//
// Used as a fallback when a provider has no specific pricing above.
// ---------------------------------------------------------------------------

export const DEFAULT_COST_PER_CREDIT = 0.01;
