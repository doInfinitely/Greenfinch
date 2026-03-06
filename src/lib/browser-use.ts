// ============================================================================
// browser-use — TypeScript Client
//
// HTTP client for the browser-use Python microservice (FastAPI + browser-use).
// Provides structured web scraping for LinkedIn profiles, company team pages,
// and generic page extraction.
//
// The microservice runs separately and must be configured via BROWSER_USE_URL.
// ============================================================================

import { rateLimiters } from './rate-limiter';
import { trackCostFireAndForget } from '@/lib/cost-tracker';

const DEFAULT_BROWSER_USE_URL = 'http://localhost:8100';

function getBrowserUseUrl(): string {
  return process.env.BROWSER_USE_URL || DEFAULT_BROWSER_USE_URL;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserScrapeInput {
  url: string;
  extractionPrompt: string;
  timeoutMs?: number;
  waitForSelector?: string;
}

export interface BrowserScrapeResult {
  success: boolean;
  data: any;
  url: string;
  screenshotUrl?: string;
  error?: string;
  durationMs: number;
}

export interface LinkedInProfileData {
  name: string | null;
  headline: string | null;
  location: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  profilePictureUrl: string | null;
  about: string | null;
  experiences: LinkedInExperience[];
  education: LinkedInEducation[];
}

export interface LinkedInExperience {
  title: string;
  company: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface LinkedInEducation {
  school: string;
  degree: string | null;
  field: string | null;
  startYear: number | null;
  endYear: number | null;
}

export interface EmploymentHistory {
  currentEmployer: string | null;
  currentTitle: string | null;
  experiences: LinkedInExperience[];
  hasJobChange: boolean;
  lastUpdated: string | null;
}

export interface PersonFromPage {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

async function browserUseRequest<T>(
  endpoint: string,
  body: any,
  timeoutMs: number = 60_000
): Promise<T> {
  const baseUrl = getBrowserUseUrl();
  const url = `${baseUrl}${endpoint}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`browser-use HTTP ${response.status}: ${errorText.slice(0, 300)}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generic page scrape with LLM extraction.
 */
export async function browserScrape(input: BrowserScrapeInput): Promise<BrowserScrapeResult> {
  const startMs = Date.now();

  try {
    const result = await rateLimiters.browserUse.execute(() =>
      browserUseRequest<BrowserScrapeResult>('/api/scrape', {
        url: input.url,
        extraction_prompt: input.extractionPrompt,
        timeout_ms: input.timeoutMs || 30_000,
        wait_for_selector: input.waitForSelector,
      }, input.timeoutMs || 60_000)
    );

    trackCostFireAndForget({
      provider: 'browser_use',
      endpoint: 'scrape',
      entityType: 'page',
      success: result.success,
      metadata: { url: input.url },
    });

    return { ...result, durationMs: Date.now() - startMs };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'browser_use',
      endpoint: 'scrape',
      entityType: 'page',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      data: null,
      url: input.url,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startMs,
    };
  }
}

/**
 * Extract structured LinkedIn profile data from a profile URL.
 */
export async function browserExtractLinkedInProfile(url: string): Promise<LinkedInProfileData> {
  const emptyProfile: LinkedInProfileData = {
    name: null, headline: null, location: null,
    currentTitle: null, currentCompany: null,
    profilePictureUrl: null, about: null,
    experiences: [], education: [],
  };

  try {
    const result = await rateLimiters.browserUse.execute(() =>
      browserUseRequest<{ data: LinkedInProfileData }>('/api/linkedin/profile', {
        url,
        timeout_ms: 45_000,
      }, 60_000)
    );

    trackCostFireAndForget({
      provider: 'browser_use',
      endpoint: 'linkedin-profile',
      entityType: 'contact',
      success: true,
      metadata: { url },
    });

    return result.data || emptyProfile;
  } catch (error) {
    console.error(`[BrowserUse] LinkedIn profile scrape failed for ${url}: ${error instanceof Error ? error.message : error}`);
    trackCostFireAndForget({
      provider: 'browser_use',
      endpoint: 'linkedin-profile',
      entityType: 'contact',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return emptyProfile;
  }
}

/**
 * Extract employment history from a LinkedIn profile URL.
 */
export async function browserExtractEmploymentHistory(linkedinUrl: string): Promise<EmploymentHistory> {
  const empty: EmploymentHistory = {
    currentEmployer: null, currentTitle: null,
    experiences: [], hasJobChange: false, lastUpdated: null,
  };

  try {
    const profile = await browserExtractLinkedInProfile(linkedinUrl);
    if (!profile.experiences || profile.experiences.length === 0) {
      return empty;
    }

    const currentExp = profile.experiences.find(e => e.isCurrent);
    return {
      currentEmployer: currentExp?.company || profile.currentCompany,
      currentTitle: currentExp?.title || profile.currentTitle,
      experiences: profile.experiences,
      hasJobChange: false, // Determined by caller comparing against expected employer
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[BrowserUse] Employment history extraction failed for ${linkedinUrl}: ${error instanceof Error ? error.message : error}`);
    return empty;
  }
}

/**
 * Extract team/people from a company's team page.
 */
export async function browserExtractTeamPage(domain: string): Promise<{ people: PersonFromPage[] }> {
  try {
    const result = await rateLimiters.browserUse.execute(() =>
      browserUseRequest<{ data: { people: PersonFromPage[] } }>('/api/company/team', {
        domain,
        timeout_ms: 45_000,
      }, 60_000)
    );

    trackCostFireAndForget({
      provider: 'browser_use',
      endpoint: 'company-team',
      entityType: 'organization',
      success: true,
      metadata: { domain, peopleCount: result.data?.people?.length || 0 },
    });

    return result.data || { people: [] };
  } catch (error) {
    console.error(`[BrowserUse] Team page scrape failed for ${domain}: ${error instanceof Error ? error.message : error}`);
    trackCostFireAndForget({
      provider: 'browser_use',
      endpoint: 'company-team',
      entityType: 'organization',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { people: [] };
  }
}

/**
 * Health check for the browser-use microservice.
 */
export async function browserUseHealthCheck(): Promise<boolean> {
  try {
    const baseUrl = getBrowserUseUrl();
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}
