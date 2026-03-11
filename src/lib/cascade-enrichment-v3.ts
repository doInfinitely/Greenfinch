// ============================================================================
// Cascade Enrichment V3 — Unified Contact & Organization Enrichment
//
// Improvements over V2:
//   1. AI-discovered emails get verified via Findymail before storing
//   2. Explicit phone enrichment stage (Findymail phone + Hunter phone)
//   3. Full-result caching per contact key (7d TTL) — same PM company
//      contacts across 50-200 properties skip the entire waterfall
//   4. Uses all the per-service caches added in Phase 2
//
// Returns the same ContactEnrichmentResult / OrganizationEnrichmentResult
// interface shape as V1/V2 for queue compatibility.
// ============================================================================

import type {
  ContactEnrichmentInput,
  ContactEnrichmentResult,
  OrganizationEnrichmentResult,
  ConfidenceFlag,
  EmailSource,
} from './cascade-enrichment';
import { enrichPersonSerpAI } from './serp-person-enrichment';
import { enrichCompanySerpAI } from './serp-company-enrichment';
import { enrichPersonPDL } from './pdl';
import { verifyEmployment } from './browser-employment-verification';
import { verifyEmail as verifyEmailFindymail, findEmailByName, findLinkedInByEmail } from './findymail';
import { findEmail as findEmailHunter } from './hunter';
import { searchLinkedInProfile } from './serp-linkedin';
import { enrichPhone } from './phone-enrichment';
import { normalizeDomain } from './normalization';
import { validateLinkedInSlug } from './linkedin-validation';
import { parseFullName, getEmployeeRange } from './utils';
import { cacheGet, cacheSet } from './redis';

const CONTACT_CASCADE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const CONTACT_CASCADE_NEGATIVE_TTL = 24 * 60 * 60; // 24 hours

// ============================================================================
// Contact Enrichment V3
// ============================================================================

/**
 * Build a cache key for the full contact cascade result.
 * Same person at same company → same key → cache hit.
 */
function contactCascadeCacheKey(input: ContactEnrichmentInput): string {
  const { firstName, lastName } = parseFullName(input.fullName);
  const domain = input.companyDomain ? normalizeDomain(input.companyDomain) : '';
  return `cascade-contact:${firstName.toLowerCase()}|${lastName.toLowerCase()}|${domain}`;
}

/**
 * Enrich a contact using the V3 unified cascade pipeline.
 *
 * Stages:
 *   1. Input validation + email discovery (Findymail + Hunter)
 *   1b. AI email verification — NEW: verify AI-discovered emails via Findymail
 *   2. Person match via SerpAPI + LLM
 *   2b. PDL email/phone/LinkedIn supplement (cached)
 *   3. LinkedIn discovery via SERP
 *   4. Employment verification via browser-use
 *   5. Phone enrichment — NEW: Findymail phone + Hunter phone waterfall
 *   6. Confidence flag assignment
 */
