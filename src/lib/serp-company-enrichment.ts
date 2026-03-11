// ============================================================================
// SerpAPI Company Enrichment
//
// Replaces PDL Company Enrich + Crustdata Company for the new cascade.
// Runs SerpAPI queries for company firmographics, then LLM extraction.
// ============================================================================

import { serpWebSearch } from './serp';
import { getLLMAdapter } from './ai/llm';
import { getStageConfig } from './ai/runtime-config';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { parseJsonResponse } from './ai/parsers';
import { cacheGet, cacheSet } from './redis';

const SERP_COMPANY_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const SERP_COMPANY_NEGATIVE_TTL = 24 * 60 * 60; // 24 hours

export interface SerpCompanyEnrichmentResult {
  found: boolean;
  name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  description: string | null;
  linkedinUrl: string | null;
  location: string | null;
  founded: number | null;
  logoUrl: string | null;
  phone: string | null;
  parentCompanyName: string | null;
  parentCompanyDomain: string | null;
  confidence: number;
  sources: string[];
}

/**
 * Enrich a company using SerpAPI web search + LLM extraction.
 * Replaces PDL Company Enrich + Crustdata Company.
 */
export async function enrichCompanySerpAI(
  domain: string,
  options: {
    name?: string;
    locality?: string;
    region?: string;
    clerkOrgId?: string;
  } = {}
): Promise<SerpCompanyEnrichmentResult> {
  const empty: SerpCompanyEnrichmentResult = {
    found: false, name: null, domain: null, website: null,
    industry: null, employeeCount: null, employeeRange: null,
    description: null, linkedinUrl: null, location: null,
    founded: null, logoUrl: null, phone: null,
    parentCompanyName: null, parentCompanyDomain: null,
    confidence: 0, sources: [],
  };

  if (!domain && !options.name) return empty;

  // Check cache
  const cacheKey = `serp-company:${(domain || '').toLowerCase()}`;
  const cached = await cacheGet<SerpCompanyEnrichmentResult>(cacheKey);
  if (cached) {
    console.log(`[SerpCompanyEnrich] Cache hit: ${cacheKey}`);
    return cached;
  }

  try {
    const queries: string[] = [];

    if (domain) {
      queries.push(`"${domain}" company`);
    }
    if (options.name) {
      queries.push(`"${options.name}" official website`);
      if (options.locality) {
        queries.push(`"${options.name}" ${options.locality} ${options.region || ''} company`);
      }
    }

    const searchResults = await Promise.all(
      queries.slice(0, 3).map(q => serpWebSearch({ query: q, numResults: 3 }))
    );

    const allResults = searchResults.flat();
    if (allResults.length === 0) return empty;

    const resultContext = allResults.map((r, i) =>
      `[${i + 1}] ${r.title}\n    URL: ${r.link}\n    ${r.snippet}`
    ).join('\n\n');

    const stageConfig = getStageConfig('stage2_ownership');
    const adapter = getLLMAdapter(stageConfig.provider);

    const prompt = `Extract structured company information from these search results. Return ONLY valid JSON.

${domain ? `DOMAIN: ${domain}` : ''}
${options.name ? `COMPANY NAME: ${options.name}` : ''}
${options.locality ? `LOCATION: ${options.locality}, ${options.region || ''}` : ''}

SEARCH RESULTS:
${resultContext}

Extract and return JSON:
{
  "found": true,
  "name": "Company Legal Name",
  "domain": "company.com",
  "website": "https://company.com",
  "industry": "Industry | null",
  "employeeCount": 0,
  "employeeRange": "11-50 | 51-200 | 201-500 | 501-1000 | 1001-5000 | 5001+ | null",
  "description": "One sentence description | null",
  "linkedinUrl": "https://linkedin.com/company/... | null",
  "location": "City, State | null",
  "founded": 2000,
  "phone": "+1... | null",
  "parentCompanyName": "Parent company name if subsidiary | null",
  "parentCompanyDomain": "parentcompany.com if known | null",
  "confidence": 0.0
}

If the company cannot be identified, return {"found": false}.`;

    const response = await adapter.call(prompt, {
      model: stageConfig.model,
      temperature: 0.3,
      stageName: 'serp-company-enrichment',
      searchGrounding: false,
      timeoutMs: 30_000,
    });

    const parsed = parseJsonResponse(response.text);

    trackCostFireAndForget({
      provider: stageConfig.provider,
      endpoint: 'serp-company-enrichment',
      entityType: 'organization',
      clerkOrgId: options.clerkOrgId,
      success: !!parsed.found,
      metadata: { domain, name: options.name },
    });

    if (!parsed.found) {
      await cacheSet(cacheKey, empty, SERP_COMPANY_NEGATIVE_TTL);
      return empty;
    }

    const result: SerpCompanyEnrichmentResult = {
      found: true,
      name: parsed.name || options.name || null,
      domain: parsed.domain || domain || null,
      website: parsed.website || (domain ? `https://${domain}` : null),
      industry: parsed.industry || null,
      employeeCount: parsed.employeeCount || null,
      employeeRange: parsed.employeeRange || null,
      description: parsed.description || null,
      linkedinUrl: parsed.linkedinUrl || null,
      location: parsed.location || null,
      founded: parsed.founded || null,
      logoUrl: null,
      phone: parsed.phone || null,
      parentCompanyName: parsed.parentCompanyName || null,
      parentCompanyDomain: parsed.parentCompanyDomain || null,
      confidence: parsed.confidence || 0.5,
      sources: allResults.map(r => r.link).filter(Boolean),
    };
    await cacheSet(cacheKey, result, SERP_COMPANY_CACHE_TTL);
    return result;
  } catch (error) {
    console.error(`[SerpCompanyEnrich] Failed for ${domain || options.name}: ${error instanceof Error ? error.message : error}`);
    trackCostFireAndForget({
      provider: 'serpapi',
      endpoint: 'serp-company-enrichment',
      entityType: 'organization',
      clerkOrgId: options.clerkOrgId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
