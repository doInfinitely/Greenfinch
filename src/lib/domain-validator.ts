const PARKING_DOMAINS = new Set([
  'sedoparking.com',
  'bodis.com',
  'parkingcrew.net',
  'above.com',
  'hugedomains.com',
  'afternic.com',
  'dan.com',
  'godaddy.com',
  'namesilo.com',
  'domainmarket.com',
  'sav.com',
  'porkbun.com',
  'dynadot.com',
  'name.com',
  'undeveloped.com',
  'brandbucket.com',
  'squadhelp.com',
  'namecheap.com',
  'register.com',
  'domainagents.com',
  'buydomains.com',
  'parked.com',
  'fastdomain.com',
  'bluehost.com',
  'hostgator.com',
  'ionos.com',
  'uni-register.com',
  'web.com',
  'domainlore.com',
  'epik.com',
]);

const PARKING_INDICATORS = [
  'domain is for sale',
  'buy this domain',
  'this domain may be for sale',
  'domain name for sale',
  'purchase this domain',
  'make an offer',
  'domain parking',
  'parked domain',
  'this page is parked',
  'parked by',
  'register this domain',
  'domain has expired',
  'this domain name has been registered',
  'sedoparking',
  'bodis.com',
  'parkingcrew',
  'this webpage is parked',
  'get your domain',
  'related searches',
  'sponsored listings',
  'domain broker',
];

const VALIDATION_TIMEOUT_MS = 8000;
const DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000;

interface DomainValidationResult {
  isValid: boolean;
  reason: string;
  finalUrl?: string;
  finalDomain?: string;
}

interface DomainCacheEntry {
  result: DomainValidationResult;
  expiresAt: number;
}

const _domainCache = new Map<string, DomainCacheEntry>();

function getCached(key: string): DomainValidationResult | null {
  const entry = _domainCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _domainCache.delete(key); return null; }
  return entry.result;
}

function setCache(key: string, result: DomainValidationResult): void {
  _domainCache.set(key, { result, expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
  if (_domainCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _domainCache) { if (now > v.expiresAt) _domainCache.delete(k); }
  }
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^www\./, '');
  }
}

function domainsMatch(domain1: string, domain2: string): boolean {
  const d1 = domain1.replace(/^www\./, '').toLowerCase();
  const d2 = domain2.replace(/^www\./, '').toLowerCase();
  return d1 === d2 || d1.endsWith(`.${d2}`) || d2.endsWith(`.${d1}`);
}

