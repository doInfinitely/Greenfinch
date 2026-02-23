// ============================================================================
// AI Enrichment — Stage 3a/3b: Contact Discovery & Enrichment
// Stage 3a identifies decision-makers via web search.
// Stage 3b enriches each contact with email/phone details.
// discoverContacts orchestrates both sub-stages and post-processes results.
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

async function identifyDecisionMakers(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: IdentifiedDecisionMaker[] }>> {
  const client = getGeminiClient();

  const mgmtName = ownership.managementCompany?.name || null;
  const mgmtDomain = ownership.managementCompany?.domain || null;
  const mgmtInfo = mgmtName ? `${mgmtName} (${mgmtDomain || 'no website'})` : 'Unknown';
  const ownerName = ownership.beneficialOwner?.name || property.bizName || property.ownerName1 || 'Unknown';
  const propertySite = ownership.propertyWebsite || 'none';
  const city = property.city || 'Dallas';

  const prompt = `Find 3 people directly involved in managing THIS specific property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName} at ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}
MGMT CO: ${mgmtInfo}
OWNER: ${ownerName}
PROPERTY SITE: ${propertySite}

TASK: Search the web to find people who directly manage, operate, or maintain this specific property on a day-to-day basis. Focus on the property management company staff in the ${city} area, not corporate headquarters executives.

PRIORITY ROLES (return these first; listed in priority order):
- On-site property manager or community manager for this specific property
- Facilities/maintenance director or chief engineer for this specific property
- Regional/district property manager overseeing this property's area
- Asset manager or owner with direct responsibility for this property

DO NOT RETURN:
- C-suite executives (CEO, CFO, COO, CTO, CMO) unless they are the direct property owner and higher-priority contacts were not identified
- Corporate HR, marketing, or IT staff
- People at corporate headquarters with no direct tie to this property or market
- National-level VPs unless they specifically oversee the ${city} region

Only return people verifiably connected to THIS property at THIS address or its local market as of 2025-2026.

IMPORTANT: If after searching you cannot find any verifiable contacts for this property, do NOT keep searching. Immediately return an empty contacts array with a summary explaining why no contacts were found. A fast "none found" response is far better than an exhaustive search that finds nothing.

SOURCE REQUIREMENT: For each contact, provide the "src" field with the URL where you found them (LinkedIn profile, company team page, property listing, etc.). Do NOT return contacts you cannot cite a source for — if you cannot provide a source URL, omit that contact entirely.

Return JSON:
{"contacts":[{"name":"Full Name","title":"Title","company":"Company Name","domain":"company.com","role":"property_manager|facilities_manager|owner|other","rc":0.0-1.0,"evidence":"1 sentence linking them to this property","src":"https://source-url-where-found","type":"individual|general"}],"summary":"2 sentences max. If no contacts found, explain why (e.g. small owner-operated business, no public staff listings, etc.)."}`;

  console.log('[FocusedEnrichment] Stage 3a: Identifying decision-makers...');
  console.log(`[FocusedEnrichment] Stage 3a input - Property: ${classification.propertyName}, Mgmt: ${mgmtInfo}`);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3a attempt ${attempt}/${maxAttempts}...`);
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], thinkingLevel: 'LOW', latLng: propertyLatLng(property) }),
        2
      );

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 3a attempt ${attempt} response length: ${text.length} chars`);

      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 3a (attempt ${attempt}/${maxAttempts})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'identify-decision-makers',
          entityType: 'property',
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 3a retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 3a: all attempts returned empty, giving up');
        return { data: { contacts: [] }, summary: '', sources: [] };
      }

      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      try {
        validateStage3aSchema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 3a schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 3a retrying after schema error in ${delayMs}ms...`);
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
      }));

      const contacts: IdentifiedDecisionMaker[] = [];
      for (const contact of rawContactsParsed) {
        if (!contact.name) continue;

        if (!contact.sourceUrl) {
          console.warn(`[FocusedEnrichment] Stage 3a: Contact "${contact.name}" has no source URL — downgrading confidence`);
          contact.roleConfidence = Math.min(contact.roleConfidence, 0.4);
        }

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
      if (attempt < maxAttempts) {
        const delayMs = attempt * 3000;
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

async function enrichContactDetails(
  contact: IdentifiedDecisionMaker,
  city: string,
  latLng?: { latitude: number; longitude: number }
): Promise<ContactEnrichmentResult> {
  const client = getGeminiClient();

  const companyInfo = contact.company
    ? `${contact.company}${contact.companyDomain ? ` (${contact.companyDomain})` : ''}`
    : 'unknown company';

  const prompt = `Find contact info for ${contact.name}, ${contact.title || 'unknown title'} at ${companyInfo} in ${city}, TX. Return ONLY valid JSON.

RULES:
- Only return an email address that you found in an actual web page or search result. Copy it exactly as it appeared.
- DO NOT construct emails from name patterns. Examples of HALLUCINATED emails you must NOT return: firstname@company.com, flastname@company.com, first.last@company.com. If no email appeared in search results, return null.
- For phone: return a number you found on the company or property website. Return null if not found.
- If you cannot find verified contact details after searching, return null — a null is far more valuable than a guess.

{"email":"found@email.com|null","phone":"+1XXXXXXXXXX|null","pl":"direct_work|office|personal|null","pc":0.0-1.0,"loc":"City, ST|null"}`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3b attempt ${attempt}/${maxAttempts} for ${contact.name}...`);
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], thinkingLevel: 'MINIMAL', latLng }),
        2
      );

      const text = response.text?.trim() || '';
      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response in Stage 3b for ${contact.name} (attempt ${attempt}/${maxAttempts})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'enrich-contact-details',
          entityType: 'contact',
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < maxAttempts) {
          const delayMs = attempt * 2000;
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
        success: true,
        metadata: { sourcesCount: sources.length, attempt },
      });

      let email = parsed.email && parsed.email !== 'null' ? parsed.email : null;

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
      if (attempt < maxAttempts) {
        const delayMs = attempt * 2000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
    }
  }

  return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
}

