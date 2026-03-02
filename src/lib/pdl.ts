import { trackCostFireAndForget, PDL_COST } from '@/lib/cost-tracker';
import { rateLimiters, withRetry } from './rate-limiter';
import { normalizeDomain } from './normalization';

const PDL_API_BASE = 'https://api.peopledatalabs.com/v5';

export interface PDLPersonResult {
  found: boolean;
  confidence: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  workEmail: string | null;
  personalEmails: string[] | null;
  emailsJson: any[] | null;
  phonesJson: any[] | null;
  mobilePhone: string | null;
  linkedinUrl: string | null;
  title: string | null;
  titleRole: string | null;
  titleLevels: string[] | null;
  titleClass: string | null;
  titleSubRole: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyPdlId: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  addressesJson: any[] | null;
  industry: string | null;
  gender: string | null;
  photoUrl: string | null;
  domainMatch: boolean;
  datasetVersion: string | null;
  raw?: any;
}

export interface PDLCompanyResult {
  found: boolean;
  pdlCompanyId: string | null;
  affiliatedProfiles: string[] | null;
  alternativeDomains: string[] | null;
  datasetVersion: string | null;
  name: string | null;
  displayName: string | null;
  description: string | null;
  website: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  foundedYear: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sicCode: string | null;
  naicsCode: string | null;
  tags: string[] | null;
  phone: string | null;
  twitterUrl: string | null;
  facebookUrl: string | null;
  logoUrl: string | null;
  raw?: any;
}

function normalizeFirstName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z]/g, '');
}

function normalizeLastName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z]/g, '');
}

function strictMatch(
  input: { firstName: string; lastName: string; domain: string },
  result: { firstName: string | null; lastName: string | null; companyDomain: string | null }
): boolean {
  if (!result.firstName || !result.lastName || !result.companyDomain) {
    return false;
  }
  
  const inputFirst = normalizeFirstName(input.firstName);
  const inputLast = normalizeLastName(input.lastName);
  const inputDomain = normalizeDomain(input.domain);
  
  const resultFirst = normalizeFirstName(result.firstName);
  const resultLast = normalizeLastName(result.lastName);
  const resultDomain = normalizeDomain(result.companyDomain);
  
  const firstMatch = inputFirst === resultFirst;
  const lastMatch = inputLast === resultLast;
  const domainMatch = inputDomain === resultDomain;
  
  return firstMatch && lastMatch && domainMatch;
}

function emptyPersonResult(): PDLPersonResult {
  return {
    found: false,
    confidence: 0,
    firstName: null,
    lastName: null,
    fullName: null,
    email: null,
    workEmail: null,
    personalEmails: null,
    emailsJson: null,
    phonesJson: null,
    mobilePhone: null,
    linkedinUrl: null,
    title: null,
    titleRole: null,
    titleLevels: null,
    titleClass: null,
    titleSubRole: null,
    companyName: null,
    companyDomain: null,
    companyPdlId: null,
    location: null,
    city: null,
    state: null,
    addressesJson: null,
    industry: null,
    gender: null,
    photoUrl: null,
    domainMatch: false,
    datasetVersion: null,
  };
}

function emptyCompanyResult(): PDLCompanyResult {
  return {
    found: false,
    pdlCompanyId: null,
    affiliatedProfiles: null,
    alternativeDomains: null,
    datasetVersion: null,
    name: null,
    displayName: null,
    description: null,
    website: null,
    linkedinUrl: null,
    industry: null,
    employeeCount: null,
    employeeRange: null,
    foundedYear: null,
    city: null,
    state: null,
    country: null,
    sicCode: null,
    naicsCode: null,
    tags: null,
    phone: null,
    twitterUrl: null,
    facebookUrl: null,
    logoUrl: null,
  };
}

