import axios from 'axios';
import pRetry from 'p-retry';

const HUNTER_API_BASE = 'https://api.hunter.io/v2';

export interface EmailFindResult {
  email: string | null;
  confidence: number;
  status: string;
  creditsUsed: number;
  sources?: HunterSource[];
}

export interface HunterSource {
  domain: string;
  uri: string;
  extracted_on: string;
  last_seen_on: string;
  still_on_page: boolean;
}

interface HunterEmailFinderResponse {
  data: {
    first_name: string;
    last_name: string;
    email: string;
    score: number;
    domain: string;
    accept_all: boolean;
    position: string | null;
    twitter: string | null;
    linkedin_url: string | null;
    phone_number: string | null;
    company: string | null;
    sources: HunterSource[];
    verification: {
      date: string | null;
      status: string | null;
    };
  };
  meta: {
    params: {
      first_name: string;
      last_name: string;
      full_name: string | null;
      domain: string;
      company: string | null;
    };
  };
}

let totalCreditsUsed = 0;

export function getCreditsUsed(): number {
  return totalCreditsUsed;
}

export function resetCreditsTracker(): void {
  totalCreditsUsed = 0;
}

async function makeEmailFinderRequest(
  firstName: string, 
  lastName: string, 
  domain: string, 
  apiKey: string
): Promise<HunterEmailFinderResponse> {
  const response = await axios.get<HunterEmailFinderResponse>(
    `${HUNTER_API_BASE}/email-finder`,
    {
      params: {
        domain: domain,
        first_name: firstName,
        last_name: lastName,
        api_key: apiKey,
      },
      timeout: 30000,
    }
  );
  return response.data;
}

