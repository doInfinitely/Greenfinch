import { cacheGet, cacheSet } from './redis';

const SERPAPI_BASE = 'https://serpapi.com/search';

export interface SerpLinkedInResult {
  found: boolean;
  linkedinUrl: string | null;
  profileName: string | null;
  headline: string | null;
  confidence: number;
  raw?: any;
}

const CACHE_TTL_SECONDS = 24 * 60 * 60;

function buildCacheKey(name: string, company: string | null): string {
  const normalized = `${name.toLowerCase().trim()}|${(company || '').toLowerCase().trim()}`;
  return `serp-linkedin:${normalized}`;
}

export async function searchLinkedInProfile(
  firstName: string,
  lastName: string,
  company: string | null
): Promise<SerpLinkedInResult> {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) {
    console.warn('[SERP LinkedIn] SERP_API_KEY not configured');
    return { found: false, linkedinUrl: null, profileName: null, headline: null, confidence: 0 };
  }

  const fullName = `${firstName} ${lastName}`.trim();
  const cacheKey = buildCacheKey(fullName, company);

  try {
    const cached = await cacheGet<SerpLinkedInResult>(cacheKey);
    if (cached) {
      console.log(`[SERP LinkedIn] Cache hit for "${fullName}": ${cached.linkedinUrl || 'no match'}`);
      return cached;
    }
  } catch {
  }

  console.log(`[SERP LinkedIn] Searching for: ${fullName}${company ? ` at ${company}` : ''}`);

  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: `site:linkedin.com/in/ "${firstName} ${lastName}"${company ? ` "${company}"` : ''}`,
      api_key: apiKey,
      num: '5',
    });

    const response = await fetch(`${SERPAPI_BASE}?${params}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SERP LinkedIn] API error ${response.status}:`, errorText.slice(0, 500));
      return { found: false, linkedinUrl: null, profileName: null, headline: null, confidence: 0 };
    }

    const data = await response.json();
    const organicResults = data.organic_results || [];

    console.log(`[SERP LinkedIn] Got ${organicResults.length} results for "${fullName}"`);

    const linkedinMatch = findBestLinkedInMatch(organicResults, firstName, lastName, company);

    if (linkedinMatch) {
      console.log(`[SERP LinkedIn] Found LinkedIn for "${fullName}": ${linkedinMatch.linkedinUrl} (confidence: ${linkedinMatch.confidence})`);
    } else {
      console.log(`[SERP LinkedIn] No LinkedIn match for "${fullName}"`);
    }

    const result: SerpLinkedInResult = linkedinMatch || {
      found: false,
      linkedinUrl: null,
      profileName: null,
      headline: null,
      confidence: 0,
    };

    try {
      await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
    } catch {
    }

    return result;
  } catch (error) {
    console.error('[SERP LinkedIn] Search failed:', error instanceof Error ? error.message : error);
    return { found: false, linkedinUrl: null, profileName: null, headline: null, confidence: 0 };
  }
}

function findBestLinkedInMatch(
  results: any[],
  firstName: string,
  lastName: string,
  company: string | null
): SerpLinkedInResult | null {
  const firstLower = firstName.toLowerCase();
  const lastLower = lastName.toLowerCase();
  const companyLower = company?.toLowerCase() || '';

  for (const result of results) {
    const link = result.link || '';
    const title = result.title || '';
    const snippet = result.snippet || '';

    if (!link.includes('linkedin.com/in/')) continue;

    const url = normalizeLinkedInUrl(link);
    if (!url) continue;

    const titleLower = title.toLowerCase();
    const snippetLower = snippet.toLowerCase();
    const combined = `${titleLower} ${snippetLower}`;

    const hasFirstName = combined.includes(firstLower);
    const hasLastName = combined.includes(lastLower);

    if (!hasFirstName || !hasLastName) continue;

    let confidence = 0.6;

    if (companyLower && combined.includes(companyLower)) {
      confidence = 0.9;
    }

    const slug = url.split('/in/')[1]?.replace(/\/$/, '') || '';
    if (slug.includes(firstLower) && slug.includes(lastLower)) {
      confidence = Math.max(confidence, 0.75);
    }

    if (companyLower) {
      const companyWords = companyLower.split(/\s+/).filter(w => w.length > 3);
      const matchingWords = companyWords.filter(w => combined.includes(w));
      if (matchingWords.length >= Math.ceil(companyWords.length / 2)) {
        confidence = Math.max(confidence, 0.8);
      }
    }

    return {
      found: true,
      linkedinUrl: url,
      profileName: extractNameFromTitle(title),
      headline: snippet.slice(0, 200),
      confidence,
      raw: result,
    };
  }

  return null;
}

function normalizeLinkedInUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('linkedin.com')) return null;

    const pathMatch = parsed.pathname.match(/\/in\/([^/?#]+)/);
    if (!pathMatch) return null;

    return `https://www.linkedin.com/in/${pathMatch[1]}`;
  } catch {
    return null;
  }
}

function extractNameFromTitle(title: string): string | null {
  const cleaned = title
    .replace(/\s*[-–—|]\s*LinkedIn.*$/i, '')
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .trim();

  return cleaned || null;
}
