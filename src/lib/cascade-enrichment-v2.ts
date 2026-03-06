// ============================================================================
// Cascade Enrichment V2 — SerpAPI + browser-use Pipeline
//
// Replaces PDL, Crustdata, and EnrichLayer with:
//   - SerpAPI web search + LLM extraction for person/company data
//   - browser-use LinkedIn scraping for employment verification
//   - Keeps Hunter + Findymail for email discovery/verification
//
// Returns the same ContactEnrichmentResult / OrganizationEnrichmentResult
// interface shape as V1 for compatibility, with provider-specific fields
// set to null for deprecated providers.
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
import { verifyEmployment } from './browser-employment-verification';
import { verifyEmail as verifyEmailFindymail, findEmailByName, findLinkedInByEmail } from './findymail';
import { findEmail as findEmailHunter } from './hunter';
import { searchLinkedInProfile } from './serp-linkedin';
import { normalizeDomain } from './normalization';
import { validateLinkedInSlug } from './linkedin-validation';
import { parseFullName, getEmployeeRange } from './utils';

// ============================================================================
// Contact Enrichment V2
// ============================================================================

/**
 * Enrich a contact using the new SerpAPI + browser-use cascade pipeline.
 *
 * Five stages:
 *   1. Input validation + email discovery (Findymail + Hunter — unchanged)
 *   2. Person match via SerpAPI + LLM (replaces PDL)
 *   3. LinkedIn discovery via SERP (unchanged)
 *   4. Employment verification via browser-use (replaces Crustdata)
 *   5. Confidence flag assignment
 */
export async function enrichContactCascadeV2(
  input: ContactEnrichmentInput
): Promise<ContactEnrichmentResult> {
  const result = createEmptyContactResult();
  result.fullName = input.fullName;

  const { firstName, lastName } = parseFullName(input.fullName);
  result.firstName = firstName;
  result.lastName = lastName;

  // Skip contacts with insufficient name data
  if (!lastName) {
    console.log(`[CascadeV2] Skipping "${input.fullName}" — no last name`);
    result.confidenceFlag = 'insufficient_input';
    return result;
  }

  const inputDomain = input.companyDomain ? normalizeDomain(input.companyDomain) : null;

  // -- Stage 1: Email Discovery (Findymail + Hunter — same as V1) -----------
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
      console.warn(`[CascadeV2] Findymail verify failed for ${input.email}: ${err instanceof Error ? err.message : err}`);
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
      console.warn(`[CascadeV2] Findymail finder failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Try Hunter if still no email
  if (!result.email && inputDomain) {
    try {
      const hunterResult = await findEmailHunter(firstName, lastName, inputDomain);
      if (hunterResult.email) {
        // Re-verify with Findymail
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
          // Use unverified Hunter email
          result.email = hunterResult.email;
          result.emailSource = 'hunter_finder';
          result.emailStatus = 'unknown';
          emailSource = 'hunter_finder';
        }
      }
    } catch (err) {
      console.warn(`[CascadeV2] Hunter finder failed: ${err instanceof Error ? err.message : err}`);
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

  // -- Stage 2: Person Match (SerpAPI + LLM — replaces PDL) ----------------
  try {
    const serpPerson = await enrichPersonSerpAI(
      firstName,
      lastName,
      input.companyName || null,
      inputDomain,
      { location: input.location || undefined, title: input.title || undefined }
    );

    if (serpPerson.found) {
      result.found = true;
      result.enrichmentSource = 'ai';
      result.enrichedAt = new Date();
      result.title = serpPerson.title || result.title || input.title || null;
      result.company = serpPerson.company || input.companyName || null;
      result.companyDomain = serpPerson.domain || inputDomain;
      result.location = serpPerson.location || input.location || null;

      // Set email from SERP if we don't already have one
      if (!result.email && serpPerson.email) {
        result.email = serpPerson.email;
        result.emailSource = null; // AI-discovered, unverified
        result.emailStatus = 'unknown';
      }

      // Set LinkedIn from SERP if we don't already have one
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
    console.warn(`[CascadeV2] SerpAPI person enrichment failed: ${err instanceof Error ? err.message : err}`);
  }

  // -- Stage 3: LinkedIn Discovery (SERP fallback — same as V1) ------------
  if (!result.linkedinUrl) {
    try {
      const serpLinkedIn = await searchLinkedInProfile(
        firstName,
        lastName,
        input.companyName || result.company || null,
        input.location || result.location || null
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
      console.warn(`[CascadeV2] SERP LinkedIn search failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -- Stage 4: Employment Verification (browser-use — replaces Crustdata) -
  if (result.linkedinUrl && inputDomain) {
    try {
      const verification = await verifyEmployment(
        result.linkedinUrl,
        input.companyName || result.company,
        inputDomain
      );

      if (verification.verified) {
        if (verification.currentTitle) {
          result.title = verification.currentTitle;
        }
        if (verification.currentEmployer) {
          result.company = verification.currentEmployer;
        }
        if (verification.hasJobChange) {
          result.employerLeftDetected = true;
          result.employerLeftReason = `browser-use: now at ${verification.currentEmployer}`;
        }
      }
    } catch (err) {
      console.warn(`[CascadeV2] Employment verification failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -- Stage 5: Confidence Flag Assignment ----------------------------------
  result.confidenceFlag = assignConfidenceFlag(result, emailSource);

  console.log(`[CascadeV2] Contact "${input.fullName}" → ${result.confidenceFlag} | email=${result.email || 'none'} | linkedin=${result.linkedinUrl || 'none'}`);
  return result;
}

function assignConfidenceFlag(
  result: ContactEnrichmentResult,
  emailSource: EmailSource
): ConfidenceFlag {
  if (result.employerLeftDetected) return 'unverified';
  if (result.found && result.emailVerified) return 'verified';
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
    // Legacy PDL fields — null in V2
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
// Organization Enrichment V2
// ============================================================================

/**
 * Enrich an organization using SerpAPI + LLM (replaces PDL + Crustdata).
 * Returns the same OrganizationEnrichmentResult shape as V1.
 */
export async function enrichOrganizationCascadeV2(
  domain: string,
  options: {
    name?: string;
    locality?: string;
    region?: string;
  } = {}
): Promise<OrganizationEnrichmentResult> {
  const empty = createEmptyOrgResult();

  if (!domain && !options.name) return empty;

  try {
    const serpCompany = await enrichCompanySerpAI(domain, options);

    if (!serpCompany.found) return empty;

    return {
      found: true,
      providerId: null,
      enrichmentSource: null, // No legacy provider
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
      pdlRaw: null,
      crustdataRaw: null,
    };
  } catch (error) {
    console.error(`[CascadeV2] Organization enrichment failed for ${domain}: ${error instanceof Error ? error.message : error}`);
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
    pdlRaw: null,
    crustdataRaw: null,
  };
}
