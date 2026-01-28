import pRetry from 'p-retry';
import pLimit from 'p-limit';

const PDL_API_BASE = 'https://api.peopledatalabs.com/v5';
const CONCURRENCY = 2;
const limit = pLimit(CONCURRENCY);

export interface PDLPersonResult {
  found: boolean;
  confidence: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  linkedinUrl: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  location: string | null;
  photoUrl: string | null;
  domainMatch: boolean;
  raw?: any;
}

export interface PDLCompanyResult {
  found: boolean;
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
  raw?: any;
}

function normalizeFirstName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z]/g, '');
}

function normalizeLastName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z]/g, '');
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^www\./, '');
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

export async function enrichPersonPDL(
  firstName: string,
  lastName: string,
  domain: string,
  options: { location?: string; useSearch?: boolean; companyName?: string } = {}
): Promise<PDLPersonResult> {
  const apiKey = process.env.PEOPLEDATALABS_API_KEY;
  
  if (!apiKey) {
    console.warn('[PDL] PEOPLEDATALABS_API_KEY not configured');
    return {
      found: false,
      confidence: 0,
      firstName: null,
      lastName: null,
      fullName: null,
      email: null,
      linkedinUrl: null,
      title: null,
      companyName: null,
      companyDomain: null,
      location: null,
      photoUrl: null,
      domainMatch: false,
    };
  }

  try {
    const result = await limit(() =>
      pRetry(
        async () => {
          if (options.useSearch) {
            // PDL Person Search API - Elasticsearch query
            // Build a flexible query that can match on name + company
            const mustClauses: any[] = [];
            
            // Name matching - use match for flexibility
            if (firstName) {
              mustClauses.push({ match: { first_name: firstName.toLowerCase() } });
            }
            if (lastName) {
              mustClauses.push({ match: { last_name: lastName.toLowerCase() } });
            }
            
            // Company matching - try both domain and name
            if (domain) {
              // Use should clause for flexible company matching
              mustClauses.push({
                bool: {
                  should: [
                    { term: { job_company_website: normalizeDomain(domain) } },
                    { match: { job_company_name: domain.replace(/\.(com|org|net|io|co)$/i, '') } },
                  ],
                  minimum_should_match: 1,
                }
              });
            }
            
            // Location is optional boost
            const shouldClauses: any[] = [];
            if (options.location) {
              shouldClauses.push({ match: { location_name: options.location } });
            }
            
            const esQuery: any = {
              query: {
                bool: {
                  must: mustClauses,
                }
              },
              size: 5, // Get top 5 results to find best match
            };
            
            if (shouldClauses.length > 0) {
              esQuery.query.bool.should = shouldClauses;
            }
            
            console.log('[PDL] Search API query:', JSON.stringify(esQuery, null, 2));
            
            const response = await fetch(`${PDL_API_BASE}/person/search`, {
              method: 'POST',
              headers: {
                'X-Api-Key': apiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(esQuery),
            });

            console.log('[PDL] Search response status:', response.status);
            const responseText = await response.text();
            console.log('[PDL] Search response body:', responseText.slice(0, 1000));

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
            
            // Find best match - prefer one with matching domain
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
          
          // PDL Person Enrich API - requires specific identifying info
          // Build params based on available data
          const params = new URLSearchParams();
          
          // Always add name
          params.append('first_name', firstName);
          if (lastName) {
            params.append('last_name', lastName);
          }
          
          // PDL Enrich API: 'company' should be company NAME, not domain
          // If we have a company name, use it; otherwise try to derive from domain
          if (options.companyName) {
            params.append('company', options.companyName);
          } else if (domain) {
            // Try to extract company name from domain (e.g., google.com -> google)
            const companyFromDomain = domain
              .replace(/^www\./i, '')
              .replace(/\.(com|org|net|io|co|ai|app|dev)$/i, '')
              .replace(/[-_]/g, ' ');
            params.append('company', companyFromDomain);
          }
          
          if (options.location) {
            params.append('location', options.location);
          }
          
          // Set minimum likelihood threshold for quality
          params.append('min_likelihood', '3');

          console.log('[PDL] Enrich API params:', Object.fromEntries(params));

          const response = await fetch(`${PDL_API_BASE}/person/enrich?${params}`, {
            method: 'GET',
            headers: {
              'X-Api-Key': apiKey,
            },
          });

          console.log('[PDL] Enrich response status:', response.status);
          const responseText = await response.text();
          console.log('[PDL] Enrich response body:', responseText.slice(0, 1000));

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
        },
        {
          retries: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
        }
      )
    );

    if (!result.found || !result.data) {
      return {
        found: false,
        confidence: 0,
        firstName: null,
        lastName: null,
        fullName: null,
        email: null,
        linkedinUrl: null,
        title: null,
        companyName: null,
        companyDomain: null,
        location: null,
        photoUrl: null,
        domainMatch: false,
      };
    }

    const person = result.data.data || result.data;
    const job = person.job_company_name ? person : (person.experience?.[0] || {});
    
    const resultData = {
      firstName: person.first_name || null,
      lastName: person.last_name || null,
      companyDomain: job.job_company_website || person.job_company_website || null,
    };
    
    const isStrictMatch = domain ? strictMatch(
      { firstName, lastName, domain },
      resultData
    ) : false;

    // Get LinkedIn URL from profiles array or direct field
    const linkedinProfiles = person.profiles?.filter((p: any) => p.network === 'linkedin') || [];
    const linkedinUrl = linkedinProfiles[0]?.url || person.linkedin_url || null;

    return {
      found: true,
      confidence: isStrictMatch ? (result.data.likelihood / 10 || 0.8) : (result.data.likelihood / 10 || 0.5),
      firstName: person.first_name || null,
      lastName: person.last_name || null,
      fullName: person.full_name || null,
      email: person.work_email || person.personal_emails?.[0] || null,
      linkedinUrl,
      title: person.job_title || job.job_title || null,
      companyName: person.job_company_name || job.job_company_name || null,
      companyDomain: resultData.companyDomain,
      location: person.location_name || null,
      photoUrl: person.profile_pic_url || null,
      domainMatch: isStrictMatch,
      raw: result.data,
    };
  } catch (error) {
    console.error('[PDL] Person enrichment failed:', error);
    return {
      found: false,
      confidence: 0,
      firstName: null,
      lastName: null,
      fullName: null,
      email: null,
      linkedinUrl: null,
      title: null,
      companyName: null,
      companyDomain: null,
      location: null,
      photoUrl: null,
      domainMatch: false,
    };
  }
}

export async function enrichCompanyPDL(domain: string): Promise<PDLCompanyResult> {
  const apiKey = process.env.PEOPLEDATALABS_API_KEY;
  
  if (!apiKey) {
    console.warn('[PDL] PEOPLEDATALABS_API_KEY not configured');
    return {
      found: false,
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
    };
  }

  try {
    const result = await limit(() =>
      pRetry(
        async () => {
          const params = new URLSearchParams({
            website: domain,
          });

          console.log('[PDL] Company enrich request:', domain);

          const response = await fetch(`${PDL_API_BASE}/company/enrich?${params}`, {
            method: 'GET',
            headers: {
              'X-Api-Key': apiKey,
            },
          });

          console.log('[PDL] Company enrich response status:', response.status);

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
            console.error('[PDL] Company enrichment error:', text);
            throw new Error(`PDL API error: ${response.status}`);
          }

          const data = await response.json();
          console.log('[PDL] Company found:', data.name);
          return { found: true, data };
        },
        {
          retries: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
        }
      )
    );

    if (!result.found || !result.data) {
      return {
        found: false,
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
      };
    }

    const company = result.data;
    
    const linkedinHandle = company.linkedin_url || company.linkedin_id;
    const linkedinUrl = linkedinHandle 
      ? (linkedinHandle.startsWith('http') ? linkedinHandle : `https://linkedin.com/company/${linkedinHandle}`)
      : null;

    const employeeRange = company.size 
      || (company.employee_count ? getEmployeeRange(company.employee_count) : null);

    return {
      found: true,
      name: company.name || null,
      displayName: company.display_name || company.name || null,
      description: company.summary || company.description || null,
      website: company.website || `https://${domain}`,
      linkedinUrl,
      industry: company.industry || null,
      employeeCount: company.employee_count || null,
      employeeRange,
      foundedYear: company.founded || null,
      city: company.location?.locality || company.location?.name?.split(',')[0]?.trim() || null,
      state: company.location?.region || null,
      country: company.location?.country || null,
      raw: result.data,
    };
  } catch (error) {
    console.error('[PDL] Company enrichment failed:', error);
    return {
      found: false,
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
    };
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
