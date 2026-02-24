// ============================================================================
// AI Enrichment — Stage 3a/3b: Contact Discovery & Enrichment
//
// Two sub-stages that run sequentially:
//
//   Stage 3a (identifyDecisionMakers):
//     Searches the web for people directly involved in managing the property.
//     Validates each contact's source URL and company domain.
//     Returns up to ~3 IdentifiedDecisionMaker records.
//
//   Stage 3b (enrichContactDetails):
//     For each person from 3a, searches for their email and phone.
//     Filters out hallucinated emails (name-pattern construction without
//     grounding sources) and validates email domains via DNS.
//     Runs all contacts in parallel via Promise.allSettled.
//
//   discoverContacts orchestrates both sub-stages and then:
//     - Falls back to email domains for missing company domains
//     - Deduplicates contacts by name
//     - Cross-validates companies against Stage 2 ownership data
//     - Flags shared/office phone numbers
// ============================================================================

import type { CommercialProperty } from "../../snowflake";
import type {
  StageResult, OwnershipInfo, PropertyClassification,
  IdentifiedDecisionMaker, ContactEnrichmentResult, DiscoveredContact
} from '../types';
import { getGeminiClient, streamGeminiResponse, callGeminiWithTimeout } from '../client';
import { extractGroundedSources, parseJsonResponse, validateStage3aSchema } from '../parsers';
import { propertyLatLng, isLikelyConstructedEmail, deduplicateContacts } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { validateAndCleanDomain } from '../../domain-validator';
import {
  THINKING_LEVELS, RETRIES, BACKOFF, CONFIDENCE,
  FREE_EMAIL_DOMAINS, GOOGLE_SEARCH_TOOL,
} from '../config';

// =============================================================================
// Stage 3a — Decision-Maker Identification
// =============================================================================

/**
 * Search the web for people who directly manage this property.
 *
 * Prioritizes on-site property managers, facilities directors, and regional
 * managers over C-suite executives.  Each contact must have a source URL
 * citation — contacts without sources get their confidence capped.
 */
async function identifyDecisionMakers(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: IdentifiedDecisionMaker[] }>> {
  const client = getGeminiClient();

  const propertySite = ownership.propertyWebsite || 'none';
  const city = property.city || 'Dallas';
  const state = (property as any).state || 'TX';

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
    const fallbackOwner = property.bizName || property.ownerName1 || 'Unknown';
    companyLines.push(`- OWNER: ${fallbackOwner} | domain: unknown`);
  }
  const companiesBlock = companyLines.join('\n');

  // -- Build the prompt -------------------------------------------------------
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

