// ============================================================================
// AI Enrichment — Error Classification
// Determines whether Gemini API errors are retryable or permanent, plus the
// custom EnrichmentStageError used for checkpoint-based resumption.
// ============================================================================

import type { EnrichmentStage, EnrichmentStageCheckpoint } from './types';

export function isRetryableGeminiError(errMsg: string): { retryable: boolean; isDeadline: boolean; isStreamDisconnect: boolean } {
  const lower = errMsg.toLowerCase();

  const isDeadline = lower.includes('deadline_exceeded') || lower.includes('deadline expired')
    || errMsg.includes('504') || lower.includes('gateway timeout');

  const isNetworkError = errMsg === 'terminated'
    || lower.includes('econnreset') || lower.includes('econnrefused') || lower.includes('econnaborted')
    || lower.includes('epipe') || lower.includes('etimedout') || lower.includes('enetunreach')
    || lower.includes('ehostunreach') || lower.includes('enotfound')
    || lower.includes('socket hang up') || lower.includes('network error')
    || lower.includes('fetch failed') || lower.includes('failed to fetch')
    || lower.includes('connect timeout') || lower.includes('connection refused')
    || lower.includes('dns resolution') || lower.includes('getaddrinfo')
    || lower.includes('ssl routines') || lower.includes('certificate')
    || lower.includes('unable to get local issuer')
    || lower.includes('aborted') || lower.includes('request aborted')
    || lower.includes('undici') || lower.includes('bodyTimeout');

  const isServerError = errMsg.includes('500') || errMsg.includes('502') || errMsg.includes('503')
    || lower.includes('internal server error') || lower.includes('bad gateway')
    || lower.includes('service unavailable') || lower.includes('internal')
    || lower.includes('resource_exhausted') || lower.includes('unavailable');

  const isRateLimit = errMsg.includes('429') || lower.includes('rate limit')
    || lower.includes('too many requests') || lower.includes('quota exceeded');

  const isCircuitBreaker = lower.includes('circuit breaker is open');

  const isNotRetryable = lower.includes('invalid_argument') || lower.includes('permission_denied')
    || lower.includes('not_found') || lower.includes('unauthenticated')
    || errMsg.includes('400') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('404')
    || lower.includes('api key') || lower.includes('invalid api')
    || lower.includes('billing') || lower.includes('safety')
    || lower.includes('blocked') || lower.includes('harm category')
    || lower.includes('thought_signature') || lower.includes('thinking_config');

  const retryable = !isNotRetryable && (isDeadline || isNetworkError || isServerError || isRateLimit || isCircuitBreaker);
  return { retryable, isDeadline, isStreamDisconnect: isNetworkError };
}

export class SchemaValidationError extends Error {
  constructor(stage: string, details: string) {
    super(`[${stage}] Schema validation failed: ${details}`);
    this.name = 'SchemaValidationError';
  }
}

export class EnrichmentStageError extends Error {
  checkpoint: EnrichmentStageCheckpoint;
  stage: EnrichmentStage;
  
  constructor(message: string, stage: EnrichmentStage, checkpoint: EnrichmentStageCheckpoint) {
    super(message);
    this.name = 'EnrichmentStageError';
    this.stage = stage;
    this.checkpoint = checkpoint;
  }
}
