/**
 * ZeroBounce API Integration
 * 
 * Provides email validation services.
 * API Documentation: https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails
 */

import { cacheGet, cacheSet, isRedisConfigured } from './redis';

const ZEROBOUNCE_API_URL = 'https://api.zerobounce.net/v2';

// In-memory fallback cache for email validation results
const memoryValidationCache = new Map<string, { result: ValidateEmailResult; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache TTL
const CACHE_TTL_SECONDS = 3600; // 1 hour in seconds for Redis

interface ZeroBounceValidateResponse {
  address: string;
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'spamtrap' | 'abuse' | 'do_not_mail';
  sub_status: string;
  free_email: boolean;
  did_you_mean: string | null;
  account: string | null;
  domain: string | null;
  domain_age_days: string | null;
  smtp_provider: string | null;
  mx_found: string;
  mx_record: string | null;
  firstname: string | null;
  lastname: string | null;
  gender: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  zipcode: string | null;
  processed_at: string;
  error?: string;
}

interface ValidateEmailResult {
  success: boolean;
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown';
  rawStatus: string;
  subStatus?: string;
  freeEmail?: boolean;
  suggestedCorrection?: string | null;
  mxFound?: boolean;
  mxRecord?: string | null;
  smtpProvider?: string | null;
  raw?: any;
  error?: string;
}

/**
 * Validate an email address using ZeroBounce
 * Uses in-memory cache to avoid duplicate API calls within the same enrichment run
 */
export async function validateEmail(email: string): Promise<ValidateEmailResult> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) {
    throw new Error('ZEROBOUNCE_API_KEY is not configured');
  }

  // Check cache first (Redis with in-memory fallback)
  const normalizedEmail = email.toLowerCase().trim();
  const cacheKey = `zerobounce:${normalizedEmail}`;
  
  if (isRedisConfigured()) {
    const redisCached = await cacheGet<ValidateEmailResult>(cacheKey);
    if (redisCached) {
      console.log('[ZeroBounce] Redis cache hit for:', normalizedEmail, '->', redisCached.status);
      return redisCached;
    }
  } else {
    const memoryCached = memoryValidationCache.get(normalizedEmail);
    if (memoryCached && (Date.now() - memoryCached.timestamp) < CACHE_TTL_MS) {
      console.log('[ZeroBounce] Memory cache hit for:', normalizedEmail, '->', memoryCached.result.status);
      return memoryCached.result;
    }
  }

  console.log('[ZeroBounce] Validating email:', email);

  const params = new URLSearchParams();
  params.append('api_key', apiKey);
  params.append('email', email);

  try {
    const response = await fetch(`${ZEROBOUNCE_API_URL}/validate?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data: ZeroBounceValidateResponse = await response.json();
    
    console.log('[ZeroBounce] Response status:', response.status);
    console.log('[ZeroBounce] Response body:', JSON.stringify(data).substring(0, 500));

    if (!response.ok || data.error) {
      const errorMsg = data.error || `API error: ${response.status}`;
      console.log('[ZeroBounce] API error:', errorMsg);
      return { success: false, status: 'unknown', rawStatus: 'error', error: errorMsg, raw: data };
    }

    // Normalize status to our standard values
    let normalizedStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' = 'unknown';
    const rawStatus = data.status;
    
    switch (rawStatus) {
      case 'valid':
        normalizedStatus = 'valid';
        break;
      case 'invalid':
      case 'spamtrap':
      case 'abuse':
      case 'do_not_mail':
        normalizedStatus = 'invalid';
        break;
      case 'catch-all':
        normalizedStatus = 'catch-all';
        break;
      case 'unknown':
      default:
        normalizedStatus = 'unknown';
        break;
    }

    const result: ValidateEmailResult = {
      success: true,
      status: normalizedStatus,
      rawStatus: rawStatus,
      subStatus: data.sub_status || undefined,
      freeEmail: data.free_email,
      suggestedCorrection: data.did_you_mean,
      mxFound: data.mx_found === 'true',
      mxRecord: data.mx_record,
      smtpProvider: data.smtp_provider,
      raw: data,
    };

    // Store in cache (Redis with in-memory fallback)
    if (isRedisConfigured()) {
      await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
    } else {
      memoryValidationCache.set(normalizedEmail, { result, timestamp: Date.now() });
    }
    console.log('[EmailValidation] ZeroBounce:', email, '->', normalizedStatus, `(valid=${normalizedStatus === 'valid'})`);

    return result;
  } catch (error: any) {
    console.error('[ZeroBounce] Validation failed:', error.message);
    return { success: false, status: 'unknown', rawStatus: 'error', error: error.message };
  }
}

/**
 * Get remaining credits from ZeroBounce
 */
export async function getCredits(): Promise<{ credits: number } | { error: string }> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) {
    throw new Error('ZEROBOUNCE_API_KEY is not configured');
  }

  try {
    const response = await fetch(`${ZEROBOUNCE_API_URL}/getcredits?api_key=${apiKey}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return { error: data.error || `API error: ${response.status}` };
    }

    return { credits: data.Credits || 0 };
  } catch (error: any) {
    return { error: error.message };
  }
}
