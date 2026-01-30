/**
 * Apollo.io API Integration
 * 
 * Uses the People Match endpoint for person enrichment.
 * API Documentation: https://docs.apollo.io/reference/people-enrichment
 * 
 * Waterfall Enrichment for Phone Numbers:
 * When run_waterfall_phone=true, Apollo returns immediate sync response with
 * demographic data, then sends phone numbers asynchronously to our webhook.
 * See: https://docs.apollo.io/docs/enrich-phone-and-email-using-data-waterfall
 */

const APOLLO_API_URL = 'https://api.apollo.io/api/v1';

/**
 * Get the webhook URL for Apollo waterfall callbacks
 * Uses production domain in production, dev domain in development
 */
function getApolloWebhookUrl(): string {
  // In production, use REPLIT_DOMAINS (comma-separated list of domains)
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const primaryDomain = domains.split(',')[0];
    return `https://${primaryDomain}/api/webhooks/apollo`;
  }
  
  // In development, use REPLIT_DEV_DOMAIN
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    return `https://${devDomain}/api/webhooks/apollo`;
  }
  
  // Fallback - won't work but log the issue
  console.warn('[Apollo] No REPLIT_DOMAINS or REPLIT_DEV_DOMAIN available for webhook URL');
  return '';
}

interface ApolloWaterfallStatus {
  status: 'accepted' | 'failed' | 'partially_accepted';
  message: string;
  unprocessed_attributes?: any[];
}

interface ApolloPersonMatchResponse {
  person: {
    id: string;
    first_name: string;
    last_name: string;
    name: string;
    linkedin_url: string | null;
    title: string | null;
    email_status: string | null;
    email: string | null;
    photo_url: string | null;  // LinkedIn profile photo URL
    phone_numbers?: { raw_number: string; sanitized_number: string }[];
    headline: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    organization_id: string | null;
    organization?: {
      id: string;
      name: string;
      website_url: string | null;
      linkedin_url: string | null;
      primary_domain: string | null;
    };
    seniority: string | null;
    departments: string[] | null;
  } | null;
  waterfall?: ApolloWaterfallStatus;
  request_id?: number;
  status?: string;
  error?: string;
}

interface ApolloEnrichResult {
  found: boolean;
  apolloId?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  location?: string;
  seniority?: string;
  emailStatus?: string;
  photoUrl?: string;  // LinkedIn profile photo URL from Apollo
  waterfallStatus?: 'accepted' | 'failed' | 'not_requested';
  waterfallMessage?: string;
  raw?: any;
  error?: string;
}

/**
 * Enrich a person using Apollo.io People Match API
 * Requires first_name + last_name + organization_domain for best results
 * 
 * When useWaterfallPhone is true, phone numbers are delivered asynchronously
 * to our webhook endpoint. The sync response will only contain demographic data.
 */
export async function enrichPersonApollo(
  firstName: string,
  lastName: string,
  domain?: string,
  options?: { 
    revealEmails?: boolean; 
    revealPhone?: boolean;
    useWaterfallPhone?: boolean;  // Use waterfall enrichment for phone numbers
    linkedinUrl?: string;  // Improves match rate for waterfall
  }
): Promise<ApolloEnrichResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY is not configured');
  }

  // Build request body for Apollo People Match API
  const requestBody: Record<string, any> = {
    first_name: firstName,
    last_name: lastName,
    reveal_personal_emails: options?.revealEmails ?? false,
  };
  
  if (domain) {
    requestBody.domain = domain;
  }

  // Add LinkedIn URL if provided (improves match rate for waterfall)
  if (options?.linkedinUrl) {
    requestBody.linkedin_url = options.linkedinUrl;
  }

  // Set up waterfall phone enrichment if requested
  const useWaterfallPhone = options?.useWaterfallPhone ?? true;  // Default to true
  let webhookUrl = '';
  
  if (useWaterfallPhone) {
    webhookUrl = getApolloWebhookUrl();
    if (webhookUrl) {
      requestBody.run_waterfall_phone = true;
      requestBody.webhook_url = webhookUrl;
      console.log('[Apollo] Waterfall phone enabled, webhook URL:', webhookUrl);
    } else {
      console.warn('[Apollo] Waterfall phone requested but no webhook URL available');
    }
  }

  const url = `${APOLLO_API_URL}/people/match`;

  console.log('[Apollo] People Match request:', { 
    firstName, 
    lastName, 
    domain,
    useWaterfallPhone,
    hasWebhookUrl: !!webhookUrl 
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'accept': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    const data: ApolloPersonMatchResponse = await response.json();
    
    console.log('[Apollo] Response status:', response.status);
    // Log full person data (excluding large raw fields) for better debugging
    if (data.person) {
      console.log('[Apollo] Person found:', {
        id: data.person.id,
        name: data.person.name,
        email: data.person.email,
        emailStatus: data.person.email_status,
        photoUrl: data.person.photo_url ? 'present' : 'none',
        linkedinUrl: data.person.linkedin_url,
        title: data.person.title,
        company: data.person.organization?.name,
        phoneCount: data.person.phone_numbers?.length || 0,
      });
    } else {
      console.log('[Apollo] Response body:', JSON.stringify(data).substring(0, 500));
    }

    if (!response.ok) {
      const errorMsg = data.error || `Apollo API error: ${response.status}`;
      console.log('[Apollo] API error:', errorMsg);
      return { found: false, error: errorMsg, raw: data };
    }

    if (!data.person) {
      console.log('[Apollo] No person found');
      return { found: false, error: 'No match found', raw: data };
    }

    const person = data.person;
    const location = [person.city, person.state, person.country]
      .filter(Boolean)
      .join(', ');

    // Normalize LinkedIn URL to include https://
    let linkedinUrl = person.linkedin_url;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    // Determine waterfall status
    let waterfallStatus: 'accepted' | 'failed' | 'not_requested' = 'not_requested';
    let waterfallMessage = '';
    
    if (data.waterfall) {
      waterfallStatus = data.waterfall.status === 'partially_accepted' 
        ? 'accepted' 
        : data.waterfall.status;
      waterfallMessage = data.waterfall.message || '';
      console.log('[Apollo] Waterfall status:', waterfallStatus, '-', waterfallMessage);
    }

    const result: ApolloEnrichResult = {
      found: true,
      apolloId: person.id,
      fullName: person.name,
      firstName: person.first_name,
      lastName: person.last_name,
      email: person.email || undefined,
      phone: person.phone_numbers?.[0]?.sanitized_number || undefined,
      title: person.title || undefined,
      company: person.organization?.name || undefined,
      companyDomain: person.organization?.primary_domain || undefined,
      linkedinUrl: linkedinUrl || undefined,
      location: location || undefined,
      seniority: person.seniority || undefined,
      emailStatus: person.email_status || undefined,
      photoUrl: person.photo_url || undefined,
      waterfallStatus,
      waterfallMessage,
      raw: data,
    };

    console.log('[Apollo] Match found:', person.name, 'at', person.organization?.name);
    if (waterfallStatus === 'accepted') {
      console.log('[Apollo] Phone numbers will be delivered via webhook');
    }
    
    return result;
  } catch (error: any) {
    console.error('[Apollo] Request failed:', error.message);
    return { found: false, error: error.message };
  }
}

