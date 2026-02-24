// ============================================================================
// AI Enrichment — Gemini Client
//
// Sets up Vertex AI credentials, creates the GoogleGenAI client, and
// provides two call wrappers:
//   streamGeminiResponse  — streams a prompt through Gemini and returns full text
//   callGeminiOnce        — wraps any async fn with the Gemini rate limiter
//   callGeminiWithTimeout — legacy alias for callGeminiOnce (no internal retries)
//
// Also maintains a global ring-buffer debug log of all Gemini calls with full
// request configs and raw response metadata for the Vertex AI Debug admin page.
// ============================================================================

import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";
import { rateLimiters } from '../rate-limiter';
import { GEMINI_HTTP_TIMEOUT_MS, DEFAULT_TEMPERATURE } from './config';
import { computeGeminiCostUsd, GEMINI_PRICING } from './config';
import type { StreamedGeminiResponse, GeminiTokenUsage } from './types';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'fs';
import * as path from 'path';

let vertexCredentialsReady = false;

export { GEMINI_HTTP_TIMEOUT_MS } from './config';

export function ensureVertexCredentials(): { project: string; location: string } {
  const credsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credsJson) {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS is not set");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(credsJson);
  } catch {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS contains invalid JSON");
  }

  const project = parsed.project_id;
  if (!project) {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS missing project_id");
  }

  if (!vertexCredentialsReady) {
    const credFilePath = path.join('/tmp', 'gcp-service-account.json');
    fs.writeFileSync(credFilePath, credsJson, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credFilePath;
    vertexCredentialsReady = true;
    console.log(`[VertexAI] Credentials written to ${credFilePath}, project=${project}`);
  }

  return { project, location: 'global' };
}

export function getGeminiClient(): GoogleGenAI {
  const { project, location } = ensureVertexCredentials();
  return new GoogleGenAI({ vertexai: true, project, location });
}

// ---------------------------------------------------------------------------
// Global debug log — ring buffer of full request/response details
// ---------------------------------------------------------------------------

export interface VertexDebugEntry {
  id: number;
  timestamp: number;
  stageName: string;
  durationMs: number;
  error: boolean;
  errorMessage?: string;

  request: {
    model: string;
    prompt: string;
    temperature: number;
    thinkingLevel?: string;
    tools?: any;
    toolConfig?: any;
    latLng?: { latitude: number; longitude: number };
  };

  response: {
    text: string;
    finishReason?: string;
    rawUsageMetadata: any | null;
    parsedTokenUsage: GeminiTokenUsage | null;
    computedCostUsd: number;
    groundingMetadata: any | null;
    candidateCount: number;
    searchGroundingUsed: boolean;
  };
}

const MAX_DEBUG_ENTRIES = 200;
let debugEntryId = 0;
const debugLog: VertexDebugEntry[] = [];

function addDebugEntry(entry: VertexDebugEntry): void {
  debugLog.push(entry);
  if (debugLog.length > MAX_DEBUG_ENTRIES) {
    debugLog.splice(0, debugLog.length - MAX_DEBUG_ENTRIES);
  }
}

export function getVertexDebugLog(): VertexDebugEntry[] {
  return [...debugLog];
}

export function clearVertexDebugLog(): void {
  debugLog.length = 0;
}

// ---------------------------------------------------------------------------
// Per-property call log (AsyncLocalStorage-based)
// ---------------------------------------------------------------------------

export interface GeminiCallRecord {
  stageName: string;
  promptTokens: number;
  responseTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  costUsd: number;
  searchGroundingUsed: boolean;
  searchGroundingCostUsd: number;
  timestamp: number;
  error?: boolean;
}

const callLogStorage = new AsyncLocalStorage<GeminiCallRecord[]>();

export function runWithCallLog<T>(fn: () => Promise<T>): Promise<T> {
  return callLogStorage.run([], fn);
}

export function getGeminiCallLog(): GeminiCallRecord[] {
  return [...(callLogStorage.getStore() || [])];
}

function logCall(stageName: string, usage: GeminiTokenUsage, error = false): void {
  const store = callLogStorage.getStore();
  if (!store) return;
  store.push({
    stageName,
    promptTokens: usage.promptTokens,
    responseTokens: usage.responseTokens,
    thinkingTokens: usage.thinkingTokens,
    totalTokens: usage.totalTokens,
    costUsd: computeGeminiCostUsd(usage),
    searchGroundingUsed: usage.searchGroundingUsed,
    searchGroundingCostUsd: usage.searchGroundingCostUsd,
    timestamp: Date.now(),
    error,
  });
}

