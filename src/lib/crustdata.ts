import pRetry from 'p-retry';
import pLimit from 'p-limit';
import { trackCostFireAndForget } from '@/lib/cost-tracker';

const CRUSTDATA_API_BASE = 'https://api.crustdata.com';
const CONCURRENCY = 2;
const limit = pLimit(CONCURRENCY);

export interface CrustdataPersonResult {
  found: boolean;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  workEmail: string | null;
  linkedinUrl: string | null;
  location: string | null;
  raw?: any;
}

export interface CrustdataCompanyResult {
  found: boolean;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  headcount: number | null;
  totalFundingRaised: number | null;
  description: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  foundedYear: number | null;
  raw?: any;
}

const EMPTY_PERSON_RESULT: CrustdataPersonResult = {
  found: false,
  title: null,
  companyName: null,
  companyDomain: null,
  workEmail: null,
  linkedinUrl: null,
  location: null,
};

const EMPTY_COMPANY_RESULT: CrustdataCompanyResult = {
  found: false,
  companyName: null,
  companyDomain: null,
  linkedinUrl: null,
  headcount: null,
  totalFundingRaised: null,
  description: null,
  industry: null,
  city: null,
  state: null,
  country: null,
  foundedYear: null,
};

export async function enrichPersonCrustdata(params: {
  linkedinUrl?: string;
  email?: string;
}): Promise<CrustdataPersonResult> {
  const apiKey = process.env.CRUSTDATA_API_KEY;

  if (!apiKey) {
    console.warn('[Crustdata] CRUSTDATA_API_KEY not configured');
    return { ...EMPTY_PERSON_RESULT };
  }

  if (!params.linkedinUrl && !params.email) {
    console.warn('[Crustdata] No linkedinUrl or email provided for person enrichment');
    return { ...EMPTY_PERSON_RESULT };
  }

  try {
    const result = await limit(() =>
      pRetry(
        async () => {
          const queryParams = new URLSearchParams();
          if (params.linkedinUrl) {
            queryParams.append('linkedin_profile_url', params.linkedinUrl);
          } else if (params.email) {
            queryParams.append('business_email', params.email);
          }

          console.log('[Crustdata] Person enrich request:', Object.fromEntries(queryParams));

          const response = await fetch(
            `${CRUSTDATA_API_BASE}/screener/person/enrich?${queryParams}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Token ${apiKey}`,
                'Accept': 'application/json',
              },
            }
          );

          console.log('[Crustdata] Person enrich response status:', response.status);
          const responseText = await response.text();
          console.log('[Crustdata] Person enrich response body:', responseText.slice(0, 1000));

          if (response.status === 404) {
            return { found: false };
          }

          if (response.status === 402) {
            console.error('[Crustdata] Insufficient credits or payment required');
            throw new Error('Crustdata API: Insufficient credits');
          }

          if (response.status === 429) {
            console.warn('[Crustdata] Rate limit hit, will retry...');
            throw new Error('Rate limit hit');
          }

          if (response.status >= 500) {
            console.warn('[Crustdata] Server error (not retrying):', response.status, responseText.slice(0, 200));
            return { found: false };
          }

          if (!response.ok) {
            console.error('[Crustdata] Person enrichment error:', response.status, responseText);
            throw new Error(`Crustdata API error: ${response.status} - ${responseText}`);
          }

          const data = JSON.parse(responseText);
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
      return { ...EMPTY_PERSON_RESULT };
    }

    const person = Array.isArray(result.data) ? result.data[0] : result.data;

    if (!person) {
      return { ...EMPTY_PERSON_RESULT };
    }

    const rawEmails = person.emails || person.email_addresses || [];
    const emails: string[] = rawEmails.map((e: any) => typeof e === 'string' ? e : e?.email || e?.value || e?.address).filter(Boolean);
    const workEmail = emails.length > 0 ? emails[0] : (person.email || null);

    let linkedinUrl = person.linkedin_flagship_url || person.linkedin_profile_url || null;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    const personName = person.name || (person.first_name ? `${person.first_name} ${person.last_name || ''}`.trim() : null);
    const personTitle = person.title || person.current_position_title || person.headline || null;
    const titleClean = personTitle ? personTitle.split(/[;(]/)[0].replace(/\s*\(?\d{4}\s*[-–]\s*(Present|\d{4})\)?/g, '').trim() : null;
    const companyName = person.company_name || person.current_company_name || null;
    const companyDomain = person.company_website_domain || person.current_company_domain || null;

    console.log('[Crustdata] Person found:', personName, 'at', companyName, '| title:', titleClean);

    trackCostFireAndForget({
      provider: 'crustdata',
      endpoint: 'person/enrich',
      entityType: 'contact',
      success: true,
      metadata: { found: true },
    });

    return {
      found: true,
      title: titleClean,
      companyName,
      companyDomain,
      workEmail,
      linkedinUrl,
      location: person.location || null,
      raw: result.data,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'crustdata',
      endpoint: 'person/enrich',
      entityType: 'contact',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error('[Crustdata] Person enrichment failed:', error);
    return { ...EMPTY_PERSON_RESULT };
  }
}

export async function enrichCompanyCrustdata(domain: string): Promise<CrustdataCompanyResult> {
  const apiKey = process.env.CRUSTDATA_API_KEY;

  if (!apiKey) {
    console.warn('[Crustdata] CRUSTDATA_API_KEY not configured');
    return { ...EMPTY_COMPANY_RESULT };
  }

  try {
    const result = await limit(() =>
      pRetry(
        async () => {
          const queryParams = new URLSearchParams({
            company_domain: domain,
          });

          console.log('[Crustdata] Company enrich request:', domain);

          const response = await fetch(
            `${CRUSTDATA_API_BASE}/screener/company?${queryParams}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Token ${apiKey}`,
                'Accept': 'application/json',
              },
            }
          );

          console.log('[Crustdata] Company enrich response status:', response.status);
          const responseText = await response.text();
          console.log('[Crustdata] Company enrich response body:', responseText.slice(0, 1000));

          if (response.status === 404) {
            return { found: false };
          }

          if (response.status === 402) {
            console.error('[Crustdata] Insufficient credits or payment required');
            throw new Error('Crustdata API: Insufficient credits');
          }

          if (response.status === 429) {
            console.warn('[Crustdata] Rate limit hit, will retry...');
            throw new Error('Rate limit hit');
          }

          if (response.status >= 500) {
            console.warn('[Crustdata] Company server error (not retrying):', response.status, responseText.slice(0, 200));
            return { found: false };
          }

          if (!response.ok) {
            console.error('[Crustdata] Company enrichment error:', response.status, responseText);
            throw new Error(`Crustdata API error: ${response.status} - ${responseText}`);
          }

          const data = JSON.parse(responseText);
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
      return { ...EMPTY_COMPANY_RESULT };
    }

    const company = Array.isArray(result.data) ? result.data[0] : result.data;

    if (!company) {
      return { ...EMPTY_COMPANY_RESULT };
    }

    if (company.status === 'enriching' || company.companies_to_be_enriched) {
      console.log('[Crustdata] Company is still being enriched, not yet available');
      return { ...EMPTY_COMPANY_RESULT };
    }

    if (!company.company_name) {
      console.log('[Crustdata] Company response missing company_name field');
      return { ...EMPTY_COMPANY_RESULT };
    }

    let linkedinUrl = company.linkedin_profile_url || null;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    console.log('[Crustdata] Company found:', company.company_name);

    trackCostFireAndForget({
      provider: 'crustdata',
      endpoint: 'company/enrich',
      entityType: 'company',
      success: true,
      metadata: { found: true },
    });

    return {
      found: true,
      companyName: company.company_name || null,
      companyDomain: company.company_website_domain || null,
      linkedinUrl,
      headcount: company.headcount != null ? Number(company.headcount) : null,
      totalFundingRaised: company.total_funding_raised_usd != null ? Number(company.total_funding_raised_usd) : null,
      description: company.company_description || null,
      industry: company.industry || null,
      city: company.city || null,
      state: company.state || null,
      country: company.country || null,
      foundedYear: company.founded_year != null ? Number(company.founded_year) : null,
      raw: result.data,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'crustdata',
      endpoint: 'company/enrich',
      entityType: 'company',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error('[Crustdata] Company enrichment failed:', error);
    return { ...EMPTY_COMPANY_RESULT };
  }
}
