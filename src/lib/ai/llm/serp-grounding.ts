// ============================================================================
// LLM Grounding via SerpAPI
//
// For non-Gemini providers (OpenAI, Claude), we inject web search results
// into the prompt as grounding context.  This module runs SerpAPI queries,
// formats results as a context block, and extracts source references.
// ============================================================================

import { serpWebSearch, type SerpWebResult } from '../../serp';
import type { GroundedSource } from '../types';

/** Format search results into a context block for LLM prompt injection. */
export function formatSearchResultsAsContext(results: SerpWebResult[]): string {
  if (results.length === 0) return '';

  const lines = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    URL: ${r.link}\n    ${r.snippet}`
  );

  return `\n\n---\nWEB SEARCH RESULTS (use these as grounding — cite source URLs in your analysis):\n\n${lines.join('\n\n')}\n---\n`;
}

/** Extract GroundedSource entries from search results for downstream tracking. */
export function extractSourcesFromResults(results: SerpWebResult[]): GroundedSource[] {
  return results
    .filter(r => r.link)
    .map(r => ({ url: r.link, title: r.title }));
}

/** Build search queries from prompt content for grounding. */
export function buildGroundingQueries(prompt: string, explicitQueries?: string[]): string[] {
  if (explicitQueries && explicitQueries.length > 0) {
    return explicitQueries.slice(0, 3);
  }

  // Extract key search-worthy phrases from the prompt
  const queries: string[] = [];

  // Look for ADDRESS: or PROPERTY: lines
  const addressMatch = prompt.match(/(?:ADDRESS|PROPERTY):\s*(.+?)(?:\n|$)/i);
  if (addressMatch) {
    queries.push(addressMatch[1].trim().substring(0, 100));
  }

  // Look for COMPANY: lines
  const companyMatch = prompt.match(/COMPANY:\s*(.+?)(?:\n|$)/i);
  if (companyMatch) {
    queries.push(companyMatch[1].trim().substring(0, 100));
  }

  // Look for quoted search phrases in the prompt (e.g., Search "term here")
  const quotedPhrases = prompt.match(/[Ss]earch\s+"([^"]+)"/g);
  if (quotedPhrases) {
    for (const phrase of quotedPhrases.slice(0, 2)) {
      const match = phrase.match(/"([^"]+)"/);
      if (match) queries.push(match[1]);
    }
  }

  return queries.slice(0, 3);
}

/**
 * Run SerpAPI grounding: execute queries and return formatted context + sources.
 *
 * Used by OpenAI and Claude adapters to inject web context into prompts.
 */
export async function runSerpGrounding(
  prompt: string,
  options: {
    searchQueries?: string[];
    latLng?: { latitude: number; longitude: number };
    maxResults?: number;
  } = {}
): Promise<{
  contextBlock: string;
  sources: GroundedSource[];
  queriesUsed: string[];
  totalResults: number;
}> {
  const queries = buildGroundingQueries(prompt, options.searchQueries);
  if (queries.length === 0) {
    return { contextBlock: '', sources: [], queriesUsed: [], totalResults: 0 };
  }

  const maxResultsPerQuery = options.maxResults || 3;
  const allResults: SerpWebResult[] = [];
  const seenUrls = new Set<string>();

  // Run queries in parallel
  const queryResults = await Promise.all(
    queries.map(query =>
      serpWebSearch({
        query,
        numResults: maxResultsPerQuery,
        latLng: options.latLng,
      })
    )
  );

  for (const results of queryResults) {
    for (const result of results) {
      if (!seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        allResults.push(result);
      }
    }
  }

  const contextBlock = formatSearchResultsAsContext(allResults);
  const sources = extractSourcesFromResults(allResults);

  return {
    contextBlock,
    sources,
    queriesUsed: queries,
    totalResults: allResults.length,
  };
}