// ---------------------------------------------------------------------------
// Search grounding detection
// ---------------------------------------------------------------------------

function isGemini3Model(model: string): boolean {
  return model.includes('gemini-3') || model.includes('gemini-3.');
}

function detectSearchGrounding(candidate: any): boolean {
  if (!candidate?.groundingMetadata) return false;
  const gm = candidate.groundingMetadata;
  return !!(
    gm.searchEntryPoint ||
    (gm.groundingChunks && gm.groundingChunks.length > 0) ||
    (gm.groundingSupports && gm.groundingSupports.length > 0) ||
    (gm.webSearchQueries && gm.webSearchQueries.length > 0)
  );
}

function computeSearchGroundingCost(model: string, searchUsed: boolean): number {
  if (!searchUsed) return 0;
  if (isGemini3Model(model)) {
    return GEMINI_PRICING.SEARCH_GROUNDING_PER_SEARCH_GEMINI3;
  }
  return GEMINI_PRICING.SEARCH_GROUNDING_PER_PROMPT_OTHER;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

function extractTokenUsage(meta: any, model: string, searchGroundingUsed: boolean): GeminiTokenUsage {
  const basePromptTokens = meta.promptTokenCount ?? 0;
  const toolUseTokens = meta.toolUsePromptTokenCount ?? 0;
  const promptTokens = basePromptTokens + toolUseTokens;
  const responseTokens = meta.responseTokenCount ?? meta.candidatesTokenCount ?? 0;
  const thinkingTokens = meta.thoughtsTokenCount ?? 0;
  const totalTokens = meta.totalTokenCount ?? 0;
  const searchGroundingCostUsd = computeSearchGroundingCost(model, searchGroundingUsed);
  return { promptTokens, responseTokens, thinkingTokens, totalTokens, searchGroundingUsed, searchGroundingCostUsd };
}

// ---------------------------------------------------------------------------
// streamGeminiResponse
// ---------------------------------------------------------------------------

export async function streamGeminiResponse(
  client: GoogleGenAI,
  prompt: string,
  options: { tools?: any[]; temperature?: number; thinkingLevel?: 'NONE' | 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'; latLng?: { latitude: number; longitude: number }; stageName?: string; model?: string } = {}
): Promise<StreamedGeminiResponse> {
  const tag = options.stageName || 'unknown';
  const model = options.model || GEMINI_MODEL;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const config: any = {
    temperature,
    httpOptions: { timeout: GEMINI_HTTP_TIMEOUT_MS },
  };
  if (options.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  }
  if (options.tools) {
    config.tools = options.tools;
  }
  if (options.latLng) {
    config.toolConfig = {
      retrievalConfig: {
        latLng: options.latLng,
      },
    };
  }

  const callStart = Date.now();
  const entryId = ++debugEntryId;

  const requestSnapshot = {
    model,
    prompt,
    temperature,
    thinkingLevel: options.thinkingLevel,
    tools: options.tools,
    toolConfig: config.toolConfig,
    latLng: options.latLng,
  };

  const stream = await client.models.generateContentStream({
    model,
    contents: prompt,
    config,
  });

  let fullText = '';
  let lastCandidate: any = null;
  let lastUsageMetadata: any = null;

  try {
    for await (const chunk of stream) {
      if (chunk.text) {
        fullText += chunk.text;
      }
      if (chunk.candidates && chunk.candidates.length > 0) {
        lastCandidate = chunk.candidates[0];
      }
      if ((chunk as any).usageMetadata) {
        lastUsageMetadata = (chunk as any).usageMetadata;
      }
    }
  } catch (streamError) {
    const durationMs = Date.now() - callStart;
    const errMsg = streamError instanceof Error ? streamError.message : String(streamError);

    if (lastUsageMetadata) {
      const searchUsed = detectSearchGrounding(lastCandidate);
      const partialUsage = extractTokenUsage(lastUsageMetadata, model, searchUsed);
      const partialCost = computeGeminiCostUsd(partialUsage);
      console.error(`[Gemini:${tag}] STREAM ERROR with partial usage — raw metadata: ${JSON.stringify(lastUsageMetadata)}`);
      console.error(`[Gemini:${tag}] Partial tokens: prompt=${partialUsage.promptTokens} response=${partialUsage.responseTokens} thinking=${partialUsage.thinkingTokens} total=${partialUsage.totalTokens} | cost=$${partialCost.toFixed(6)}`);
      logCall(tag, partialUsage, true);

      addDebugEntry({
        id: entryId, timestamp: callStart, stageName: tag, durationMs, error: true, errorMessage: errMsg,
        request: requestSnapshot,
        response: {
          text: fullText,
          finishReason: lastCandidate?.finishReason,
          rawUsageMetadata: lastUsageMetadata,
          parsedTokenUsage: partialUsage,
          computedCostUsd: partialCost,
          groundingMetadata: lastCandidate?.groundingMetadata ?? null,
          candidateCount: lastCandidate ? 1 : 0,
          searchGroundingUsed: searchUsed,
        },
      });
    } else {
      console.error(`[Gemini:${tag}] STREAM ERROR with no usageMetadata captured`);
      addDebugEntry({
        id: entryId, timestamp: callStart, stageName: tag, durationMs, error: true, errorMessage: errMsg,
        request: requestSnapshot,
        response: {
          text: fullText, finishReason: undefined, rawUsageMetadata: null,
          parsedTokenUsage: null, computedCostUsd: 0, groundingMetadata: null, candidateCount: 0,
          searchGroundingUsed: false,
        },
      });
    }
    throw streamError;
  }

  const durationMs = Date.now() - callStart;
  const response: StreamedGeminiResponse = { text: fullText };

  if (lastCandidate) {
    response.candidates = [lastCandidate];
  }

  let parsedUsage: GeminiTokenUsage | null = null;
  let costUsd = 0;

  const searchGroundingUsed = detectSearchGrounding(lastCandidate);

  if (lastUsageMetadata) {
    console.log(`[Gemini:${tag}] RAW usageMetadata: ${JSON.stringify(lastUsageMetadata)}`);

    parsedUsage = extractTokenUsage(lastUsageMetadata, model, searchGroundingUsed);
    response.tokenUsage = parsedUsage;
    costUsd = computeGeminiCostUsd(parsedUsage);

    const groundingNote = searchGroundingUsed ? ` | grounding=$${parsedUsage.searchGroundingCostUsd.toFixed(4)}` : '';
    console.log(`[Gemini:${tag}] Tokens: prompt=${parsedUsage.promptTokens} response=${parsedUsage.responseTokens} thinking=${parsedUsage.thinkingTokens} total=${parsedUsage.totalTokens} | computedCost=$${costUsd.toFixed(6)}${groundingNote}`);
    logCall(tag, parsedUsage);

    if (parsedUsage.promptTokens === 0 && parsedUsage.responseTokens === 0 && parsedUsage.totalTokens === 0) {
      console.warn(`[Gemini:${tag}] usageMetadata present but all token counts are 0. Raw keys: ${Object.keys(lastUsageMetadata).join(', ')}`);
    }
  } else {
    console.warn(`[Gemini:${tag}] No usageMetadata found in streamed response`);
  }

  addDebugEntry({
    id: entryId, timestamp: callStart, stageName: tag, durationMs, error: false,
    request: requestSnapshot,
    response: {
      text: fullText,
      finishReason: lastCandidate?.finishReason,
      rawUsageMetadata: lastUsageMetadata,
      parsedTokenUsage: parsedUsage,
      computedCostUsd: costUsd,
      groundingMetadata: lastCandidate?.groundingMetadata ?? null,
      candidateCount: lastCandidate ? 1 : 0,
      searchGroundingUsed,
    },
  });

  return response;
}

// ---------------------------------------------------------------------------
// Rate-limited wrappers
// ---------------------------------------------------------------------------

export async function callGeminiOnce<T>(
  fn: () => Promise<T>
): Promise<T> {
  const overallStart = Date.now();

  const wrappedFn = async () => {
    const queueWait = Date.now() - overallStart;
    if (queueWait > 1000) {
      console.log(`[FocusedEnrichment] Rate limiter queue wait: ${queueWait}ms`);
    }
    const apiStart = Date.now();

    try {
      const result = await fn();
      console.log(`[FocusedEnrichment] Gemini API responded in ${Date.now() - apiStart}ms (total with queue: ${Date.now() - overallStart}ms)`);
      return result;
    } catch (apiErr) {
      console.warn(`[FocusedEnrichment] Gemini API error after ${Date.now() - apiStart}ms: ${apiErr instanceof Error ? apiErr.message : apiErr}`);
      throw apiErr;
    }
  };

  return rateLimiters.gemini.execute(wrappedFn);
}

export async function callGeminiWithTimeout<T>(
  fn: () => Promise<T>,
  _retries: number = 1
): Promise<T> {
  return callGeminiOnce(fn);
}