export async function findEmail(
  firstName: string, 
  lastName: string, 
  companyDomain: string
): Promise<EmailFindResult> {
  const apiKey = process.env.HUNTER_API_KEY;
  
  if (!apiKey) {
    console.warn('HUNTER_API_KEY not configured, returning null email');
    return {
      email: null,
      confidence: 0,
      status: 'no_api_key',
      creditsUsed: 0,
    };
  }

  try {
    const response = await pRetry(
      async () => {
        try {
          return await makeEmailFinderRequest(firstName, lastName, companyDomain, apiKey);
        } catch (error: any) {
          if (error.response?.status === 429) {
            console.warn('Hunter.io rate limit hit, will retry...');
            throw error;
          }
          if (error.response?.status >= 500) {
            console.warn('Hunter.io server error, will retry...');
            throw error;
          }
          if (error.response?.status === 404) {
            return null;
          }
          throw error;
        }
      },
      {
        retries: 2,
        minTimeout: 1000,
        maxTimeout: 5000,
        onFailedAttempt: error => {
          console.log(`Email find attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
        },
      }
    );

    totalCreditsUsed += 1;

    if (!response || !response.data?.email) {
      return {
        email: null,
        confidence: 0,
        status: 'not_found',
        creditsUsed: 1,
      };
    }

    const data = response.data;
    const confidence = data.score / 100;

    return {
      email: data.email,
      confidence: confidence,
      status: confidence >= 0.8 ? 'found' : confidence >= 0.5 ? 'likely' : 'uncertain',
      creditsUsed: 1,
      sources: data.sources,
    };
  } catch (error: any) {
    if (error.response?.status === 402) {
      console.error('Hunter.io: Payment required - out of credits');
      return {
        email: null,
        confidence: 0,
        status: 'payment_required',
        creditsUsed: 0,
      };
    }
    
    console.error('Hunter.io API error:', error.message);
    return {
      email: null,
      confidence: 0,
      status: 'error',
      creditsUsed: 0,
    };
  }
}

// Company Enrichment API Response (Clearbit-compatible schema)
export interface CompanyEnrichmentResult {
  success: boolean;
  data: {
    name: string | null;
    legalName: string | null;
    domain: string;
    domainAliases: string[];
    description: string | null;
    foundedYear: number | null;
    
    // Industry classification
    sector: string | null;
    industryGroup: string | null;
    industry: string | null;
    subIndustry: string | null;
    gicsCode: string | null;
    sicCode: string | null;
    naicsCode: string | null;
    tags: string[];
    
    // Company size
    employees: number | null;
    employeesRange: string | null;
    estimatedAnnualRevenue: string | null;
    
    // Location
    location: string | null;
    streetAddress: string | null;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    postalCode: string | null;
    country: string | null;
    countryCode: string | null;
    lat: number | null;
    lng: number | null;
    
    // Social profiles
    linkedinHandle: string | null;
    twitterHandle: string | null;
    facebookHandle: string | null;
    crunchbaseHandle: string | null;
    
    // Logo
    logoUrl: string | null;
    
    // Parent companies
    parentDomain: string | null;
    ultimateParentDomain: string | null;
    
    // Technology
    tech: string[];
    techCategories: string[];
    
    // Contact info
    phoneNumbers: string[];
    emailAddresses: string[];
  } | null;
  creditsUsed: number;
  error?: string;
}

interface HunterCompanyEnrichmentResponse {
  data: {
    id: string;
    name: string;
    legalName: string;
    domain: string;
    domainAliases: string[];
    site: {
      phoneNumbers: string[];
      emailAddresses: string[];
    };
    category: {
      sector: string;
      industryGroup: string;
      industry: string;
      subIndustry: string;
      gicsCode: string;
      sicCode: string;
      naicsCode: string;
    };
    tags: string[];
    description: string;
    foundedYear: number;
    location: string;
    geo: {
      streetNumber: string;
      streetName: string;
      streetAddress: string;
      city: string;
      state: string;
      stateCode: string;
      postalCode: string;
      country: string;
      countryCode: string;
      lat: number;
      lng: number;
    };
    logo: string;
    facebook: { handle: string };
    linkedin: { handle: string };
    twitter: { handle: string };
    crunchbase: { handle: string };
    employees: number;
    employeesRange: string;
    metrics: {
      estimatedAnnualRevenue: string;
    };
    tech: string[];
    techCategories: string[];
    parent: { domain: string };
    ultimateParent: { domain: string };
  };
  meta: {
    params: {
      domain: string;
    };
  };
}

export async function enrichCompanyByDomain(domain: string): Promise<CompanyEnrichmentResult> {
  const apiKey = process.env.HUNTER_API_KEY;
  
  if (!apiKey) {
    console.warn('HUNTER_API_KEY not configured, cannot enrich company');
    return {
      success: false,
      data: null,
      creditsUsed: 0,
      error: 'no_api_key',
    };
  }
  
  try {
    // Use Companies Find API (Company Enrichment) - correct endpoint
    const response = await pRetry(
      async () => {
        try {
          const res = await axios.get<HunterCompanyEnrichmentResponse>(
            `${HUNTER_API_BASE}/companies/find`,
            {
              params: {
                domain: domain,
                api_key: apiKey,
              },
              timeout: 30000,
            }
          );
          return res.data;
        } catch (error: any) {
          if (error.response?.status === 429) {
            console.warn('Hunter.io rate limit hit, will retry...');
            throw error;
          }
          if (error.response?.status >= 500) {
            console.warn('Hunter.io server error, will retry...');
            throw error;
          }
          if (error.response?.status === 404) {
            return null;
          }
          throw error;
        }
      },
      {
        retries: 2,
        minTimeout: 1000,
        maxTimeout: 5000,
        onFailedAttempt: error => {
          console.log(`Company enrichment attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
        },
      }
    );
    
    // Cost is 0.2 credits per call (but we track as 1 for simplicity)
    totalCreditsUsed += 1;
    
    if (!response || !response.data) {
      return {
        success: false,
        data: null,
        creditsUsed: 1,
        error: 'not_found',
      };
    }
    
    const d = response.data;
    
    // Map Hunter.io response to Clearbit-compatible schema
    return {
      success: true,
      data: {
        name: d.name || null,
        legalName: d.legalName || null,
        domain: d.domain,
        domainAliases: d.domainAliases || [],
        description: d.description || null,
        foundedYear: d.foundedYear || null,
        
        sector: d.category?.sector || null,
        industryGroup: d.category?.industryGroup || null,
        industry: d.category?.industry || null,
        subIndustry: d.category?.subIndustry || null,
        gicsCode: d.category?.gicsCode || null,
        sicCode: d.category?.sicCode || null,
        naicsCode: d.category?.naicsCode || null,
        tags: d.tags || [],
        
        employees: d.employees || null,
        employeesRange: d.employeesRange || null,
        estimatedAnnualRevenue: d.metrics?.estimatedAnnualRevenue || null,
        
        location: d.location || null,
        streetAddress: d.geo?.streetAddress || null,
        city: d.geo?.city || null,
        state: d.geo?.state || null,
        stateCode: d.geo?.stateCode || null,
        postalCode: d.geo?.postalCode || null,
        country: d.geo?.country || null,
        countryCode: d.geo?.countryCode || null,
        lat: d.geo?.lat || null,
        lng: d.geo?.lng || null,
        
        linkedinHandle: d.linkedin?.handle || null,
        twitterHandle: d.twitter?.handle || null,
        facebookHandle: d.facebook?.handle || null,
        crunchbaseHandle: d.crunchbase?.handle || null,
        
        logoUrl: d.logo || null,
        
        parentDomain: d.parent?.domain || null,
        ultimateParentDomain: d.ultimateParent?.domain || null,
        
        tech: d.tech || [],
        techCategories: d.techCategories || [],
        
        phoneNumbers: d.site?.phoneNumbers || [],
        emailAddresses: d.site?.emailAddresses || [],
      },
      creditsUsed: 1,
    };
  } catch (error: any) {
    if (error.response?.status === 402) {
      console.error('Hunter.io: Payment required - out of credits');
      return {
        success: false,
        data: null,
        creditsUsed: 0,
        error: 'payment_required',
      };
    }
    
    console.error('Hunter.io Company Enrichment API error:', error.message);
    return {
      success: false,
      data: null,
      creditsUsed: 0,
      error: error.message,
    };
  }
}

export async function verifyEmail(email: string): Promise<{
  status: string;
  score: number;
  regexp: boolean;
  gibberish: boolean;
  disposable: boolean;
  webmail: boolean;
  mx_records: boolean;
  smtp_server: boolean;
  smtp_check: boolean;
  accept_all: boolean;
  block: boolean;
}> {
  const apiKey = process.env.HUNTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('HUNTER_API_KEY not configured');
  }

  const response = await axios.get(`${HUNTER_API_BASE}/email-verifier`, {
    params: {
      email: email,
      api_key: apiKey,
    },
    timeout: 30000,
  });

  totalCreditsUsed += 1;
  return response.data.data;
}
