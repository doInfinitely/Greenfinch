// ============================================================================
// SerpAPI — General-Purpose Web Search
//
// Wraps the SerpAPI Google search endpoint for web grounding.
// Used by serp-grounding.ts to inject search context into non-Gemini LLMs,
// and by enrichment modules for person/company research.
//
// Separate from serp-linkedin.ts which is LinkedIn-specific.
// ============================================================================

import { rateLimiters } from './rate-limiter';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { cacheGet, cacheSet } from './redis';

const SERPAPI_BASE = 'https://serpapi.com/search';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export interface SerpWebResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
  displayedLink?: string;
  date?: string;
}

export interface SerpWebSearchOptions {
  query: string;
  numResults?: number;
  location?: string;
  latLng?: { latitude: number; longitude: number };
  clerkOrgId?: string;
}

function buildCacheKey(query: string, location?: string): string {
  const normalized = `${query.toLowerCase().trim()}|${(location || '').toLowerCase().trim()}`;
  return `serp-web:${normalized}`;
}

/**
 * Run a general web search via SerpAPI and return structured results.
 */
export async function serpWebSearch(options: SerpWebSearchOptions): Promise<SerpWebResult[]> {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) {
    console.warn('[SerpAPI] SERP_API_KEY not configured');
    return [];
  }

  const { query, numResults = 5, location, latLng } = options;
  const cacheKey = buildCacheKey(query, location);

  // Check cache
  try {
    const cached = await cacheGet<SerpWebResult[]>(cacheKey);
    if (cached) {
      console.log(`[SerpAPI] Cache hit for query: "${query.substring(0, 60)}..."`);
      return cached;
    }
  } catch { /* cache miss */ }

  console.log(`[SerpAPI] Searching: "${query.substring(0, 80)}"`);

  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    api_key: apiKey,
    num: String(numResults),
  });

  if (location) {
    params.set('location', location);
  } else if (latLng) {
    // SerpAPI accepts `ll` for lat/lng in some engines; use location string instead
    params.set('location', `${latLng.latitude},${latLng.longitude}`);
  }

  try {
    const response = await rateLimiters.serpApi.execute(async () => {
      const res = await fetch(`${SERPAPI_BASE}?${params}`);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`SerpAPI HTTP ${res.status}: ${errorText.slice(0, 300)}`);
      }
      return res.json();
    });

    const organicResults = response.organic_results || [];
    const results: SerpWebResult[] = organicResults.slice(0, numResults).map((r: any, i: number) => ({
      position: i + 1,
      title: r.title || '',
      link: r.link || '',
      snippet: r.snippet || '',
      displayedLink: r.displayed_link,
      date: r.date,
    }));

    trackCostFireAndForget({
      provider: 'serpapi',
      endpoint: 'google-search',
      entityType: 'search',
      clerkOrgId: options.clerkOrgId,
      success: true,
      metadata: { query: query.substring(0, 100), resultCount: results.length },
    });

    // Cache results
    try {
      await cacheSet(cacheKey, results, CACHE_TTL_SECONDS);
    } catch { /* cache write failure is non-critical */ }

    console.log(`[SerpAPI] Got ${results.length} results for: "${query.substring(0, 60)}"`);
    return results;
  } catch (error) {
    console.error(`[SerpAPI] Search failed: ${error instanceof Error ? error.message : error}`);
    trackCostFireAndForget({
      provider: 'serpapi',
      endpoint: 'google-search',
      entityType: 'search',
      clerkOrgId: options.clerkOrgId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
