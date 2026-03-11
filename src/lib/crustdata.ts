import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { rateLimiters, withRetry } from './rate-limiter';

const CRUSTDATA_API_BASE = 'https://api.crustdata.com';

export interface CrustdataExperience {
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface CrustdataPersonResult {
  found: boolean;
  personId: number | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  workEmail: string | null;
  linkedinUrl: string | null;
  profilePictureUrl: string | null;
  location: string | null;
  experiences: CrustdataExperience[];
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
  personId: null,
  title: null,
  companyName: null,
  companyDomain: null,
  workEmail: null,
  linkedinUrl: null,
  profilePictureUrl: null,
  location: null,
  experiences: [],
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
  clerkOrgId?: string;
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
    const result = await withRetry(
      () => rateLimiters.crustdata.execute(async () => {
          const queryParams = new URLSearchParams();
          if (params.linkedinUrl) {
            queryParams.append('linkedin_profile_url', params.linkedinUrl);
          } else if (params.email) {
            queryParams.append('business_email', params.email);
          }

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

          const responseText = await response.text();

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
        }),
      {
        maxRetries: 3,
        baseDelayMs: 5000,
        serviceName: 'Crustdata Person',
      }
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

    const currentEmployer = Array.isArray(person.current_employers) && person.current_employers.length > 0
      ? person.current_employers[0]
      : null;
    const companyName = person.company_name || person.current_company_name || currentEmployer?.employer_name || null;
    const currentEmployerDomains = currentEmployer?.domains || currentEmployer?.employer_company_website_domain;
    const companyDomain = person.company_website_domain || person.current_company_domain 
      || (Array.isArray(currentEmployerDomains) ? currentEmployerDomains[0] : currentEmployerDomains) 
      || null;

    console.log('[Crustdata] Person found:', personName, 'at', companyName, '| title:', titleClean);

    trackCostFireAndForget({
      provider: 'crustdata',
      endpoint: 'person/enrich',
      entityType: 'contact',
      clerkOrgId: params.clerkOrgId,
      success: true,
      metadata: { found: true },
    });

    const profilePictureUrl = person.profile_picture_url || person.profile_pic_url || person.photo_url || null;

    const mapEmployerToExperience = (emp: any, isCurrent: boolean): CrustdataExperience => {
      let expCompanyLinkedinUrl = emp.company_linkedin_url || emp.company_linkedin_profile_url || null;
      const linkedinId = emp.employer_linkedin_id;
      if (!expCompanyLinkedinUrl && linkedinId) {
        expCompanyLinkedinUrl = `https://www.linkedin.com/company/${linkedinId}`;
      }
      if (expCompanyLinkedinUrl && !expCompanyLinkedinUrl.startsWith('http')) {
        expCompanyLinkedinUrl = `https://${expCompanyLinkedinUrl}`;
      }
      const endDateRaw = emp.end_date || emp.end_year || null;
      const endDateStr = endDateRaw ? String(endDateRaw) : null;
      const empDomains = emp.domains || emp.employer_company_website_domain;
      const empDomain = Array.isArray(empDomains) ? empDomains[0] : empDomains || null;
      return {
        title: emp.employee_title || emp.title || emp.job_title || null,
        companyName: emp.employer_name || emp.company_name || emp.organization_name || null,
        companyDomain: emp.company_website_domain || emp.company_domain || empDomain,
        companyLinkedinUrl: expCompanyLinkedinUrl,
        startDate: emp.start_date || (emp.start_year ? String(emp.start_year) : null),
        endDate: endDateStr,
        isCurrent,
      };
    };

    const currentEmployers = Array.isArray(person.current_employers) ? person.current_employers : [];
    const pastEmployers = Array.isArray(person.past_employers) ? person.past_employers : [];
    const rawExperiences = person.past_experiences || person.experiences || person.positions || [];

    let experiences: CrustdataExperience[];
    if (currentEmployers.length > 0 || pastEmployers.length > 0) {
      experiences = [
        ...currentEmployers.map((emp: any) => mapEmployerToExperience(emp, true)),
        ...pastEmployers.map((emp: any) => mapEmployerToExperience(emp, false)),
      ];
    } else {
      experiences = rawExperiences.map((exp: any) => {
        let expCompanyLinkedinUrl = exp.company_linkedin_url || exp.company_linkedin_profile_url || null;
        if (expCompanyLinkedinUrl && !expCompanyLinkedinUrl.startsWith('http')) {
          expCompanyLinkedinUrl = `https://${expCompanyLinkedinUrl}`;
        }
        const endDateRaw = exp.end_date || exp.end_year || null;
        const endDateStr = endDateRaw ? String(endDateRaw) : null;
        const isCurrentExp = exp.is_current === true || 
          (endDateStr && /present/i.test(endDateStr)) ||
          (!endDateRaw && !exp.end_year && !exp.end_month);
        return {
          title: exp.title || exp.job_title || null,
          companyName: exp.company_name || exp.organization_name || null,
          companyDomain: exp.company_website_domain || exp.company_domain || null,
          companyLinkedinUrl: expCompanyLinkedinUrl,
          startDate: exp.start_date || (exp.start_year ? String(exp.start_year) : null),
          endDate: endDateStr,
          isCurrent: !!isCurrentExp,
        };
      });
    }

    console.log(`[Crustdata] Employment history: ${experiences.length} positions found`);

    return {
      found: true,
      personId: person.person_id || null,
      title: titleClean,
      companyName,
      companyDomain,
      workEmail,
      linkedinUrl,
      profilePictureUrl,
      location: person.location || null,
      experiences,
      raw: result.data,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'crustdata',
      endpoint: 'person/enrich',
      entityType: 'contact',
      clerkOrgId: params.clerkOrgId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error('[Crustdata] Person enrichment failed:', error);
    return { ...EMPTY_PERSON_RESULT };
  }
}

export async function enrichCompanyCrustdata(domain: string, options: { clerkOrgId?: string } = {}): Promise<CrustdataCompanyResult> {
  const apiKey = process.env.CRUSTDATA_API_KEY;

  if (!apiKey) {
    console.warn('[Crustdata] CRUSTDATA_API_KEY not configured');
    return { ...EMPTY_COMPANY_RESULT };
  }

  try {
    const result = await withRetry(
      () => rateLimiters.crustdata.execute(async () => {
          const queryParams = new URLSearchParams({
            company_domain: domain,
          });

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

          const responseText = await response.text();

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
        }),
      {
        maxRetries: 3,
        baseDelayMs: 5000,
        serviceName: 'Crustdata Company',
      }
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
      clerkOrgId: options.clerkOrgId,
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
      clerkOrgId: options.clerkOrgId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error('[Crustdata] Company enrichment failed:', error);
    return { ...EMPTY_COMPANY_RESULT };
  }
}
