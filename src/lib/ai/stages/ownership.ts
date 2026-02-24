// ============================================================================
// AI Enrichment — Stage 2: Ownership & Management Identification
//
// Uses Gemini search grounding to discover:
//   - The beneficial owner behind the DCAD deed entity (LLC → parent company)
//   - The property management company and its domain
//   - The property's marketing website and main phone number
//
// After the initial Gemini call, domains go through a validation cascade:
//   1. PDL Company Enrich (authoritative domain lookup)
//   2. DNS validation (if PDL has no match)
//   3. Gemini retry search (if still no domain)
//
// Retry policy: up to RETRIES.STAGE_2 attempts with linear back-off.
// ============================================================================

import type { CommercialProperty } from "../../snowflake";
import type { StageResult, OwnershipInfo, PropertyClassification, BeneficialOwnerEntry, ManagementCompanyEntry } from '../types';
import { getGeminiClient, streamGeminiResponse, callGeminiWithTimeout } from '../client';
import { extractGroundedSources, parseJsonResponse, validateStage2Schema } from '../parsers';
import { propertyLatLng, extractUsefulLegalInfo, crossValidateOwnership, OWNER_TYPE_MAP } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { validatePropertyWebsite, validateAndCleanDomain } from '../../domain-validator';
import {
  THINKING_LEVELS, RETRIES, BACKOFF, GOOGLE_SEARCH_TOOL,
} from '../config';

/**
 * Run Stage 2 of the AI enrichment pipeline.
 *
 * Takes the classification from Stage 1 and the raw property record, then
 * searches the web to identify who owns and manages the property.  Returns
 * validated ownership data with confirmed domains.
 */