Return JSON:
{
  "contacts": [
    {
      "name": "Full Name",
      "title": "Title",
      "company": "Company Name",
      "domain": "company.com",
      "role": "property_manager | facilities_manager | owner | other",
      "rc": 0.0,
      "evidence": "1 sentence linking them to this property",
      "src": "https://source-url-where-found",
      "type": "individual | general"
    }
  ],
  "summary": "2 sentences max. If no contacts found, explain why."
}`;

  console.log('[FocusedEnrichment] Stage 3a: Identifying decision-makers...');
  console.log(`[FocusedEnrichment] Stage 3a input - Property: ${classification.propertyName}, Companies: ${companyLines.length}`);

  // -- Retry loop -------------------------------------------------------------
  for (let attempt = 1; attempt <= RETRIES.STAGE_3A; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3a attempt ${attempt}/${RETRIES.STAGE_3A}...`);

      // LOW thinking level — this stage requires multi-step research reasoning
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, {
          tools: GOOGLE_SEARCH_TOOL,
          thinkingLevel: THINKING_LEVELS.STAGE_3A_CONTACTS,
          latLng: propertyLatLng(property),
        }),
        2
      );

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 3a attempt ${attempt} response length: ${text.length} chars`);

      // Handle empty response
      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 3a (attempt ${attempt}/${RETRIES.STAGE_3A})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'identify-decision-makers',
          entityType: 'property',
          tokenUsage: response.tokenUsage,
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < RETRIES.STAGE_3A) {
          const delayMs = attempt * BACKOFF.STAGE_3A_PER_ATTEMPT_MS;
          console.log(`[FocusedEnrichment] Stage 3a retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 3a: all attempts returned empty, giving up');
        return { data: { contacts: [] }, summary: '', sources: [] };
      }

      // -- Parse and validate -------------------------------------------------
      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      try {
        validateStage3aSchema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 3a schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < RETRIES.STAGE_3A) {
          const delayMs = attempt * BACKOFF.STAGE_3A_PER_ATTEMPT_MS;
          console.log(`[FocusedEnrichment] Stage 3a retrying after schema error in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return { data: { contacts: [] }, summary: parsed.summary || '', sources: [] };
      }

      // -- Map raw JSON to typed records --------------------------------------
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
      }));

      // -- Validate each contact's source and domain --------------------------
      const contacts: IdentifiedDecisionMaker[] = [];
      for (const contact of rawContactsParsed) {
        if (!contact.name) continue;

        // Cap confidence when no source URL is provided
        if (!contact.sourceUrl) {
          console.warn(`[FocusedEnrichment] Stage 3a: Contact "${contact.name}" has no source URL — downgrading confidence`);
          contact.roleConfidence = Math.min(contact.roleConfidence, CONFIDENCE.NO_SOURCE_URL_CAP);
        }

        // Validate company domain via DNS
        if (contact.companyDomain) {
          const validatedDomain = await validateAndCleanDomain(contact.companyDomain, contact.company || undefined, `Stage 3a domain for ${contact.name}`);
          if (!validatedDomain) {
            console.warn(`[FocusedEnrichment] Stage 3a: Domain "${contact.companyDomain}" for ${contact.name} failed validation — will try email domain fallback after Stage 3b`);
            contact.companyDomain = null;
          } else {
            contact.companyDomain = validatedDomain;
          }
        }
        contacts.push(contact);
      }

      if (contacts.length === 0) {
        console.log(`[FocusedEnrichment] Stage 3a: No contacts found. Reason: ${parsed.summary || 'no reason given'}`);
      } else {
        console.log(`[FocusedEnrichment] Stage 3a complete: ${contacts.length} contacts identified, ${sources.length} sources`);
      }

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-decision-makers',
        entityType: 'property',
        tokenUsage: response.tokenUsage,
        success: true,
        metadata: { contactsCount: contacts.length, sourcesCount: sources.length, attempt },
      });

      return {
        data: { contacts },
        summary: parsed.summary || '',
        sources,
      };
    } catch (error) {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-decision-makers',
        entityType: 'property',
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error(`[FocusedEnrichment] Stage 3a attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt < RETRIES.STAGE_3A) {
        const delayMs = attempt * BACKOFF.STAGE_3A_PER_ATTEMPT_MS;
        console.log(`[FocusedEnrichment] Stage 3a retrying after error in ${delayMs}ms...`);
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
// Stage 3b — Per-Contact Email/Phone Enrichment
// =============================================================================

/**
 * Search the web for a single contact's email and phone number.
 *
 * Anti-hallucination measures:
 *   - Emails that match common name-pattern constructions (e.g. jsmith@co.com)
 *     are rejected unless the response has grounding sources
 *   - Email domains are validated via DNS before returning
 */
async function enrichContactDetails(
  contact: IdentifiedDecisionMaker,
  city: string,
  state: string,
  latLng?: { latitude: number; longitude: number }
): Promise<ContactEnrichmentResult> {
  const client = getGeminiClient();

  const companyInfo = contact.company
    ? `${contact.company}${contact.companyDomain ? ` (${contact.companyDomain})` : ''}`
    : 'unknown company';

  // -- Build the prompt -------------------------------------------------------
  const prompt = `Find contact info for ${contact.name}, ${contact.title || 'unknown title'} at ${companyInfo} in ${city}, ${state}. Return ONLY valid JSON.

RULES:
- Only return an email address that you found in an actual web page or search result. Copy it exactly as it appeared.
- DO NOT construct emails from name patterns. Examples of HALLUCINATED emails you must NOT return: firstname@company.com, flastname@company.com, first.last@company.com. If no email appeared in search results, return null.
- For phone: return a number you found on the company or property website. Return null if not found.
- If you cannot find verified contact details after searching, return null — a null is far more valuable than a guess.

{
  "email": "found@email.com | null",
  "phone": "+1XXXXXXXXXX | null",
  "pl": "direct_work | office | personal | null",
  "pc": 0.0,
  "loc": "City, ST | null"
}`;

  // -- Retry loop -------------------------------------------------------------
  for (let attempt = 1; attempt <= RETRIES.STAGE_3B; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3b attempt ${attempt}/${RETRIES.STAGE_3B} for ${contact.name}...`);

      // MINIMAL thinking — this is a simple lookup, not multi-step reasoning
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, {
          tools: GOOGLE_SEARCH_TOOL,
          thinkingLevel: THINKING_LEVELS.STAGE_3B_ENRICH,
          latLng,
        }),
        2
      );

      const text = response.text?.trim() || '';
      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response in Stage 3b for ${contact.name} (attempt ${attempt}/${RETRIES.STAGE_3B})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'enrich-contact-details',
          entityType: 'contact',
          tokenUsage: response.tokenUsage,
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < RETRIES.STAGE_3B) {
          const delayMs = attempt * BACKOFF.STAGE_3B_PER_ATTEMPT_MS;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
      }

      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'enrich-contact-details',
        entityType: 'contact',
        tokenUsage: response.tokenUsage,
        success: true,
        metadata: { sourcesCount: sources.length, attempt },
      });

      let email = parsed.email && parsed.email !== 'null' ? parsed.email : null;

      // -- Anti-hallucination: reject name-pattern emails without grounding ----
      if (email) {
        if (isLikelyConstructedEmail(email, contact.name)) {
          const hasGrounding = sources.length > 0;
          if (!hasGrounding) {
            console.warn(`[FocusedEnrichment] Stage 3b: Email "${email}" matches name-pattern construction for ${contact.name} with no grounding sources — likely hallucinated, clearing`);
            email = null;
          } else {
            console.log(`[FocusedEnrichment] Stage 3b: Email "${email}" matches name-pattern but has ${sources.length} grounding sources — keeping`);
          }
        }
      }

      // -- Validate email domain via DNS --------------------------------------
      if (email) {
        const emailDomain = email.split('@')[1];
        if (emailDomain) {
          const domainResult = await validateAndCleanDomain(emailDomain, undefined, `email domain for ${contact.name}`);
          if (!domainResult) {
            console.warn(`[FocusedEnrichment] Stage 3b: Email "${email}" has invalid domain, clearing`);
            email = null;
          }
        }
      }

      return {
        email,
        emailSource: email ? 'ai_discovered' : null,
        phone: parsed.phone && parsed.phone !== 'null' ? parsed.phone : null,
        phoneLabel: parsed.pl && parsed.pl !== 'null' ? parsed.pl : null,
        phoneConfidence: parsed.pc ?? null,
        location: parsed.loc && parsed.loc !== 'null' ? parsed.loc : null,
        enrichmentSources: sources,
      };
    } catch (error) {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'enrich-contact-details',
        entityType: 'contact',
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.warn(`[FocusedEnrichment] Stage 3b attempt ${attempt} failed for ${contact.name}: ${error instanceof Error ? error.message : error}`);
      if (attempt < RETRIES.STAGE_3B) {
        const delayMs = attempt * BACKOFF.STAGE_3B_PER_ATTEMPT_MS;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
    }
  }

  return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
}

// =============================================================================
// Stage 3 Orchestrator
// =============================================================================

/**
 * Run the full Stage 3 pipeline: identify contacts (3a) then enrich each
 * one in parallel (3b), then apply post-processing rules.
 *
 * Post-processing includes:
 *   - Email domain fallback: if a contact has an email but no company domain,
 *     use the email domain (excluding free providers like gmail.com)
 *   - Management company domain fallback: if Stage 2 left mgmt domain empty,
 *     try to fill it from a matching contact's email domain
 *   - Contact deduplication by normalized name
 *   - Cross-stage company validation: downgrade confidence when a contact's
 *     company doesn't match any known company from Stage 2
 *   - Phone cross-validation: flag phones that match the property's main
 *     number or are shared across multiple contacts as "office"
 */
export async function discoverContacts(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: DiscoveredContact[] }> & { contactIdentificationMs: number; contactEnrichmentMs: number }> {
  const city = property.city || 'Dallas';
  const state = (property as any).state || 'TX';

  // -- Stage 3a: identify decision-makers ------------------------------------
  const startIdentify = Date.now();
  const identifyResult = await identifyDecisionMakers(property, classification, ownership);
  const contactIdentificationMs = Date.now() - startIdentify;

  const identifiedContacts = identifyResult.data.contacts;
  console.log(`[FocusedEnrichment] Stage 3a took ${contactIdentificationMs}ms, identified ${identifiedContacts.length} contacts`);

  // -- Stage 3b: enrich each contact in parallel -----------------------------
  const startEnrich = Date.now();
  const latLng = propertyLatLng(property);
  const settledResults = await Promise.allSettled(
    identifiedContacts.map(contact => enrichContactDetails(contact, city, state, latLng))
  );
  const contactEnrichmentMs = Date.now() - startEnrich;

  const enrichmentResults: ContactEnrichmentResult[] = settledResults.map((result, idx) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`[FocusedEnrichment] Stage 3b failed for ${identifiedContacts[idx].name}: ${result.reason}`);
    return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
  });

  console.log(`[FocusedEnrichment] Stage 3b took ${contactEnrichmentMs}ms for ${identifiedContacts.length} contacts`);

  // -- Merge 3a + 3b results into DiscoveredContact records ------------------
  const allSources = [...identifyResult.sources];
  const rawContacts: DiscoveredContact[] = identifiedContacts.map((dm, idx) => {
    const enrichment = enrichmentResults[idx];
    allSources.push(...enrichment.enrichmentSources);

    return {
      name: dm.name,
      title: dm.title,
      company: dm.company,
      companyDomain: dm.companyDomain,
      email: enrichment.email,
      emailSource: enrichment.emailSource,
      phone: enrichment.phone,
      phoneLabel: enrichment.phoneLabel,
      phoneConfidence: enrichment.phoneConfidence,
      location: enrichment.location,
      role: dm.role,
      roleConfidence: dm.roleConfidence,
      priorityRank: idx + 1,
      contactType: dm.contactType,
    };
  });

  // -- Post-processing: email domain fallback for missing company domains -----
  for (const c of rawContacts) {
    if (!c.companyDomain && c.email && c.company) {
      const emailDomain = c.email.split('@')[1]?.toLowerCase();
      if (emailDomain && !FREE_EMAIL_DOMAINS.includes(emailDomain)) {
        console.log(`[FocusedEnrichment] Email domain fallback: "${c.name}" (${c.company}) → ${emailDomain} from validated email`);
        c.companyDomain = emailDomain;
      }
    }
  }

  // -- Post-processing: fill missing mgmt company domain from contact emails --
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

  // -- Post-processing: deduplicate contacts by normalized name ---------------
  const contacts = deduplicateContacts(rawContacts);
  contacts.forEach((c, i) => { c.priorityRank = i + 1; });

  if (contacts.length < rawContacts.length) {
    console.log(`[FocusedEnrichment] Deduplicated ${rawContacts.length} → ${contacts.length} contacts`);
  }

  // -- Post-processing: cross-stage company validation ------------------------
  // Downgrade roleConfidence when a contact's company doesn't match any
  // known company from Stage 2 (owner, mgmt, deed holder, + additional)
  const knownCompanies = [
    ownership.managementCompany?.name,
    ownership.beneficialOwner?.name,
    ...(ownership.additionalManagementCompanies || []).map(m => m.name),
    ...(ownership.additionalOwners || []).map(o => o.name),
    property.bizName,
    property.ownerName1,
  ].filter(Boolean).map(n => n!.toLowerCase().replace(/[^a-z0-9]/g, ''));

  if (knownCompanies.length > 0) {
    for (const c of contacts) {
      if (c.company) {
        const contactCompanyNorm = c.company.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchesKnown = knownCompanies.some(known =>
          contactCompanyNorm.includes(known) || known.includes(contactCompanyNorm)
        );
        if (!matchesKnown && contactCompanyNorm.length > 3) {
          console.warn(`[FocusedEnrichment] Cross-stage validation: ${c.name}'s company "${c.company}" doesn't match known companies [${knownCompanies.join(', ')}] — downgrading roleConfidence`);
          c.roleConfidence = Math.min(c.roleConfidence, CONFIDENCE.COMPANY_MISMATCH_CAP);
        }
      }
    }
  }

  // -- Post-processing: phone cross-validation --------------------------------
  // Flag phones that match the property's main number as "office" with low confidence
  const propertyPhone = ownership.propertyPhone?.replace(/\D/g, '') || null;
  if (propertyPhone) {
    for (const c of contacts) {
      if (c.phone && c.phone.replace(/\D/g, '') === propertyPhone) {
        console.warn(`[FocusedEnrichment] Phone cross-validation: ${c.name}'s phone matches propertyPhone — labeling as office`);
        c.phoneLabel = 'office';
        c.phoneConfidence = Math.min(c.phoneConfidence ?? 0.5, CONFIDENCE.OFFICE_PHONE_CAP);
      }
    }
  }

  // Flag phones shared by multiple contacts — likely a generic office number
  const phoneCountMap = new Map<string, string[]>();
  for (const c of contacts) {
    if (c.phone) {
      const normalized = c.phone.replace(/\D/g, '');
      if (!phoneCountMap.has(normalized)) phoneCountMap.set(normalized, []);
      phoneCountMap.get(normalized)!.push(c.name);
    }
  }
  for (const [phone, names] of phoneCountMap) {
    if (names.length > 1) {
      console.warn(`[FocusedEnrichment] Phone cross-validation: ${names.length} contacts share phone +${phone} (${names.join(', ')}) — likely generic office number, downgrading to office label`);
      for (const c of contacts) {
        if (c.phone?.replace(/\D/g, '') === phone) {
          c.phoneLabel = 'office';
          c.phoneConfidence = Math.min(c.phoneConfidence ?? 0.5, CONFIDENCE.SHARED_PHONE_CAP);
        }
      }
    }
  }

  // -- Deduplicate sources across both sub-stages -----------------------------
  const uniqueSources = allSources.filter((s, i, arr) =>
    arr.findIndex(x => x.url === s.url) === i
  ).slice(0, 10);

  return {
    data: { contacts },
    summary: identifyResult.summary,
    sources: uniqueSources,
    contactIdentificationMs,
    contactEnrichmentMs,
  };
}
