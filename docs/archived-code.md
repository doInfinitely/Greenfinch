# Archived Code — Enrichment Pipeline Refactor

This file contains retired modules from the enrichment pipeline refactor (February 2026). Each section documents a removed file, the reason it was retired, and its full source code at the time of archival.

---

## Table of Contents

1. [src/lib/enrichment-providers.ts](#1-srclibenmrichment-providersts)
2. [src/lib/google-places.ts](#2-srclibgoogle-placests)
3. [src/lib/maps-grounding.ts](#3-srclibmaps-groundingts)
4. [src/lib/enrichment.ts](#4-srclibenrichmentts)
5. [src/lib/leadmagic.ts](#5-srclibleadmagicts)
6. [src/lib/neverbounce.ts](#6-srclibneverbouncts)
7. [src/app/api/test/linkedin/route.ts](#7-srcappapitestlinkedinroutets)
8. [src/app/api/test/maps-grounding/route.ts](#8-srcappapitestmaps-groundingroutets)
9. [src/app/api/validate-email/route.ts](#9-srcappapivalidate-emailroutets)
10. [src/map/GoogleMap.ts](#10-srcmapgooglemts)
11. [src/map/GoogleMapCanvas.tsx](#11-srcmapgooglemapcanvastsx)
12. [src/app/dashboard/google-map/page.tsx](#12-srcappdashboardgoogle-mappagetsx)

---

## 1. `src/lib/enrichment-providers.ts`

**Reason retired:** Barrel re-export file with zero importers. All callers now import directly from individual provider modules or use `cascade-enrichment.ts`.

```ts
/**
 * Unified Enrichment Providers Index
 * 
 * This file consolidates all email, person, and company enrichment providers
 * into a single import location for easier access and management.
 * 
 * Individual provider files remain separate for maintainability,
 * but this index provides a unified API surface.
 */

// Person Enrichment Providers
export { enrichPersonApollo, enrichCompanyApollo } from './apollo';
export { enrichPersonPDL, enrichCompanyPDL } from './pdl';
export { 
  enrichLinkedInProfile,
  lookupPerson as lookupPersonEnrichLayer,
  getCompanyProfile, 
  resolveCompanyByDomain,
  lookupWorkEmail,
  getProfilePicture,
  enrichCompanyByDomain as enrichCompanyEnrichLayer
} from './enrichlayer';

// Email Finding Providers
export { 
  findEmail as findEmailHunter,
  verifyEmail as verifyEmailHunter,
  enrichCompanyByDomain as enrichCompanyHunter 
} from './hunter';
export { 
  findEmailByName as findEmailFindymail,
  findEmailByLinkedIn as findEmailFindymailLinkedIn,
  findLinkedInByEmail as findLinkedInByEmailFindymail,
  verifyEmail as verifyEmailFindymail 
} from './findymail';
export {
  enrichPersonCrustdata,
  enrichCompanyCrustdata
} from './crustdata';

// Cascade Enrichment Pipelines
export {
  enrichContactCascade,
  enrichOrganizationCascade
} from './cascade-enrichment';

// Email Verification Providers
export { 
  validateEmail as validateEmailLeadMagic,
  findEmail as findEmailLeadMagic 
} from './leadmagic';
export { validateEmail as validateEmailZeroBounce } from './zerobounce';
export { validateEmail as validateEmailNeverBounce } from './neverbounce';

// Type exports for convenience
export type { PDLPersonResult, PDLCompanyResult } from './pdl';
export type { CrustdataPersonResult, CrustdataCompanyResult } from './crustdata';
export type { ContactEnrichmentResult, OrganizationEnrichmentResult as CascadeOrgResult, ConfidenceFlag, EmailSource } from './cascade-enrichment';
export type { EmailFindResult } from './hunter';
export type { EmailValidationResult as LeadMagicValidationResult } from './leadmagic';
export type { EmailValidationResult as NeverBounceValidationResult } from './neverbounce';
```

---

## 2. `src/lib/google-places.ts`

**Reason retired:** Google Places API integration for common name lookup and containing place detection. Zero importers — functionality was superseded by Mapbox POI enrichment.

```ts
import { cacheGet, cacheSet, isRedisConfigured } from './redis';

export interface CommonNameResult {
  commonName: string | null;
  rawResponse: unknown;
}

// In-memory fallback cache
const memoryNameCache = new Map<string, { result: CommonNameResult; timestamp: number }>();
const NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NAME_CACHE_TTL_SECONDS = 86400; // 24 hours for Redis

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 100;

async function throttle(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
  }
  
  lastRequestTime = Date.now();
}

function getNameCacheKey(lat: number, lon: number): string {
  const roundedLat = Math.round(lat * 100000) / 100000;
  const roundedLon = Math.round(lon * 100000) / 100000;
  return `gplaces:${roundedLat},${roundedLon}`;
}

export async function getCommonNameFromGooglePlaces(lat: number, lon: number): Promise<CommonNameResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('[Google Places] No API key configured');
    return { commonName: null, rawResponse: null };
  }
  
  const cacheKey = getNameCacheKey(lat, lon);
  
  // Check cache (Redis with in-memory fallback)
  if (isRedisConfigured()) {
    const redisCached = await cacheGet<CommonNameResult>(cacheKey);
    if (redisCached) {
      return redisCached;
    }
  } else {
    const memoryCached = memoryNameCache.get(cacheKey);
    if (memoryCached && Date.now() - memoryCached.timestamp < NAME_CACHE_TTL_MS) {
      return memoryCached.result;
    }
  }
  
  await throttle();
  
  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName',
        },
        body: JSON.stringify({
          maxResultCount: 1,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 10.0,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Places] Common name lookup error:', errorText);
      return { commonName: null, rawResponse: null };
    }

    const data = await response.json();
    const places = data.places || [];

    if (places.length === 0) {
      const noResult: CommonNameResult = { commonName: null, rawResponse: data };
      if (isRedisConfigured()) {
        await cacheSet(cacheKey, noResult, NAME_CACHE_TTL_SECONDS);
      } else {
        memoryNameCache.set(cacheKey, { result: noResult, timestamp: Date.now() });
      }
      return noResult;
    }

    const firstPlace = places[0];
    const commonName = firstPlace.displayName?.text || null;

    const result: CommonNameResult = { commonName, rawResponse: data };
    if (isRedisConfigured()) {
      await cacheSet(cacheKey, result, NAME_CACHE_TTL_SECONDS);
    } else {
      memoryNameCache.set(cacheKey, { result, timestamp: Date.now() });
    }
    return result;
  } catch (error) {
    console.error('[Google Places] Error getting common name:', error);
    return { commonName: null, rawResponse: null };
  }
}

export function clearNameCache(): void {
  memoryNameCache.clear();
}

interface ContainingPlaceResult {
  containingPlace: string | null;
  containingPlaceType: string | null;
  confidence: number;
}

interface NearbyPlace {
  displayName?: { text: string };
  types?: string[];
  primaryType?: string;
}

const CONTAINING_PLACE_TYPES = [
  'shopping_mall',
  'school',
  'university',
  'hospital',
  'hotel',
  'parking',
];

export async function findContainingPlace(
  lat: number,
  lon: number
): Promise<ContainingPlaceResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('[Google Places] No API key configured');
    return { containingPlace: null, containingPlaceType: null, confidence: 0 };
  }

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType',
        },
        body: JSON.stringify({
          includedTypes: CONTAINING_PLACE_TYPES,
          maxResultCount: 1,
          rankPreference: 'POPULARITY',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 25.0,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Places] Nearby search error:', errorText);
      return { containingPlace: null, containingPlaceType: null, confidence: 0 };
    }

    const data = await response.json();
    const places: NearbyPlace[] = data.places || [];

    if (places.length === 0) {
      return { containingPlace: null, containingPlaceType: null, confidence: 0 };
    }

    const prioritizedTypes = [
      'shopping_mall',
      'hospital',
      'airport',
      'university',
      'convention_center',
    ];

    for (const preferredType of prioritizedTypes) {
      const match = places.find(
        (p) => p.primaryType === preferredType || p.types?.includes(preferredType)
      );
      if (match && match.displayName?.text) {
        return {
          containingPlace: match.displayName.text,
          containingPlaceType: match.primaryType || preferredType,
          confidence: 0.85,
        };
      }
    }

    const firstPlace = places[0];
    if (firstPlace && firstPlace.displayName?.text) {
      return {
        containingPlace: firstPlace.displayName.text,
        containingPlaceType: firstPlace.primaryType || null,
        confidence: 0.7,
      };
    }

    return { containingPlace: null, containingPlaceType: null, confidence: 0 };
  } catch (error) {
    console.error('[Google Places] Error finding containing place:', error);
    return { containingPlace: null, containingPlaceType: null, confidence: 0 };
  }
}

export async function getPlaceDetails(
  lat: number,
  lon: number
): Promise<{ placeName: string | null; placeType: string | null; containingPlace: string | null }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    return { placeName: null, placeType: null, containingPlace: null };
  }

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType',
        },
        body: JSON.stringify({
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: 50.0,
            },
          },
          maxResultCount: 1,
        }),
      }
    );

    if (!response.ok) {
      return { placeName: null, placeType: null, containingPlace: null };
    }

    const data = await response.json();
    const places: NearbyPlace[] = data.places || [];

    if (places.length === 0) {
      return { placeName: null, placeType: null, containingPlace: null };
    }

    const place = places[0];
    const placeName = place.displayName?.text || null;
    const placeType = place.primaryType || null;

    const isContainingPlaceType = placeType && CONTAINING_PLACE_TYPES.includes(placeType);

    if (isContainingPlaceType) {
      return { placeName, placeType, containingPlace: placeName };
    }

    const containingResult = await findContainingPlace(lat, lon);

    return {
      placeName,
      placeType,
      containingPlace: containingResult.containingPlace,
    };
  } catch (error) {
    console.error('[Google Places] Error getting place details:', error);
    return { placeName: null, placeType: null, containingPlace: null };
  }
}
```

---

## 3. `src/lib/maps-grounding.ts`

**Reason retired:** Google Maps MCP grounding endpoint. Only imported by test route (also being removed). Never used in production enrichment flow.

```ts
import axios from 'axios';

const MAPS_GROUNDING_ENDPOINT = 'https://mapstools.googleapis.com/mcp';

export interface PlaceView {
  place: string;
  id: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  googleMapsLinks?: {
    placeUrl?: string;
    directionsUrl?: string;
    reviewsUrl?: string;
    photosUrl?: string;
  };
}

export interface SearchPlacesResponse {
  places: PlaceView[];
  summary: string;
  nextPageToken?: string;
}

export interface MapsGroundingResult {
  success: boolean;
  summary?: string;
  places?: PlaceView[];
  error?: string;
}

export async function searchPlaces(
  query: string,
  location?: { latitude: number; longitude: number },
  radiusMeters?: number
): Promise<MapsGroundingResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.error('[MapsGrounding] GOOGLE_MAPS_API_KEY not configured');
    return { success: false, error: 'API key not configured' };
  }

  const arguments_: Record<string, unknown> = {
    textQuery: query,
  };

  if (location) {
    arguments_.locationBias = {
      circle: {
        center: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        ...(radiusMeters && { radiusMeters }),
      },
    };
  }

  const requestBody = {
    method: 'tools/call',
    params: {
      name: 'search_places',
      arguments: arguments_,
    },
    jsonrpc: '2.0',
    id: 1,
  };

  try {
    console.log(`[MapsGrounding] Searching: "${query}"${location ? ` near (${location.latitude}, ${location.longitude})` : ''}`);
    const startTime = Date.now();

    const response = await axios.post(MAPS_GROUNDING_ENDPOINT, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'X-Goog-Api-Key': apiKey,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const data = response.data;
    
    if (data?.result?.isError) {
      const errorContent = data.result.content?.[0];
      const errorMsg = errorContent?.text || JSON.stringify(errorContent) || 'Unknown MCP error';
      console.error(`[MapsGrounding] MCP error:`, errorMsg);
      return { success: false, error: errorMsg };
    }

    if (data?.result?.content) {
      const content = data.result.content[0];
      if (content?.text) {
        try {
          const parsed = JSON.parse(content.text) as SearchPlacesResponse;
          console.log(`[MapsGrounding] Found ${parsed.places?.length || 0} places in ${elapsed}s`);
          return {
            success: true,
            summary: parsed.summary,
            places: parsed.places || [],
          };
        } catch {
          console.log(`[MapsGrounding] Response: ${content.text.substring(0, 200)}`);
          return { success: true, summary: content.text, places: [] };
        }
      }
    }

    if (data?.error) {
      console.error(`[MapsGrounding] API error:`, data.error);
      return { success: false, error: data.error.message || 'Unknown error' };
    }

    console.log(`[MapsGrounding] Unexpected response:`, JSON.stringify(data).substring(0, 300));
    return { success: false, error: 'Unexpected response format' };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[MapsGrounding] Request failed:`, error.response?.data || error.message);
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
    console.error(`[MapsGrounding] Error:`, error);
    return { success: false, error: String(error) };
  }
}

export async function getPlaceContext(
  address: string,
  commonName?: string | null,
  latitude?: number | null,
  longitude?: number | null
): Promise<string | null> {
  const query = commonName 
    ? `${commonName} at ${address}`
    : `business or property at ${address}`;

  const location = latitude && longitude 
    ? { latitude, longitude } 
    : undefined;

  const result = await searchPlaces(query, location, 100);

  if (!result.success || !result.summary) {
    return null;
  }

  let context = `Google Maps Context:\n${result.summary}`;
  
  if (result.places && result.places.length > 0) {
    const placeDetails = result.places.slice(0, 3).map((p, i) => {
      const parts = [`[${i}] Place ID: ${p.id}`];
      if (p.googleMapsLinks?.placeUrl) {
        parts.push(`Maps: ${p.googleMapsLinks.placeUrl}`);
      }
      return parts.join(' | ');
    }).join('\n');
    
    context += `\n\nPlace References:\n${placeDetails}`;
  }

  return context;
}
```

---

## 4. `src/lib/enrichment.ts`

**Reason retired:** Old AI enrichment module with `storeEnrichmentResults` and `enrichServiceProvider` functions. Only imported by test routes. Core enrichment now handled by `cascade-enrichment.ts`.

> **Note:** The file on disk was already truncated (missing the top portion with imports and the `enrichProperty`/`storeEnrichmentResults` function beginnings). The content below is the full file as it existed on disk at archival time.

```ts
tact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          contactType: contact.contactType,
          source: contact.source,
          contactRationale: contact.contactRationale,
          needsReview: contact.needsReview,
          reviewReason: contact.reviewReason,
          providerId: contact.providerId || existingContact.providerId,
          enrichmentSource: contact.enrichmentSource || existingContact.enrichmentSource,
          photoUrl: contact.photoUrl || existingContact.photoUrl,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, existingContact.id));
    } else {
      const [inserted] = await db.insert(contacts)
        .values({
          id: contact.id,
          fullName: contact.fullName,
          normalizedName: contact.normalizedName,
          nameConfidence: contact.nameConfidence,
          email: contact.email,
          normalizedEmail: contact.normalizedEmail,
          emailConfidence: contact.emailConfidence,
          emailValidationStatus: contact.emailValidationStatus,
          phone: contact.phone,
          normalizedPhone: contact.normalizedPhone,
          phoneConfidence: contact.phoneConfidence,
          phoneLabel: contact.phoneLabel,
          phoneSource: contact.phoneSource,
          aiPhone: contact.aiPhone,
          aiPhoneLabel: contact.aiPhoneLabel,
          aiPhoneConfidence: contact.aiPhoneConfidence,
          enrichmentPhoneWork: contact.enrichmentPhoneWork,
          enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
          title: contact.title,
          titleConfidence: contact.titleConfidence,
          companyDomain: contact.companyDomain,
          employerName: contact.employerName,
          linkedinUrl: contact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          location: contact.location,
          contactType: contact.contactType,
          source: contact.source,
          contactRationale: contact.contactRationale,
          needsReview: contact.needsReview,
          reviewReason: contact.reviewReason,
          providerId: contact.providerId,
          enrichmentSource: contact.enrichmentSource,
          photoUrl: contact.photoUrl,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      contactId = inserted?.id || contact.id;
      
      // Only fetch LinkedIn profile photo if we don't have one from Apollo
      if (contact.linkedinUrl && contactId && !contact.photoUrl) {
        // Fetch photo in background (don't block enrichment flow)
        getProfilePicture(contact.linkedinUrl).then(async (photoResult) => {
          if (photoResult.success && photoResult.url) {
            try {
              await db.update(contacts)
                .set({ 
                  photoUrl: photoResult.url,
                  updatedAt: new Date()
                })
                .where(eq(contacts.id, contactId));
              console.log(`[Enrichment] Auto-fetched profile photo for ${contact.fullName}`);
            } catch (err) {
              console.error(`[Enrichment] Failed to save profile photo for ${contact.fullName}:`, err);
            }
          } else {
            console.log(`[Enrichment] No profile photo found for ${contact.fullName} (${photoResult.error || 'unknown'})`);
          }
        }).catch(err => {
          console.error(`[Enrichment] Error fetching profile photo for ${contact.fullName}:`, err);
        });
      }
    }
    contactIds.push(contactId);

    // Link to property
    await db.insert(propertyContacts)
      .values({
        propertyId,
        contactId,
        role: contact.role,
        confidenceScore: contact.roleConfidence,
        discoveredAt: new Date(),
      })
      .onConflictDoNothing();
    
    // Link contact to organization by matching domain
    if (contact.companyDomain) {
      const matchingOrg = await db.query.organizations.findFirst({
        where: eq(organizations.domain, contact.companyDomain),
      });
      
      if (matchingOrg) {
        await db.insert(contactOrganizations)
          .values({
            contactId,
            orgId: matchingOrg.id,
            title: contact.title,
            isCurrent: true,
          })
          .onConflictDoNothing();
        console.log(`[Enrichment] Linked contact ${contact.fullName} to org ${matchingOrg.name}`);
      }
    }
  }

  console.log(`[Enrichment] Stored ${contactIds.length} contacts`);
  console.log(`[Enrichment] Enrichment complete for property: ${aggregatedProperty.propertyKey}`);

  return { propertyId, contactIds, orgIds };
}

// Service Provider enrichment types
export interface ServiceProviderEnrichmentResult {
  success: boolean;
  companyLinkedInUrl?: string;
  companyName?: string;
  servicesOffered?: string[];
  description?: string;
  confidence?: number;
  error?: string;
}

// Service provider enrichment prompt
const SERVICE_PROVIDER_PROMPT = `You are a commercial property services expert. Analyze the given company name and domain to determine what facility services they provide.

CONTEXT:
You are helping a commercial property prospecting tool identify and classify service providers that work with commercial properties. These are companies that provide facility management and maintenance services.

SERVICE CATEGORIES (choose all that apply):
1. landscaping - Landscaping, lawn care, grounds maintenance, irrigation, tree services
2. janitorial - Cleaning services, janitorial, custodial, sanitation
3. hvac - HVAC, heating, ventilation, air conditioning, climate control
4. security - Security services, guards, surveillance, access control
5. waste_management - Waste removal, recycling, dumpster services
6. elevator - Elevator, escalator maintenance and repair
7. roofing - Commercial roofing, roof repair, waterproofing
8. plumbing - Commercial plumbing, pipe repair, water systems
9. electrical - Electrical services, wiring, lighting
10. fire_protection - Fire alarm systems, sprinklers, fire safety
11. parking_pavement - Parking lot maintenance, striping, asphalt repair
12. pest_control - Pest control, extermination, pest management
13. window_cleaning - Window washing, high-rise window cleaning
14. snow_ice_removal - Snow removal, ice management, de-icing
15. pool_water_features - Pool maintenance, fountain care, water features

INPUT:
- Company Name: {companyName}
- Domain: {domain}
- Website Description (if available): {websiteDescription}

OUTPUT: Respond with ONLY valid JSON in this exact format:
{
  "servicesOffered": ["category1", "category2"],
  "primaryService": "main_category",
  "description": "Brief description of the company and its services",
  "confidence": 0.0-1.0
}

RULES:
1. Only include service categories from the list above
2. If you cannot determine services, return empty array for servicesOffered
3. confidence should reflect how certain you are (0.9+ for clear service companies, 0.5-0.8 for partial info, <0.5 for uncertain)
4. Be conservative - only include services you're confident they provide`;

// Enrich a service provider with AI classification
export async function enrichServiceProvider(
  companyName: string,
  domain: string,
  websiteDescription?: string
): Promise<ServiceProviderEnrichmentResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GOOGLE_GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('[ServiceProvider Enrichment] No Gemini API key found');
    return { success: false, error: 'No API key available' };
  }

  try {
    const genai = new GoogleGenAI({ apiKey });
    
    const prompt = SERVICE_PROVIDER_PROMPT
      .replace('{companyName}', companyName)
      .replace('{domain}', domain || 'Not available')
      .replace('{websiteDescription}', websiteDescription || 'Not available');

    console.log(`[ServiceProvider Enrichment] Enriching: ${companyName} (${domain})`);

    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const responseText = response.text || '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ServiceProvider Enrichment] No valid JSON in response');
      return { success: false, error: 'Invalid response format' };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Search for company LinkedIn page
    let companyLinkedInUrl: string | undefined;
    try {
      const linkedinQuery = `site:linkedin.com/company "${companyName}"`;
      const searchResults = await serpApiSearch(linkedinQuery);
      
      if (searchResults?.items && searchResults.items.length > 0) {
        const linkedinResult = searchResults.items.find(item => 
          item.link.includes('linkedin.com/company/')
        );
        if (linkedinResult) {
          companyLinkedInUrl = linkedinResult.link;
          console.log(`[ServiceProvider Enrichment] Found LinkedIn: ${companyLinkedInUrl}`);
        }
      }
    } catch (err) {
      console.error('[ServiceProvider Enrichment] LinkedIn search failed:', err);
    }

    return {
      success: true,
      companyName,
      companyLinkedInUrl,
      servicesOffered: parsed.servicesOffered || [],
      description: parsed.description,
      confidence: parsed.confidence || 0.5,
    };
  } catch (error) {
    console.error('[ServiceProvider Enrichment] Error:', error);
    return { success: false, error: String(error) };
  }
}

// Combined function to enrich and store
export async function enrichAndStoreProperty(
  aggregatedProperty: AggregatedProperty
): Promise<{ result: EnrichmentResult; stored: { propertyId: string; contactIds: string[]; orgIds: string[] } | null }> {
  const result = await enrichProperty(aggregatedProperty);
  
  if (!result.success) {
    return { result, stored: null };
  }

  const stored = await storeEnrichmentResults(aggregatedProperty, result);
  return { result, stored };
}
```

---

## 5. `src/lib/leadmagic.ts`

**Reason retired:** LeadMagic email validation and finder. Only re-exported by `enrichment-providers.ts` (dead). Email validation now uses ZeroBounce as primary, and email finding uses Findymail/Hunter cascade.

```ts
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
```

---

## 6. `src/lib/neverbounce.ts`

**Reason retired:** NeverBounce email validation. Used by admin compare route and validate-email route. Both are legacy — validation now uses ZeroBounce as primary provider.

```ts
import axios from 'axios';
import pRetry from 'p-retry';
import pLimit from 'p-limit';
import { db } from './db';
import { contacts } from './schema';
import { eq } from 'drizzle-orm';
import { CONCURRENCY } from './constants';

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

export async function validateEmailBatch(emails: string[]): Promise<EmailValidationResult[]> {
  const limit = pLimit(CONCURRENCY.NEVERBOUNCE);
  
  console.log(`[NeverBounce] Validating ${emails.length} emails with concurrency=${CONCURRENCY.NEVERBOUNCE}`);
  
  const results = await Promise.all(
    emails.map(email => limit(() => validateEmail(email)))
  );
  
  const valid = results.filter(r => r.isValid).length;
  console.log(`[NeverBounce] Batch complete: ${valid}/${emails.length} valid`);
  
  return results;
}
```

---

## 7. `src/app/api/test/linkedin/route.ts`

**Reason retired:** Test/debug route for old Gemini-based LinkedIn URL search. Imports from retired `enrichment.ts`.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { findLinkedInUrl } from '@/lib/enrichment';
import { GoogleGenAI } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  if (process.env.GOOGLE_GENAI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });
  }
  
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!apiKey) {
    throw new Error("No Gemini API key found");
  }
  
  if (baseUrl) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl,
      },
    });
  }
  
  return new GoogleGenAI({ apiKey });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get('name');
  const title = searchParams.get('title');
  const company = searchParams.get('company');
  const domain = searchParams.get('domain');
  const city = searchParams.get('city');
  const noSearch = searchParams.get('noSearch') === 'true';

  if (!name) {
    return NextResponse.json(
      { error: 'Name is required' },
      { status: 400 }
    );
  }

  console.log(`[Test API] LinkedIn search for: ${name}, ${title || 'no title'}, ${company || 'no company'}, ${domain || 'no domain'}, ${city || 'no city'}, noSearch: ${noSearch}`);

  // Test with custom search if noSearch is not set
  if (noSearch) {
    // Test if Gemini API works without search grounding
    try {
      const client = getGeminiClient();
      const testResponse = await client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Say hello in one word",
      });
      const testText = testResponse.text?.trim();
      console.log(`[Test API] Basic Gemini test response: ${testText}`);
      
      return NextResponse.json({
        success: true,
        mode: 'no-search-test',
        testResponse: testText,
      });
    } catch (error) {
      console.error('[Test API] Basic Gemini test error:', error);
      return NextResponse.json(
        { error: 'Gemini API test failed', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }

  try {
    const result = await findLinkedInUrl(
      name,
      title || null,
      company || null,
      domain || null,
      city || null
    );

    return NextResponse.json({
      success: !!result.linkedinUrl,
      searchParams: {
        name,
        title: title || null,
        company: company || null,
        domain: domain || null,
        city: city || null,
      },
      result: {
        linkedinUrl: result.linkedinUrl,
        confidence: result.confidence,
      },
    });
  } catch (error) {
    console.error('[Test API] LinkedIn search error:', error);
    return NextResponse.json(
      { error: 'Failed to search for LinkedIn profile', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

---

## 8. `src/app/api/test/maps-grounding/route.ts`

**Reason retired:** Test/debug route for Google Maps MCP grounding. Imports from retired `maps-grounding.ts`.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { searchPlaces, getPlaceContext } from '@/lib/maps-grounding';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  const address = searchParams.get('address');
  const name = searchParams.get('name');
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');

  if (address) {
    const latitude = lat ? parseFloat(lat) : null;
    const longitude = lng ? parseFloat(lng) : null;
    
    const context = await getPlaceContext(address, name, latitude, longitude);
    
    return NextResponse.json({
      success: !!context,
      address,
      name,
      context,
    });
  }

  if (!query) {
    return NextResponse.json(
      { error: 'Missing query or address parameter' },
      { status: 400 }
    );
  }

  const latitude = lat ? parseFloat(lat) : undefined;
  const longitude = lng ? parseFloat(lng) : undefined;
  const location = latitude && longitude ? { latitude, longitude } : undefined;

  const result = await searchPlaces(query, location);

  return NextResponse.json({
    success: result.success,
    query,
    location,
    summary: result.summary,
    placesCount: result.places?.length || 0,
    places: result.places?.slice(0, 5),
    error: result.error,
  });
}
```

---

## 9. `src/app/api/validate-email/route.ts`

**Reason retired:** Standalone NeverBounce email validation endpoint. Replaced by ZeroBounce validation integrated in cascade pipeline.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { validateEmail, validateAndUpdateContact, getCreditsUsed } from '@/lib/neverbounce';
import { rateLimitMiddleware, checkRateLimit as checkRateLimitFn, addRateLimitHeaders, getIdentifier } from '@/lib/rate-limit';

const checkRateLimit = rateLimitMiddleware(20, 60);

export async function POST(request: NextRequest) {
  try {
    const rateResponse = await checkRateLimit(request);
    if (rateResponse) return rateResponse;

    const body = await request.json();
    const { email, contactId } = body;

    // Get rate limit info for headers
    const identifier = getIdentifier(request);
    const route = new URL(request.url).pathname;
    const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

    if (contactId) {
      const result = await validateAndUpdateContact(contactId);
      if (!result) {
        return NextResponse.json(
          { error: 'Contact not found or has no email' },
          { status: 404 }
        );
      }
      const response = NextResponse.json({ 
        result: {
          isValid: result.isValid,
          confidence: result.confidence,
          status: result.status,
          details: result.details,
        },
        creditsUsed: result.creditsUsed,
        totalCreditsUsed: getCreditsUsed(),
      });
      addRateLimitHeaders(response, rateInfo);
      return response;
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email or contactId required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const result = await validateEmail(email);
    const response = NextResponse.json({ 
      result: {
        isValid: result.isValid,
        confidence: result.confidence,
        status: result.status,
        details: result.details,
      },
      creditsUsed: result.creditsUsed,
      totalCreditsUsed: getCreditsUsed(),
    });
    addRateLimitHeaders(response, rateInfo);
    return response;
  } catch (error) {
    console.error('Email validation API error:', error);
    return NextResponse.json(
      { error: 'Failed to validate email' },
      { status: 500 }
    );
  }
}
```

---

## 10. `src/map/GoogleMap.ts`

**Reason retired:** Google Maps controller (alternate to Mapbox DashboardMap). POC implementation, not used in production — Mapbox is the production map provider.

```ts
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { MVTLayer } from '@deck.gl/geo-layers';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { normalizeCommonName } from '@/lib/normalization';

let googleMapsOptionsSet = false;

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GoogleMapConfig {
  container: HTMLElement;
  apiKey: string;
  regridToken?: string;
  regridTileUrl?: string;
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
}

interface PropertyFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    propertyKey: string;
    address: string;
    commonName: string | null;
    enriched: boolean;
  };
}

export class GoogleMapController {
  private map: google.maps.Map | null = null;
  private config: GoogleMapConfig;
  private isDestroyed = false;
  private currentData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  private pendingData: GeoJSON.FeatureCollection | null = null;
  private deckOverlay: GoogleMapsOverlay | null = null;
  private markers: google.maps.marker.AdvancedMarkerElement[] = [];
  private clusterer: MarkerClusterer | null = null;
  private infoWindow: google.maps.InfoWindow | null = null;
  private currentZoom = 10;
  private isSatellite = false;
  private isInitialized = false;
  private hoveredParcelId: string | number | null = null;
  private hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GoogleMapConfig) {
    this.config = config;
    this.initialize();
  }

  private async initialize() {
    if (!googleMapsOptionsSet) {
      setOptions({
        key: this.config.apiKey,
        v: 'weekly',
      });
      googleMapsOptionsSet = true;
    }

    try {
      await importLibrary('maps');
      await importLibrary('marker');
      if (this.isDestroyed) return;

      const initialCenter = this.config.initialCenter || { lat: 32.8639, lon: -96.7784 };
      const initialZoom = this.config.initialZoom || 12;

      this.map = new google.maps.Map(this.config.container, {
        center: { lat: initialCenter.lat, lng: initialCenter.lon },
        zoom: initialZoom,
        mapId: 'greenfinch-map',
        mapTypeId: 'roadmap',
        mapTypeControl: true,
        mapTypeControlOptions: {
          position: google.maps.ControlPosition.TOP_RIGHT,
        },
        fullscreenControl: false,
        streetViewControl: false,
      });

      this.currentZoom = initialZoom;
      this.infoWindow = new google.maps.InfoWindow();

      this.setupDeckOverlay();
      this.setupEventListeners();
      this.emitBounds();
      
      this.isInitialized = true;
      
      if (this.pendingData) {
        this.setData(this.pendingData);
        this.pendingData = null;
      }
    } catch (error) {
      console.error('Failed to load Google Maps:', error);
    }
  }

  private setupDeckOverlay() {
    if (!this.map || (!this.config.regridToken && !this.config.regridTileUrl)) return;

    this.deckOverlay = new GoogleMapsOverlay({
      layers: this.createLayers(),
    });

    this.deckOverlay.setMap(this.map);
  }

  private createLayers() {
    const layers = [];
    const zoom = this.currentZoom;
    const showParcels = zoom >= 15;

    const regridTileUrl = this.config.regridTileUrl || 
      (this.config.regridToken ? `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${this.config.regridToken}` : null);

    if (showParcels && regridTileUrl) {
      layers.push(
        new MVTLayer({
          id: 'regrid-parcels',
          data: regridTileUrl,
          minZoom: 10,
          maxZoom: 21,
          uniqueIdProperty: 'll_uuid',
          getFillColor: [0, 0, 0, 0],
          getLineColor: [34, 197, 94, 200],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          pickable: true,
          autoHighlight: true,
          highlightColor: [34, 197, 94, 80],
          maxRequests: 6,
          loadOptions: {
            fetch: {
              cache: 'force-cache',
            },
          },
          onClick: (info: any) => {
            if (info.object) {
              this.handleParcelClick(info);
            }
          },
          onHover: (info: any) => {
            if (info.object && this.map) {
              this.config.container.style.cursor = 'pointer';
              
              if (this.hoverDebounceTimer) {
                clearTimeout(this.hoverDebounceTimer);
              }
              this.hoverDebounceTimer = setTimeout(() => {
                this.hoveredParcelId = info.object?.properties?.ll_uuid || null;
              }, 16);
            } else {
              this.config.container.style.cursor = '';
              this.hoveredParcelId = null;
            }
          },
        })
      );
    }

    return layers;
  }

  private handleParcelClick(info: any) {
    const coords = info.coordinate;
    if (!coords) return;

    const [lng, lat] = coords;
    const tolerance = 0.0005;

    for (const feature of this.currentData.features) {
      if (feature.geometry.type === 'Point') {
        const [fLng, fLat] = feature.geometry.coordinates as [number, number];
        if (Math.abs(fLng - lng) < tolerance && Math.abs(fLat - lat) < tolerance) {
          const props = feature.properties as any;
          if (props?.propertyKey && this.config.onPropertyClick) {
            this.config.onPropertyClick(props.propertyKey);
          }
          return;
        }
      }
    }
  }

  private setupEventListeners() {
    if (!this.map) return;

    this.map.addListener('idle', () => {
      if (this.isDestroyed) return;
      this.emitBounds();
    });

    this.map.addListener('zoom_changed', () => {
      if (this.isDestroyed || !this.map) return;
      const newZoom = this.map.getZoom() || 10;
      const oldZoom = this.currentZoom;
      this.currentZoom = newZoom;

      const wasAbove15 = oldZoom >= 15;
      const isAbove15 = newZoom >= 15;

      if (wasAbove15 !== isAbove15) {
        this.updateMapType();
        this.updateLayers();
        this.updateMarkerVisibility();
      }
    });
  }

  private updateMapType() {
    if (!this.map) return;
    const shouldBeSatellite = this.currentZoom >= 15;

    if (shouldBeSatellite && !this.isSatellite) {
      this.map.setMapTypeId('hybrid');
      this.isSatellite = true;
    } else if (!shouldBeSatellite && this.isSatellite) {
      this.map.setMapTypeId('roadmap');
      this.isSatellite = false;
    }
  }

  private updateLayers() {
    if (this.deckOverlay) {
      this.deckOverlay.setProps({
        layers: this.createLayers(),
      });
    }
  }

  private updateMarkerVisibility() {
    const showClusters = this.currentZoom < 15;

    this.markers.forEach(marker => {
      marker.map = showClusters ? null : this.map;
    });

    if (this.clusterer) {
      if (showClusters) {
        this.clusterer.addMarkers(this.markers);
      } else {
        this.clusterer.clearMarkers();
      }
    }
  }

  private emitBounds() {
    if (!this.map || !this.config.onBoundsChange) return;

    const bounds = this.map.getBounds();
    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    this.config.onBoundsChange(
      {
        north: ne.lat(),
        south: sw.lat(),
        east: ne.lng(),
        west: sw.lng(),
      },
      this.map.getZoom() || 10
    );
  }

  setData(geojson: GeoJSON.FeatureCollection) {
    if (!this.isInitialized) {
      this.pendingData = geojson;
      return;
    }
    
    this.currentData = geojson;
    this.updateMarkers();
  }

  private async updateMarkers() {
    if (!this.map) return;

    this.markers.forEach(marker => {
      marker.map = null;
    });
    this.markers = [];

    if (this.clusterer) {
      this.clusterer.clearMarkers();
    }

    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker') as google.maps.MarkerLibrary;

    for (const feature of this.currentData.features as PropertyFeature[]) {
      if (feature.geometry.type !== 'Point') continue;

      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties;

      const markerContent = document.createElement('div');
      markerContent.className = 'google-map-marker';
      markerContent.style.cssText = `
        width: 24px;
        height: 24px;
        background-color: ${props.enriched ? '#22c55e' : '#6b7280'};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        cursor: pointer;
      `;

      const normalizedName = props.commonName ? normalizeCommonName(props.commonName) : null;
      const marker = new AdvancedMarkerElement({
        position: { lat, lng },
        content: markerContent,
        title: normalizedName || props.address,
      });

      marker.addListener('click', () => {
        if (this.config.onPropertyClick) {
          this.config.onPropertyClick(props.propertyKey);
        }
      });

      marker.addListener('mouseover', () => {
        if (this.infoWindow && this.map) {
          const content = props.enriched && normalizedName 
            ? `<div style="padding: 4px;"><strong>${normalizedName}</strong><br/>${props.address}</div>`
            : `<div style="padding: 4px;">${props.address}</div>`;
          this.infoWindow.setContent(content);
          this.infoWindow.open(this.map, marker);
        }
      });

      marker.addListener('mouseout', () => {
        if (this.infoWindow) {
          this.infoWindow.close();
        }
      });

      this.markers.push(marker);
    }

    this.clusterer = new MarkerClusterer({
      map: this.map,
      markers: this.currentZoom < 15 ? this.markers : [],
      renderer: {
        render: ({ count, position }) => {
          const content = document.createElement('div');
          content.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            background-color: #22c55e;
            border: 3px solid white;
            border-radius: 50%;
            color: white;
            font-weight: bold;
            font-size: 14px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          `;
          content.textContent = String(count);

          return new google.maps.marker.AdvancedMarkerElement({
            position,
            content,
          });
        },
      },
    });

    if (this.currentZoom >= 15) {
      this.markers.forEach(marker => {
        marker.map = this.map;
      });
    }
  }

  flyTo(lat: number, lon: number, zoom?: number) {
    if (!this.map) return;
    this.map.panTo({ lat, lng: lon });
    if (zoom) {
      this.map.setZoom(zoom);
    }
  }

  destroy() {
    this.isDestroyed = true;

    if (this.hoverDebounceTimer) {
      clearTimeout(this.hoverDebounceTimer);
      this.hoverDebounceTimer = null;
    }

    if (this.deckOverlay) {
      this.deckOverlay.setMap(null);
      this.deckOverlay = null;
    }

    this.markers.forEach(marker => {
      marker.map = null;
    });
    this.markers = [];

    if (this.clusterer) {
      this.clusterer.clearMarkers();
      this.clusterer = null;
    }

    if (this.infoWindow) {
      this.infoWindow.close();
      this.infoWindow = null;
    }

    this.map = null;
  }
}
```

---

## 11. `src/map/GoogleMapCanvas.tsx`

**Reason retired:** React wrapper for GoogleMap controller. Only used by google-map dashboard page (also being removed).

```tsx
'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { GoogleMapController, MapBounds } from './GoogleMap';

interface GoogleMapCanvasProps {
  apiKey: string;
  regridToken?: string;
  regridTileUrl?: string;
  properties: GeoJSON.Feature[];
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
}

export interface GoogleMapCanvasHandle {
  flyTo: (lat: number, lon: number, zoom?: number) => void;
}

const GoogleMapCanvas = forwardRef<GoogleMapCanvasHandle, GoogleMapCanvasProps>(({
  apiKey,
  regridToken,
  regridTileUrl,
  properties,
  initialCenter,
  initialZoom,
  onBoundsChange,
  onPropertyClick,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GoogleMapController | null>(null);
  const callbacksRef = useRef({ onBoundsChange, onPropertyClick });

  callbacksRef.current = { onBoundsChange, onPropertyClick };

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lon: number, zoom?: number) => {
      controllerRef.current?.flyTo(lat, lon, zoom);
    },
  }));

  useEffect(() => {
    if (!containerRef.current || !apiKey) return;

    controllerRef.current = new GoogleMapController({
      container: containerRef.current,
      apiKey,
      regridToken,
      regridTileUrl,
      initialCenter,
      initialZoom,
      onBoundsChange: (bounds, zoom) => {
        callbacksRef.current.onBoundsChange?.(bounds, zoom);
      },
      onPropertyClick: (propertyKey) => {
        callbacksRef.current.onPropertyClick?.(propertyKey);
      },
    });

    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [apiKey, regridToken, regridTileUrl, initialCenter?.lat, initialCenter?.lon, initialZoom]);

  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setData({
        type: 'FeatureCollection',
        features: properties,
      });
    }
  }, [properties]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
});

GoogleMapCanvas.displayName = 'GoogleMapCanvas';

export default GoogleMapCanvas;
```

---

## 12. `src/app/dashboard/google-map/page.tsx`

**Reason retired:** Google Maps POC dashboard page. Experimental alternative to Mapbox dashboard, not linked from production navigation.

```tsx
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { MapBounds } from '@/map/GoogleMap';
import type { GoogleMapCanvasHandle } from '@/map/GoogleMapCanvas';
import PropertyFilters, { FilterState } from '@/components/PropertyFilters';

const GoogleMapCanvas = dynamic(() => import('@/map/GoogleMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
    </div>
  ),
});

interface PropertyFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    propertyKey: string;
    address: string;
    city: string;
    zip: string;
    primaryOwner: string;
    commonName: string | null;
    category: string | null;
    subcategory: string | null;
    propertyClass: string | null;
    operationalStatus: string | null;
    enriched: boolean;
    lotSqft: number;
  };
}

export default function GoogleMapPage() {
  const router = useRouter();
  const mapRef = useRef<GoogleMapCanvasHandle>(null);
  const [config, setConfig] = useState<{ googleMapsApiKey: string; regridToken: string; regridTileUrl: string } | null>(null);
  const [allProperties, setAllProperties] = useState<PropertyFeature[]>([]);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    minLotAcres: null,
    maxLotAcres: null,
    minNetSqft: null,
    maxNetSqft: null,
    categories: [],
    subcategories: [],
    buildingClasses: [],
    acTypes: [],
    heatingTypes: [],
    organizationId: null,
    contactId: null,
    enrichmentStatus: 'all',
    customerStatuses: [],
    zipCodes: [],
    minLotSqft: null,
    maxLotSqft: null,
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/properties/geojson').then(r => r.json()),
    ]).then(([configData, geoData]) => {
      setConfig({ googleMapsApiKey: configData.googleMapsApiKey, regridToken: configData.regridToken, regridTileUrl: configData.regridTileUrl });
      setAllProperties(geoData.features || []);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  const handlePropertyClick = useCallback((propertyKey: string) => {
    router.push(`/property/${propertyKey}`);
  }, [router]);

  const filteredProperties = useMemo(() => {
    return allProperties.filter((f) => {
      if (filters.minLotAcres) {
        const lotAcres = f.properties.lotSqft / 43560;
        if (lotAcres < filters.minLotAcres) return false;
      }
      if (filters.categories.length > 0) {
        if (!f.properties.category || !filters.categories.includes(f.properties.category)) {
          return false;
        }
      }
      return true;
    });
  }, [allProperties, filters]);

  const visibleProperties = useMemo(() => {
    if (!bounds) return filteredProperties;
    return filteredProperties.filter((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return (
        lat >= bounds.south &&
        lat <= bounds.north &&
        lon >= bounds.west &&
        lon <= bounds.east
      );
    });
  }, [filteredProperties, bounds]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!config?.googleMapsApiKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-medium">Google Maps API key not configured</p>
          <p className="text-gray-500 text-sm mt-2">Please add GOOGLE_MAPS_API_KEY to your environment variables</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 relative">
        <GoogleMapCanvas
          ref={mapRef}
          apiKey={config.googleMapsApiKey}
          regridToken={config.regridToken}
          regridTileUrl={config.regridTileUrl}
          properties={filteredProperties}
          onBoundsChange={handleBoundsChange}
          onPropertyClick={handlePropertyClick}
        />
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
          <div className="bg-white px-3 py-2 rounded-lg shadow-md">
            <span className="text-sm font-medium text-green-600">Google Maps POC</span>
          </div>
          <PropertyFilters filters={filters} onFiltersChange={setFilters} />
        </div>
      </div>

      <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Properties ({visibleProperties.length})
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleProperties.slice(0, 50).map((property) => {
            const props = property.properties;
            return (
              <button
                key={props.propertyKey}
                onClick={() => handlePropertyClick(props.propertyKey)}
                className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                {props.enriched && props.commonName && (
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {props.commonName}
                  </p>
                )}
                <p className={`text-sm ${props.enriched && props.commonName ? 'text-gray-500' : 'text-gray-900 font-medium'} truncate`}>
                  {props.address}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {props.city}, TX {props.zip}
                </p>
              </button>
            );
          })}
          {visibleProperties.length > 50 && (
            <div className="px-4 py-3 text-center text-sm text-gray-500">
              Showing 50 of {visibleProperties.length} properties
            </div>
          )}
          {visibleProperties.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              No properties in view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```
