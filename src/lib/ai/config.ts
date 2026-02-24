// ============================================================================
// AI Enrichment — Centralized Configuration
//
// All tunable parameters for the Gemini-based enrichment pipeline live here.
// Changing a value in this file updates every stage that uses it — no need
// to hunt through individual stage files.
// ============================================================================

// ---------------------------------------------------------------------------
// Model & HTTP
// ---------------------------------------------------------------------------

import { GEMINI_MODEL } from '../constants';

/** HTTP timeout for every Gemini streaming call (ms). */
export const GEMINI_HTTP_TIMEOUT_MS = 120_000; // 120 seconds

/** Default sampling temperature.  Must be 1.0 when thinking mode is enabled. */
export const DEFAULT_TEMPERATURE = 1.0;

/** Lower temperature used for deterministic editing tasks (e.g. summary cleanup). */
export const CLEANUP_TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// Per-Stage Model Configuration
//
// Each stage can use a different Gemini model.  Defaults to the global
// GEMINI_MODEL from constants.ts.  Change individual stages here without
// affecting the rest of the pipeline.
// ---------------------------------------------------------------------------

export const STAGE_MODELS = {
  STAGE_1_CLASSIFY: GEMINI_MODEL,
  STAGE_2_OWNERSHIP: GEMINI_MODEL,
  STAGE_3_CONTACTS: GEMINI_MODEL,
  SUMMARY_CLEANUP: GEMINI_MODEL,
  REPLACEMENT_SEARCH: GEMINI_MODEL,
  DOMAIN_RETRY: GEMINI_MODEL,
} as const;

// ---------------------------------------------------------------------------
// Search Grounding Configuration
//
// Controls how aggressively stages use Google Search grounding.
//
// dynamicThreshold (0.0 – 1.0):
//   When using googleSearchRetrieval with MODE_DYNAMIC, the model only
//   triggers a search when its internal confidence is BELOW this threshold.
//     0.0 = always search (max web data, highest cost)
//     1.0 = never search (pure model knowledge)
//   Default 0.3 keeps search aggressive for data-freshness.
//
// Note: gemini-3-flash-preview uses the `googleSearch` tool which always
//       searches. The dynamic threshold applies when using other models
//       with `googleSearchRetrieval`.
// ---------------------------------------------------------------------------

export const SEARCH_GROUNDING = {
  DYNAMIC_THRESHOLD: 0.3,
} as const;

// ---------------------------------------------------------------------------
// Gemini Pricing — re-exported from centralized pricing-config.ts
// ---------------------------------------------------------------------------

export { GEMINI_PRICING, computeGeminiCostUsd } from '@/lib/pricing-config';

// ---------------------------------------------------------------------------
// Thinking Levels
//
// Gemini "thinking mode" controls how much internal reasoning the model does
// before responding.  Higher levels improve accuracy for complex tasks but
// increase latency and token usage.
//
//   MINIMAL  – fast, good for simple lookups and light formatting
//   LOW      – balanced reasoning, used for multi-step research tasks
// ---------------------------------------------------------------------------

export const THINKING_LEVELS = {
  /** Stage 1 — property classification (straightforward lookup). */
  STAGE_1_CLASSIFY: 'MINIMAL' as const,
  /** Stage 2 — ownership & management (multi-step entity resolution). */
  STAGE_2_OWNERSHIP: 'LOW' as const,
  /** Stage 3a — decision-maker identification (research-heavy). */
  STAGE_3A_CONTACTS: 'MEDIUM' as const,
  /** Summary cleanup — light editing, no reasoning needed. */
  SUMMARY_CLEANUP: 'MINIMAL' as const,
  /** Replacement contact search — simple web lookup. */
  REPLACEMENT_SEARCH: 'MEDIUM' as const,
  /** Domain retry calls — quick single-purpose searches. */
  DOMAIN_RETRY: 'MINIMAL' as const,
};

// ---------------------------------------------------------------------------
// Retry & Back-off
//
// Each stage retries independently.  Delays use linear or exponential
// back-off depending on the error type.
// ---------------------------------------------------------------------------

export const RETRIES = {
  /** Stage 1 — classification.  3 attempts with exponential back-off. */
  STAGE_1: 3,
  /** Stage 2 — ownership.  3 attempts with linear back-off. */
  STAGE_2: 3,
  /** Stage 3 — contact identification.  3 attempts, linear back-off. */
  STAGE_3A: 3,
};

export const BACKOFF = {
  /** Stage 1: base delay (ms) when response is empty / timeout. */
  STAGE_1_DEADLINE_BASE_MS: 5_000,
  /** Stage 1: base delay (ms) for non-timeout retries. */
  STAGE_1_DEFAULT_BASE_MS: 1_000,
  /** Stage 1: maximum delay cap (ms). */
  STAGE_1_MAX_MS: 15_000,
  /** Stage 2: linear delay multiplier per attempt (ms). */
  STAGE_2_PER_ATTEMPT_MS: 3_000,
  /** Stage 3: linear delay multiplier per attempt (ms). */
  STAGE_3A_PER_ATTEMPT_MS: 3_000,
};

// ---------------------------------------------------------------------------
// Confidence Thresholds & Caps
//
// These caps prevent over-confident scores when supporting evidence is weak.
// ---------------------------------------------------------------------------

export const CONFIDENCE = {
  /** Max roleConfidence when a Stage 3a contact has no source URL. */
  NO_SOURCE_URL_CAP: 0.4,
  /** Max roleConfidence after cross-stage company mismatch. */
  COMPANY_MISMATCH_CAP: 0.5,
  /** Phone confidence cap when phone matches the property's main number. */
  OFFICE_PHONE_CAP: 0.4,
  /** Phone confidence cap when multiple contacts share the same number. */
  SHARED_PHONE_CAP: 0.5,
};

// ---------------------------------------------------------------------------
// Source Extraction & Scoring
// ---------------------------------------------------------------------------

/** Maximum grounding sources to keep per Gemini response. */
export const MAX_GROUNDED_SOURCES = 5;

/** Domains that indicate the "source" is AI-generated, not a real web page. */
export const AI_GENERATED_DOMAINS = [
  'generativelanguage.googleapis.com',
  'ai.google.dev',
  'bard.google.com',
];

/** CRE industry / news domains treated as medium-trust for source scoring. */
export const MEDIUM_TRUST_DOMAINS = [
  'loopnet.com', 'costar.com', 'commercialcafe.com', 'crexi.com',
  'bizjournals.com', 'dallasnews.com', 'dmagazine.com',
  'prnewswire.com', 'globenewswire.com',
];

// ---------------------------------------------------------------------------
// Free / Personal Email Providers
//
// Used to distinguish corporate from personal email domains when falling
// back to email-domain-as-company-domain.
// ---------------------------------------------------------------------------

export const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'ymail.com',
];

// ---------------------------------------------------------------------------
// Quality-Grade → Property-Class Mapping
//
// Maps DCAD quality grades (from county appraisal data) to CRE property
// classes (A/B/C/D).  Confidence reflects how reliably the grade predicts
// the class without additional research.
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
//
// Maps short/variant labels from Gemini JSON output to canonical
// OwnershipInfo.beneficialOwner.type values.
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

// ---------------------------------------------------------------------------
// Google Search Tool
//
// Convenience constant for the Gemini tool config that enables search
// grounding.  Passed to every stage that needs web access.
// ---------------------------------------------------------------------------

export const GOOGLE_SEARCH_TOOL = [{ googleSearch: {} }];
