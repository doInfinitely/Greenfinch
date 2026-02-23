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
  ContactEnrichmentResult,
  FocusedEnrichmentResult,
  EnrichmentStage,
  EnrichmentStageCheckpoint,
} from './types';

export { isRetryableGeminiError, EnrichmentStageError, SchemaValidationError } from './errors';
export { getGeminiClient, streamGeminiResponse, callGeminiOnce, callGeminiWithTimeout, GEMINI_HTTP_TIMEOUT_MS } from './client';
export { scoreSources, parseJsonResponse, extractGroundedSources } from './parsers';
export { propertyLatLng, stripInternalMessages } from './helpers';
export { classifyAndVerifyProperty } from './stages/classify';
export { identifyOwnership } from './stages/ownership';
export { discoverContacts } from './stages/contacts';
export { cleanupAISummary, searchForReplacementContact } from './stages/misc';
export { runFocusedEnrichment } from './pipeline';
