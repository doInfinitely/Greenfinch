// ============================================================================
// AI Enrichment — Stage 2: Ownership & Management Identification
// Discovers beneficial owners, management companies, property websites,
// and validates/resolves domains via PDL and DNS checks.
// ============================================================================

import type { CommercialProperty } from "../../snowflake";
import type { StageResult, OwnershipInfo, PropertyClassification } from '../types';
import { getGeminiClient, streamGeminiResponse, callGeminiWithTimeout } from '../client';
import { extractGroundedSources, parseJsonResponse, validateStage2Schema } from '../parsers';
import { propertyLatLng, extractUsefulLegalInfo, crossValidateOwnership, OWNER_TYPE_MAP } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { validatePropertyWebsite, validateAndCleanDomain } from '../../domain-validator';

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

  const prompt = `Find the ownership and management of this commercial property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName} at ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}, ${sqft} sqft
DCAD DEED OWNER: ${deedOwner} (transferred ${deedDate})
${secondaryOwner ? `DCAD SECONDARY: ${secondaryOwner}` : ''}
${legalInfo ? `LEGAL: ${legalInfo}` : ''}

SEARCH SEQUENCE:
1. Search "${classification.propertyName} ${property.city || 'Dallas'}" to find the property website and management company
2. Search the management company website for this property listing to confirm management and find a direct property management phone number
3. Search "${deedOwner} Texas" on OpenCorporates or TX Secretary of State to find the entity behind the LLC/trust
4. Search for news about acquisitions or sales of ${classification.propertyName} around ${deedDate} to identify the beneficial owner

DOMAIN ACCURACY: For "domain" and "site" fields, copy the exact domain from a URL you found in search results. If no search result contained the company's website, return null. Return the "domainSource" field with the full URL where you found it.

Return JSON:
{"mgmt":{"name":"Co|null","domain":"co.com|null","domainSource":"full URL where domain was found|null","c":0.0-1.0},"owner":{"name":"Entity|null","type":"REIT|PE|Family Office|Individual|Corporation|Institutional|Syndicator|null","domain":"owner-co.com|null","domainSource":"full URL where domain was found|null","c":0.0-1.0},"site":"https://property-site.com|null","siteSource":"full URL where property site was found|null","phone":"+1XXXXXXXXXX|null","summary":"2 sentences max: who owns it, who manages it."}`;

  console.log('[FocusedEnrichment] Stage 2: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 2 input - Property: ${classification.propertyName}, Deed Owner: ${deedOwner}`);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 2 attempt ${attempt}/${maxAttempts}...`);
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], thinkingLevel: 'LOW', latLng: propertyLatLng(property) }),
        2
      );

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 2 attempt ${attempt} response length: ${text.length} chars`);

      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 2 (attempt ${attempt}/${maxAttempts})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'identify-ownership',
          entityType: 'property',
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 2 retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 2: all attempts returned empty, returning defaults');
        return {
          data: {
            beneficialOwner: { name: null, type: null, domain: null, confidence: 0 },
            managementCompany: { name: null, domain: null, confidence: 0 },
            propertyWebsite: null,
            propertyPhone: null,
          },
          summary: '',
          sources: [],
        };
      }

      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      try {
        validateStage2Schema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 2 schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 2 retrying after schema error in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-ownership',
        entityType: 'property',
        success: true,
        metadata: { sourcesCount: sources.length, attempt },
      });

      const ownerType = parsed.owner?.type ? (OWNER_TYPE_MAP[parsed.owner.type] || null) : null;

      let mgmtDomain = parsed.mgmt?.domain ?? null;
      const mgmtDomainSource = parsed.mgmt?.domainSource ?? null;
      if (mgmtDomain && !mgmtDomainSource) {
        console.warn(`[FocusedEnrichment] Stage 2: Mgmt domain "${mgmtDomain}" has no source citation — likely hallucinated, clearing`);
        mgmtDomain = null;
      }

      let propertySite = parsed.site ?? null;
      const siteSource = parsed.siteSource ?? null;
      if (propertySite && !siteSource) {
        console.warn(`[FocusedEnrichment] Stage 2: Property site "${propertySite}" has no source citation — likely hallucinated, clearing`);
        propertySite = null;
      }

      const ownerDomain = parsed.owner?.domain && parsed.owner.domain !== 'null'
        ? parsed.owner.domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase()
        : null;

      const ownershipData: OwnershipInfo = {
        beneficialOwner: {
          name: parsed.owner?.name ?? null,
          type: ownerType,
          domain: ownerDomain,
          confidence: parsed.owner?.c ?? 0,
        },
        managementCompany: {
          name: parsed.mgmt?.name ?? null,
          domain: mgmtDomain,
          confidence: parsed.mgmt?.c ?? 0,
        },
        propertyWebsite: propertySite,
        propertyPhone: parsed.phone ?? null,
      };

      const validated = crossValidateOwnership(ownershipData);

      const mgmtName = validated.managementCompany.name || undefined;
      const ownerName = validated.beneficialOwner.name || property.bizName || property.ownerName1 || null;
      const propCity = property.city || 'Dallas';

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
              console.log(`[FocusedEnrichment] Stage 2: Mgmt domain "${aiDomain}" differs from validated website domain "${siteDomain}" — using website domain`);
              validated.managementCompany.domain = websiteResult.extractedDomain;
            }
          }
        }
      }

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
          if (retryResult.domain && !validated.managementCompany.domain) {
            validated.managementCompany.domain = retryResult.domain;
            console.log(`[FocusedEnrichment] Stage 2: Domain retry also provided mgmt domain: ${retryResult.domain}`);
          }
        }
      }

      if (validated.managementCompany.name) {
        const aiDomain = validated.managementCompany.domain;
        let pdlResolvedDomain: string | null = null;

        try {
          const { enrichCompanyPDL } = await import('../../pdl');
          console.log(`[FocusedEnrichment] Stage 2: PDL lookup for "${validated.managementCompany.name}" (AI domain: ${aiDomain || 'none'})`);
          const pdlResult = await enrichCompanyPDL(aiDomain || '', {
            name: validated.managementCompany.name,
            locality: propCity || undefined,
            region: 'TX',
          });

          if (pdlResult.found && pdlResult.website) {
            const pdlDomain = pdlResult.website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
            console.log(`[FocusedEnrichment] Stage 2: PDL confirmed "${validated.managementCompany.name}" → ${pdlDomain}`);
            pdlResolvedDomain = pdlDomain;
          } else {
            console.log(`[FocusedEnrichment] Stage 2: PDL did not find "${validated.managementCompany.name}"`);
          }
        } catch (pdlErr) {
          console.warn(`[FocusedEnrichment] Stage 2: PDL lookup failed for "${validated.managementCompany.name}":`, pdlErr instanceof Error ? pdlErr.message : pdlErr);
        }

        if (pdlResolvedDomain) {
          validated.managementCompany.domain = pdlResolvedDomain;
        } else if (aiDomain) {
          const validatedMgmtDomain = await validateAndCleanDomain(
            aiDomain,
            mgmtName,
            'mgmt company domain'
          );
          if (validatedMgmtDomain) {
            validated.managementCompany.domain = validatedMgmtDomain;
          } else {
            console.warn(`[FocusedEnrichment] Stage 2: Mgmt domain "${aiDomain}" failed validation and no PDL match — will try email domain fallback after Stage 3b`);
            validated.managementCompany.domain = null;
          }
        }

        if (!validated.managementCompany.domain) {
          console.log(`[FocusedEnrichment] Stage 2: No mgmt domain — running company domain retry...`);
          const retryDomain = await retryFindCompanyDomain(
            validated.managementCompany.name,
            propCity,
            propertyLatLng(property)
          );
          if (retryDomain) {
            validated.managementCompany.domain = retryDomain;
          }
        }
      }

      if (validated.beneficialOwner.name) {
        const aiOwnerDomain = validated.beneficialOwner.domain;
        let pdlOwnerDomain: string | null = null;

        try {
          const { enrichCompanyPDL } = await import('../../pdl');
          console.log(`[FocusedEnrichment] Stage 2: PDL lookup for owner "${validated.beneficialOwner.name}" (AI domain: ${aiOwnerDomain || 'none'})`);
          const pdlResult = await enrichCompanyPDL(aiOwnerDomain || '', {
            name: validated.beneficialOwner.name,
            locality: propCity || undefined,
            region: 'TX',
          });

          if (pdlResult.found && pdlResult.website) {
            pdlOwnerDomain = pdlResult.website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
            console.log(`[FocusedEnrichment] Stage 2: PDL confirmed owner "${validated.beneficialOwner.name}" → ${pdlOwnerDomain}`);
          } else {
            console.log(`[FocusedEnrichment] Stage 2: PDL did not find owner "${validated.beneficialOwner.name}"`);
          }
        } catch (pdlErr) {
          console.warn(`[FocusedEnrichment] Stage 2: PDL lookup failed for owner "${validated.beneficialOwner.name}":`, pdlErr instanceof Error ? pdlErr.message : pdlErr);
        }

        if (pdlOwnerDomain) {
          validated.beneficialOwner.domain = pdlOwnerDomain;
        } else if (aiOwnerDomain) {
          const validatedOwnerDomain = await validateAndCleanDomain(
            aiOwnerDomain,
            validated.beneficialOwner.name || undefined,
            'owner company domain'
          );
          if (validatedOwnerDomain) {
            validated.beneficialOwner.domain = validatedOwnerDomain;
          } else {
            console.warn(`[FocusedEnrichment] Stage 2: Owner domain "${aiOwnerDomain}" failed validation and no PDL match — will try email domain fallback after Stage 3b`);
            validated.beneficialOwner.domain = null;
          }
        }
      }

      console.log(`[FocusedEnrichment] Stage 2 complete with ${sources.length} grounded sources`);
      console.log(`[FocusedEnrichment] Stage 2 extracted - website: ${validated.propertyWebsite || 'none'}, phone: ${validated.propertyPhone || 'none'}, mgmt: ${validated.managementCompany.name || 'none'} (${validated.managementCompany.domain || 'no domain'}), owner: ${validated.beneficialOwner.name || 'none'} (${validated.beneficialOwner.domain || 'no domain'})`);

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
      if (attempt < maxAttempts) {
        const delayMs = attempt * 3000;
        console.log(`[FocusedEnrichment] Stage 2 retrying after error in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return {
        data: {
          beneficialOwner: { name: null, type: null, domain: null, confidence: 0 },
          managementCompany: { name: null, domain: null, confidence: 0 },
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
      propertyWebsite: null,
      propertyPhone: null,
    },
    summary: '',
    sources: [],
  };
}

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

Return JSON: {"url":"https://full-url-to-property-page|null","domain":"domain-of-the-site|null"}`;

  try {
    console.log(`[FocusedEnrichment] Domain retry: searching for property website for "${propertyName}"...`);
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], thinkingLevel: 'MINIMAL', latLng }),
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

Return JSON: {"domain":"company-domain.com|null","source":"full URL where you found it|null"}`;

  try {
    console.log(`[FocusedEnrichment] Domain retry: searching for company domain for "${companyName}"...`);
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], thinkingLevel: 'MINIMAL', latLng }),
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
