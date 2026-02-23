// ============================================================================
// AI Enrichment — Gemini Client
//
// Sets up Vertex AI credentials, creates the GoogleGenAI client, and
// provides two call wrappers:
//   streamGeminiResponse  — streams a prompt through Gemini and returns full text
//   callGeminiOnce        — wraps any async fn with the Gemini rate limiter
//   callGeminiWithTimeout — legacy alias for callGeminiOnce (no internal retries)
// ============================================================================

import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";
import { rateLimiters } from '../rate-limiter';
import { GEMINI_HTTP_TIMEOUT_MS, DEFAULT_TEMPERATURE } from './config';
import type { StreamedGeminiResponse } from './types';
import * as fs from 'fs';
import * as path from 'path';

let vertexCredentialsReady = false;

// Re-export so consumers that imported GEMINI_HTTP_TIMEOUT_MS from client.ts still work.
export { GEMINI_HTTP_TIMEOUT_MS } from './config';

/**
 * Write the GCP service-account JSON to disk (once) and set
 * GOOGLE_APPLICATION_CREDENTIALS so the SDK can authenticate.
 * Returns the project ID and Vertex AI location ('global').
 */
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

/** Create a new GoogleGenAI client authenticated via Vertex AI. */
export function getGeminiClient(): GoogleGenAI {
  const { project, location } = ensureVertexCredentials();
  return new GoogleGenAI({ vertexai: true, project, location });
}

/**
 * Send a prompt to Gemini using streaming and collect the full response.
 *
 * Streaming avoids Node.js fetch timeouts that occur with large responses.
 * The returned object contains the concatenated text and the last
 * candidate (which carries grounding metadata needed for source extraction).
 *
 * @param client       – GoogleGenAI instance from getGeminiClient()
 * @param prompt       – The full prompt string
 * @param options.tools          – e.g. [{ googleSearch: {} }] for search grounding
 * @param options.temperature    – Sampling temperature (default from config)
 * @param options.thinkingLevel  – Gemini thinking mode depth
 * @param options.latLng         – Geo-bias for search grounding (property coords)
 */
export async function streamGeminiResponse(
  client: GoogleGenAI,
  prompt: string,
  options: { tools?: any[]; temperature?: number; thinkingLevel?: 'NONE' | 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'; latLng?: { latitude: number; longitude: number } } = {}
): Promise<StreamedGeminiResponse> {
  const config: any = {
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
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

  const stream = await client.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: prompt,
    config,
  });

  let fullText = '';
  let lastCandidate: any = null;

  for await (const chunk of stream) {
    if (chunk.text) {
      fullText += chunk.text;
    }
    if (chunk.candidates && chunk.candidates.length > 0) {
      lastCandidate = chunk.candidates[0];
    }
  }

  const response: StreamedGeminiResponse = {
    text: fullText,
  };

  if (lastCandidate) {
    response.candidates = [lastCandidate];
  }

  return response;
}

/**
 * Execute a single Gemini API call through the shared rate limiter.
 *
 * Logs queue wait time and API latency for performance monitoring.
 * Does NOT retry — the caller (each stage) owns its own retry loop.
 */
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

/**
 * Legacy wrapper — identical to callGeminiOnce.
 * Kept for backward compatibility; the _retries param is ignored.
 */
export async function callGeminiWithTimeout<T>(
  fn: () => Promise<T>,
  _retries: number = 1
): Promise<T> {
  return callGeminiOnce(fn);
}
