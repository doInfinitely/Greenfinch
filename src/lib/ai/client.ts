// ============================================================================
// AI Enrichment — Gemini Client
// Handles Vertex AI credentials, client instantiation, streaming calls,
// and rate-limited invocation wrappers.
// ============================================================================

import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";
import { rateLimiters } from '../rate-limiter';
import type { StreamedGeminiResponse } from './types';
import * as fs from 'fs';
import * as path from 'path';

let vertexCredentialsReady = false;

export const GEMINI_HTTP_TIMEOUT_MS = 120000; // 120 seconds

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

export async function streamGeminiResponse(
  client: GoogleGenAI,
  prompt: string,
  options: { tools?: any[]; temperature?: number; thinkingLevel?: 'NONE' | 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'; latLng?: { latitude: number; longitude: number } } = {}
): Promise<StreamedGeminiResponse> {
  const config: any = {
    temperature: options.temperature ?? 1.0,
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