export async function identifyOwnership(
  property: CommercialProperty,
  classification: PropertyClassification
): Promise<StageResult<OwnershipInfo>> {
  const client = getGeminiClient();
  const deedOwner = property.bizName || property.ownerName1 || 'Unknown';
  const secondaryOwner = property.ownerName2 || null;
  const deedDate = property.deedTxfrDate || 'date unknown';
  const legalInfo = extractUsefulLegalInfo(property);
  const sqft = property.totalGrossBldgArea?.toLocaleString() || 'unknown';

  // -- Build the prompt -------------------------------------------------------
  const prompt = `Find benficial owners, all associated property management companies, and the direct website for this commercial property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName} at ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}, ${sqft} sqft
DCAD DEED OWNER: ${deedOwner} (transferred ${deedDate})
${secondaryOwner ? `DCAD SECONDARY: ${secondaryOwner}` : ''}
${legalInfo ? `LEGAL: ${legalInfo}` : ''}

SEARCH SEQUENCE:
1. Search "${classification.propertyName} ${property.city || 'Dallas'}" to find the property website and management company
2. On the property website, look for "managed by", "a ___ community", or PM company branding in the footer — this identifies the PM. If the property site is hosted on a PM's domain (e.g. propertyname.pmcompany.com or pmcompany.com/propertyname), that is likely the PM.
3. Search "${classification.propertyName} ${property.city || 'Dallas'} property management" to cross-check or discover the PM if step 2 didn't find one
4. Search the management company's portfolio or property listings to CONFIRM this property appears
5. Search the management company website for this property listing to find a direct property management phone number
6. Search "${deedOwner} Texas" on OpenCorporates or TX Secretary of State to find the entity behind the LLC/trust
7. Search for news about acquisitions or sales of ${classification.propertyName} around ${deedDate} to identify the beneficial owner


PROPERTY WEBSITE PRIORITY: First look for the property's own external marketing website or its listing on its PM's site. If none exists, fall back to a CRE listing page (apartments.com, loopnet.com, costar.com, crexi.com) that has a dedicated page for this property.

DOMAIN ACCURACY: For "domain" and "site" fields, copy the exact domain from a URL you found in search results. If no search result contained the company's website, return null.

**IMPORTANT NOTES**

*KEY DISTINCTION*: The deed owner and the property manager (PM) are often DIFFERENT companies. The PM is the company hired to handle day-to-day operations, leasing, maintenance, and tenant relations. If the owner self-manages (no third-party PM), return the owner as both "mgmt" and "owner".

*MULTIPLE COMPANIES*: Properties may involve multiple companies. For example, an apartment complex might have a PM company AND a general community site. Return ALL companies you identify.


*SEARCH SOURCES*: Using current, accurate information is critcial as contact and property data changes frequently. Use recent sources and confirm company information, websites, and property information are current. Visit website domains you return and validate they are active and up to date.


Return JSON (mgmt and owners are ARRAYS — include every company you identify):
{
  "mgmt": [
    {
      "name": "Property management company name | null",
      "domain": "pm-company.com | null",
      "c": 0.0
    }
  ],
  "owners": [
    {
      "name": "Beneficial owner entity | null",
      "type": "REIT | PE | Family Office | Individual | Corporation | Institutional | Syndicator | null",
      "domain": "owner-co.com | null",
      "c": 0.0
    }
  ],
  "site": "https://property-website-or-listing.com | null",
  "siteSource": "full URL where property site was found | null",
  "phone": "+1XXXXXXXXXX | null",
  "summary": "2 sentences max: who owns it, who manages it."
}`;

  console.log('[FocusedEnrichment] Stage 2: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 2 input - Property: ${classification.propertyName}, Deed Owner: ${deedOwner}`);

  // -- Retry loop -------------------------------------------------------------
  for (let attempt = 1; attempt <= RETRIES.STAGE_2; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 2 attempt ${attempt}/${RETRIES.STAGE_2}...`);

      // Call Gemini with search grounding and LOW thinking for multi-step reasoning
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, {
          tools: GOOGLE_SEARCH_TOOL,
          thinkingLevel: THINKING_LEVELS.STAGE_2_OWNERSHIP,
          latLng: propertyLatLng(property),
        }),
        2
      );

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 2 attempt ${attempt} response length: ${text.length} chars`);

      // Handle empty response — retry if attempts remain
      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 2 (attempt ${attempt}/${RETRIES.STAGE_2})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'identify-ownership',
          entityType: 'property',
          tokenUsage: response.tokenUsage,
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < RETRIES.STAGE_2) {
          const delayMs = attempt * BACKOFF.STAGE_2_PER_ATTEMPT_MS;
          console.log(`[FocusedEnrichment] Stage 2 retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 2: all attempts returned empty, returning defaults');
        return {
          data: {
            beneficialOwner: { name: null, type: null, domain: null, confidence: 0 },
            managementCompany: { name: null, domain: null, confidence: 0 },
            additionalOwners: [],
            additionalManagementCompanies: [],
            propertyWebsite: null,
            propertyPhone: null,
          },
          summary: '',
          sources: [],
        };
      }

      // -- Parse and validate JSON --------------------------------------------
      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      try {
        validateStage2Schema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 2 schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < RETRIES.STAGE_2) {
          const delayMs = attempt * BACKOFF.STAGE_2_PER_ATTEMPT_MS;
          console.log(`[FocusedEnrichment] Stage 2 retrying after schema error in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-ownership',
        entityType: 'property',
        tokenUsage: response.tokenUsage,
        success: true,
        metadata: { sourcesCount: sources.length, attempt },
      });

      // -- Normalize arrays: support both old single-object and new array format
      const rawMgmtArr: any[] = Array.isArray(parsed.mgmt)
        ? parsed.mgmt
        : (parsed.mgmt && typeof parsed.mgmt === 'object' ? [parsed.mgmt] : []);
      const rawOwnerArr: any[] = Array.isArray(parsed.owners)
        ? parsed.owners
        : Array.isArray(parsed.owner)
          ? parsed.owner
          : (parsed.owner && typeof parsed.owner === 'object' ? [parsed.owner] : []);

      // -- Clean domain helper ------------------------------------------------
      const cleanDomain = (d: any): string | null => {
        if (!d || d === 'null' || typeof d !== 'string') return null;
        return d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
      };

      // -- Parse management company entries -----------------------------------
      const allMgmt: ManagementCompanyEntry[] = rawMgmtArr
        .filter((m: any) => m && typeof m === 'object' && m.name && m.name !== 'null')
        .map((m: any) => ({
          name: m.name ?? null,
          domain: cleanDomain(m.domain),
          confidence: m.c ?? 0,
        }));

      // -- Parse owner entries ------------------------------------------------
      const allOwners: BeneficialOwnerEntry[] = rawOwnerArr
        .filter((o: any) => o && typeof o === 'object' && o.name && o.name !== 'null')
        .map((o: any) => ({
          name: o.name ?? null,
          type: o.type ? (OWNER_TYPE_MAP[o.type] ?? null) : null,
          domain: cleanDomain(o.domain),
          confidence: o.c ?? 0,
        }));

      // Sort by confidence descending so index 0 is the primary
      allMgmt.sort((a, b) => b.confidence - a.confidence);
      allOwners.sort((a, b) => b.confidence - a.confidence);

      const primaryMgmt: ManagementCompanyEntry = allMgmt[0] || { name: null, domain: null, confidence: 0 };
      const additionalMgmt = allMgmt.slice(1);
      const primaryOwner: BeneficialOwnerEntry = allOwners[0] || { name: null, type: null, domain: null, confidence: 0 };
      const additionalOwners = allOwners.slice(1);

      console.log(`[FocusedEnrichment] Stage 2: parsed ${allMgmt.length} mgmt companies, ${allOwners.length} owners`);

      // -- Extract property site -----------------------------------------------
      let propertySite = parsed.site ?? null;
      const siteSource = parsed.siteSource ?? null;
      if (propertySite && !siteSource) {
        console.warn(`[FocusedEnrichment] Stage 2: Property site "${propertySite}" has no source citation — likely hallucinated, clearing`);
        propertySite = null;
      }

      // -- Assemble initial ownership data ------------------------------------
      const ownershipData: OwnershipInfo = {
        beneficialOwner: primaryOwner,
        managementCompany: primaryMgmt,
        additionalOwners,
        additionalManagementCompanies: additionalMgmt,
        propertyWebsite: propertySite,
        propertyPhone: parsed.phone ?? null,
      };

      // Cross-check management domain vs property website domain
      const validated = crossValidateOwnership(ownershipData);

      const mgmtName = validated.managementCompany.name || undefined;
      const ownerName = validated.beneficialOwner.name || property.bizName || property.ownerName1 || null;
      const propCity = property.city || 'Dallas';

      // -- Property website validation ----------------------------------------
      // Verify the URL resolves, isn't a parking page, and matches the property
      if (validated.propertyWebsite) {
        const websiteResult = await validatePropertyWebsite(
          validated.propertyWebsite,
          classification.propertyName,
          mgmtName
        );
        if (!websiteResult.validatedUrl) {
          console.warn(`[FocusedEnrichment] Stage 2: Property website "${validated.propertyWebsite}" failed validation, clearing`);
          validated.propertyWebsite = null;
        } else {
          validated.propertyWebsite = websiteResult.validatedUrl;
          if (websiteResult.extractedDomain && validated.managementCompany.domain) {
            const aiDomain = validated.managementCompany.domain.toLowerCase();
            const siteDomain = websiteResult.extractedDomain.toLowerCase();
            if (aiDomain !== siteDomain && !aiDomain.includes(siteDomain) && !siteDomain.includes(aiDomain)) {
              console.log(`[FocusedEnrichment] Stage 2: Mgmt domain "${aiDomain}" differs from property website domain "${siteDomain}" — keeping separate (PM domain ≠ property site)`);
            }
          }
        }
      }

      // If no valid property website, run a focused retry search
      if (!validated.propertyWebsite) {
        console.log(`[FocusedEnrichment] Stage 2: No valid property website — running domain retry...`);
        const retryResult = await retryFindPropertyWebsite(
          classification.propertyName,
          classification.canonicalAddress,
          mgmtName || null,
          ownerName,
          propCity,
          propertyLatLng(property)
        );
        if (retryResult.url) {
          validated.propertyWebsite = retryResult.url;
          if (retryResult.domain) {
            console.log(`[FocusedEnrichment] Stage 2: Property website retry found domain "${retryResult.domain}" — keeping separate from mgmt company domains (each validated via PDL independently)`);
          }
        }
      }

      // -- Company domain validation cascade (shared for all companies) --------
      // Priority: PDL → DNS validation → Gemini retry search
      // Applied to primary + additional companies identically
      const validateCompanyDomain = async (
        entry: { name: string | null; domain: string | null },
        label: string,
        skipRetrySearch = false
      ): Promise<void> => {
        if (!entry.name) return;
        const aiDomain = entry.domain;
        let pdlResolvedDomain: string | null = null;

        try {
          const { enrichCompanyPDL } = await import('../../pdl');
          console.log(`[FocusedEnrichment] Stage 2: PDL lookup for ${label} "${entry.name}" (AI domain: ${aiDomain || 'none'})`);
          const pdlResult = await enrichCompanyPDL(aiDomain || '', {
            name: entry.name,
            locality: propCity || undefined,
            region: 'TX',
          });

          if (pdlResult.found && pdlResult.website) {
            pdlResolvedDomain = pdlResult.website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
            console.log(`[FocusedEnrichment] Stage 2: PDL confirmed ${label} "${entry.name}" → ${pdlResolvedDomain}`);
          } else {
            console.log(`[FocusedEnrichment] Stage 2: PDL did not find ${label} "${entry.name}"`);
          }
        } catch (pdlErr) {
          console.warn(`[FocusedEnrichment] Stage 2: PDL lookup failed for ${label} "${entry.name}":`, pdlErr instanceof Error ? pdlErr.message : pdlErr);
        }

        if (pdlResolvedDomain) {
          entry.domain = pdlResolvedDomain;
        } else if (aiDomain) {
          const validatedDomain = await validateAndCleanDomain(
            aiDomain,
            entry.name || undefined,
            `${label} company domain`
          );
          if (validatedDomain) {
            entry.domain = validatedDomain;
          } else {
            console.warn(`[FocusedEnrichment] Stage 2: ${label} domain "${aiDomain}" failed validation and no PDL match — will try email domain fallback after Stage 3b`);
            entry.domain = null;
          }
        }

        if (!entry.domain && !skipRetrySearch) {
          console.log(`[FocusedEnrichment] Stage 2: No ${label} domain — running company domain retry...`);
          const retryDomain = await retryFindCompanyDomain(
            entry.name!,
            propCity,
            propertyLatLng(property)
          );
          if (retryDomain) {
            entry.domain = retryDomain;
          }
        }
      };

      // Validate primary management company
      await validateCompanyDomain(validated.managementCompany, 'mgmt');

      // Validate primary beneficial owner
      await validateCompanyDomain(validated.beneficialOwner, 'owner');

      // Validate additional management companies (skip Gemini retry to limit API calls)
      for (const addlMgmt of validated.additionalManagementCompanies) {
        await validateCompanyDomain(addlMgmt, 'additional mgmt', true);
      }

      // Validate additional owners (skip Gemini retry to limit API calls)
      for (const addlOwner of validated.additionalOwners) {
        await validateCompanyDomain(addlOwner, 'additional owner', true);
      }

      const allMgmtNames = [validated.managementCompany, ...validated.additionalManagementCompanies]
        .filter(m => m.name).map(m => `${m.name} (${m.domain || 'no domain'})`).join(', ');
      const allOwnerNames = [validated.beneficialOwner, ...validated.additionalOwners]
        .filter(o => o.name).map(o => `${o.name} (${o.domain || 'no domain'})`).join(', ');

      console.log(`[FocusedEnrichment] Stage 2 complete with ${sources.length} grounded sources`);
      console.log(`[FocusedEnrichment] Stage 2 extracted - website: ${validated.propertyWebsite || 'none'}, phone: ${validated.propertyPhone || 'none'}, mgmt: [${allMgmtNames || 'none'}], owners: [${allOwnerNames || 'none'}]`);

      return {
        data: validated,
        summary: parsed.summary || '',
        sources,
      };
    } catch (error) {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-ownership',
        entityType: 'property',
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error(`[FocusedEnrichment] Stage 2 attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt < RETRIES.STAGE_2) {
        const delayMs = attempt * BACKOFF.STAGE_2_PER_ATTEMPT_MS;
        console.log(`[FocusedEnrichment] Stage 2 retrying after error in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return {
        data: {
          beneficialOwner: { name: null, type: null, domain: null, confidence: 0 },
          managementCompany: { name: null, domain: null, confidence: 0 },
          additionalOwners: [],
          additionalManagementCompanies: [],
          propertyWebsite: null,
          propertyPhone: null,
        },
        summary: '',
        sources: [],
      };
    }
  }

  return {
    data: {
      beneficialOwner: { name: null, type: null, domain: null, confidence: 0 },
      managementCompany: { name: null, domain: null, confidence: 0 },
      additionalOwners: [],
      additionalManagementCompanies: [],
      propertyWebsite: null,
      propertyPhone: null,
    },
    summary: '',
    sources: [],
  };
}

