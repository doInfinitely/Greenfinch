// ============================================================================
// Apollo.io People Match API Client
//
// Provides "turbo enrich" for contacts — phone, email, and title data via
// Apollo's People Match endpoint. Results are cached per person (30d TTL)
// to avoid burning credits on repeat lookups.
//
// API docs: https://apolloio.github.io/apollo-api-docs/
// ============================================================================

import { rateLimiters, withRetry } from './rate-limiter';
import { cacheGet, cacheSet } from './redis';
import { trackCostFireAndForget } from './cost-tracker';

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const NEGATIVE_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface ApolloPersonResult {
  found: boolean;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  location: string | null;
  seniority: string | null;
  departments: string[];
  raw?: any;
  error?: string;
}

interface ApolloPersonMatchResponse {
  person?: {
    id: string;
    first_name: string;
    last_name: string;
    name: string;
    email: string | null;
    sanitized_phone: string | null;
    title: string | null;
    headline: string | null;
    linkedin_url: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    seniority: string | null;
    departments: string[];
    organization?: {
      name: string | null;
      primary_domain: string | null;
    };
  };
  status?: string;
}

function buildCacheKey(firstName: string, lastName: string, domain: string, linkedinUrl?: string): string {
  const parts = ['apollo-person', firstName.toLowerCase(), lastName.toLowerCase(), domain.toLowerCase()];
  if (linkedinUrl) parts.push(linkedinUrl.toLowerCase());
  return parts.join(':');
}

/**
 * Enrich a contact using Apollo's People Match API.
 * Results are cached for 30 days; negative results cached for 24h.
 */
export async function apolloTurboEnrich(contact: {
  firstName: string;
  lastName: string;
  domain: string;
  email?: string;
  linkedinUrl?: string;
  title?: string;
}): Promise<ApolloPersonResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return { found: false, email: null, phone: null, title: null, company: null, linkedinUrl: null, location: null, seniority: null, departments: [], error: 'APOLLO_API_KEY not configured' };
  }

  const cacheKey = buildCacheKey(contact.firstName, contact.lastName, contact.domain, contact.linkedinUrl);

  // Check cache
  const cached = await cacheGet<ApolloPersonResult>(cacheKey);
  if (cached) {
    console.log(`[Apollo] Cache hit for ${contact.firstName} ${contact.lastName} @ ${contact.domain}`);
    return cached;
  }

  console.log(`[Apollo] Turbo enrich: ${contact.firstName} ${contact.lastName} @ ${contact.domain}`);

  try {
    const result = await withRetry(
      () => rateLimiters.apollo.execute(async () => {
        const body: Record<string, any> = {
          first_name: contact.firstName,
          last_name: contact.lastName,
          organization_name: contact.domain,
          domain: contact.domain,
        };

        if (contact.email) body.email = contact.email;
        if (contact.linkedinUrl) body.linkedin_url = contact.linkedinUrl;
        if (contact.title) body.title = contact.title;

        const response = await fetch(`${APOLLO_API_BASE}/people/match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
          },
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          throw new Error('Rate limit hit');
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Apollo API error ${response.status}: ${errorText}`);
        }

        return (await response.json()) as ApolloPersonMatchResponse;
      }),
      { maxRetries: 3, baseDelayMs: 2000, serviceName: 'Apollo' }
    );

    const person = result.person;
    if (!person) {
      const negativeResult: ApolloPersonResult = {
        found: false, email: null, phone: null, title: null, company: null,
        linkedinUrl: null, location: null, seniority: null, departments: [],
      };

      trackCostFireAndForget({
        provider: 'apollo',
        endpoint: 'people/match',
        entityType: 'contact',
        success: true,
        metadata: { found: false },
      });

      await cacheSet(cacheKey, negativeResult, NEGATIVE_CACHE_TTL_SECONDS);
      return negativeResult;
    }

    const locationParts = [person.city, person.state, person.country].filter(Boolean);
    const enriched: ApolloPersonResult = {
      found: true,
      email: person.email,
      phone: person.sanitized_phone,
      title: person.title,
      company: person.organization?.name ?? null,
      linkedinUrl: person.linkedin_url,
      location: locationParts.length > 0 ? locationParts.join(', ') : null,
      seniority: person.seniority,
      departments: person.departments || [],
    };

    trackCostFireAndForget({
      provider: 'apollo',
      endpoint: 'people/match',
      entityType: 'contact',
      success: true,
      metadata: { found: true, hasEmail: !!person.email, hasPhone: !!person.sanitized_phone },
    });

    // Cache without raw response
    await cacheSet(cacheKey, enriched, CACHE_TTL_SECONDS);
    return enriched;
  } catch (error: any) {
    console.error('[Apollo] Turbo enrich failed:', error.message);
    trackCostFireAndForget({
      provider: 'apollo',
      endpoint: 'people/match',
      entityType: 'contact',
      success: false,
      errorMessage: error.message,
    });
    return { found: false, email: null, phone: null, title: null, company: null, linkedinUrl: null, location: null, seniority: null, departments: [], error: error.message };
  }
}