export async function enrichPersonPDL(
  firstName: string,
  lastName: string,
  domain: string,
  options: { location?: string; useSearch?: boolean; companyName?: string; email?: string; linkedinUrl?: string } = {}
): Promise<PDLPersonResult> {
  const apiKey = process.env.PDL_API_KEY || process.env.PEOPLEDATALABS_API_KEY;
  
  if (!apiKey) {
    console.warn('[PDL] PDL_API_KEY / PEOPLEDATALABS_API_KEY not configured');
    return emptyPersonResult();
  }

  try {
    const result = await withRetry(
      () => rateLimiters.pdlPerson.execute(async () => {
          if (options.useSearch) {
            const mustClauses: any[] = [];
            
            if (firstName) {
              mustClauses.push({ match: { first_name: firstName.toLowerCase() } });
            }
            if (lastName) {
              mustClauses.push({ match: { last_name: lastName.toLowerCase() } });
            }
            
            const shouldClauses: any[] = [];
            if (domain) {
              shouldClauses.push({ term: { job_company_website: normalizeDomain(domain) } });
              const companyFromDomain = domain
                .replace(/^www\./i, '')
                .replace(/\.(com|org|net|io|co|ai|app|dev)$/i, '')
                .replace(/[-_]/g, ' ');
              shouldClauses.push({ match: { job_company_name: companyFromDomain } });
            }
            
            if (options.location) {
              shouldClauses.push({ match: { location_name: options.location } });
            }
            
            const esQuery: any = {
              query: {
                bool: {
                  must: mustClauses,
                  should: shouldClauses,
                }
              },
              size: 5,
            };
            
            const response = await fetch(`${PDL_API_BASE}/person/search`, {
              method: 'POST',
              headers: {
                'X-Api-Key': apiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(esQuery),
            });

            const responseText = await response.text();

            if (response.status === 404) {
              return { found: false };
            }

            if (response.status === 402) {
              console.error('[PDL] Insufficient credits or payment required');
              throw new Error('PDL API: Insufficient credits');
            }

            if (response.status === 429) {
              throw new Error('Rate limit hit');
            }

            if (!response.ok) {
              console.error('[PDL] Person search error:', response.status, responseText);
              throw new Error(`PDL API error: ${response.status} - ${responseText}`);
            }

            const data = JSON.parse(responseText);
            console.log('[PDL] Search total results:', data.total);
            
            if (data.total === 0 || !data.data?.[0]) {
              return { found: false };
            }
            
            let bestMatch = data.data[0];
            const normalizedInputDomain = normalizeDomain(domain || '');
            
            for (const person of data.data) {
              const personDomain = normalizeDomain(person.job_company_website || '');
              if (personDomain === normalizedInputDomain) {
                bestMatch = person;
                break;
              }
            }
            
            console.log('[PDL] Search best match:', bestMatch.full_name, 'at', bestMatch.job_company_name);
            return { found: true, data: { data: bestMatch, likelihood: 0.7 } };
          }
          
          const params = new URLSearchParams();
          
          params.append('first_name', firstName);
          if (lastName) {
            params.append('last_name', lastName);
          }
          
          if (options.companyName) {
            params.append('company', options.companyName);
          } else if (domain) {
            const companyFromDomain = domain
              .replace(/^www\./i, '')
              .replace(/\.(com|org|net|io|co|ai|app|dev)$/i, '')
              .replace(/[-_]/g, ' ');
            params.append('company', companyFromDomain);
          }
          
          if (options.location) {
            params.append('location', options.location);
          }

          if (options.email) {
            params.append('email', options.email);
          }

          if (options.linkedinUrl) {
            params.append('profile', options.linkedinUrl);
          }
          
          params.append('min_likelihood', '6');
          params.append('pretty', 'true');
          params.append('titlecase', 'true');

          const response = await fetch(`${PDL_API_BASE}/person/enrich?${params}`, {
            method: 'GET',
            headers: {
              'X-Api-Key': apiKey,
            },
          });

          const responseText = await response.text();

          if (response.status === 404) {
            console.log('[PDL] Enrich: No match found');
            return { found: false };
          }

          if (response.status === 402) {
            console.error('[PDL] Insufficient credits');
            throw new Error('PDL API: Insufficient credits');
          }

          if (response.status === 429) {
            throw new Error('Rate limit hit');
          }

          if (!response.ok) {
            console.error('[PDL] Person enrichment error:', response.status, responseText);
            throw new Error(`PDL API error: ${response.status} - ${responseText}`);
          }

          const data = JSON.parse(responseText);
          console.log('[PDL] Enrich found person:', data.data?.full_name || data.full_name, 'likelihood:', data.likelihood);
          return { found: true, data };
        }),
      { maxRetries: 3, baseDelayMs: 3000, serviceName: 'PDL Person' }
    );

    if (!result.found || !result.data) {
      trackCostFireAndForget({
        provider: 'pdl',
        endpoint: options.useSearch ? 'person/search' : 'person/enrich',
        entityType: 'contact',
        success: true,
        metadata: { found: false },
      });
      return emptyPersonResult();
    }

    const person = result.data.data || result.data;

    const latestExp = person.experience?.[0] || {};
    const expTitle = latestExp.title?.name || latestExp.job_title || null;
    const expCompanyName = latestExp.company?.name || latestExp.job_company_name || null;
    const expCompanyWebsite = latestExp.company?.website || latestExp.job_company_website || null;
    const expTitleRole = latestExp.title?.role || null;
    const expTitleLevels = latestExp.title?.levels || null;
    const expTitleClass = latestExp.title?.class || null;
    const expTitleSubRole = latestExp.title?.sub_role || null;

    const personFullName = person.full_name || null;
    const personTitle = person.job_title || expTitle || null;
    const personCompanyName = person.job_company_name || expCompanyName || null;
    const personCompanyWebsite = person.job_company_website || expCompanyWebsite || null;

    const emailsArray = Array.isArray(person.emails) ? person.emails : [];
    const professionalEmail = emailsArray.find((e: any) => e.type === 'professional')?.address || null;
    const resolvedWorkEmail = person.work_email || professionalEmail || null;

    if (!personFullName) {
      console.log('[PDL] Incomplete match - no full_name in response');
      return emptyPersonResult();
    }

    if (!personTitle || !personCompanyName) {
      console.log('[PDL] Partial match - person found but missing current employment:', {
        full_name: personFullName,
        job_title: !!personTitle,
        job_company_name: !!personCompanyName,
        job_company_website: !!personCompanyWebsite,
        usedExperienceFallback: !person.job_company_name && !!expCompanyName,
        experienceCount: person.experience?.length || 0,
      });
    }
    
    const resultData = {
      firstName: person.first_name || null,
      lastName: person.last_name || null,
      companyDomain: personCompanyWebsite,
    };
    
    const isStrictMatch = domain ? strictMatch(
      { firstName, lastName, domain },
      resultData
    ) : false;

    const linkedinProfiles = person.profiles?.filter((p: any) => p.network === 'linkedin') || [];
    let linkedinUrl = linkedinProfiles[0]?.url || person.linkedin_url || null;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    trackCostFireAndForget({
      provider: 'pdl',
      endpoint: options.useSearch ? 'person/search' : 'person/enrich',
      entityType: 'contact',
      costOverrideUsd: PDL_COST.PERSON_ENRICH_SUCCESS,
      success: true,
      metadata: { found: true },
    });

    return {
      found: true,
      confidence: isStrictMatch ? (result.data.likelihood / 10 || 0.8) : (result.data.likelihood / 10 || 0.5),
      firstName: person.first_name || null,
      lastName: person.last_name || null,
      fullName: personFullName,
      email: resolvedWorkEmail || person.personal_emails?.[0] || null,
      workEmail: resolvedWorkEmail,
      personalEmails: person.personal_emails || null,
      emailsJson: person.emails || null,
      phonesJson: person.phone_numbers || null,
      mobilePhone: person.mobile_phone || null,
      linkedinUrl,
      title: personTitle,
      titleRole: person.job_title_role || expTitleRole || null,
      titleLevels: person.job_title_levels || expTitleLevels || null,
      titleClass: person.job_title_class || expTitleClass || null,
      titleSubRole: person.job_title_sub_role || expTitleSubRole || null,
      companyName: personCompanyName,
      companyDomain: resultData.companyDomain,
      companyPdlId: person.job_company_id || latestExp.company?.id || null,
      location: person.location_name || null,
      city: person.location_locality || null,
      state: person.location_region || null,
      addressesJson: person.street_addresses || null,
      industry: person.industry || null,
      gender: person.sex || null,
      photoUrl: person.profile_pic_url || null,
      domainMatch: isStrictMatch,
      datasetVersion: person.dataset_version || null,
      raw: result.data,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'pdl',
      endpoint: options.useSearch ? 'person/search' : 'person/enrich',
      entityType: 'contact',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error('[PDL] Person enrichment failed:', error);
    return emptyPersonResult();
  }
}

export async function enrichCompanyPDL(
  domain: string,
  options: { name?: string; linkedinUrl?: string; locality?: string; region?: string; streetAddress?: string; postalCode?: string; country?: string; ticker?: string; pdlId?: string } = {}
): Promise<PDLCompanyResult> {
  const apiKey = process.env.PDL_API_KEY || process.env.PEOPLEDATALABS_API_KEY;
  
  if (!apiKey) {
    console.warn('[PDL] PDL_API_KEY / PEOPLEDATALABS_API_KEY not configured');
    return emptyCompanyResult();
  }

  if (!domain && !options.name && !options.linkedinUrl && !options.ticker && !options.pdlId) {
    console.warn('[PDL] No identifiers provided for company enrichment');
    return emptyCompanyResult();
  }

  async function attemptEnrich(params: URLSearchParams, attemptLabel: string): Promise<{ found: boolean; data?: any }> {
    const response = await fetch(`${PDL_API_BASE}/company/enrich?${params}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey! },
    });

    if (response.status === 404) {
      return { found: false };
    }

    if (response.status === 402) {
      console.error('[PDL] Insufficient credits');
      throw new Error('PDL API: Insufficient credits');
    }

    if (response.status === 429) {
      throw new Error('Rate limit hit');
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`[PDL] Company enrichment error (${attemptLabel}):`, text);
      throw new Error(`PDL API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[PDL] Company found (${attemptLabel}):`, data.name, '| likelihood:', data.likelihood);
    return { found: true, data };
  }

  try {
    const result = await withRetry(
      () => rateLimiters.pdlCompany.execute(async () => {
          const baseParams = new URLSearchParams({
            pretty: 'true',
            titlecase: 'true',
            min_likelihood: '5',
          });

          if (options.pdlId) {
            baseParams.set('pdl_id', options.pdlId);
            const pdlIdAttempt = await attemptEnrich(baseParams, 'pdl_id lookup');
            if (pdlIdAttempt.found) return pdlIdAttempt;
            return { found: false };
          }

          if (domain) baseParams.set('website', domain);
          if (options.name) baseParams.set('name', options.name);
          if (options.linkedinUrl) baseParams.set('profile', options.linkedinUrl);
          if (options.locality) baseParams.set('locality', options.locality);
          if (options.region) baseParams.set('region', options.region);
          if (options.streetAddress) baseParams.set('street_address', options.streetAddress);
          if (options.postalCode) baseParams.set('postal_code', options.postalCode);
          if (options.country) baseParams.set('country', options.country);
          if (options.ticker) baseParams.set('ticker', options.ticker);

          const attempt1 = await attemptEnrich(baseParams, 'attempt 1 (all params)');
          if (attempt1.found) return attempt1;

          if (domain && options.name) {
            const nameOnlyParams = new URLSearchParams({
              name: options.name,
              pretty: 'true',
              titlecase: 'true',
              min_likelihood: '5',
            });
            if (options.linkedinUrl) nameOnlyParams.set('profile', options.linkedinUrl);
            if (options.locality) nameOnlyParams.set('locality', options.locality);
            if (options.region) nameOnlyParams.set('region', options.region);
            if (options.streetAddress) nameOnlyParams.set('street_address', options.streetAddress);
            if (options.postalCode) nameOnlyParams.set('postal_code', options.postalCode);
            if (options.country) nameOnlyParams.set('country', options.country);

            console.log('[PDL] Domain-based lookup failed, retrying with name-based lookup...');
            const attempt2 = await attemptEnrich(nameOnlyParams, 'attempt 2 (name only)');
            if (attempt2.found) return attempt2;
          }

          if (options.linkedinUrl && !domain) {
            const profileParams = new URLSearchParams({
              profile: options.linkedinUrl,
              pretty: 'true',
              titlecase: 'true',
              min_likelihood: '5',
            });
            if (options.name) profileParams.set('name', options.name);

            console.log('[PDL] Trying LinkedIn profile-based lookup...');
            const attempt3 = await attemptEnrich(profileParams, 'attempt 3 (profile)');
            if (attempt3.found) return attempt3;
          }

          return { found: false };
        }),
      { maxRetries: 3, baseDelayMs: 3000, serviceName: 'PDL Company' }
    );

    if (!result.found || !result.data) {
      trackCostFireAndForget({
        provider: 'pdl',
        endpoint: 'company/enrich',
        entityType: 'company',
        success: true,
        metadata: { found: false },
      });
      return emptyCompanyResult();
    }

    const company = result.data;
    
    const linkedinHandle = company.linkedin_url || company.linkedin_id;
    const linkedinUrl = linkedinHandle 
      ? (linkedinHandle.startsWith('http') ? linkedinHandle : `https://${linkedinHandle}`)
      : null;

    const employeeRange = company.size 
      || (company.employee_count ? getEmployeeRange(company.employee_count) : null);

    trackCostFireAndForget({
      provider: 'pdl',
      endpoint: 'company/enrich',
      entityType: 'company',
      costOverrideUsd: PDL_COST.COMPANY_ENRICH_SUCCESS,
      success: true,
      metadata: { found: true },
    });

    return {
      found: true,
      pdlCompanyId: company.id || null,
      affiliatedProfiles: Array.isArray(company.affiliated_profiles) && company.affiliated_profiles.length > 0
        ? company.affiliated_profiles : null,
      alternativeDomains: Array.isArray(company.alternative_domains) && company.alternative_domains.length > 0
        ? company.alternative_domains : null,
      datasetVersion: company.dataset_version || null,
      name: company.name || null,
      displayName: company.display_name || company.name || null,
      description: company.summary || company.description || null,
      website: company.website || (domain ? `https://${domain}` : null),
      linkedinUrl,
      industry: company.industry || null,
      employeeCount: company.employee_count || null,
      employeeRange,
      foundedYear: company.founded || null,
      city: company.location?.locality || company.location?.name?.split(',')[0]?.trim() || null,
      state: company.location?.region || null,
      country: company.location?.country || null,
      sicCode: company.sic?.[0]?.sic_code?.toString() || company.sic?.[0]?.toString() || null,
      naicsCode: company.naics?.[0]?.naics_code?.toString() || company.naics?.[0]?.toString() || null,
      tags: company.tags || null,
      phone: company.phone || null,
      twitterUrl: company.twitter_url || null,
      facebookUrl: company.facebook_url || null,
      logoUrl: company.profile_pic_url || company.logo_url || null,
      raw: result.data,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'pdl',
      endpoint: 'company/enrich',
      entityType: 'company',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error('[PDL] Company enrichment failed:', error);
    return emptyCompanyResult();
  }
}

function getEmployeeRange(count: number): string {
  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  if (count <= 200) return '51-200';
  if (count <= 500) return '201-500';
  if (count <= 1000) return '501-1000';
  if (count <= 5000) return '1001-5000';
  if (count <= 10000) return '5001-10000';
  return '10001+';
}

export async function checkExistingContact(
  email: string,
  fullName: string,
  db: any,
  contactsTable: any,
  eq: any
): Promise<{ exists: boolean; contact?: any }> {
  const normalizedEmail = email.toLowerCase().trim();
  
  const [existingByEmail] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.normalizedEmail, normalizedEmail))
    .limit(1);
  
  if (existingByEmail) {
    return { exists: true, contact: existingByEmail };
  }
  
  return { exists: false };
}
