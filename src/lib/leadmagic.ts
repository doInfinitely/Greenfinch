import axios from 'axios';
import pRetry from 'p-retry';
import { db } from './db';
import { contacts } from './schema';
import { eq } from 'drizzle-orm';

const LEADMAGIC_API_BASE = 'https://api.leadmagic.io';

export interface EmailValidationResult {
  isValid: boolean;
  confidence: number;
  status: 'valid' | 'valid_catch_all' | 'catch_all' | 'invalid' | 'unknown';
  details: LeadMagicResponse;
  creditsUsed: number;
}

export interface LeadMagicResponse {
  email: string;
  email_status: string;
  credits_consumed: number;
  message?: string;
  is_domain_catch_all?: boolean;
  mx_record?: string;
  mx_provider?: string;
  mx_security_gateway?: boolean;
  company_name?: string;
  company_industry?: string;
  company_size?: string;
  company_founded?: number;
  company_location?: {
    name?: string;
    locality?: string;
    region?: string;
    metro?: string;
    country?: string;
    continent?: string;
    street_address?: string;
    address_line_2?: string | null;
    postal_code?: string;
    geo?: string;
  };
  company_linkedin_url?: string;
  company_linkedin_id?: string;
  company_facebook_url?: string;
  company_twitter_url?: string;
  company_type?: string;
}

let totalCreditsUsed = 0;

export function getCreditsUsed(): number {
  return totalCreditsUsed;
}

export function resetCreditsTracker(): void {
  totalCreditsUsed = 0;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function makeApiRequest(email: string, apiKey: string): Promise<LeadMagicResponse> {
  const response = await axios.post<LeadMagicResponse>(
    `${LEADMAGIC_API_BASE}/email-validate`,
    { email },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      timeout: 30000,
    }
  );
  return response.data;
}

export async function validateEmail(email: string): Promise<EmailValidationResult> {
  const apiKey = process.env.LEADMAGIC_API_KEY;
  
  if (!apiKey) {
    console.warn('LEADMAGIC_API_KEY not configured, returning unknown status');
    return {
      isValid: false,
      confidence: 0,
      status: 'unknown',
      details: {
        email,
        email_status: 'unknown',
        credits_consumed: 0,
        message: 'API key not configured',
      },
      creditsUsed: 0,
    };
  }

  try {
    const data = await pRetry(
      async () => {
        try {
          return await makeApiRequest(email, apiKey);
        } catch (error: any) {
          if (error.response?.status === 429) {
            console.warn('LeadMagic rate limit hit, will retry...');
            throw error;
          }
          if (error.response?.status >= 500) {
            console.warn('LeadMagic server error, will retry...');
            throw error;
          }
          // Non-retryable error - throw as-is to stop retrying
          error.message = `LeadMagic API error: ${error.message}`;
          throw error;
        }
      },
      {
        retries: 3,
        minTimeout: 2000,
        maxTimeout: 10000,
        onFailedAttempt: error => {
          console.log(`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
        },
      }
    );

    const creditsUsed = data.credits_consumed || 0;
    totalCreditsUsed += creditsUsed;

    let status: 'valid' | 'valid_catch_all' | 'catch_all' | 'invalid' | 'unknown' = 'unknown';
    let isValid = false;
    let confidence = 0.5;

    switch (data.email_status) {
      case 'valid':
        status = 'valid';
        isValid = true;
        confidence = 0.95;
        break;
      case 'valid_catch_all':
        status = 'valid_catch_all';
        isValid = true;
        confidence = 0.8;
        break;
      case 'catch_all':
        status = 'catch_all';
        isValid = false;
        confidence = 0.5;
        break;
      case 'invalid':
        status = 'invalid';
        isValid = false;
        confidence = 0.95;
        break;
      default:
        status = 'unknown';
        isValid = false;
        confidence = 0.3;
    }

    return {
      isValid,
      confidence,
      status,
      details: data,
      creditsUsed,
    };
  } catch (error: any) {
    console.error('LeadMagic API error:', error.message);
    return {
      isValid: false,
      confidence: 0,
      status: 'unknown',
      details: {
        email,
        email_status: 'error',
        credits_consumed: 0,
        message: error.message || 'API request failed',
      },
      creditsUsed: 0,
    };
  }
}

export async function validateAndUpdateContact(contactId: string): Promise<EmailValidationResult | null> {
  try {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact || !contact.email) {
      return null;
    }

    const result = await validateEmail(contact.email);

    const validationStatus = result.status === 'valid' || result.status === 'valid_catch_all' 
      ? 'valid' 
      : result.status === 'invalid' 
        ? 'invalid' 
        : 'unknown';

    await db
      .update(contacts)
      .set({
        emailStatus: result.status,
        emailValidationStatus: validationStatus,
        emailValidatedAt: new Date(),
        emailConfidence: result.confidence,
        emailValidationDetails: result.details,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));

    return result;
  } catch (error) {
    console.error('Error validating contact:', error);
    return null;
  }
}

export async function validateEmailBatch(emails: string[], batchSize = 5): Promise<EmailValidationResult[]> {
  const results: EmailValidationResult[] = [];
  
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(validateEmail));
    results.push(...batchResults);
    
    if (i + batchSize < emails.length) {
      await delay(1000);
    }
  }
  
  return results;
}

export interface EmailFindResult {
  email: string | null;
  confidence: number;
  status: string;
  creditsUsed: number;
}

interface EmailFindResponse {
  email: string | null;
  confidence: number;
  status: string;
  is_catch_all: boolean;
  credits_consumed?: number;
}

async function makeEmailFindRequest(firstName: string, lastName: string, companyDomain: string, apiKey: string): Promise<EmailFindResponse> {
  const response = await axios.post<EmailFindResponse>(
    `${LEADMAGIC_API_BASE}/email-finder`,
    { 
      first_name: firstName, 
      last_name: lastName, 
      domain: companyDomain 
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      timeout: 30000,
    }
  );
  return response.data;
}

export async function findEmail(firstName: string, lastName: string, companyDomain: string): Promise<EmailFindResult> {
  const apiKey = process.env.LEADMAGIC_API_KEY;
  
  if (!apiKey) {
    console.warn('LEADMAGIC_API_KEY not configured, returning null email');
    return {
      email: null,
      confidence: 0,
      status: 'unknown',
      creditsUsed: 0,
    };
  }

  try {
    const data = await pRetry(
      async () => {
        try {
          return await makeEmailFindRequest(firstName, lastName, companyDomain, apiKey);
        } catch (error: any) {
          if (error.response?.status === 429) {
            console.warn('LeadMagic rate limit hit, will retry...');
            throw error;
          }
          if (error.response?.status >= 500) {
            console.warn('LeadMagic server error, will retry...');
            throw error;
          }
          error.message = `LeadMagic API error: ${error.message}`;
          throw error;
        }
      },
      {
        retries: 1,
        minTimeout: 1000,
        maxTimeout: 5000,
        onFailedAttempt: error => {
          console.log(`Email find attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
        },
      }
    );

    const creditsUsed = data.credits_consumed || 1;
    totalCreditsUsed += creditsUsed;

    return {
      email: data.email || null,
      confidence: data.confidence || 0,
      status: data.status || 'unknown',
      creditsUsed,
    };
  } catch (error: any) {
    console.error('LeadMagic email find error:', error.message);
    return {
      email: null,
      confidence: 0,
      status: 'error',
      creditsUsed: 0,
    };
  }
}