export async function discoverContacts(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: DiscoveredContact[] }> & { contactIdentificationMs: number; contactEnrichmentMs: number }> {
  const city = property.city || 'Dallas';

  const startIdentify = Date.now();
  const identifyResult = await identifyDecisionMakers(property, classification, ownership);
  const contactIdentificationMs = Date.now() - startIdentify;

  const identifiedContacts = identifyResult.data.contacts;
  console.log(`[FocusedEnrichment] Stage 3a took ${contactIdentificationMs}ms, identified ${identifiedContacts.length} contacts`);

  const startEnrich = Date.now();
  const latLng = propertyLatLng(property);
  const settledResults = await Promise.allSettled(
    identifiedContacts.map(contact => enrichContactDetails(contact, city, latLng))
  );
  const contactEnrichmentMs = Date.now() - startEnrich;

  const enrichmentResults: ContactEnrichmentResult[] = settledResults.map((result, idx) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`[FocusedEnrichment] Stage 3b failed for ${identifiedContacts[idx].name}: ${result.reason}`);
    return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
  });

  console.log(`[FocusedEnrichment] Stage 3b took ${contactEnrichmentMs}ms for ${identifiedContacts.length} contacts`);

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

  for (const c of rawContacts) {
    if (!c.companyDomain && c.email && c.company) {
      const emailDomain = c.email.split('@')[1]?.toLowerCase();
      if (emailDomain && !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com', 'ymail.com'].includes(emailDomain)) {
        console.log(`[FocusedEnrichment] Email domain fallback: "${c.name}" (${c.company}) → ${emailDomain} from validated email`);
        c.companyDomain = emailDomain;
      }
    }
  }

  if (!ownership.managementCompany?.domain && ownership.managementCompany?.name) {
    const mgmtNameNorm = ownership.managementCompany.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const c of rawContacts) {
      if (c.email && c.company) {
        const contactCompanyNorm = c.company.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (contactCompanyNorm.includes(mgmtNameNorm) || mgmtNameNorm.includes(contactCompanyNorm)) {
          const emailDomain = c.email.split('@')[1]?.toLowerCase();
          if (emailDomain && !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com', 'ymail.com'].includes(emailDomain)) {
            console.log(`[FocusedEnrichment] Email domain fallback for mgmt company "${ownership.managementCompany.name}" → ${emailDomain} from ${c.name}'s email`);
            ownership.managementCompany.domain = emailDomain;
            break;
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

  const knownCompanies = [
    ownership.managementCompany?.name,
    ownership.beneficialOwner?.name,
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
          c.roleConfidence = Math.min(c.roleConfidence, 0.5);
        }
      }
    }
  }

  const propertyPhone = ownership.propertyPhone?.replace(/\D/g, '') || null;
  if (propertyPhone) {
    for (const c of contacts) {
      if (c.phone && c.phone.replace(/\D/g, '') === propertyPhone) {
        console.warn(`[FocusedEnrichment] Phone cross-validation: ${c.name}'s phone matches propertyPhone — labeling as office`);
        c.phoneLabel = 'office';
        c.phoneConfidence = Math.min(c.phoneConfidence ?? 0.5, 0.4);
      }
    }
  }

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
          c.phoneConfidence = Math.min(c.phoneConfidence ?? 0.5, 0.5);
        }
      }
    }
  }

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
