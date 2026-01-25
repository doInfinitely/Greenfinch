import axios from 'axios';
import pRetry from 'p-retry';
import { db } from './db';
import { contacts } from './schema';
import { eq } from 'drizzle-orm';

const NEVERBOUNCE_API_BASE = 'https://api.neverbounce.com/v4.2';

export interface EmailValidationResult {
  isValid: boolean;
  confidence: number;
  status: 'valid' | 'invalid' | 'disposable' | 'catchall' | 'unknown';
  details: NeverBounceResponse;
  creditsUsed: number;
}

export interface NeverBounceResponse {
  status: string;
  result: string;
  flags: string[];
  suggested_correction: string;
  execution_time: number;
  credits_info?: {
    paid_credits_used: number;
    free_credits_used: number;
    paid_credits_remaining: number;
    free_credits_remaining: number;
  };
}

let totalCreditsUsed = 0;

export function getCreditsUsed(): number {
  return totalCreditsUsed;
}

export function resetCreditsTracker(): void {
  totalCreditsUsed = 0;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function makeApiRequest(email: string, apiKey: string): Promise<NeverBounceResponse> {
  const response = await axios.get<NeverBounceResponse>(
    `${NEVERBOUNCE_API_BASE}/single/check`,
    {
      params: {
        key: apiKey,
        email: email,
        credits_info: 1,
      },
      timeout: 30000,
    }
  );
  return response.data;
}

export async function validateEmail(email: string): Promise<EmailValidationResult> {
  const apiKey = process.env.NEVERBOUNCE_API_KEY;
  
  if (!apiKey) {
    console.warn('NEVERBOUNCE_API_KEY not configured, returning unknown status');
    return {
      isValid: false,
      confidence: 0,
      status: 'unknown',
      details: {
        status: 'error',
        result: 'unknown',
        flags: [],
        suggested_correction: '',
        execution_time: 0,
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
            console.warn('NeverBounce rate limit hit, will retry...');
            throw error;
          }
          if (error.response?.status >= 500) {
            console.warn('NeverBounce server error, will retry...');
            throw error;
          }
          error.message = `NeverBounce API error: ${error.message}`;
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

    const creditsUsed = 1;
    totalCreditsUsed += creditsUsed;

    let status: 'valid' | 'invalid' | 'disposable' | 'catchall' | 'unknown' = 'unknown';
    let isValid = false;
    let confidence = 0.5;

    switch (data.result) {
      case 'valid':
        status = 'valid';
        isValid = true;
        confidence = 0.95;
        break;
      case 'invalid':
        status = 'invalid';
        isValid = false;
        confidence = 0.95;
        break;
      case 'disposable':
        status = 'disposable';
        isValid = false;
        confidence = 0.9;
        break;
      case 'catchall':
        status = 'catchall';
        isValid = true;
        confidence = 0.6;
        break;
      case 'unknown':
        status = 'unknown';
        isValid = false;
        confidence = 0.3;
        break;
      default:
        console.warn(`NeverBounce returned unexpected result: ${data.result}`);
        status = 'invalid';
        isValid = false;
        confidence = 0.8;
    }

    return {
      isValid,
      confidence,
      status,
      details: data,
      creditsUsed,
    };
  } catch (error: any) {
    console.error('NeverBounce API error:', error.message);
    return {
      isValid: false,
      confidence: 0,
      status: 'unknown',
      details: {
        status: 'error',
        result: 'unknown',
        flags: [],
        suggested_correction: '',
        execution_time: 0,
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

    const validationStatus = result.status === 'valid' 
      ? 'valid' 
      : result.status === 'invalid' || result.status === 'disposable'
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
