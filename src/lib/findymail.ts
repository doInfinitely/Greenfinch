/**
 * Findymail API Integration
 * 
 * Provides email finding and verification services.
 * API Documentation: https://app.findymail.com/docs/
 */

import { rateLimiters, withRetry } from './rate-limiter';
import { cacheGet, cacheSet } from './redis';

const FINDYMAIL_API_URL = 'https://app.findymail.com/api';
const EMAIL_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const VERIFY_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const NEGATIVE_CACHE_TTL = 24 * 60 * 60; // 24 hours

interface FindymailEmailResult {
  email?: string;
  linkedin_url?: string;
  contact?: {
    name: string;
    first_name: string;
    last_name: string;
    email: string;
    job_title?: string;
    linkedin_url?: string;
    linkedin?: string;
    phone?: string;
  };
  domain?: string;
  credits_left?: number;
}

interface FindymailVerifyResult {
  email: string;
  verified?: boolean;
  status?: 'valid' | 'invalid' | 'risky' | 'unknown';
  provider?: string;
  credits_left?: number;
}

interface FindEmailResult {
  found: boolean;
  email?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  linkedinUrl?: string;
  phone?: string;
  raw?: any;
  error?: string;
}

interface VerifyEmailResult {
  success: boolean;
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown';
  rawStatus?: string;
  raw?: any;
  error?: string;
}

/**
 * Find email by name and domain using Findymail
 */
export async function findEmailByName(
  firstName: string,
  lastName: string,
  domain: string
): Promise<FindEmailResult> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('FINDYMAIL_API_KEY is not configured');
  }

  const fullName = `${firstName} ${lastName}`.trim();
  console.log('[Findymail] Find email by name:', { name: fullName, domain });

  // Check cache
  const cacheKey = `findymail-email:${firstName.toLowerCase()}|${lastName.toLowerCase()}|${domain.toLowerCase()}`;
  const cached = await cacheGet<FindEmailResult>(cacheKey);
  if (cached) {
    console.log('[Findymail] Cache hit for findEmailByName:', cacheKey);
    return cached;
  }

  try {
    return await withRetry(() => rateLimiters.findymail.execute(async () => {
      const response = await fetch(`${FINDYMAIL_API_URL}/search/name`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          name: fullName,
          domain: domain,
        }),
      });

      if (response.status === 429) {
        throw new Error('Rate limit hit');
      }

      const data: FindymailEmailResult = await response.json();
      
      console.log('[Findymail] Response status:', response.status);
      console.log('[Findymail] Response body:', JSON.stringify(data).substring(0, 500));

      if (!response.ok) {
        const errorMsg = (data as any).message || (data as any).error || `API error: ${response.status}`;
        console.log('[Findymail] API error:', errorMsg);
        return { found: false, error: errorMsg, raw: data };
      }

      if (!data.email && !data.contact?.email) {
        console.log('[Findymail] No email found');
        return { found: false, error: 'No email found', raw: data };
      }

      const email = data.email || data.contact?.email;
      const contact = data.contact;

      // Extract LinkedIn URL — prefer linkedin_url (vanity) over linkedin (may be hashed member ID)
      let linkedinUrl = data.linkedin_url || contact?.linkedin_url || contact?.linkedin || null;
      console.log('[Findymail] LinkedIn fields:', {
        'data.linkedin_url': data.linkedin_url,
        'contact.linkedin_url': contact?.linkedin_url,
        'contact.linkedin': contact?.linkedin,
        selected: linkedinUrl,
      });
      if (linkedinUrl && !linkedinUrl.startsWith('http')) {
        linkedinUrl = `https://${linkedinUrl}`;
      }

      const result: FindEmailResult = {
        found: true,
        email,
        fullName: contact?.name || fullName,
        firstName: contact?.first_name || firstName,
        lastName: contact?.last_name || lastName,
        title: contact?.job_title,
        linkedinUrl: linkedinUrl || undefined,
        phone: contact?.phone,
        raw: data,
      };
      // Cache without raw response
      const { raw: _raw, ...cacheable } = result;
      await cacheSet(cacheKey, cacheable, EMAIL_CACHE_TTL);
      return result;
    }), { maxRetries: 3, baseDelayMs: 2000, serviceName: 'Findymail' });
  } catch (error: any) {
    console.error('[Findymail] Find by name failed:', error.message);
    const negativeResult: FindEmailResult = { found: false, error: error.message };
    await cacheSet(cacheKey, negativeResult, NEGATIVE_CACHE_TTL);
    return negativeResult;
  }
}

/**
 * Reverse email lookup - find LinkedIn URL from an email address
 */
export async function findLinkedInByEmail(email: string): Promise<FindEmailResult> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('FINDYMAIL_API_KEY is not configured');
  }

  console.log('[Findymail] Reverse email lookup:', email);

  try {
    return await withRetry(() => rateLimiters.findymail.execute(async () => {
      const response = await fetch(`${FINDYMAIL_API_URL}/search/reverse-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        throw new Error('Rate limit hit');
      }

      const data: FindymailEmailResult = await response.json();
      
      console.log('[Findymail] Reverse email response status:', response.status);
      console.log('[Findymail] Reverse email response body:', JSON.stringify(data).substring(0, 500));

      if (!response.ok) {
        const errorMsg = (data as any).message || (data as any).error || `API error: ${response.status}`;
        return { found: false, error: errorMsg, raw: data };
      }

      const contact = data.contact;
      let linkedinUrl = data.linkedin_url || contact?.linkedin_url || contact?.linkedin || null;
      console.log('[Findymail] Reverse email LinkedIn fields:', {
        'data.linkedin_url': data.linkedin_url,
        'contact.linkedin_url': contact?.linkedin_url,
        'contact.linkedin': contact?.linkedin,
        selected: linkedinUrl,
      });
      if (linkedinUrl && !linkedinUrl.startsWith('http')) {
        linkedinUrl = `https://${linkedinUrl}`;
      }

      if (!linkedinUrl) {
        return { found: false, error: 'No LinkedIn URL found', raw: data };
      }

      return {
        found: true,
        email: contact?.email || email,
        fullName: contact?.name,
        firstName: contact?.first_name,
        lastName: contact?.last_name,
        title: contact?.job_title,
        linkedinUrl,
        phone: contact?.phone,
        raw: data,
      };
    }), { maxRetries: 3, baseDelayMs: 2000, serviceName: 'Findymail' });
  } catch (error: any) {
    console.error('[Findymail] Reverse email lookup failed:', error.message);
    return { found: false, error: error.message };
  }
}

