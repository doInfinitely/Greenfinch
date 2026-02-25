// ============================================================================
// AI Enrichment — Centralized Configuration
//
// All tunable parameters for the Gemini-based enrichment pipeline live here.
// Values are read from the runtime config store (admin-editable via UI) with
// sensible defaults built in.
// ============================================================================

// ---------------------------------------------------------------------------
// Model & HTTP
// ---------------------------------------------------------------------------

import { getStageConfig, type StageKey } from './runtime-config';

export const GEMINI_HTTP_TIMEOUT_MS = 120_000; // 120 seconds

export const DEFAULT_TEMPERATURE = 1.0;

export const CLEANUP_TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// Per-Stage Model Configuration (runtime-driven)
// ---------------------------------------------------------------------------

function stageModel(key: StageKey): string {
  return getStageConfig(key).model;
}

export const STAGE_MODELS = {
  get STAGE_1_CLASSIFY() { return stageModel('stage1_classify'); },
  get STAGE_2_OWNERSHIP() { return stageModel('stage2_ownership'); },
  get STAGE_3_CONTACTS() { return stageModel('stage3_contacts'); },
  get SUMMARY_CLEANUP() { return stageModel('summary_cleanup'); },
  get REPLACEMENT_SEARCH() { return stageModel('replacement_search'); },
  get DOMAIN_RETRY() { return stageModel('domain_retry'); },
};

// ---------------------------------------------------------------------------
// Search Grounding Configuration (runtime-driven)
// ---------------------------------------------------------------------------

export function getSearchGroundingTools(stageKey: StageKey): any[] | undefined {
  const cfg = getStageConfig(stageKey);
  if (!cfg.searchGrounding) return undefined;
  return [{ googleSearch: {} }];
}

export const GOOGLE_SEARCH_TOOL = [{ googleSearch: {} }];

// ---------------------------------------------------------------------------
// Gemini Pricing — re-exported from centralized pricing-config.ts
// ---------------------------------------------------------------------------

export { GEMINI_PRICING, computeGeminiCostUsd } from '@/lib/pricing-config';

// ---------------------------------------------------------------------------
// Thinking Levels (runtime-driven)
// ---------------------------------------------------------------------------

function stageThinking(key: StageKey) {
  return getStageConfig(key).thinkingLevel;
}

export const THINKING_LEVELS = {
  get STAGE_1_CLASSIFY() { return stageThinking('stage1_classify'); },
  get STAGE_2_OWNERSHIP() { return stageThinking('stage2_ownership'); },
  get STAGE_3A_CONTACTS() { return stageThinking('stage3_contacts'); },
  get SUMMARY_CLEANUP() { return stageThinking('summary_cleanup'); },
  get REPLACEMENT_SEARCH() { return stageThinking('replacement_search'); },
  get DOMAIN_RETRY() { return stageThinking('domain_retry'); },
};

// ---------------------------------------------------------------------------
// Per-Stage Temperature (runtime-driven)
// ---------------------------------------------------------------------------

function stageTemperature(key: StageKey): number {
  return getStageConfig(key).temperature;
}

export const STAGE_TEMPERATURES = {
  get STAGE_1_CLASSIFY() { return stageTemperature('stage1_classify'); },
  get STAGE_2_OWNERSHIP() { return stageTemperature('stage2_ownership'); },
  get STAGE_3_CONTACTS() { return stageTemperature('stage3_contacts'); },
  get SUMMARY_CLEANUP() { return stageTemperature('summary_cleanup'); },
  get REPLACEMENT_SEARCH() { return stageTemperature('replacement_search'); },
  get DOMAIN_RETRY() { return stageTemperature('domain_retry'); },
};

// ---------------------------------------------------------------------------
// Per-Stage Timeout (runtime-driven)
// ---------------------------------------------------------------------------

function stageTimeout(key: StageKey): number {
  return getStageConfig(key).timeoutMs;
}