// =============================================================================
// Domain Retry Helpers
//
// When the initial Stage 2 response doesn't produce a valid property website
// or company domain, these functions run a focused follow-up Gemini search.
// =============================================================================

/**
 * Retry search specifically for a property's marketing website.
 *
 * Tries consumer-style search queries (e.g. "The Crescent Dallas apartments")
 * and validates the result against DNS + content checks.
 */
async function retryFindPropertyWebsite(
  propertyName: string,
  address: string,
  mgmtCompany: string | null,
  ownerName: string | null,
  city: string,
  latLng?: { latitude: number; longitude: number }
): Promise<{ url: string | null; domain: string | null }> {
  const client = getGeminiClient();
  const context = [
    mgmtCompany ? `Management company: ${mgmtCompany}` : '',
    ownerName ? `Owner: ${ownerName}` : '',
  ].filter(Boolean).join('. ');

  const prompt = `Find the official website for this property. Return ONLY valid JSON.

PROPERTY: ${propertyName} at ${address}, ${city}, TX
${context}

Search for "${propertyName} ${city}" and "${propertyName} apartments" or "${propertyName} office" as a consumer would. Look for the property's own marketing website (e.g. "live${propertyName.toLowerCase().replace(/\s+/g, '')}.com" or similar), a listing on the management company's site, or a dedicated property page. Copy the exact URL from search results.

Return JSON:
{
  "url": "https://full-url-to-property-page | null",
  "domain": "domain-of-the-site | null"
}`;

  try {
    console.log(`[FocusedEnrichment] Domain retry: searching for property website for "${propertyName}"...`);
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, {
        tools: GOOGLE_SEARCH_TOOL,
        thinkingLevel: THINKING_LEVELS.DOMAIN_RETRY,
        latLng,
      }),
      1
    );
    const text = response.text?.trim() || '';
    if (!text) return { url: null, domain: null };

    const parsed = parseJsonResponse(text);
    const url = parsed.url && parsed.url !== 'null' ? parsed.url : null;
    const domain = parsed.domain && parsed.domain !== 'null' ? parsed.domain : null;

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-property-website',
      entityType: 'property',
      tokenUsage: response.tokenUsage,
      success: true,
    });

    if (url) {
      const websiteResult = await validatePropertyWebsite(url, propertyName, mgmtCompany || undefined);
      if (websiteResult.validatedUrl) {
        console.log(`[FocusedEnrichment] Domain retry: found valid property website: ${websiteResult.validatedUrl}`);
        return { url: websiteResult.validatedUrl, domain: websiteResult.extractedDomain };
      }
      console.warn(`[FocusedEnrichment] Domain retry: property website "${url}" failed validation`);
    }
    return { url: null, domain: null };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-property-website',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn(`[FocusedEnrichment] Domain retry for property website failed: ${error instanceof Error ? error.message : error}`);
    return { url: null, domain: null };
  }
}

