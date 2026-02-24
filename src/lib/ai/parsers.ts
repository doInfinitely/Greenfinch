// ============================================================================
// AI Enrichment — Response Parsing & Source Extraction
//
// Handles three concerns:
//   1. JSON extraction — pull valid JSON from Gemini's free-text responses
//   2. Schema validation — lightweight checks that each stage's JSON has
//      the required fields before downstream code processes it
//   3. Grounding sources — extract the web URLs Gemini used as evidence,
//      filter out AI-generated links, and score sources by trust tier
// ============================================================================

import type { GroundedSource, ScoredSource, OwnershipInfo } from './types';
import { SchemaValidationError } from './errors';
import { AI_GENERATED_DOMAINS, MEDIUM_TRUST_DOMAINS, MAX_GROUNDED_SOURCES } from './config';

/**
 * Check whether a URL points to an AI platform rather than a real web page.
 * These show up in grounding metadata but aren't useful as evidence.
 */
export function isAIGeneratedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return AI_GENERATED_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * Pull grounded web sources from a Gemini streaming response.
 *
 * Gemini attaches grounding metadata to the last candidate when search
 * grounding is enabled.  This function navigates several possible response
 * shapes (groundingChunks, groundingSupports) to extract real URLs.
 *
 * Returns up to MAX_GROUNDED_SOURCES unique, non-AI-generated URLs.
 */
export function extractGroundedSources(response: any): GroundedSource[] {
  try {
    const candidates = response?.candidates || response?.response?.candidates || response?.data?.candidates;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      try {
        const snippet = JSON.stringify(response, null, 2)?.substring(0, 500);
        console.log(`[GroundedSources] No candidates array. Response type: ${response?.constructor?.name}. Snippet: ${snippet}`);
      } catch {
        console.log(`[GroundedSources] No candidates array. Response type: ${typeof response}, constructor: ${response?.constructor?.name}`);
      }
      return [];
    }
    
    const candidate = candidates[0];
    const groundingMetadata = candidate.groundingMetadata || candidate.grounding_metadata;
    if (!groundingMetadata) {
      try {
        const candidateSnippet = JSON.stringify(candidate, null, 2)?.substring(0, 500);
        console.log(`[GroundedSources] No groundingMetadata. Candidate snippet: ${candidateSnippet}`);
      } catch {
        const candidateKeys = Object.keys(candidate || {});
        console.log(`[GroundedSources] No groundingMetadata. Candidate keys: ${candidateKeys.join(', ')}`);
      }
      return [];
    }
    
    const groundingChunks = groundingMetadata.groundingChunks || groundingMetadata.grounding_chunks || [];
    
    // When Gemini searched but produced no grounding chunks, the response
    // has higher hallucination risk — log a warning for observability.
    if (!groundingChunks || groundingChunks.length === 0) {
      const metadataKeys = Object.keys(groundingMetadata);
      const hasSearchQueries = groundingMetadata.webSearchQueries?.length > 0;
      const hasSearchEntryPoint = !!groundingMetadata.searchEntryPoint;
      const hasSupports = groundingMetadata.groundingSupports?.length > 0;

      if (hasSearchQueries && !hasSupports) {
        console.warn(`[GroundedSources] GROUNDING GAP: Gemini searched (${groundingMetadata.webSearchQueries.length} queries) but response is NOT grounded in any source — higher hallucination risk`);
        console.log(`[GroundedSources] Queries: ${JSON.stringify(groundingMetadata.webSearchQueries)}`);
      } else {
        console.log(`[GroundedSources] No grounding chunks. Metadata keys: ${metadataKeys.join(', ')}, hasSearchQueries=${hasSearchQueries}, hasSupports=${hasSupports}`);
      }

      // Fallback: try to recover URLs from groundingSupports → chunkIndices
      if (hasSupports) {
        console.log(`[GroundedSources] Has ${groundingMetadata.groundingSupports.length} groundingSupports but no chunks — extracting from supports`);
        const supportSources: GroundedSource[] = [];
        const seen = new Set<string>();
        for (const support of groundingMetadata.groundingSupports) {
          const indices = support.groundingChunkIndices || [];
          for (const idx of indices) {
            const chunk = groundingMetadata.groundingChunks?.[idx];
            if (chunk?.web?.uri && !seen.has(chunk.web.uri)) {
              seen.add(chunk.web.uri);
              supportSources.push({ url: chunk.web.uri, title: chunk.web.title || 'Source' });
            }
          }
        }
        if (supportSources.length > 0) {
          console.log(`[GroundedSources] Recovered ${supportSources.length} sources from groundingSupports`);
          return supportSources;
        }
      }
      return [];
    }
    
    console.log(`[GroundedSources] Found ${groundingChunks.length} grounding chunks, first chunk keys: ${Object.keys(groundingChunks[0] || {}).join(', ')}`);
    
    // Deduplicate by domain, skip AI-generated links, cap at MAX_GROUNDED_SOURCES
    const seen = new Set<string>();
    const sources: GroundedSource[] = [];
    for (const chunk of groundingChunks) {
      const uri = chunk.web?.uri;
      if (!uri) continue;
      if (isAIGeneratedSource(uri)) continue;
      const displayUrl = chunk.web.domain ? `https://${chunk.web.domain}` : uri;
      const dedupeKey = chunk.web.domain || uri;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      sources.push({
        url: uri,
        title: chunk.web.title || chunk.web.domain || 'Source',
      });
      if (sources.length >= MAX_GROUNDED_SOURCES) break;
    }
    
    console.log(`[GroundedSources] Extracted ${sources.length} sources from ${groundingChunks.length} chunks`);
    return sources;
  } catch (error) {
    console.warn('[GroundedSources] Error extracting grounding sources:', error);
    return [];
  }
}