interface FindymailPhoneResult {
  phone?: string;
  phones?: Array<{
    phone: string;
    type?: string;
    label?: string;
  }>;
  contact?: {
    name?: string;
    phone?: string;
    phones?: Array<{
      phone: string;
      type?: string;
      label?: string;
    }>;
  };
  error?: string;
  message?: string;
}

export interface FindPhoneResult {
  found: boolean;
  phone?: string;
  phones?: Array<{ phone: string; type?: string; label?: string }>;
  raw?: any;
  error?: string;
}

export async function findPhoneByLinkedIn(linkedinUrl: string): Promise<FindPhoneResult> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('FINDYMAIL_API_KEY is not configured');
  }

  console.log('[Findymail] Phone finder by LinkedIn:', linkedinUrl);

  try {
    return await withRetry(() => rateLimiters.findymail.execute(async () => {
      const response = await fetch(`${FINDYMAIL_API_URL}/search/phone`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          linkedin_url: linkedinUrl,
        }),
      });

      if (response.status === 429) {
        throw new Error('Rate limit hit');
      }

      const data: FindymailPhoneResult = await response.json();

      console.log('[Findymail] Phone finder response status:', response.status);
      console.log('[Findymail] Phone finder response body:', JSON.stringify(data).substring(0, 500));

      if (!response.ok) {
        const errorMsg = data.message || data.error || `API error: ${response.status}`;
        console.log('[Findymail] Phone finder API error:', errorMsg);
        return { found: false, error: errorMsg, raw: data };
      }

      const phone = data.phone || data.contact?.phone;
      const phones = data.phones || data.contact?.phones || [];

      if (!phone && phones.length === 0) {
        console.log('[Findymail] No phone found');
        return { found: false, error: 'No phone found', raw: data };
      }

      console.log('[Findymail] Phone found:', phone, 'Additional phones:', phones.length);

      return {
        found: true,
        phone: phone || phones[0]?.phone,
        phones: phones.length > 0 ? phones : (phone ? [{ phone }] : []),
        raw: data,
      };
    }), { maxRetries: 3, baseDelayMs: 2000, serviceName: 'Findymail' });
  } catch (error: any) {
    console.error('[Findymail] Phone finder failed:', error.message);
    return { found: false, error: error.message };
  }
}

/**
 * Verify an email address using Findymail
 */
export async function verifyEmail(email: string): Promise<VerifyEmailResult> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('FINDYMAIL_API_KEY is not configured');
  }

  console.log('[Findymail] Verify email:', email);

  // Check cache
  const verifyCacheKey = `email-verify:${email.toLowerCase()}`;
  const cachedVerify = await cacheGet<VerifyEmailResult>(verifyCacheKey);
  if (cachedVerify) {
    console.log('[Findymail] Cache hit for verifyEmail:', email);
    return cachedVerify;
  }

  try {
    return await withRetry(() => rateLimiters.findymail.execute(async () => {
      const response = await fetch(`${FINDYMAIL_API_URL}/verify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        throw new Error('Rate limit hit');
      }

      const data: FindymailVerifyResult & { message?: string; error?: string } = await response.json();
      
      console.log('[Findymail] Verify response status:', response.status);
      console.log('[Findymail] Verify response body:', JSON.stringify(data));

      if (!response.ok) {
        const errorMsg = data.message || data.error || `API error: ${response.status}`;
        return { success: false, status: 'unknown' as const, error: errorMsg, raw: data };
      }

      // Normalize status to our standard values
      // Findymail returns { verified: true/false } format
      let normalizedStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' = 'unknown';
      let rawStatus = 'unknown';
      
      if (data.verified !== undefined) {
        normalizedStatus = data.verified ? 'valid' : 'unknown';
        rawStatus = data.verified ? 'verified' : 'not_verified';
      } else if (data.status) {
        // Legacy format: { status: string }
        rawStatus = data.status;
        if (data.status === 'valid') {
          normalizedStatus = 'valid';
        } else if (data.status === 'invalid') {
          normalizedStatus = 'invalid';
        } else if (data.status === 'risky') {
          normalizedStatus = 'catch-all';
        }
      }

      const verifyResult: VerifyEmailResult = {
        success: true,
        status: normalizedStatus,
        rawStatus: rawStatus,
        raw: data,
      };
      // Cache without raw response
      const { raw: _rawV, ...cacheableVerify } = verifyResult;
      await cacheSet(verifyCacheKey, cacheableVerify, VERIFY_CACHE_TTL);
      return verifyResult;
    }), { maxRetries: 3, baseDelayMs: 2000, serviceName: 'Findymail' });
  } catch (error: any) {
    console.error('[Findymail] Verify failed:', error.message);
    return { success: false, status: 'unknown' as const, error: error.message };
  }
}
