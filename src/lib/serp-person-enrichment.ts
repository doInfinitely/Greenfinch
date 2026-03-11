// ============================================================================
// SerpAPI Person Enrichment
//
// Replaces PDL's enrichPersonPDL for the new cascade pipeline.
// Runs 2-3 SerpAPI queries per person, passes results to an LLM for
// structured extraction of name, title, company, LinkedIn, etc.
// ============================================================================

import { serpWebSearch } from './serp';
import { getLLMAdapter } from './ai/llm';
import { getStageConfig } from './ai/runtime-config';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { parseJsonResponse } from './ai/parsers';
import { cacheGet, cacheSet } from './redis';

const SERP_PERSON_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const SERP_PERSON_NEGATIVE_TTL = 24 * 60 * 60; // 24 hours

export interface SerpPersonEnrichmentResult {
  found: boolean;
  name: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  profilePictureUrl: string | null;
  confidence: number;
  sources: string[];
}

/**
 * Enrich a person using SerpAPI web search + LLM extraction.
 * Replaces PDL Person Enrich in the new cascade pipeline.
 */
export async function enrichPersonSerpAI(
  firstName: string,
  lastName: string,
  company: string | null,
  domain: string | null,
  options: {
    location?: string;
    title?: string;
    clerkOrgId?: string;
  } = {}
): Promise<SerpPersonEnrichmentResult> {
  const empty: SerpPersonEnrichmentResult = {
    found: false, name: null, title: null, company: null, domain: null,
    linkedinUrl: null, email: null, phone: null, location: null,
    profilePictureUrl: null, confidence: 0, sources: [],
  };

  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) return empty;

  // Check cache
  const cacheKey = `serp-person:${firstName.toLowerCase()}|${lastName.toLowerCase()}|${(company || '').toLowerCase()}`;
  const cached = await cacheGet<SerpPersonEnrichmentResult>(cacheKey);
  if (cached) {
    console.log(`[SerpPersonEnrich] Cache hit: ${cacheKey}`);
    return cached;
  }

  try {
    // Build search queries
    const queries: string[] = [];
    if (company) {
      queries.push(`"${fullName}" "${company}" LinkedIn`);
      queries.push(`"${fullName}" "${company}" ${options.title || 'property manager'}`);
    } else {
      queries.push(`"${fullName}" ${options.title || ''} commercial real estate`);
    }
    if (domain) {
      queries.push(`"${fullName}" site:${domain}`);
    }

    // Run searches in parallel
    const searchResults = await Promise.all(
      queries.slice(0, 3).map(q => serpWebSearch({ query: q, numResults: 3 }))
    );

    const allResults = searchResults.flat();
    if (allResults.length === 0) {
      return empty;
    }

    // Format search results as context for LLM extraction
    const resultContext = allResults.map((r, i) =>
      `[${i + 1}] ${r.title}\n    URL: ${r.link}\n    ${r.snippet}`
    ).join('\n\n');

    // Use LLM to extract structured person data
    const stageConfig = getStageConfig('stage3_contacts');
    const adapter = getLLMAdapter(stageConfig.provider);

    const prompt = `Extract structured person data from these search results. Return ONLY valid JSON.

PERSON: ${fullName}
${company ? `COMPANY: ${company}` : ''}
${domain ? `DOMAIN: ${domain}` : ''}
${options.title ? `EXPECTED TITLE: ${options.title}` : ''}

SEARCH RESULTS:
${resultContext}

Extract and return JSON:
{
  "found": true,
  "name": "Full Name",
  "title": "Current Job Title | null",
  "company": "Current Company | null",
  "domain": "company-domain.com | null",
  "linkedinUrl": "https://linkedin.com/in/... | null",
  "email": "email@domain.com | null",
  "phone": "+1... | null",
  "location": "City, State | null",
  "confidence": 0.0
}

Set confidence based on how well the search results match: 0.9+ if LinkedIn profile found and matches, 0.7-0.8 if strong match without LinkedIn, 0.5-0.6 if partial match, below 0.5 if uncertain.
If the person cannot be identified from the results, return {"found": false}.`;

    const response = await adapter.call(prompt, {
      model: stageConfig.model,
      temperature: 0.3,
      stageName: 'serp-person-enrichment',
      searchGrounding: false,
      timeoutMs: 30_000,
    });

    const parsed = parseJsonResponse(response.text);

    trackCostFireAndForget({
      provider: stageConfig.provider,
      endpoint: 'serp-person-enrichment',
      entityType: 'contact',
      clerkOrgId: options.clerkOrgId,
      success: !!parsed.found,
      metadata: { name: fullName, company },
    });

    if (!parsed.found) {
      await cacheSet(cacheKey, empty, SERP_PERSON_NEGATIVE_TTL);
      return empty;
    }

    const result: SerpPersonEnrichmentResult = {
      found: true,
      name: parsed.name || fullName,
      title: parsed.title || null,
      company: parsed.company || company,
      domain: parsed.domain || domain,
      linkedinUrl: parsed.linkedinUrl || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      location: parsed.location || null,
      profilePictureUrl: null, // Profile pictures come from browser-use LinkedIn scraping
      confidence: parsed.confidence || 0.5,
      sources: allResults.map(r => r.link).filter(Boolean),
    };
    await cacheSet(cacheKey, result, SERP_PERSON_CACHE_TTL);
    return result;
  } catch (error) {
    console.error(`[SerpPersonEnrich] Failed for ${fullName}: ${error instanceof Error ? error.message : error}`);
    trackCostFireAndForget({
      provider: 'serpapi',
      endpoint: 'serp-person-enrichment',
      entityType: 'contact',
      clerkOrgId: options.clerkOrgId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
