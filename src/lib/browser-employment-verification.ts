// ============================================================================
// Browser Employment Verification
//
// Replaces Crustdata's employment history verification.
// Uses browser-use to scrape LinkedIn experience section and detect job changes.
// ============================================================================

import { browserExtractEmploymentHistory, type EmploymentHistory } from './browser-use';
import { cacheGet, cacheSet } from './redis';

const VERIFY_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const VERIFY_NEGATIVE_TTL = 24 * 60 * 60; // 24 hours

export interface EmploymentVerificationResult {
  verified: boolean;
  currentEmployer: string | null;
  currentTitle: string | null;
  hasJobChange: boolean;
  previousEmployers: string[];
  confidence: number;
  source: 'browser_use' | 'unavailable';
}

/**
 * Verify a person's current employment using browser-use LinkedIn scraping.
 * Replaces Crustdata Person verification.
 *
 * @param linkedinUrl - LinkedIn profile URL
 * @param expectedCompany - Company we expect them to work at
 * @param expectedDomain - Domain of the expected company
 */
export async function verifyEmployment(
  linkedinUrl: string,
  expectedCompany: string | null,
  expectedDomain: string | null
): Promise<EmploymentVerificationResult> {
  const empty: EmploymentVerificationResult = {
    verified: false,
    currentEmployer: null,
    currentTitle: null,
    hasJobChange: false,
    previousEmployers: [],
    confidence: 0,
    source: 'unavailable',
  };

  if (!linkedinUrl) return empty;

  // Check cache
  const cacheKey = `employment-verify:${linkedinUrl.toLowerCase().replace(/\/$/, '')}`;
  const cached = await cacheGet<EmploymentVerificationResult>(cacheKey);
  if (cached) {
    console.log(`[EmploymentVerification] Cache hit: ${cacheKey}`);
    return cached;
  }

  try {
    const history: EmploymentHistory = await browserExtractEmploymentHistory(linkedinUrl);

    if (!history.currentEmployer && history.experiences.length === 0) {
      return empty;
    }

    const currentEmployer = history.currentEmployer;
    const currentTitle = history.currentTitle;

    // Detect job change
    let hasJobChange = false;
    if (expectedCompany && currentEmployer) {
      const expectedNorm = normalizeCompanyName(expectedCompany);
      const currentNorm = normalizeCompanyName(currentEmployer);
      hasJobChange = !fuzzyCompanyMatch(expectedNorm, currentNorm);

      if (hasJobChange && expectedDomain) {
        // Also check by domain - some companies have different display names
        const currentLower = currentEmployer.toLowerCase();
        const domainBase = expectedDomain.replace(/\.(com|org|net|io|co)$/, '');
        if (currentLower.includes(domainBase) || domainBase.includes(currentNorm)) {
          hasJobChange = false;
        }
      }
    }

    // Build previous employers list
    const previousEmployers = history.experiences
      .filter(e => !e.isCurrent)
      .map(e => e.company)
      .filter(Boolean);

    // Calculate confidence
    let confidence = 0.5;
    if (currentEmployer) confidence += 0.2;
    if (history.experiences.length >= 2) confidence += 0.1;
    if (!hasJobChange && expectedCompany) confidence += 0.1;
    confidence = Math.min(confidence, 1.0);

    const result: EmploymentVerificationResult = {
      verified: !!currentEmployer,
      currentEmployer,
      currentTitle,
      hasJobChange,
      previousEmployers,
      confidence,
      source: 'browser_use',
    };
    await cacheSet(cacheKey, result, result.verified ? VERIFY_CACHE_TTL : VERIFY_NEGATIVE_TTL);
    return result;
  } catch (error) {
    console.error(`[EmploymentVerification] Failed for ${linkedinUrl}: ${error instanceof Error ? error.message : error}`);
    return empty;
  }
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(inc|llc|llp|ltd|corp|corporation|company|co|group|holdings|management|mgmt|properties|realty|real estate)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function fuzzyCompanyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Check if major words overlap
  const wordsA = a.split(' ').filter(w => w.length > 2);
  const wordsB = b.split(' ').filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const matchingWords = wordsA.filter(w => wordsB.includes(w));
  return matchingWords.length >= Math.ceil(Math.min(wordsA.length, wordsB.length) / 2);
}
