/**
 * Findymail API Integration
 * 
 * Provides email finding and verification services.
 * API Documentation: https://app.findymail.com/docs/
 */

const FINDYMAIL_API_URL = 'https://app.findymail.com/api';

interface FindymailEmailResult {
  email?: string;
  contact?: {
    name: string;
    first_name: string;
    last_name: string;
    email: string;
    job_title?: string;
    linkedin?: string;
    phone?: string;
  };
  domain?: string;
  credits_left?: number;
}

interface FindymailVerifyResult {
  email: string;
  status: 'valid' | 'invalid' | 'risky' | 'unknown';
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

  try {
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

    // Normalize LinkedIn URL
    let linkedinUrl = contact?.linkedin;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    return {
      found: true,
      email,
      fullName: contact?.name || fullName,
      firstName: contact?.first_name || firstName,
      lastName: contact?.last_name || lastName,
      title: contact?.job_title,
      linkedinUrl,
      phone: contact?.phone,
      raw: data,
    };
  } catch (error: any) {
    console.error('[Findymail] Find by name failed:', error.message);
    return { found: false, error: error.message };
  }
}

/**
 * Find email by LinkedIn URL using Findymail
 */
export async function findEmailByLinkedIn(linkedinUrl: string): Promise<FindEmailResult> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('FINDYMAIL_API_KEY is not configured');
  }

  console.log('[Findymail] Find email by LinkedIn:', linkedinUrl);

  try {
    const response = await fetch(`${FINDYMAIL_API_URL}/search/linkedin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        linkedin: linkedinUrl,
      }),
    });

    const data: FindymailEmailResult = await response.json();
    
    console.log('[Findymail] Response status:', response.status);
    console.log('[Findymail] Response body:', JSON.stringify(data).substring(0, 500));

    if (!response.ok) {
      const errorMsg = (data as any).message || (data as any).error || `API error: ${response.status}`;
      return { found: false, error: errorMsg, raw: data };
    }

    if (!data.email && !data.contact?.email) {
      return { found: false, error: 'No email found', raw: data };
    }

    const email = data.email || data.contact?.email;
    const contact = data.contact;

    return {
      found: true,
      email,
      fullName: contact?.name,
      firstName: contact?.first_name,
      lastName: contact?.last_name,
      title: contact?.job_title,
      linkedinUrl,
      phone: contact?.phone,
      raw: data,
    };
  } catch (error: any) {
    console.error('[Findymail] Find by LinkedIn failed:', error.message);
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

  try {
    const response = await fetch(`${FINDYMAIL_API_URL}/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data: FindymailVerifyResult & { message?: string; error?: string } = await response.json();
    
    console.log('[Findymail] Verify response status:', response.status);
    console.log('[Findymail] Verify response body:', JSON.stringify(data));

    if (!response.ok) {
      const errorMsg = data.message || data.error || `API error: ${response.status}`;
      return { success: false, status: 'unknown', error: errorMsg, raw: data };
    }

    // Normalize status to our standard values
    let normalizedStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' = 'unknown';
    const rawStatus = data.status;
    
    if (rawStatus === 'valid') {
      normalizedStatus = 'valid';
    } else if (rawStatus === 'invalid') {
      normalizedStatus = 'invalid';
    } else if (rawStatus === 'risky') {
      // Risky emails might be catch-all or have other issues
      normalizedStatus = 'catch-all';
    }

    return {
      success: true,
      status: normalizedStatus,
      rawStatus: rawStatus,
      raw: data,
    };
  } catch (error: any) {
    console.error('[Findymail] Verify failed:', error.message);
    return { success: false, status: 'unknown', error: error.message };
  }
}
