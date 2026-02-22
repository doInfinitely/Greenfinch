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

interface DomainValidationResult {
  isValid: boolean;
  reason: string;
  finalUrl?: string;
  finalDomain?: string;
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

export async function validateDomain(
  url: string,
  expectedCompanyName?: string
): Promise<DomainValidationResult> {
  const inputDomain = extractDomain(url);
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;

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
      return {
        isValid: true,
        reason: `DNS resolves, HTTP ${response.status} (likely anti-bot protection)`,
        finalUrl: response.url,
        finalDomain: extractDomain(response.url),
      };
    }

    const finalUrl = response.url;
    const finalDomain = extractDomain(finalUrl);

    if (!domainsMatch(inputDomain, finalDomain)) {
      for (const parkingDomain of PARKING_DOMAINS) {
        if (finalDomain === parkingDomain || finalDomain.endsWith(`.${parkingDomain}`)) {
          return {
            isValid: false,
            reason: `Redirects to parking service: ${finalDomain}`,
            finalUrl,
            finalDomain,
          };
        }
      }

      console.log(`[DomainValidator] ${inputDomain} redirected to ${finalDomain} — checking if legitimate redirect`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return {
        isValid: true,
        reason: 'Non-HTML response, assuming valid',
        finalUrl,
        finalDomain,
      };
    }

    const bodyText = await response.text();
    const lowerBody = bodyText.substring(0, 50000).toLowerCase();

    let parkingScore = 0;
    const matchedIndicators: string[] = [];

    for (const indicator of PARKING_INDICATORS) {
      if (lowerBody.includes(indicator.toLowerCase())) {
        parkingScore++;
        matchedIndicators.push(indicator);
      }
    }

    const hasMinimalContent = lowerBody.replace(/<[^>]*>/g, '').trim().length < 500;
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
      return {
        isValid: false,
        reason: `Domain appears parked (score=${parkingScore}): ${matchedIndicators.slice(0, 3).join(', ')}`,
        finalUrl,
        finalDomain,
      };
    }

    if (!domainsMatch(inputDomain, finalDomain)) {
      if (expectedCompanyName) {
        const normalizedCompany = expectedCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normalizedFinalDomain = finalDomain.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/g, '');
        const companyWords = expectedCompanyName.toLowerCase()
          .replace(/[,.]| llc| inc| ltd| corp| company| group| properties| real estate| management| partners| capital| investments/gi, '')
          .trim()
          .split(/\s+/)
          .filter(w => w.length > 2);
        const anyWordInBody = companyWords.some(w => lowerBody.includes(w));
        const anyWordInDomain = companyWords.some(w => normalizedFinalDomain.includes(w));

        if (normalizedFinalDomain.includes(normalizedCompany) ||
            normalizedCompany.includes(normalizedFinalDomain) ||
            anyWordInDomain ||
            anyWordInBody) {
          return {
            isValid: true,
            reason: `Redirects to ${finalDomain} which matches company "${expectedCompanyName}"`,
            finalUrl,
            finalDomain,
          };
        }
      }

      return {
        isValid: false,
        reason: `Redirects to unrelated domain: ${finalDomain}`,
        finalUrl,
        finalDomain,
      };
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
        return {
          isValid: false,
          reason: `Page content does not reference company "${expectedCompanyName}"`,
          finalUrl,
          finalDomain,
        };
      }
    }

    return {
      isValid: true,
      reason: 'Domain resolves and content appears legitimate',
      finalUrl,
      finalDomain,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('abort') || errMsg.includes('timeout')) {
      console.log(`[DomainValidator] ${inputDomain} timed out — accepting as unverified (connection was established)`);
      return {
        isValid: true,
        reason: `Domain timed out but connection initiated (likely slow or heavy site)`,
        finalDomain: inputDomain,
      };
    }

    if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
      return {
        isValid: false,
        reason: 'Domain does not resolve (DNS failure)',
      };
    }

    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ECONNRESET')) {
      return {
        isValid: false,
        reason: `Connection refused/reset: ${errMsg}`,
      };
    }

    return {
      isValid: false,
      reason: `Validation error: ${errMsg.substring(0, 100)}`,
    };
  }
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