async function _fetchAndValidateDomain(
  fullUrl: string,
  inputDomain: string,
  expectedCompanyName?: string
): Promise<{ result: DomainValidationResult; cacheable: boolean }> {
  const wrap = (result: DomainValidationResult, cacheable = true) => ({ result, cacheable });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(fullUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Greenfinch/1.0)',
          'Accept': 'text/html',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 403 || response.status === 429) {
      console.log(`[DomainValidator] ${inputDomain} returned ${response.status} — accepting as unverified (DNS resolved, likely anti-bot)`);
      return wrap({
        isValid: true,
        reason: `DNS resolves, HTTP ${response.status} (likely anti-bot protection)`,
        finalUrl: response.url,
        finalDomain: extractDomain(response.url),
      });
    }

    const finalUrl = response.url;
    const finalDomain = extractDomain(finalUrl);

    if (!domainsMatch(inputDomain, finalDomain)) {
      for (const parkingDomain of PARKING_DOMAINS) {
        if (finalDomain === parkingDomain || finalDomain.endsWith(`.${parkingDomain}`)) {
          return wrap({
            isValid: false,
            reason: `Redirects to parking service: ${finalDomain}`,
            finalUrl,
            finalDomain,
          });
        }
      }
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return wrap({
        isValid: true,
        reason: 'Non-HTML response, assuming valid',
        finalUrl,
        finalDomain,
      });
    }

    const bodyText = await response.text();
    const lowerBody = bodyText.substring(0, 50000).toLowerCase();

    const strippedText = lowerBody.replace(/<[^>]*>/g, '').trim();
    const hasMinimalContent = strippedText.length < 500;

    if (hasMinimalContent) {
      const jsRedirectPattern = /window\.location\s*[.=]|document\.location\s*[.=]|location\.href\s*=|location\.replace\s*\(/;
      const metaRefreshPattern = /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?/i;
      if (jsRedirectPattern.test(lowerBody) || metaRefreshPattern.test(lowerBody)) {
        console.warn(`[DomainValidator] ${inputDomain} has minimal content with JS/meta redirect — likely parking page`);
        return wrap({
          isValid: false,
          reason: `Minimal content with JS/meta redirect — likely parking or redirect page`,
          finalUrl,
          finalDomain,
        });
      }
    }

    let parkingScore = 0;
    const matchedIndicators: string[] = [];

    for (const indicator of PARKING_INDICATORS) {
      if (lowerBody.includes(indicator.toLowerCase())) {
        parkingScore++;
        matchedIndicators.push(indicator);
      }
    }

    if (hasMinimalContent) {
      parkingScore += 1;
    }

    const titleMatch = lowerBody.match(/<title[^>]*>(.*?)<\/title>/);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '';
    if (pageTitle && (
      pageTitle.includes('for sale') ||
      pageTitle.includes('parked') ||
      pageTitle.includes('domain name') ||
      pageTitle === inputDomain ||
      pageTitle === `www.${inputDomain}`
    )) {
      parkingScore += 2;
    }

    if (parkingScore >= 3) {
      return wrap({
        isValid: false,
        reason: `Domain appears parked (score=${parkingScore}): ${matchedIndicators.slice(0, 3).join(', ')}`,
        finalUrl,
        finalDomain,
      });
    }

    if (!domainsMatch(inputDomain, finalDomain)) {
      console.log(`[DomainValidator] ${inputDomain} redirected to ${finalDomain} — not a parking domain, accepting redirect`);
    }

    if (expectedCompanyName) {
      const companyNameLower = expectedCompanyName.toLowerCase();
      const companyWords = companyNameLower
        .replace(/[,.]| llc| inc| ltd| corp| company| group| properties| real estate/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2);

      const matchingWords = companyWords.filter(w => lowerBody.includes(w));
      if (matchingWords.length === 0 && companyWords.length > 0) {
        console.log(`[DomainValidator] ${inputDomain} content does not reference "${expectedCompanyName}" — accepting anyway (not a parking domain)`);
      }
    }

    return wrap({
      isValid: true,
      reason: 'Domain resolves and content appears legitimate',
      finalUrl,
      finalDomain,
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('abort') || errMsg.includes('timeout')) {
      console.log(`[DomainValidator] ${inputDomain} timed out — accepting as unverified (connection was established)`);
      return wrap({
        isValid: true,
        reason: `Domain timed out but connection initiated (likely slow or heavy site)`,
        finalDomain: inputDomain,
      }, false);
    }

    if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
      return wrap({ isValid: false, reason: 'Domain does not resolve (DNS failure)' });
    }

    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ECONNRESET')) {
      return wrap({ isValid: false, reason: `Connection refused/reset: ${errMsg}` }, false);
    }

    return wrap({ isValid: false, reason: `Validation error: ${errMsg.substring(0, 100)}` }, false);
  }
}

export async function validateDomain(
  url: string,
  expectedCompanyName?: string
): Promise<DomainValidationResult> {
  const inputDomain = extractDomain(url);
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const cacheKey = `${inputDomain}|${expectedCompanyName || ''}`;

  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { result, cacheable } = await _fetchAndValidateDomain(fullUrl, inputDomain, expectedCompanyName);
  if (cacheable) setCache(cacheKey, result);
  return result;
}

export async function validateAndCleanDomain(
  domain: string | null | undefined,
  expectedCompanyName?: string,
  label: string = 'domain'
): Promise<string | null> {
  if (!domain) return null;

  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!cleaned || !cleaned.includes('.')) return null;

  try {
    const result = await validateDomain(cleaned, expectedCompanyName);

    if (result.isValid) {
      const validDomain = result.finalDomain || cleaned;
      console.log(`[DomainValidator] ${label} "${cleaned}" validated: ${result.reason}`);
      return validDomain;
    } else {
      console.warn(`[DomainValidator] ${label} "${cleaned}" REJECTED: ${result.reason}`);
      return null;
    }
  } catch (error) {
    console.warn(`[DomainValidator] ${label} "${cleaned}" validation failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export async function validatePropertyWebsite(
  websiteUrl: string | null | undefined,
  propertyName?: string,
  managementCompanyName?: string
): Promise<{ validatedUrl: string | null; extractedDomain: string | null }> {
  if (!websiteUrl) return { validatedUrl: null, extractedDomain: null };

  const fullUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  try {
    const result = await validateDomain(fullUrl, managementCompanyName || propertyName);

    if (result.isValid) {
      const validDomain = result.finalDomain || extractDomain(fullUrl);
      console.log(`[DomainValidator] Property website "${websiteUrl}" validated: ${result.reason}`);
      return {
        validatedUrl: result.finalUrl || fullUrl,
        extractedDomain: validDomain,
      };
    } else {
      console.warn(`[DomainValidator] Property website "${websiteUrl}" REJECTED: ${result.reason}`);
      return { validatedUrl: null, extractedDomain: null };
    }
  } catch (error) {
    console.warn(`[DomainValidator] Property website validation failed: ${error instanceof Error ? error.message : error}`);
    return { validatedUrl: null, extractedDomain: null };
  }
}
