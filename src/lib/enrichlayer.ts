const ENRICHLAYER_API_KEY = process.env.ENRICHLAYER_API_KEY;
const ENRICHLAYER_BASE_URL = 'https://enrichlayer.com/api/v2';

const FETCH_TIMEOUT_MS = 10000;

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
let circuitFailureCount = 0;
let circuitOpenedAt: number | null = null;

function isCircuitOpen(): boolean {
  if (circuitOpenedAt === null) return false;
  if (Date.now() - circuitOpenedAt > CIRCUIT_BREAKER_COOLDOWN_MS) {
    circuitFailureCount = 0;
    circuitOpenedAt = null;
    console.log('[EnrichLayer] Circuit breaker reset after cooldown');
    return false;
  }
  return true;
}

function recordCircuitFailure(): void {
  circuitFailureCount++;
  if (circuitFailureCount >= CIRCUIT_BREAKER_THRESHOLD && circuitOpenedAt === null) {
    circuitOpenedAt = Date.now();
    console.warn(`[EnrichLayer] Circuit breaker OPEN after ${circuitFailureCount} failures. Skipping calls for ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
  }
}

function recordCircuitSuccess(): void {
  circuitFailureCount = 0;
  circuitOpenedAt = null;
}

function createTimeoutSignal(): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return controller.signal;
}

// Rate limiting: 20 requests per minute (paid plan)
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 60000;
const requestTimestamps: number[] = [];

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  // Remove timestamps older than the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  
  // If at limit, wait until oldest request expires
  if (requestTimestamps.length >= RATE_LIMIT_REQUESTS) {
    const waitTime = requestTimestamps[0] + RATE_LIMIT_WINDOW_MS - now + 100;
    console.log(`[EnrichLayer] Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return waitForRateLimit();
  }
  
  requestTimestamps.push(now);
}

export interface EnrichLayerPersonInput {
  firstName: string;
  lastName?: string;
  companyDomain?: string;
  location?: string;
  title?: string;
  linkedinUrl?: string;
}

export interface EnrichLayerPersonResult {
  success: boolean;
  linkedinUrl?: string;
  email?: string;
  personalEmail?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  company?: string;
  title?: string;
  profilePicture?: string;
  skills?: string[];
  error?: string;
  creditsUsed?: number;
  rawResponse?: any;
}

export interface EnrichLayerProfileResult {
  success: boolean;
  linkedinUrl?: string;
  email?: string;
  personalEmail?: string;
  workEmail?: string;
  phone?: string;
  personalPhone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  company?: string;
  title?: string;
  profilePicture?: string;
  summary?: string;
  skills?: string[];
  experiences?: Array<{
    title: string;
    company: string;
    startDate?: string;
    endDate?: string;
    current?: boolean;
  }>;
  education?: Array<{
    school: string;
    degree?: string;
    field?: string;
    startDate?: string;
    endDate?: string;
  }>;
  error?: string;
  creditsUsed?: number;
  rawResponse?: any;
}

function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

async function lookupPerson(input: EnrichLayerPersonInput): Promise<EnrichLayerPersonResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.error('[EnrichLayer] API key not configured');
    return { success: false, error: 'EnrichLayer API key not configured' };
  }

  if (isCircuitOpen()) {
    return { success: false, error: 'EnrichLayer temporarily unavailable' };
  }

  try {
    await waitForRateLimit();
    const params = new URLSearchParams();
    params.append('first_name', input.firstName);
    if (input.lastName) {
      params.append('last_name', input.lastName);
    }
    if (input.companyDomain) {
      params.append('company_domain', input.companyDomain);
    }
    if (input.location) {
      params.append('location', input.location);
    }
    if (input.title) {
      params.append('title', input.title);
    }
    params.append('enrich_profile', 'enrich');
    params.append('similarity_checks', 'include');

    const url = `${ENRICHLAYER_BASE_URL}/profile/resolve?${params.toString()}`;
    console.log('[EnrichLayer] Person lookup request:', { firstName: input.firstName, lastName: input.lastName, companyDomain: input.companyDomain, location: input.location, title: input.title });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: createTimeoutSignal(),
    });

    if (response.status === 404) {
      recordCircuitSuccess();
      return { success: false, error: 'Person not found in EnrichLayer database' };
    }

    if (response.status === 429) {
      return { success: false, error: 'Rate limited' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EnrichLayer] API error:', response.status, errorText);
      recordCircuitFailure();
      return { success: false, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    console.log('[EnrichLayer] Person lookup response:', JSON.stringify(data).slice(0, 500));

    if (!data || data.error) {
      recordCircuitSuccess();
      return { success: false, error: data?.error || 'No data returned', rawResponse: data };
    }

    const profile = data.profile || data;
    
    // The resolve endpoint returns LinkedIn URL at top level as 'url'
    const linkedinUrl = data.url ?? profile.linkedin_url ?? (profile.public_identifier ? `https://www.linkedin.com/in/${profile.public_identifier}` : undefined);
    
    // If no LinkedIn URL found, person wasn't matched
    if (!linkedinUrl) {
      recordCircuitSuccess();
      return { 
        success: false, 
        error: 'Person not found in EnrichLayer database',
        rawResponse: data,
      };
    }
    
    recordCircuitSuccess();
    return {
      success: true,
      linkedinUrl,
      email: profile.work_email || profile.email,
      personalEmail: profile.personal_email,
      phone: profile.phone_number || profile.personal_contact_number,
      firstName: profile.first_name,
      lastName: profile.last_name,
      fullName: profile.full_name,
      headline: profile.headline,
      location: profile.location_str || profile.location || profile.city,
      company: profile.company || profile.current_company,
      title: profile.title || profile.occupation,
      profilePicture: profile.profile_pic_url,
      skills: profile.skills,
      creditsUsed: data.credits_used,
      rawResponse: data,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error(`[EnrichLayer] Person lookup ${isTimeout ? 'timed out' : 'error'}:`, error);
    recordCircuitFailure();
    return { success: false, error: isTimeout ? 'Request timed out' : (error instanceof Error ? error.message : 'Unknown error') };
  }
}

export async function enrichLinkedInProfile(linkedinUrl: string, options?: {
  includeEmail?: boolean;
  includePhone?: boolean;
  includeSkills?: boolean;
  liveFetch?: boolean;
}): Promise<EnrichLayerProfileResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.error('[EnrichLayer] API key not configured');
    return { success: false, error: 'EnrichLayer API key not configured' };
  }

  if (isCircuitOpen()) {
    return { success: false, error: 'EnrichLayer temporarily unavailable' };
  }

  try {
    await waitForRateLimit();
    const params = new URLSearchParams();
    params.append('profile_url', linkedinUrl);
    
    if (options?.includeEmail !== false) {
      params.append('personal_email', 'include');
    }
    if (options?.includePhone !== false) {
      params.append('personal_contact_number', 'include');
    }
    if (options?.includeSkills) {
      params.append('skills', 'include');
    }
    params.append('extra', 'include');
    params.append('enrich_profile', 'enrich');
    
    if (options?.liveFetch) {
      params.append('live_fetch', 'force');
    }

    const url = `${ENRICHLAYER_BASE_URL}/profile?${params.toString()}`;
    console.log('[EnrichLayer] Profile enrichment request:', { linkedinUrl, options });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: createTimeoutSignal(),
    });

    if (response.status === 404) {
      recordCircuitSuccess();
      return { success: false, error: 'Profile not found' };
    }

    if (response.status === 429) {
      return { success: false, error: 'Rate limited' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EnrichLayer] API error:', response.status, errorText);
      recordCircuitFailure();
      return { success: false, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    console.log('[EnrichLayer] Profile enrichment response:', JSON.stringify(data).slice(0, 500));

    if (!data || data.error) {
      recordCircuitSuccess();
      return { success: false, error: data?.error || 'No data returned', rawResponse: data };
    }

    // EnrichLayer returns personal_emails and personal_numbers as arrays
    const personalEmail = data.personal_emails?.[0] || data.personal_email;
    const personalPhone = data.personal_numbers?.[0] || data.personal_contact_number;
    
    recordCircuitSuccess();
    return {
      success: true,
      linkedinUrl: data.linkedin_url ?? (data.public_identifier ? `https://www.linkedin.com/in/${data.public_identifier}` : linkedinUrl),
      email: data.work_email || personalEmail,
      personalEmail: personalEmail,
      workEmail: data.work_email,
      phone: data.phone_number || personalPhone,
      personalPhone: personalPhone,
      firstName: data.first_name,
      lastName: data.last_name,
      fullName: data.full_name,
      headline: data.headline,
      location: data.location,
      city: data.city,
      state: data.state,
      country: data.country,
      company: data.company || data.experiences?.[0]?.company,
      title: data.occupation || data.experiences?.[0]?.title,
      profilePicture: data.profile_pic_url,
      summary: data.summary,
      skills: data.skills,
      experiences: data.experiences?.map((exp: any) => ({
        title: exp.title,
        company: exp.company,
        startDate: exp.starts_at ? `${exp.starts_at.year}-${exp.starts_at.month || 1}` : undefined,
        endDate: exp.ends_at ? `${exp.ends_at.year}-${exp.ends_at.month || 1}` : undefined,
        current: !exp.ends_at,
      })),
      education: data.education?.map((edu: any) => ({
        school: edu.school,
        degree: edu.degree_name,
        field: edu.field_of_study,
        startDate: edu.starts_at ? `${edu.starts_at.year}` : undefined,
        endDate: edu.ends_at ? `${edu.ends_at.year}` : undefined,
      })),
      creditsUsed: data.credits_used,
      rawResponse: data,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error(`[EnrichLayer] Profile enrichment ${isTimeout ? 'timed out' : 'error'}:`, error);
    recordCircuitFailure();
    return { success: false, error: isTimeout ? 'Request timed out' : (error instanceof Error ? error.message : 'Unknown error') };
  }
}

async function enrichContact(contact: {
  fullName: string;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
  location?: string | null;
  title?: string | null;
}): Promise<EnrichLayerPersonResult | EnrichLayerProfileResult> {
  // Always use name-based lookup to verify/replace AI-discovered LinkedIn URLs
  // This ensures we get the most accurate match from EnrichLayer
  const { firstName, lastName } = parseFullName(contact.fullName);
  
  return lookupPerson({
    firstName,
    lastName,
    companyDomain: contact.companyDomain || undefined,
    location: contact.location || undefined,
    title: contact.title || undefined,
  });
}

export interface WorkEmailResult {
  success: boolean;
  email: string | null;
  status: string | null;
  error?: string;
  creditsUsed?: number;
}

async function lookupWorkEmail(linkedinUrl: string, options?: {
  validate?: boolean;
  useCache?: 'if-present' | 'if-recent' | 'never';
  expectedDomain?: string;  // Filter to only accept emails from this domain
}): Promise<WorkEmailResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.error('[EnrichLayer] API key not configured');
    return { success: false, email: null, status: null, error: 'EnrichLayer API key not configured' };
  }

  if (isCircuitOpen()) {
    return { success: false, email: null, status: null, error: 'EnrichLayer temporarily unavailable' };
  }

  try {
    await waitForRateLimit();
    const params = new URLSearchParams();
    params.append('linkedin_profile_url', linkedinUrl);
    
    // Add validation to ensure deliverability (costs extra credits but ensures freshness)
    if (options?.validate !== false) {
      params.append('email_validation', 'include');
    }
    
    // Control cache behavior to avoid stale emails from old jobs
    if (options?.useCache) {
      params.append('use_cache', options.useCache);
    }

    // Use the correct work email lookup endpoint: /api/v2/profile/email
    const url = `${ENRICHLAYER_BASE_URL}/profile/email?${params.toString()}`;
    console.log('[EnrichLayer] Work email lookup:', { linkedinUrl, validate: options?.validate !== false });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Accept': 'application/json',
      },
      signal: createTimeoutSignal(),
    });

    if (response.status === 404) {
      recordCircuitSuccess();
      return { success: false, email: null, status: 'not_found', error: 'Work email not found' };
    }

    if (response.status === 429) {
      return { success: false, email: null, status: null, error: 'Rate limited' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EnrichLayer] Work email API error:', response.status, errorText);
      recordCircuitFailure();
      return { success: false, email: null, status: null, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    console.log('[EnrichLayer] Work email response:', JSON.stringify(data));

    // Response format: { email: "...", status: "email_found" } or { email_queue_count: N }
    if (data.email) {
      // If expectedDomain is provided, verify the email domain matches
      if (options?.expectedDomain) {
        const emailDomain = data.email.split('@')[1]?.toLowerCase();
        const expectedDomainLower = options.expectedDomain.toLowerCase().replace(/^www\./, '');
        
        if (emailDomain !== expectedDomainLower) {
          console.log(`[EnrichLayer] Email domain mismatch: got ${emailDomain}, expected ${expectedDomainLower}`);
          return {
            success: false,
            email: data.email, // Still return the email even if domain mismatched
            status: 'domain_mismatch',
            error: `Email ${data.email} doesn't match expected domain ${options.expectedDomain} (may be from previous role)`,
          };
        }
      }
      
      recordCircuitSuccess();
      return {
        success: true,
        email: data.email,
        status: data.status || 'email_found',
        creditsUsed: 3,
      };
    }

    // If email_queue_count > 0, the request is still processing (async)
    if (data.email_queue_count > 0) {
      recordCircuitSuccess();
      return {
        success: false,
        email: null,
        status: 'queued',
        error: `Email lookup queued (position: ${data.email_queue_count}). Check enrichlayer.com/dashboard/email-lookup-logs`,
      };
    }

    recordCircuitSuccess();
    return {
      success: false,
      email: null,
      status: data.status || 'not_found',
      error: data.message || 'Work email not found',
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error(`[EnrichLayer] Work email lookup ${isTimeout ? 'timed out' : 'error'}:`, error);
    recordCircuitFailure();
    return { success: false, email: null, status: null, error: isTimeout ? 'Request timed out' : (error instanceof Error ? error.message : 'Unknown error') };
  }
}

export interface ProfilePictureResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Fetch a person's profile picture using their LinkedIn URL.
 * Uses the dedicated Person Profile Picture endpoint which costs 0 credits.
 */
export async function getProfilePicture(linkedinUrl: string): Promise<ProfilePictureResult> {
  if (!ENRICHLAYER_API_KEY) {
    return { success: false, error: 'EnrichLayer API key not configured' };
  }

  if (!linkedinUrl) {
    return { success: false, error: 'LinkedIn URL required' };
  }

  if (isCircuitOpen()) {
    return { success: false, error: 'EnrichLayer temporarily unavailable' };
  }

  try {
    await waitForRateLimit();
    
    const params = new URLSearchParams();
    params.append('person_profile_url', linkedinUrl);

    const url = `${ENRICHLAYER_BASE_URL}/person/profile-picture?${params.toString()}`;
    console.log(`[EnrichLayer] Fetching profile picture for: ${linkedinUrl}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Accept': 'application/json',
      },
      signal: createTimeoutSignal(),
    });

    if (response.status === 404) {
      recordCircuitSuccess();
      return { success: false, error: 'Profile picture not found' };
    }

    if (response.status === 429) {
      return { success: false, error: 'Rate limited' };
    }

    if (!response.ok) {
      recordCircuitFailure();
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();

    const pictureUrl = data.profile_pic_url || data.tmp_profile_pic_url || data.url;
    
    if (pictureUrl) {
      recordCircuitSuccess();
      return { success: true, url: pictureUrl };
    }

    recordCircuitSuccess();
    return { success: false, error: 'No profile picture URL in response' };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.warn(`[EnrichLayer] Profile picture ${isTimeout ? 'timed out' : 'failed'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    recordCircuitFailure();
    return { success: false, error: isTimeout ? 'Request timed out' : 'Request failed' };
  }
}

// ============================================================================
// Company Enrichment API
// ============================================================================

export interface CompanyResolveResult {
  success: boolean;
  linkedinUrl?: string;
  error?: string;
}

export interface CompanyProfileResult {
  success: boolean;
  data?: {
    name: string | null;
    description: string | null;
    industry: string | null;
    categories: string[];
    companySize: [number | null, number | null] | null;
    companyType: string | null;
    foundedYear: number | null;
    website: string | null;
    tagline: string | null;
    specialties: string[];
    followerCount: number | null;
    headquarter: {
      city: string | null;
      state: string | null;
      country: string | null;
      postalCode: string | null;
      streetAddress: string | null;
    } | null;
    logoUrl: string | null;
    backgroundUrl: string | null;
    linkedinHandle: string | null;
    facebookHandle: string | null;
    twitterHandle: string | null;
    crunchbaseHandle: string | null;
    phoneNumber: string | null;
    stockSymbol: string | null;
    fundingTotal: number | null;
    ipoStatus: string | null;
    operatingStatus: string | null;
  };
  creditsUsed?: number;
  error?: string;
}

/**
 * Resolve a company domain to LinkedIn company URL
 * Cost: ~1 credit
 */
async function resolveCompanyByDomain(domain: string): Promise<CompanyResolveResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.warn('[EnrichLayer] API key not configured');
    return { success: false, error: 'API key not configured' };
  }

  if (isCircuitOpen()) {
    return { success: false, error: 'EnrichLayer temporarily unavailable' };
  }

  try {
    await waitForRateLimit();

    const params = new URLSearchParams();
    params.append('company_domain', domain);

    const url = `${ENRICHLAYER_BASE_URL}/company/resolve?${params.toString()}`;
    console.log('[EnrichLayer] Resolving company domain:', domain);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Accept': 'application/json',
      },
      signal: createTimeoutSignal(),
    });

    if (response.status === 404) {
      recordCircuitSuccess();
      console.log(`[EnrichLayer] Company not found for domain: ${domain}`);
      return { success: false, error: 'Company not found' };
    }

    if (response.status === 429) {
      console.warn('[EnrichLayer] Rate limited');
      return { success: false, error: 'Rate limited' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EnrichLayer] API error: ${response.status} ${errorText}`);
      recordCircuitFailure();
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    
    if (data.url) {
      recordCircuitSuccess();
      console.log(`[EnrichLayer] Resolved ${domain} to: ${data.url}`);
      return { success: true, linkedinUrl: data.url };
    }

    recordCircuitSuccess();
    return { success: false, error: 'No LinkedIn URL in response' };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error(`[EnrichLayer] Company resolve ${isTimeout ? 'timed out' : 'error'}:`, error);
    recordCircuitFailure();
    return { success: false, error: isTimeout ? 'Request timed out' : (error instanceof Error ? error.message : 'Unknown error') };
  }
}

/**
 * Get company profile by LinkedIn URL with industry/category data
 * Cost: ~3 credits (base) + 1 credit for categories + 1 credit for extra
 */
async function getCompanyProfile(linkedinUrl: string): Promise<CompanyProfileResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.warn('[EnrichLayer] API key not configured');
    return { success: false, error: 'API key not configured' };
  }

  if (isCircuitOpen()) {
    return { success: false, error: 'EnrichLayer temporarily unavailable' };
  }

  try {
    await waitForRateLimit();

    const params = new URLSearchParams();
    params.append('url', linkedinUrl);
    params.append('categories', 'include');
    params.append('extra', 'include');
    params.append('use_cache', 'if-present');

    const url = `${ENRICHLAYER_BASE_URL}/company?${params.toString()}`;
    console.log('[EnrichLayer] Getting company profile:', linkedinUrl);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Accept': 'application/json',
      },
      signal: createTimeoutSignal(),
    });

    if (response.status === 404) {
      recordCircuitSuccess();
      console.log(`[EnrichLayer] Company profile not found: ${linkedinUrl}`);
      return { success: false, error: 'Company not found' };
    }

    if (response.status === 429) {
      console.warn('[EnrichLayer] Rate limited');
      return { success: false, error: 'Rate limited' };
    }

    if (response.status === 403) {
      console.error('[EnrichLayer] Out of credits');
      return { success: false, error: 'Out of credits' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EnrichLayer] API error: ${response.status} ${errorText}`);
      recordCircuitFailure();
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    console.log('[EnrichLayer] Company profile retrieved for:', data.name || linkedinUrl);

    // Extract LinkedIn handle from URL
    let linkedinHandle: string | null = null;
    if (linkedinUrl) {
      const match = linkedinUrl.match(/linkedin\.com\/company\/([^\/\?]+)/);
      if (match) {
        linkedinHandle = match[1];
      }
    }

    // Map response to our schema
    recordCircuitSuccess();
    const result: CompanyProfileResult = {
      success: true,
      data: {
        name: data.name || null,
        description: data.description || null,
        industry: data.industry || null,
        categories: data.categories || [],
        companySize: data.company_size || null,
        companyType: data.company_type || null,
        foundedYear: data.founded_year || null,
        website: data.website || null,
        tagline: data.tagline || null,
        specialties: data.specialities || data.specialties || [],
        followerCount: data.follower_count || null,
        headquarter: data.hq ? {
          city: data.hq.city || null,
          state: data.hq.state || null,
          country: data.hq.country || null,
          postalCode: data.hq.postal_code || null,
          streetAddress: data.hq.line_1 || null,
        } : null,
        logoUrl: data.profile_pic_url || null,
        backgroundUrl: data.background_cover_image_url || null,
        linkedinHandle,
        facebookHandle: data.extra?.facebook_id || null,
        twitterHandle: data.extra?.twitter_id || null,
        crunchbaseHandle: null,
        phoneNumber: data.extra?.phone_number || null,
        stockSymbol: data.extra?.stock_symbol || null,
        fundingTotal: data.extra?.total_funding_amount || null,
        ipoStatus: data.extra?.ipo_status || null,
        operatingStatus: data.extra?.operating_status || null,
      },
      creditsUsed: 5, // Approximate: 3 base + 1 categories + 1 extra
    };

    return result;
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error(`[EnrichLayer] Company profile ${isTimeout ? 'timed out' : 'error'}:`, error);
    recordCircuitFailure();
    return { success: false, error: isTimeout ? 'Request timed out' : (error instanceof Error ? error.message : 'Unknown error') };
  }
}

/**
 * Enrich a company by domain - resolves to LinkedIn URL and fetches full profile
 * Cost: ~6 credits total (1 for resolve + 5 for profile)
 */
export async function enrichCompanyByDomain(domain: string): Promise<CompanyProfileResult> {
  if (isCircuitOpen()) {
    return { success: false, error: 'EnrichLayer temporarily unavailable' };
  }

  console.log(`[EnrichLayer] Enriching company by domain: ${domain}`);
  
  // Step 1: Resolve domain to LinkedIn URL
  const resolveResult = await resolveCompanyByDomain(domain);
  
  if (!resolveResult.success || !resolveResult.linkedinUrl) {
    return { 
      success: false, 
      error: resolveResult.error || 'Could not resolve domain to LinkedIn URL' 
    };
  }

  // Step 2: Get full company profile
  const profileResult = await getCompanyProfile(resolveResult.linkedinUrl);
  
  if (profileResult.success && profileResult.creditsUsed) {
    profileResult.creditsUsed += 1; // Add the resolve credit
  }

  return profileResult;
}