export const STAGE_TIMEOUTS = {
  get STAGE_1_CLASSIFY() { return stageTimeout('stage1_classify'); },
  get STAGE_2_OWNERSHIP() { return stageTimeout('stage2_ownership'); },
  get STAGE_3_CONTACTS() { return stageTimeout('stage3_contacts'); },
  get SUMMARY_CLEANUP() { return stageTimeout('summary_cleanup'); },
  get REPLACEMENT_SEARCH() { return stageTimeout('replacement_search'); },
  get DOMAIN_RETRY() { return stageTimeout('domain_retry'); },
};

// ---------------------------------------------------------------------------
// Retry & Back-off (runtime-driven retries, static backoff)
// ---------------------------------------------------------------------------

export const RETRIES = {
  get STAGE_1() { return getStageConfig('stage1_classify').maxRetries; },
  get STAGE_2() { return getStageConfig('stage2_ownership').maxRetries; },
  get STAGE_3A() { return getStageConfig('stage3_contacts').maxRetries; },
};

export const BACKOFF = {
  STAGE_1_DEADLINE_BASE_MS: 5_000,
  STAGE_1_DEFAULT_BASE_MS: 1_000,
  STAGE_1_MAX_MS: 15_000,
  STAGE_2_PER_ATTEMPT_MS: 3_000,
  STAGE_3A_PER_ATTEMPT_MS: 3_000,
};

// ---------------------------------------------------------------------------
// Confidence Thresholds & Caps
// ---------------------------------------------------------------------------

export const CONFIDENCE = {
  NO_SOURCE_URL_CAP: 0.4,
  COMPANY_MISMATCH_CAP: 0.5,
  OFFICE_PHONE_CAP: 0.4,
  SHARED_PHONE_CAP: 0.5,
};

// ---------------------------------------------------------------------------
// Source Extraction & Scoring
// ---------------------------------------------------------------------------

export const MAX_GROUNDED_SOURCES = 5;

export const AI_GENERATED_DOMAINS = [
  'generativelanguage.googleapis.com',
  'ai.google.dev',
  'bard.google.com',
];

export const MEDIUM_TRUST_DOMAINS = [
  'loopnet.com', 'costar.com', 'commercialcafe.com', 'crexi.com',
  'bizjournals.com', 'dallasnews.com', 'dmagazine.com',
  'prnewswire.com', 'globenewswire.com',
];

// ---------------------------------------------------------------------------
// Free / Personal Email Providers
// ---------------------------------------------------------------------------

export const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'ymail.com',
];

// ---------------------------------------------------------------------------
// Quality-Grade → Property-Class Mapping
// ---------------------------------------------------------------------------

export const QUALITY_GRADE_MAP: Record<string, { propertyClass: string; confidence: number }> = {
  excellent: { propertyClass: 'A', confidence: 0.8 },
  superior:  { propertyClass: 'A+', confidence: 0.8 },
  good:      { propertyClass: 'B', confidence: 0.7 },
  average:   { propertyClass: 'C', confidence: 0.6 },
  fair:      { propertyClass: 'C', confidence: 0.6 },
  poor:      { propertyClass: 'D', confidence: 0.7 },
  unsound:   { propertyClass: 'D', confidence: 0.7 },
};

// ---------------------------------------------------------------------------
// Owner-Type Normalization
// ---------------------------------------------------------------------------

export type OwnerTypeValue = "REIT" | "Private Equity" | "Family Office" | "Individual" | "Corporation" | "Institutional" | "Syndicator";

export const OWNER_TYPE_MAP: Record<string, OwnerTypeValue> = {
  REIT:             'REIT',
  PE:               'Private Equity',
  'Private Equity': 'Private Equity',
  'Family Office':  'Family Office',
  Individual:       'Individual',
  Corporation:      'Corporation',
  Institutional:    'Institutional',
  Syndicator:       'Syndicator',
};
