// ============================================================================
// AI Enrichment — Stage 3: Contact Discovery
//
// Uses Gemini search grounding to find people directly involved in
// managing the property.  Returns up to ~3 contacts with names, titles,
// companies, roles, and any email addresses discovered during the search.
//
// Email/phone enrichment and validation is handled downstream by the
// 5-stage cascade enrichment pipeline (Findymail, PDL, Hunter, etc.),
// not by a separate Gemini call.
//
// Post-processing in discoverContacts:
//   - Validates each contact's source URL and company domain
//   - Falls back to email domains for missing company domains
//   - Deduplicates contacts by name
//   - Cross-validates companies against Stage 2 ownership data
// ============================================================================

import type { CommercialProperty } from "../../property-types";
import type { MarketConfig } from "../../markets/types";
import type {
  StageResult, OwnershipInfo, PropertyClassification,
  IdentifiedDecisionMaker, DiscoveredContact, RelationshipGrounding, StageMetadata
} from '../types';
import { extractGroundingQuality, extractCitationMetadata, parseJsonResponse, validateStage3aSchema } from '../parsers';
import { propertyLatLng, isLikelyConstructedEmail, deduplicateContacts } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { validateAndCleanDomain } from '../../domain-validator';
import {
  THINKING_LEVELS, RETRIES, BACKOFF, CONFIDENCE,
  FREE_EMAIL_DOMAINS, STAGE_MODELS, STAGE_TEMPERATURES, STAGE_TIMEOUTS,
} from '../config';
import { getStageConfig } from '../runtime-config';
import { getLLMAdapter } from '../llm';
import type { LLMResponse } from '../llm';

// =============================================================================
// Stage 3 — Decision-Maker Identification (with email discovery)
// =============================================================================