interface ApolloOrganizationResponse {
  organization: {
    id: string;
    name: string;
    website_url: string | null;
    linkedin_url: string | null;
    twitter_url: string | null;
    facebook_url: string | null;
    phone: string | null;
    founded_year: number | null;
    logo_url: string | null;
    primary_domain: string | null;
    industry: string | null;
    estimated_num_employees: number | null;
    keywords: string[] | null;
    sic_codes: string[] | null;
    naics_codes: string[] | null;
    street_address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
    raw_address: string | null;
    short_description: string | null;
    publicly_traded_symbol: string | null;
    publicly_traded_exchange: string | null;
    alexa_ranking: number | null;
  } | null;
  error?: string;
}

interface ApolloCompanyEnrichResult {
  found: boolean;
  name?: string;
  description?: string;
  industry?: string;
  employeeCount?: number;
  foundedYear?: number;
  city?: string;
  state?: string;
  country?: string;
  website?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  logoUrl?: string;
  phone?: string;
  sicCodes?: string[];
  naicsCodes?: string[];
  keywords?: string[];
  raw?: any;
  error?: string;
}

/**
 * Enrich a company/organization using Apollo.io Organization Enrichment API
 */
export async function enrichCompanyApollo(domain: string): Promise<ApolloCompanyEnrichResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY is not configured');
  }

  const url = `${APOLLO_API_URL}/organizations/enrich?domain=${encodeURIComponent(domain)}`;

  console.log('[Apollo] Organization Enrich request:', { domain });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    const data: ApolloOrganizationResponse = await response.json();
    
    console.log('[Apollo] Org response status:', response.status);
    console.log('[Apollo] Org response body:', JSON.stringify(data).substring(0, 500));

    if (!response.ok) {
      const errorMsg = data.error || `Apollo API error: ${response.status}`;
      console.log('[Apollo] Org API error:', errorMsg);
      return { found: false, error: errorMsg, raw: data };
    }

    if (!data.organization) {
      console.log('[Apollo] No organization found');
      return { found: false, error: 'No organization found', raw: data };
    }

    const org = data.organization;

    // Normalize LinkedIn URL to include https://
    let linkedinUrl = org.linkedin_url;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    const result: ApolloCompanyEnrichResult = {
      found: true,
      name: org.name,
      description: org.short_description || undefined,
      industry: org.industry || undefined,
      employeeCount: org.estimated_num_employees || undefined,
      foundedYear: org.founded_year || undefined,
      city: org.city || undefined,
      state: org.state || undefined,
      country: org.country || undefined,
      website: org.website_url || undefined,
      linkedinUrl: linkedinUrl || undefined,
      twitterUrl: org.twitter_url || undefined,
      facebookUrl: org.facebook_url || undefined,
      logoUrl: org.logo_url || undefined,
      phone: org.phone || undefined,
      sicCodes: org.sic_codes || undefined,
      naicsCodes: org.naics_codes || undefined,
      keywords: org.keywords || undefined,
      raw: data,
    };

    console.log('[Apollo] Organization found:', org.name, 'with', org.estimated_num_employees, 'employees');
    return result;
  } catch (error: any) {
    console.error('[Apollo] Org request failed:', error.message);
    return { found: false, error: error.message };
  }
}
