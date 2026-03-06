// ============================================================================
// AI Enrichment — Barrel Export
//
// Re-exports all public types, functions, and classes so consumers can
// import from '@/lib/ai' (or '../ai') with a single path.
//
// Usage:
//   import { runFocusedEnrichment, type FocusedEnrichmentResult } from '@/lib/ai';
// ============================================================================

export type {
  GeminiTokenUsage,
  StreamedGeminiResponse,
  GroundedSource,
  StageResult,
  PropertyPhysicalData,
  PropertyClassification,
  PropertyDataAndClassification,
  OwnershipInfo,
  DiscoveredContact,
  ScoredSource,
  IdentifiedDecisionMaker,
  FocusedEnrichmentResult,
  EnrichmentStage,
  EnrichmentStageCheckpoint,
  GroundingQuality,
  GroundingSupport,
  CitationMetadata,
  CitationEntry,
  RelationshipGrounding,
  StageMetadata,
} from './types';

export { isRetryableGeminiError, EnrichmentStageError, SchemaValidationError } from './errors';
export { getGeminiClient, streamGeminiResponse, callGeminiOnce, callGeminiWithTimeout, GEMINI_HTTP_TIMEOUT_MS, runWithCallLog, getGeminiCallLog, getVertexDebugLog, clearVertexDebugLog } from './client';
export type { GeminiCallRecord, VertexDebugEntry } from './client';
export { computeGeminiCostUsd, GEMINI_PRICING } from './config';
export { scoreSources, parseJsonResponse, extractGroundedSources } from './parsers';
export { propertyLatLng, stripInternalMessages } from './helpers';
export { classifyAndVerifyProperty } from './stages/classify';
export { identifyOwnership } from './stages/ownership';
export { discoverContacts } from './stages/contacts';
export { cleanupAISummary, searchForReplacementContact } from './stages/misc';
export { runFocusedEnrichment } from './pipeline';

// LLM Abstraction Layer
export type { LLMProvider, LLMTokenUsage, LLMResponse, LLMCallOptions, LLMProviderAdapter } from './llm';
export { getLLMAdapter } from './llm';