async function identifyDecisionMakers(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo,
  options: { clerkOrgId?: string; market?: MarketConfig } = {}
): Promise<StageResult<{ contacts: IdentifiedDecisionMaker[] }>> {
  const stageConfig = getStageConfig('stage3_contacts');
  const adapter = getLLMAdapter(stageConfig.provider);

  const propertySite = ownership.propertyWebsite || 'none';
  const city = property.city || options.market?.defaultCity || 'Dallas';
  const state = property.state || options.market?.state || 'TX';

  const companyLines: string[] = [];
  if (ownership.managementCompany?.name && ownership.managementCompany.confidence > 0) {
    const m = ownership.managementCompany;
    companyLines.push(`- MANAGEMENT (primary): ${m.name} | domain: ${m.domain || 'unknown'}`);
  }
  for (const addlMgmt of ownership.additionalManagementCompanies || []) {
    if (addlMgmt.name && addlMgmt.confidence > 0) {
      companyLines.push(`- MANAGEMENT: ${addlMgmt.name} | domain: ${addlMgmt.domain || 'unknown'}`);
    }
  }
  if (ownership.beneficialOwner?.name && ownership.beneficialOwner.confidence > 0) {
    const o = ownership.beneficialOwner;
    companyLines.push(`- OWNER${o.type ? ` (${o.type})` : ''}: ${o.name} | domain: ${o.domain || 'unknown'}`);
  }
  for (const addlOwner of ownership.additionalOwners || []) {
    if (addlOwner.name && addlOwner.confidence > 0) {
      companyLines.push(`- OWNER${addlOwner.type ? ` (${addlOwner.type})` : ''}: ${addlOwner.name} | domain: ${addlOwner.domain || 'unknown'}`);
    }
  }
  if (companyLines.length === 0) {
    const fallbackOwner = property.ownerName1 || property.bizName || 'Unknown';
    companyLines.push(`- OWNER: ${fallbackOwner} | domain: unknown`);
  }
  const companiesBlock = companyLines.join('\n');

  const prompt = `Find 3 people directly involved in managing THIS specific property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName} at ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}
LOCATION: ${city}, ${state}
PROPERTY SITE: ${propertySite}

ASSOCIATED COMPANIES (search for contacts at ALL of these):
${companiesBlock}

TASK: Search the web to find people who directly manage, operate, or maintain this specific property on a day-to-day basis. Focus on the property management company staff in the ${city}, ${state} area, not corporate headquarters executives. Search each associated company's website/domain and LinkedIn for relevant staff.

PRIORITY ROLES (return these first; listed in priority order):
- Property manager for this specific property (strongly preferred — this is the most valuable contact)
- Facilities/maintenance director or chief engineer for this specific property
- Regional/district property manager overseeing this property's area in ${state}
- Asset manager or owner with direct responsibility for this property

ONLY return people CURRENTLY verifiably connected to THIS property at THIS address. Prefer people with direct experience at this location over corporate executives.

SOURCE REQUIREMENT: For each contact, provide the "src" field with the URL where you found them (LinkedIn profile, company team page, property listing, etc.). Only return contacts you can cite a source for.

COMPANY: Return exactly ONE company name per contact — the company most directly relevant to their role at this property. Do NOT combine multiple companies with "/" or "&" (e.g. do NOT return "Company A / Company B"). If a person is associated with multiple entities, pick the one most relevant to their property role.

EMAIL: If you find an email address for a contact in search results, include it. Only include emails you actually found on a web page — do NOT construct emails from name patterns (e.g. firstname@company.com). If no email was found, set email to null.

CONFIDENCE (rc): Rate how confident you are that each person is genuinely connected to THIS specific property. Use this scale:
- 0.8–1.0: Found on a specific source (LinkedIn, company page, property listing) with clear, direct connection to this property address
- 0.5–0.7: Found via search with strong circumstantial evidence (right company + right city/region + relevant title) but not explicitly listed for this exact address
- 0.2–0.4: Reasonable match based on company and title, but limited direct evidence linking them to this property
- 0.0–0.1: Purely speculative with no supporting evidence at all

Return JSON:
{
  "contacts": [
    {
      "name": "Full Name",
      "title": "Title",
      "company": "Company Name",
      "domain": "company.com",
      "role": "property_manager | facilities_manager | owner | other",
      "rc": 0.85,
      "evidence": "1 sentence linking them to this property",
      "src": "https://source-url-where-found",
      "type": "individual | general",
      "email": "found@email.com | null"
    }
  ],
  "summary": "2 sentences max. If no contacts found, explain why."
}`;

  console.log('[FocusedEnrichment] Stage 3: Identifying decision-makers...');
  console.log(`[FocusedEnrichment] Stage 3 input - Property: ${classification.propertyName}, Companies: ${companyLines.length}`);

  for (let attempt = 1; attempt <= RETRIES.STAGE_3A; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3 attempt ${attempt}/${RETRIES.STAGE_3A} (provider: ${stageConfig.provider})...`);

      const response: LLMResponse = await adapter.call(prompt, {
        model: STAGE_MODELS.STAGE_3_CONTACTS,
        temperature: STAGE_TEMPERATURES.STAGE_3_CONTACTS,
        thinkingLevel: THINKING_LEVELS.STAGE_3A_CONTACTS,
        timeoutMs: STAGE_TIMEOUTS.STAGE_3_CONTACTS,
        stageName: 'stage3-contacts',
        searchGrounding: stageConfig.searchGrounding,
        latLng: propertyLatLng(property),
      });

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 3 attempt ${attempt} response length: ${text.length} chars`);

      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response in Stage 3 (attempt ${attempt}/${RETRIES.STAGE_3A})`);
        trackCostFireAndForget({
          provider: stageConfig.provider,
          endpoint: 'identify-decision-makers',
          entityType: 'property',
          clerkOrgId: options.clerkOrgId,
          tokenUsage: response.tokenUsage ? {
            promptTokens: response.tokenUsage.inputTokens,
            responseTokens: response.tokenUsage.outputTokens,
            thinkingTokens: response.tokenUsage.thinkingTokens,
            totalTokens: response.tokenUsage.totalTokens,
            searchGroundingUsed: response.tokenUsage.groundingQueriesUsed > 0,
            searchGroundingQueryCount: response.tokenUsage.groundingQueriesUsed,
            searchGroundingCostUsd: response.tokenUsage.groundingCostUsd,
          } : undefined,
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < RETRIES.STAGE_3A) {
          const delayMs = attempt * BACKOFF.STAGE_3A_PER_ATTEMPT_MS;
          console.log(`[FocusedEnrichment] Stage 3 retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 3: all attempts returned empty, giving up');
        return { data: { contacts: [] }, summary: '', sources: [] };
      }

      const sources = response.groundingSources;
      const groundingQuality = response.raw?.groundingQuality || extractGroundingQuality(response.raw);
      const citationMetadata = extractCitationMetadata(response.raw);
      const parsed = parseJsonResponse(text);

      try {
        validateStage3aSchema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 3 schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < RETRIES.STAGE_3A) {
          const delayMs = attempt * BACKOFF.STAGE_3A_PER_ATTEMPT_MS;
          console.log(`[FocusedEnrichment] Stage 3 retrying after schema error in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return { data: { contacts: [] }, summary: parsed.summary || '', sources: [] };
      }

      const rawContactsParsed: IdentifiedDecisionMaker[] = (parsed.contacts || []).map((c: any) => ({
        name: c.name || '',
        title: c.title ?? null,
        company: c.company ?? null,
        companyDomain: c.domain ?? null,
        role: c.role || 'other',
        roleConfidence: c.rc ?? 0.5,
        connectionEvidence: c.evidence || '',
        sourceUrl: c.src && c.src !== 'null' ? c.src : null,
        contactType: c.type === 'general' ? 'general' : 'individual',
        email: c.email && c.email !== 'null' ? c.email : null,
      }));

      const PLACEHOLDER_PATTERNS = /\b(open position|tbd|to be determined|hiring|vacant|currently hiring|position open|unfilled|seeking)\b/i;

      const knownCompanyNames = [
        ownership.managementCompany?.name,
        ownership.beneficialOwner?.name,
        ...(ownership.additionalManagementCompanies || []).map(m => m.name),
        ...(ownership.additionalOwners || []).map(o => o.name),
        property.ownerName1,
        property.bizName,
      ].filter(Boolean).map(n => n!.toLowerCase().replace(/[^a-z0-9]/g, ''));

      const contacts: IdentifiedDecisionMaker[] = [];
      for (const contact of rawContactsParsed) {
        if (!contact.name) continue;

        if (PLACEHOLDER_PATTERNS.test(contact.name)) {
          console.warn(`[FocusedEnrichment] Stage 3: Skipping placeholder contact "${contact.name}"`);
          continue;
        }

        if (contact.companyDomain) {
          const validatedDomain = await validateAndCleanDomain(contact.companyDomain, contact.company || undefined, `Stage 3 domain for ${contact.name}`);
          if (!validatedDomain) {
            console.warn(`[FocusedEnrichment] Stage 3: Domain "${contact.companyDomain}" for ${contact.name} failed validation — will try email domain fallback`);
            contact.companyDomain = null;
          } else {
            contact.companyDomain = validatedDomain;
          }
        }

        if (contact.email) {
          if (isLikelyConstructedEmail(contact.email, contact.name)) {
            const hasGrounding = sources.length > 0;
            if (!hasGrounding) {
              console.warn(`[FocusedEnrichment] Stage 3: Email "${contact.email}" matches name-pattern construction for ${contact.name} with no grounding sources — likely hallucinated, clearing`);
              contact.email = null;
            } else {
              console.log(`[FocusedEnrichment] Stage 3: Email "${contact.email}" matches name-pattern but has ${sources.length} grounding sources — keeping`);
            }
          }
        }

        if (contact.email) {
          const emailDomain = contact.email.split('@')[1];
          if (emailDomain) {
            const domainResult = await validateAndCleanDomain(emailDomain, undefined, `email domain for ${contact.name}`);
            if (!domainResult) {
              console.warn(`[FocusedEnrichment] Stage 3: Email "${contact.email}" has invalid domain, clearing`);
              contact.email = null;
            }
          }
        }

        const geminiRc = contact.roleConfidence;
        const hasSrc = !!contact.sourceUrl;
        const hasEmail = !!contact.email;
        let companyMatch = false;
        if (contact.company && knownCompanyNames.length > 0) {
          const contactCompanyNorm = contact.company.toLowerCase().replace(/[^a-z0-9]/g, '');
          companyMatch = knownCompanyNames.some(known =>
            contactCompanyNorm.includes(known) || known.includes(contactCompanyNorm)
          );
        }

        let composite = geminiRc * 0.3;
        if (hasSrc) composite += 0.2;
        if (groundingQuality?.hasGrounding) {
          composite += 0.1 + Math.min((groundingQuality?.avgConfidence ?? 0) * 0.1, 0.1);
        }
        if (companyMatch) composite += 0.15;
        if (hasEmail) composite += 0.1;

        composite = Math.min(composite, 1.0);
        composite = Math.max(composite, 0.05);

        if (!hasSrc) {
          composite = Math.min(composite, CONFIDENCE.NO_SOURCE_URL_CAP);
        }
        if (!companyMatch && knownCompanyNames.length > 0 && contact.company) {
          const contactCompanyNorm = contact.company.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (contactCompanyNorm.length > 3) {
            composite = Math.min(composite, CONFIDENCE.COMPANY_MISMATCH_CAP);
          }
        }

        contact.roleConfidence = Math.round(composite * 100) / 100;

        console.log(`[FocusedEnrichment] Confidence for "${contact.name}": geminiRc=${geminiRc} → composite=${contact.roleConfidence} (src=${hasSrc}, grounding=${groundingQuality?.hasGrounding}/${(groundingQuality?.avgConfidence ?? 0).toFixed(2)}, companyMatch=${companyMatch}, hasEmail=${hasEmail})`);

        const contactNameLower = contact.name.toLowerCase();
        const contactRelevantSupports = (groundingQuality?.supports || []).filter((s: any) =>
          s.segment.toLowerCase().includes(contactNameLower) ||
          (contact.company && s.segment.toLowerCase().includes(contact.company.toLowerCase()))
        );

        (contact as any)._groundingData = {
          sourceUrl: contact.sourceUrl,
          evidence: contact.connectionEvidence,
          groundingSupports: contactRelevantSupports,
          webSearchQueries: groundingQuality.webSearchQueries,
          citations: citationMetadata.citations,
        } as RelationshipGrounding;

        contacts.push(contact);
      }

      if (contacts.length === 0) {
        console.log(`[FocusedEnrichment] Stage 3: No contacts found. Reason: ${parsed.summary || 'no reason given'}`);
      } else {
        const withEmail = contacts.filter(c => c.email).length;
        console.log(`[FocusedEnrichment] Stage 3 complete: ${contacts.length} contacts identified (${withEmail} with email), ${sources.length} sources`);
      }

      trackCostFireAndForget({
        provider: stageConfig.provider,
        endpoint: 'identify-decision-makers',
        entityType: 'property',
        clerkOrgId: options.clerkOrgId,
        tokenUsage: response.tokenUsage ? {
          promptTokens: response.tokenUsage.inputTokens,
          responseTokens: response.tokenUsage.outputTokens,
          thinkingTokens: response.tokenUsage.thinkingTokens,
          totalTokens: response.tokenUsage.totalTokens,
          searchGroundingUsed: response.tokenUsage.groundingQueriesUsed > 0,
          searchGroundingQueryCount: response.tokenUsage.groundingQueriesUsed,
          searchGroundingCostUsd: response.tokenUsage.groundingCostUsd,
        } : undefined,
        success: true,
        metadata: { contactsCount: contacts.length, sourcesCount: sources.length, attempt },
      });

      const stageMetadata: StageMetadata = {
        finishReason: response.finishReason,
        tokens: response.tokenUsage ? {
          prompt: response.tokenUsage.inputTokens,
          response: response.tokenUsage.outputTokens,
          thinking: response.tokenUsage.thinkingTokens,
          total: response.tokenUsage.totalTokens,
        } : undefined,
        searchQueries: groundingQuality?.webSearchQueries?.length > 0 ? groundingQuality.webSearchQueries : undefined,
      };

      return {
        data: { contacts },
        summary: parsed.summary || '',
        sources,
        metadata: stageMetadata,
      };
    } catch (error) {
      trackCostFireAndForget({
        provider: stageConfig.provider,
        endpoint: 'identify-decision-makers',
        entityType: 'property',
        clerkOrgId: options.clerkOrgId,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error(`[FocusedEnrichment] Stage 3 attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt < RETRIES.STAGE_3A) {
        const delayMs = attempt * BACKOFF.STAGE_3A_PER_ATTEMPT_MS;
        console.log(`[FocusedEnrichment] Stage 3 retrying after error in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return {
        data: { contacts: [] },
        summary: '',
        sources: [],
      };
    }
  }

  return { data: { contacts: [] }, summary: '', sources: [] };
}

// =============================================================================
// Stage 3 Orchestrator
// =============================================================================

export async function discoverContacts(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo,
  options: { clerkOrgId?: string; market?: MarketConfig } = {}
): Promise<StageResult<{ contacts: DiscoveredContact[] }> & { contactIdentificationMs: number; contactEnrichmentMs: number }> {
  const startIdentify = Date.now();
  const identifyResult = await identifyDecisionMakers(property, classification, ownership, options);
  const contactIdentificationMs = Date.now() - startIdentify;

  const identifiedContacts = identifyResult.data.contacts;
  console.log(`[FocusedEnrichment] Stage 3 took ${contactIdentificationMs}ms, identified ${identifiedContacts.length} contacts`);

  const allSources = [...identifyResult.sources];
  const rawContacts: DiscoveredContact[] = identifiedContacts.map((dm, idx) => ({
    name: dm.name,
    title: dm.title,
    company: dm.company,
    companyDomain: dm.companyDomain,
    email: dm.email || null,
    emailSource: dm.email ? 'ai_discovered' as const : null,
    phone: null,
    phoneLabel: null,
    phoneConfidence: null,
    location: null,
    role: dm.role,
    roleConfidence: dm.roleConfidence,
    priorityRank: idx + 1,
    contactType: dm.contactType,
    sourceUrl: dm.sourceUrl,
    connectionEvidence: dm.connectionEvidence,
    groundingData: (dm as any)._groundingData || null,
  }));

  for (const c of rawContacts) {
    if (!c.companyDomain && c.email && c.company) {
      const emailDomain = c.email.split('@')[1]?.toLowerCase();
      if (emailDomain && !FREE_EMAIL_DOMAINS.includes(emailDomain)) {
        console.log(`[FocusedEnrichment] Email domain fallback: "${c.name}" (${c.company}) → ${emailDomain} from validated email`);
        c.companyDomain = emailDomain;
      }
    }
  }

  const allMgmtCompanies = [ownership.managementCompany, ...(ownership.additionalManagementCompanies || [])];
  for (const mgmt of allMgmtCompanies) {
    if (!mgmt?.domain && mgmt?.name) {
      const mgmtNameNorm = mgmt.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const c of rawContacts) {
        if (c.email && c.company) {
          const contactCompanyNorm = c.company.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (contactCompanyNorm.includes(mgmtNameNorm) || mgmtNameNorm.includes(contactCompanyNorm)) {
            const emailDomain = c.email.split('@')[1]?.toLowerCase();
            if (emailDomain && !FREE_EMAIL_DOMAINS.includes(emailDomain)) {
              console.log(`[FocusedEnrichment] Email domain fallback for mgmt company "${mgmt.name}" → ${emailDomain} from ${c.name}'s email`);
              mgmt.domain = emailDomain;
              break;
            }
          }
        }
      }
    }
  }

  const contacts = deduplicateContacts(rawContacts);
  contacts.forEach((c, i) => { c.priorityRank = i + 1; });

  if (contacts.length < rawContacts.length) {
    console.log(`[FocusedEnrichment] Deduplicated ${rawContacts.length} → ${contacts.length} contacts`);
  }

  const uniqueSources = allSources.filter((s, i, arr) =>
    arr.findIndex(x => x.url === s.url) === i
  ).slice(0, 10);

  return {
    data: { contacts },
    summary: identifyResult.summary,
    sources: uniqueSources,
    metadata: identifyResult.metadata,
    contactIdentificationMs,
    contactEnrichmentMs: 0,
  };
}