/**
 * Assign a trust tier to a single source based on its domain.
 *
 * Tiers:
 *   high   — matches a known property/company domain, or is LinkedIn
 *   medium — recognized CRE industry or news outlet
 *   low    — everything else
 */
function scoreSource(source: GroundedSource, knownDomains: string[]): ScoredSource {
  let hostname: string;
  try {
    hostname = new URL(source.url).hostname.toLowerCase();
  } catch {
    return { ...source, trustTier: 'low' };
  }

  if (knownDomains.some(d => hostname.includes(d)) || hostname.includes('linkedin.com')) {
    return { ...source, trustTier: 'high' };
  }
  if (MEDIUM_TRUST_DOMAINS.some(d => hostname.includes(d))) {
    return { ...source, trustTier: 'medium' };
  }
  return { ...source, trustTier: 'low' };
}

/**
 * Score all grounding sources relative to the ownership context.
 * Known domains (management company, property website) get high trust.
 */
export function scoreSources(sources: GroundedSource[], ownership: OwnershipInfo): ScoredSource[] {
  const knownDomains: string[] = [];
  if (ownership.managementCompany?.domain) {
    knownDomains.push(ownership.managementCompany.domain.toLowerCase());
  }
  for (const addlMgmt of ownership.additionalManagementCompanies || []) {
    if (addlMgmt.domain) knownDomains.push(addlMgmt.domain.toLowerCase());
  }
  for (const addlOwner of ownership.additionalOwners || []) {
    if (addlOwner.domain) knownDomains.push(addlOwner.domain.toLowerCase());
  }
  if (ownership.propertyWebsite) {
    try {
      knownDomains.push(new URL(ownership.propertyWebsite).hostname.toLowerCase());
    } catch { /* skip */ }
  }
  return sources.map(s => scoreSource(s, knownDomains));
}

/**
 * Extract the first JSON object or array from Gemini's free-text response.
 * Strips markdown fences and leading prose before parsing.
 */
export function parseJsonResponse(text: string): any {
  let cleanedText = text.trim();
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in response: ${text.substring(0, 200)}`);
  }
  return JSON.parse(jsonMatch[0]);
}

/** Ensure Stage 1 JSON has at least a property name and category. */
export function validateStage1Schema(parsed: any): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SchemaValidationError('Stage 1', `Expected object, got ${typeof parsed}`);
  }
  const name = parsed.name ?? parsed.propertyName;
  if (typeof name !== 'string' || name.length === 0) {
    throw new SchemaValidationError('Stage 1', `Missing or empty property name`);
  }
  const cat = parsed.cat ?? parsed.category;
  if (typeof cat !== 'string' || cat.length === 0) {
    throw new SchemaValidationError('Stage 1', `Missing or empty category`);
  }
}

/** Ensure Stage 2 JSON has mgmt and owner/owners (object or array). */
export function validateStage2Schema(parsed: any): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SchemaValidationError('Stage 2', `Expected object, got ${typeof parsed}`);
  }
  const mgmt = parsed.mgmt;
  if (!mgmt || (typeof mgmt !== 'object' && !Array.isArray(mgmt))) {
    throw new SchemaValidationError('Stage 2', `Missing or invalid "mgmt" (expected object or array)`);
  }
  const owner = parsed.owners ?? parsed.owner;
  if (!owner || (typeof owner !== 'object' && !Array.isArray(owner))) {
    throw new SchemaValidationError('Stage 2', `Missing or invalid "owner"/"owners" (expected object or array)`);
  }
}

/** Ensure Stage 3a JSON has a "contacts" array with named entries. */
export function validateStage3aSchema(parsed: any): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SchemaValidationError('Stage 3a', `Expected object, got ${typeof parsed}`);
  }
  if (!Array.isArray(parsed.contacts)) {
    throw new SchemaValidationError('Stage 3a', `"contacts" is ${typeof parsed.contacts}, expected array`);
  }
  for (const c of parsed.contacts) {
    if (typeof c !== 'object' || !c.name || typeof c.name !== 'string') {
      throw new SchemaValidationError('Stage 3a', `Contact missing required "name" field`);
    }
  }
}