/**
 * Retry search specifically for a company's official domain.
 *
 * Used when neither PDL nor the initial Gemini response produced a valid
 * domain for the management company.
 */
export async function retryFindCompanyDomain(
  companyName: string,
  city: string,
  latLng?: { latitude: number; longitude: number }
): Promise<string | null> {
  const client = getGeminiClient();

  const prompt = `Find the official website for this company. Return ONLY valid JSON.

COMPANY: ${companyName}
LOCATION: ${city}, TX

Search for the company's official website. Copy the exact domain from the URL you find in search results.

Return JSON:
{
  "domain": "company-domain.com | null",
  "source": "full URL where you found it | null"
}`;

  try {
    console.log(`[FocusedEnrichment] Domain retry: searching for company domain for "${companyName}"...`);
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, {
        tools: GOOGLE_SEARCH_TOOL,
        thinkingLevel: THINKING_LEVELS.DOMAIN_RETRY,
        latLng,
      }),
      1
    );
    const text = response.text?.trim() || '';
    if (!text) return null;

    const parsed = parseJsonResponse(text);
    const domain = parsed.domain && parsed.domain !== 'null' ? parsed.domain : null;

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-company-domain',
      entityType: 'organization',
      tokenUsage: response.tokenUsage,
      success: true,
    });

    if (domain) {
      const validated = await validateAndCleanDomain(domain, companyName, 'retry company domain');
      if (validated) {
        console.log(`[FocusedEnrichment] Domain retry: found valid company domain: ${validated}`);
        return validated;
      }
      console.warn(`[FocusedEnrichment] Domain retry: company domain "${domain}" failed validation`);
    }
    return null;
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-company-domain',
      entityType: 'organization',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn(`[FocusedEnrichment] Domain retry for company domain failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
