import pRetry from 'p-retry';
import pLimit from 'p-limit';

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
            queryParams.append('email', params.email);
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

    const emails = person.emails || [];
    const workEmail = emails.length > 0 ? emails[0] : null;

    let linkedinUrl = person.linkedin_profile_url || null;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    console.log('[Crustdata] Person found:', person.first_name, person.last_name, 'at', person.current_company_name);

    return {
      found: true,
      title: person.current_position_title || null,
      companyName: person.current_company_name || null,
      companyDomain: person.current_company_domain || null,
      workEmail,
      linkedinUrl,
      location: person.location || null,
      raw: result.data,
    };
  } catch (error) {
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

    let linkedinUrl = company.linkedin_profile_url || null;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    console.log('[Crustdata] Company found:', company.company_name);

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
    console.error('[Crustdata] Company enrichment failed:', error);
    return { ...EMPTY_COMPANY_RESULT };
  }
}