export async function enrichContactCascadeV3(
  input: ContactEnrichmentInput
): Promise<ContactEnrichmentResult> {
  const result = createEmptyContactResult();
  result.fullName = input.fullName;

  const { firstName, lastName } = parseFullName(input.fullName);
  result.firstName = firstName;
  result.lastName = lastName;

  if (!lastName) {
    console.log(`[CascadeV3] Skipping "${input.fullName}" — no last name`);
    result.confidenceFlag = 'insufficient_input';
    return result;
  }

  // Check full-result cache
  const cacheKey = contactCascadeCacheKey(input);
  const cached = await cacheGet<ContactEnrichmentResult>(cacheKey);
  if (cached) {
    console.log(`[CascadeV3] Full cascade cache hit: "${input.fullName}" @ ${input.companyDomain}`);
    return cached;
  }

  const inputDomain = input.companyDomain ? normalizeDomain(input.companyDomain) : null;

  // -- Stage 1: Email Discovery (Findymail + Hunter) --------------------------
  let emailSource: EmailSource = null;

  if (input.email) {
    try {
      const verifyResult = await verifyEmailFindymail(input.email);
      if (verifyResult.success && verifyResult.status === 'valid') {
        result.email = input.email;
        result.emailVerified = true;
        result.emailSource = 'input_verified';
        result.emailStatus = 'valid';
        emailSource = 'input_verified';
        result.findymailVerified = true;
        result.findymailVerifyStatus = verifyResult.status;
      } else {
        result.emailSource = 'input_invalid';
        result.findymailVerified = false;
        result.findymailVerifyStatus = verifyResult.status || 'invalid';
      }
    } catch (err) {
      console.warn(`[CascadeV3] Findymail verify failed for ${input.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Try Findymail finder if no verified email
  if (!result.email && inputDomain) {
    try {
      const fmResult = await findEmailByName(firstName, lastName, inputDomain);
      if (fmResult.email) {
        result.email = fmResult.email;
        result.emailVerified = true;
        result.emailSource = 'findymail_finder';
        result.emailStatus = 'valid';
        emailSource = 'findymail_finder';
      }
    } catch (err) {
      console.warn(`[CascadeV3] Findymail finder failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Try Hunter if still no email
  if (!result.email && inputDomain) {
    try {
      const hunterResult = await findEmailHunter(firstName, lastName, inputDomain, { clerkOrgId: input.clerkOrgId });
      if (hunterResult.email) {
        try {
          const verifyResult = await verifyEmailFindymail(hunterResult.email);
          if (verifyResult.success && verifyResult.status === 'valid') {
            result.email = hunterResult.email;
            result.emailVerified = true;
            result.emailSource = 'hunter_finder';
            result.emailStatus = 'valid';
            emailSource = 'hunter_finder';
          }
        } catch {
          result.email = hunterResult.email;
          result.emailSource = 'hunter_finder';
          result.emailStatus = 'unknown';
          emailSource = 'hunter_finder';
        }
      }
    } catch (err) {
      console.warn(`[CascadeV3] Hunter finder failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Try reverse email → LinkedIn
  if (result.email && !input.linkedinUrl) {
    try {
      const reverseResult = await findLinkedInByEmail(result.email);
      if (reverseResult.linkedinUrl) {
        if (validateLinkedInSlug(reverseResult.linkedinUrl, firstName, lastName)) {
          result.linkedinUrl = reverseResult.linkedinUrl;
        } else {
          result.linkedinRejectedUrl = reverseResult.linkedinUrl;
          result.linkedinRejectedSource = 'findymail_reverse';
        }
      }
    } catch {
      // Non-critical
    }
  } else if (input.linkedinUrl) {
    result.linkedinUrl = input.linkedinUrl;
  }

  // -- Stage 2: Person Match (SerpAPI + LLM) ----------------------------------
  try {
    const serpPerson = await enrichPersonSerpAI(
      firstName,
      lastName,
      input.companyName || null,
      inputDomain,
      { location: input.location || undefined, title: input.title || undefined, clerkOrgId: input.clerkOrgId }
    );

    if (serpPerson.found) {
      result.found = true;
      result.enrichmentSource = 'ai';
      result.enrichedAt = new Date();
      result.title = serpPerson.title || result.title || input.title || null;
      result.company = serpPerson.company || input.companyName || null;
      result.companyDomain = serpPerson.domain || inputDomain;
      result.location = serpPerson.location || input.location || null;

      // Stage 1b: AI email verification — verify AI-discovered emails
      if (!result.email && serpPerson.email) {
        try {
          const verifyResult = await verifyEmailFindymail(serpPerson.email);
          if (verifyResult.success && verifyResult.status === 'valid') {
            result.email = serpPerson.email;
            result.emailVerified = true;
            result.emailSource = null;
            result.emailStatus = 'valid';
          } else {
            // Store unverified — downstream can decide
            result.email = serpPerson.email;
            result.emailSource = null;
            result.emailStatus = verifyResult.status || 'unknown';
          }
        } catch {
          result.email = serpPerson.email;
          result.emailSource = null;
          result.emailStatus = 'unknown';
        }
      }

      if (!result.linkedinUrl && serpPerson.linkedinUrl) {
        if (validateLinkedInSlug(serpPerson.linkedinUrl, firstName, lastName)) {
          result.linkedinUrl = serpPerson.linkedinUrl;
        } else {
          result.linkedinRejectedUrl = serpPerson.linkedinUrl;
          result.linkedinRejectedSource = 'serp_person';
        }
      }

      if (serpPerson.phone) {
        result.phone = serpPerson.phone;
      }
    }
  } catch (err) {
    console.warn(`[CascadeV3] SerpAPI person enrichment failed: ${err instanceof Error ? err.message : err}`);
  }

  // -- Stage 2b: PDL Email/Phone Supplement (cached) --------------------------
  if (inputDomain && lastName) {
    try {
      const pdlResult = await enrichPersonPDL(firstName, lastName, inputDomain, {
        companyName: input.companyName || result.company || undefined,
        location: input.location || result.location || undefined,
        email: result.email || input.email || undefined,
        linkedinUrl: result.linkedinUrl || input.linkedinUrl || undefined,
        clerkOrgId: input.clerkOrgId,
      });

      if (pdlResult.found) {
        // Store PDL metadata
        result.pdlRaw = pdlResult.raw ?? null;
        result.pdlFullName = pdlResult.fullName;
        result.pdlWorkEmail = pdlResult.workEmail;
        result.pdlEmailsJson = pdlResult.emailsJson;
        result.pdlPersonalEmails = pdlResult.personalEmails;
        result.pdlPhonesJson = pdlResult.phonesJson;
        result.pdlMobilePhone = pdlResult.mobilePhone;
        result.pdlLinkedinUrl = pdlResult.linkedinUrl;
        result.pdlTitle = pdlResult.title;
        result.pdlCompany = pdlResult.companyName;
        result.pdlCompanyDomain = pdlResult.companyDomain;
        result.pdlTitleRole = pdlResult.titleRole;
        result.pdlTitleLevels = pdlResult.titleLevels;
        result.pdlTitleClass = pdlResult.titleClass;
        result.pdlTitleSubRole = pdlResult.titleSubRole;
        result.pdlLocation = pdlResult.location;
        result.pdlCity = pdlResult.city;
        result.pdlState = pdlResult.state;
        result.pdlAddressesJson = pdlResult.addressesJson;
        result.pdlIndustry = pdlResult.industry;
        result.pdlGender = pdlResult.gender;
        result.pdlDatasetVersion = pdlResult.datasetVersion;
        result.companyPdlId = pdlResult.companyPdlId;

        // Fill email from PDL if still missing
        if (!result.email && pdlResult.workEmail) {
          result.email = pdlResult.workEmail;
          result.emailSource = null;
          result.emailStatus = 'unknown';
        } else if (!result.email && pdlResult.email) {
          result.email = pdlResult.email;
          result.emailSource = null;
          result.emailStatus = 'unknown';
        }

        // Fill phones from PDL
        if (!result.phone) {
          result.phone = pdlResult.mobilePhone || null;
          if (!result.phone && pdlResult.phonesJson?.length) {
            result.phone = pdlResult.phonesJson[0]?.number || null;
          }
        }
        result.mobilePhone = result.mobilePhone || pdlResult.mobilePhone || null;

        // Fill LinkedIn from PDL
        if (!result.linkedinUrl && pdlResult.linkedinUrl) {
          if (validateLinkedInSlug(pdlResult.linkedinUrl, firstName, lastName)) {
            result.linkedinUrl = pdlResult.linkedinUrl;
          } else {
            result.linkedinRejectedUrl = pdlResult.linkedinUrl;
            result.linkedinRejectedSource = 'pdl';
          }
        }

        if (!result.photoUrl && pdlResult.photoUrl) {
          result.photoUrl = pdlResult.photoUrl;
        }

        if (!result.found) {
          result.found = true;
          result.enrichmentSource = 'pdl';
          result.enrichedAt = new Date();
          result.title = result.title || pdlResult.title;
          result.company = result.company || pdlResult.companyName || input.companyName || null;
          result.companyDomain = result.companyDomain || pdlResult.companyDomain || inputDomain;
          result.location = result.location || pdlResult.location || input.location || null;
        }
      }
    } catch (err) {
      console.warn(`[CascadeV3] PDL person enrichment failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -- Stage 3: LinkedIn Discovery (SERP fallback) ----------------------------
  if (!result.linkedinUrl) {
    try {
      const serpLinkedIn = await searchLinkedInProfile(
        firstName,
        lastName,
        input.companyName || result.company || null,
        input.location || result.location || null,
        { clerkOrgId: input.clerkOrgId }
      );
      if (serpLinkedIn.found && serpLinkedIn.linkedinUrl) {
        if (validateLinkedInSlug(serpLinkedIn.linkedinUrl, firstName, lastName)) {
          result.linkedinUrl = serpLinkedIn.linkedinUrl;
        } else {
          result.linkedinRejectedUrl = serpLinkedIn.linkedinUrl;
          result.linkedinRejectedSource = 'serp_search';
        }
      }
    } catch (err) {
      console.warn(`[CascadeV3] SERP LinkedIn search failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -- Stage 4: Employment Verification (browser-use) -------------------------
  if (result.linkedinUrl && inputDomain) {
    try {
      const verification = await verifyEmployment(
        result.linkedinUrl,
        input.companyName || result.company,
        inputDomain
      );

      if (verification.verified) {
        if (verification.currentTitle) result.title = verification.currentTitle;
        if (verification.currentEmployer) result.company = verification.currentEmployer;
        if (verification.hasJobChange) {
          result.employerLeftDetected = true;
          result.employerLeftReason = `browser-use: now at ${verification.currentEmployer}`;
        }
      }
    } catch (err) {
      console.warn(`[CascadeV3] Employment verification failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -- Stage 5: Phone Enrichment (NEW) ----------------------------------------
  if (!result.phone) {
    try {
      const phoneResult = await enrichPhone({
        existingPhone: result.phone || result.mobilePhone,
        linkedinUrl: result.linkedinUrl,
        firstName,
        lastName,
        domain: result.companyDomain || inputDomain || undefined,
      });

      if (phoneResult.found && phoneResult.phone) {
        result.phone = phoneResult.phone;
        // If we got multiple phones, use the first as mobile
        if (phoneResult.phones.length > 1 && !result.mobilePhone) {
          result.mobilePhone = phoneResult.phones[0].phone;
        }
      }
    } catch (err) {
      console.warn(`[CascadeV3] Phone enrichment failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -- Stage 6: Confidence Flag -----------------------------------------------
  result.confidenceFlag = assignConfidenceFlag(result, emailSource);

  console.log(`[CascadeV3] Contact "${input.fullName}" → ${result.confidenceFlag} | email=${result.email || 'none'} | phone=${result.phone || 'none'} | linkedin=${result.linkedinUrl || 'none'}`);

  // Cache full result (strip raw fields)
  const { pdlRaw: _pr, crustdataRaw: _cr, ...cacheable } = result;
  const ttl = result.found ? CONTACT_CASCADE_CACHE_TTL : CONTACT_CASCADE_NEGATIVE_TTL;
  await cacheSet(cacheKey, cacheable, ttl);

  return result;
}

function assignConfidenceFlag(
  result: ContactEnrichmentResult,
  emailSource: EmailSource
): ConfidenceFlag {
  if (result.employerLeftDetected) return 'unverified';
  if (result.found && result.emailVerified) return 'verified';
  if (result.found && result.enrichmentSource === 'pdl') return 'pdl_matched';
  if (result.found) return 'search_matched' as ConfidenceFlag;
  if (result.email && emailSource) return 'email_only';
  return 'no_match';
}

function createEmptyContactResult(): ContactEnrichmentResult {
  return {
    found: false,
    providerId: null,
    enrichmentSource: null,
    enrichedAt: null,
    confidenceFlag: 'no_match',
    fullName: null,
    firstName: null,
    lastName: null,
    email: null,
    emailSource: null,
    emailVerified: false,
    emailStatus: null,
    phone: null,
    mobilePhone: null,
    workPhone: null,
    title: null,
    company: null,
    companyDomain: null,
    companyPdlId: null,
    linkedinUrl: null,
    location: null,
    photoUrl: null,
    seniority: null,
    findymailVerified: null,
    findymailVerifyStatus: null,
    pdlRaw: null,
    crustdataRaw: null,
    pdlFullName: null,
    pdlWorkEmail: null,
    pdlEmailsJson: null,
    pdlPersonalEmails: null,
    pdlPhonesJson: null,
    pdlMobilePhone: null,
    pdlLinkedinUrl: null,
    pdlTitle: null,
    pdlCompany: null,
    pdlCompanyDomain: null,
    pdlTitleRole: null,
    pdlTitleLevels: null,
    pdlTitleClass: null,
    pdlTitleSubRole: null,
    pdlLocation: null,
    pdlCity: null,
    pdlState: null,
    pdlAddressesJson: null,
    pdlIndustry: null,
    pdlGender: null,
    pdlDatasetVersion: null,
    crustdataTitle: null,
    crustdataCompany: null,
    crustdataCompanyDomain: null,
    crustdataWorkEmail: null,
    crustdataLinkedinUrl: null,
    crustdataProfilePictureUrl: null,
    crustdataLocation: null,
    crustdataPersonId: null,
    crustdataEnriched: false,
    employerLeftDetected: false,
    employerLeftReason: null,
    linkedinRejectedUrl: null,
    linkedinRejectedSource: null,
  };
}

// ============================================================================
// Organization Enrichment V3
// ============================================================================

/**
 * Enrich an organization using SerpAPI + LLM (same as V2, with caching).
 */
export async function enrichOrganizationCascadeV3(
  domain: string,
  options: {
    name?: string;
    locality?: string;
    region?: string;
    clerkOrgId?: string;
  } = {}
): Promise<OrganizationEnrichmentResult> {
  const empty = createEmptyOrgResult();
  if (!domain && !options.name) return empty;

  try {
    const serpCompany = await enrichCompanySerpAI(domain, { ...options, clerkOrgId: options.clerkOrgId });
    if (!serpCompany.found) return empty;

    return {
      found: true,
      providerId: null,
      enrichmentSource: null,
      enrichedAt: new Date(),
      pdlCompanyId: null,
      affiliatedProfiles: null,
      alternativeDomains: null,
      datasetVersion: null,
      name: serpCompany.name,
      description: serpCompany.description,
      industry: serpCompany.industry,
      employeeCount: serpCompany.employeeCount,
      employeesRange: serpCompany.employeeRange || (serpCompany.employeeCount ? getEmployeeRange(serpCompany.employeeCount) : null),
      foundedYear: serpCompany.founded,
      city: serpCompany.location?.split(',')[0]?.trim() || null,
      state: serpCompany.location?.split(',')[1]?.trim() || null,
      country: 'US',
      website: serpCompany.website,
      linkedinUrl: serpCompany.linkedinUrl,
      twitterUrl: null,
      facebookUrl: null,
      logoUrl: null,
      phone: serpCompany.phone,
      sicCodes: null,
      naicsCodes: null,
      tags: null,
      parentDomain: serpCompany.parentCompanyDomain || null,
      ultimateParentDomain: null,
      pdlRaw: null,
      crustdataRaw: null,
    };
  } catch (error) {
    console.error(`[CascadeV3] Organization enrichment failed for ${domain}: ${error instanceof Error ? error.message : error}`);
    return empty;
  }
}

function createEmptyOrgResult(): OrganizationEnrichmentResult {
  return {
    found: false,
    providerId: null,
    enrichmentSource: null,
    enrichedAt: null,
    pdlCompanyId: null,
    affiliatedProfiles: null,
    alternativeDomains: null,
    datasetVersion: null,
    name: null,
    description: null,
    industry: null,
    employeeCount: null,
    employeesRange: null,
    foundedYear: null,
    city: null,
    state: null,
    country: null,
    website: null,
    linkedinUrl: null,
    twitterUrl: null,
    facebookUrl: null,
    logoUrl: null,
    phone: null,
    sicCodes: null,
    naicsCodes: null,
    tags: null,
    parentDomain: null,
    ultimateParentDomain: null,
    pdlRaw: null,
    crustdataRaw: null,
  };
}
