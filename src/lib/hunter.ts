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
