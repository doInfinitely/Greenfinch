/**
 * Cascade Enrichment Service
 * 
 * Contact Pipeline (5 stages):
 *   Stage 1: Input Validation
 *   Stage 2: Email & LinkedIn Discovery (Findymail Verify → Findymail Finder → Hunter Finder → Findymail Reverse Email)
 *   Stage 3: PDL Person Enrichment
 *   Stage 3.5: SERP LinkedIn Discovery (Google search fallback when no LinkedIn found)
 *   Stage 4: Crustdata Verification (conditional — when PDL domain != input domain)
 * 
 * Organization Pipeline (2 stages):
 *   Stage 1: PDL Company Enrichment
 *   Stage 2: Crustdata Company Enrichment (verification/supplementation)
 * 
 * Key behaviors:
 * - Store raw API responses (pdl_raw_response, crustdata_raw_response) for auditability
 * - Confidence flags: "verified" | "pdl_matched" | "unverified" | "email_only"
 * - Domain alias/fuzzy comparison for Crustdata trigger condition
 * - Skip contacts with only a first name (no last name)
 */

import { enrichCompanyPDL, enrichPersonPDL } from './pdl';
import { enrichPersonCrustdata, enrichCompanyCrustdata } from './crustdata';
import { verifyEmail as verifyEmailFindymail, findEmailByName, findLinkedInByEmail } from './findymail';
import { findEmail as findEmailHunter } from './hunter';
import { searchLinkedInProfile } from './serp-linkedin';

export type ConfidenceFlag = 'verified' | 'pdl_matched' | 'unverified' | 'email_only' | 'insufficient_input' | 'no_match';
export type EmailSource = 'input_verified' | 'input_invalid' | 'findymail_finder' | 'hunter_finder' | null;

export interface OrganizationEnrichmentResult {
  found: boolean;
  providerId: string | null;
  enrichmentSource: 'pdl' | 'crustdata' | null;
  enrichedAt: Date | null;
  
  name: string | null;
  description: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeesRange: string | null;
  foundedYear: number | null;
  
  city: string | null;
  state: string | null;
  country: string | null;
  
  website: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  facebookUrl: string | null;
  logoUrl: string | null;
  phone: string | null;
  
  sicCodes: string[] | null;
  naicsCodes: string[] | null;
  tags: string[] | null;
  
  pdlRaw: any;
  crustdataRaw: any;
}

export interface ContactEnrichmentInput {
  fullName: string;
  email?: string | null;
  companyDomain?: string | null;
  companyName?: string | null;
  title?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
}

export interface ContactEnrichmentResult {
  found: boolean;
  providerId: string | null;
  enrichmentSource: 'pdl' | 'crustdata' | 'findymail' | 'hunter' | 'ai' | null;
  enrichedAt: Date | null;
  confidenceFlag: ConfidenceFlag;
  
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  
  email: string | null;
  emailSource: EmailSource;
  emailVerified: boolean;
  emailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null;
  
  phone: string | null;
  mobilePhone: string | null;
  workPhone: string | null;
  title: string | null;
  
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  photoUrl: string | null;
  
  seniority: string | null;
  
  findymailVerified: boolean | null;
  findymailVerifyStatus: string | null;
  
  pdlRaw: any;
  crustdataRaw: any;
  
  pdlFullName: string | null;
  pdlWorkEmail: string | null;
  pdlEmailsJson: any[] | null;
  pdlPersonalEmails: string[] | null;
  pdlPhonesJson: any[] | null;
  pdlMobilePhone: string | null;
  pdlLinkedinUrl: string | null;
  pdlTitle: string | null;
  pdlCompany: string | null;
  pdlCompanyDomain: string | null;
  pdlTitleRole: string | null;
  pdlTitleLevels: string[] | null;
  pdlTitleClass: string | null;
  pdlTitleSubRole: string | null;
  pdlLocation: string | null;
  pdlCity: string | null;
  pdlState: string | null;
  pdlAddressesJson: any[] | null;
  pdlIndustry: string | null;
  pdlGender: string | null;
  pdlDatasetVersion: string | null;
  
  crustdataTitle: string | null;
  crustdataCompany: string | null;
  crustdataCompanyDomain: string | null;
  crustdataWorkEmail: string | null;
  crustdataLinkedinUrl: string | null;
  crustdataProfilePictureUrl: string | null;
  crustdataLocation: string | null;
  crustdataPersonId: number | null;
  crustdataEnriched: boolean;
  
  employerLeftDetected: boolean;
  employerLeftReason: string | null;
}

const DOMAIN_ALIASES: Record<string, string[]> = {
  'holtlunsford.com': ['hldallas.com'],
  'hldallas.com': ['holtlunsford.com'],
  '7-eleven.com': ['7-11.com'],
  '7-11.com': ['7-eleven.com'],
  'northparkcenter.com': ['northparkcntr.com'],
  'northparkcntr.com': ['northparkcenter.com'],
};

function normalizeDomainForComparison(domain: string): string {
  return domain.toLowerCase().trim().replace(/^www\./, '').replace(/\/$/, '');
}

function domainsMatch(domain1: string | null, domain2: string | null): boolean {
  if (!domain1 || !domain2) return false;
  const d1 = normalizeDomainForComparison(domain1);
  const d2 = normalizeDomainForComparison(domain2);
  
  if (d1 === d2) return true;
  
  const aliases1 = DOMAIN_ALIASES[d1] || [];
  if (aliases1.includes(d2)) return true;
  
  const aliases2 = DOMAIN_ALIASES[d2] || [];
  if (aliases2.includes(d1)) return true;
  
  const base1 = d1.replace(/\.(com|org|net|io|co|ai|app|dev)$/i, '');
  const base2 = d2.replace(/\.(com|org|net|io|co|ai|app|dev)$/i, '');
  if (base1 === base2 && base1.length > 3) return true;
  
  return false;
}

function normalizeCompanyForComparison(name: string | null | undefined): string {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(llc|llp|inc|corp|co|ltd|lp|group|holdings|partners|properties|management|company|enterprises|realty|real estate)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function companiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const normA = normalizeCompanyForComparison(a);
  const normB = normalizeCompanyForComparison(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  return false;
}

function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

function getEmployeeRange(count: number): string {
  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  if (count <= 200) return '51-200';
  if (count <= 500) return '201-500';
  if (count <= 1000) return '501-1000';
  if (count <= 5000) return '1001-5000';
  if (count <= 10000) return '5001-10000';
  return '10001+';
}

/**
 * Enrich an organization using PDL Company Enrichment API (primary),
 * with Crustdata as a fallback if PDL finds no match.
 */
export async function enrichOrganizationCascade(
  domain: string,
  options: { name?: string; linkedinUrl?: string } = {}
): Promise<OrganizationEnrichmentResult> {
  const normalizedDomain = domain.toLowerCase().trim().replace(/^www\./, '');
  console.log(`[CascadeEnrichment] Starting org enrichment (PDL → Crustdata fallback) for domain: ${normalizedDomain}`);
  
  const emptyResult: OrganizationEnrichmentResult = {
    found: false,
    providerId: null,
    enrichmentSource: null,
    enrichedAt: null,
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
  
  let pdlResult: any = null;
  
  try {
    console.log('[CascadeEnrichment] Stage 1: PDL Company Enrichment...');
    const pdl = await enrichCompanyPDL(normalizedDomain, {
      name: options.name,
      linkedinUrl: options.linkedinUrl,
    });
    
    if (pdl.found) {
      console.log(`[CascadeEnrichment] PDL found company: ${pdl.name}`);
      pdlResult = pdl;
    } else {
      console.log('[CascadeEnrichment] PDL: no match found');
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] PDL company enrichment failed:', error instanceof Error ? error.message : error);
  }
  
  if (pdlResult) {
    const result: OrganizationEnrichmentResult = {
      found: true,
      providerId: pdlResult.raw?.id || null,
      enrichmentSource: 'pdl',
      enrichedAt: new Date(),
      
      name: pdlResult.displayName || pdlResult.name || null,
      description: pdlResult.description || null,
      industry: pdlResult.industry || null,
      employeeCount: pdlResult.employeeCount || null,
      employeesRange: pdlResult.employeeRange || null,
      foundedYear: pdlResult.foundedYear || null,
      
      city: pdlResult.city || null,
      state: pdlResult.state || null,
      country: pdlResult.country || null,
      
      website: pdlResult.website || `https://${normalizedDomain}`,
      linkedinUrl: pdlResult.linkedinUrl || null,
      twitterUrl: pdlResult.twitterUrl || null,
      facebookUrl: pdlResult.facebookUrl || null,
      logoUrl: pdlResult.logoUrl || null,
      phone: pdlResult.phone || null,
      
      sicCodes: pdlResult.sicCode ? [pdlResult.sicCode] : null,
      naicsCodes: pdlResult.naicsCode ? [pdlResult.naicsCode] : null,
      tags: pdlResult.tags || null,
      
      pdlRaw: pdlResult.raw || null,
      crustdataRaw: null,
    };
    
    console.log(`[CascadeEnrichment] Org enrichment complete for ${normalizedDomain}: ${result.name} (pdl)`);
    return result;
  }
  
  let crustdataResult: any = null;
  try {
    console.log('[CascadeEnrichment] Stage 2 (fallback): Crustdata Company Enrichment...');
    const crustdata = await enrichCompanyCrustdata(normalizedDomain);
    
    if (crustdata.found) {
      console.log(`[CascadeEnrichment] Crustdata found company: ${crustdata.companyName}`);
      crustdataResult = crustdata;
    } else {
      console.log('[CascadeEnrichment] Crustdata: no match found');
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] Crustdata company enrichment failed:', error instanceof Error ? error.message : error);
  }
  
  if (!crustdataResult) {
    console.log(`[CascadeEnrichment] No provider found match for domain: ${normalizedDomain}`);
    return emptyResult;
  }
  
  const result: OrganizationEnrichmentResult = {
    found: true,
    providerId: null,
    enrichmentSource: 'crustdata',
    enrichedAt: new Date(),
    
    name: crustdataResult.companyName || null,
    description: crustdataResult.description || null,
    industry: crustdataResult.industry || null,
    employeeCount: crustdataResult.headcount || null,
    employeesRange: crustdataResult.headcount ? getEmployeeRange(crustdataResult.headcount) : null,
    foundedYear: crustdataResult.foundedYear || null,
    
    city: crustdataResult.city || null,
    state: crustdataResult.state || null,
    country: crustdataResult.country || null,
    
    website: `https://${normalizedDomain}`,
    linkedinUrl: crustdataResult.linkedinUrl || null,
    twitterUrl: null,
    facebookUrl: null,
    logoUrl: null,
    phone: null,
    
    sicCodes: null,
    naicsCodes: null,
    tags: null,
    
    pdlRaw: null,
    crustdataRaw: crustdataResult.raw || null,
  };
  
  console.log(`[CascadeEnrichment] Org enrichment complete for ${normalizedDomain}: ${result.name} (crustdata fallback)`);
  return result;
}

/**
 * Enrich a contact using the 5-stage pipeline:
 * Stage 1: Input Validation
 * Stage 2: Email & LinkedIn Discovery Waterfall (Findymail Verify → Findymail Finder → Hunter Finder → Findymail Reverse Email)
 * Stage 3: PDL Person Enrichment
 * Stage 3.5: SERP LinkedIn Discovery (Google search fallback when no LinkedIn found from prior stages)
 * Stage 4: Crustdata Verification (conditional)
 */
export async function enrichContactCascade(
  input: ContactEnrichmentInput,
): Promise<ContactEnrichmentResult> {
  const { fullName, email, companyDomain, companyName, title, location, linkedinUrl: existingLinkedin } = input;
  const { firstName, lastName } = parseFullName(fullName);
  
  console.log(`[CascadeEnrichment] Starting 5-stage contact enrichment for: ${fullName} (${email || 'no email'})`);
  
  // ═══════════════════════════════════════════════════════════════
  // STAGE 1: Input Validation
  // ═══════════════════════════════════════════════════════════════
  if (!lastName || lastName.trim() === '') {
    console.log(`[CascadeEnrichment] Single-name contact "${fullName}" — attempting best-effort enrichment`);

    if (companyDomain) {
      try {
        console.log(`[CascadeEnrichment] Trying PDL company search for "${firstName}" at ${companyDomain}`);
        const { enrichPersonPDL } = await import('./pdl');
        const pdlResult = await enrichPersonPDL(firstName, '', companyDomain, {
          companyName: companyName || undefined,
          location: location || undefined,
          email: email || undefined,
        });

        if (pdlResult.found) {
          const resolvedLastName = pdlResult.lastName || '';
          console.log(`[CascadeEnrichment] PDL resolved single-name "${fullName}" → ${pdlResult.firstName} ${resolvedLastName}`);

          const result = buildEmptyResult(
            `${pdlResult.firstName || firstName} ${resolvedLastName}`.trim(),
            pdlResult.firstName || firstName,
            resolvedLastName,
            'pdl_matched'
          );
          result.found = true;
          result.enrichmentSource = 'pdl';
          result.enrichedAt = new Date();
          result.email = pdlResult.workEmail || email || null;
          result.emailSource = pdlResult.workEmail ? 'findymail_finder' : (email ? 'input_verified' : null);
          result.phone = pdlResult.mobilePhone || null;
          result.mobilePhone = pdlResult.mobilePhone || null;
          result.title = pdlResult.title || title || null;
          result.company = pdlResult.companyName || companyName || null;
          result.companyDomain = pdlResult.companyDomain || companyDomain || null;
          result.linkedinUrl = pdlResult.linkedinUrl || null;
          result.location = pdlResult.location || location || null;
          result.pdlRaw = pdlResult.raw || null;
          result.pdlFullName = pdlResult.fullName || null;
          result.pdlWorkEmail = pdlResult.workEmail || null;
          result.pdlMobilePhone = pdlResult.mobilePhone || null;
          result.pdlLinkedinUrl = pdlResult.linkedinUrl || null;
          result.pdlTitle = pdlResult.title || null;
          result.pdlCompany = pdlResult.companyName || null;
          result.pdlCompanyDomain = pdlResult.companyDomain || null;
          result.pdlLocation = pdlResult.location || null;
          result.pdlCity = pdlResult.city || null;
          result.pdlState = pdlResult.state || null;
          result.pdlIndustry = pdlResult.industry || null;
          result.pdlGender = pdlResult.gender || null;
          return result;
        }
      } catch (err) {
        console.warn(`[CascadeEnrichment] PDL lookup failed for single-name "${fullName}":`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[CascadeEnrichment] Could not resolve single-name "${fullName}" — insufficient input`);
    return buildEmptyResult(fullName, firstName, lastName, 'insufficient_input');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STAGE 2: Email & LinkedIn Discovery Waterfall
  // ═══════════════════════════════════════════════════════════════
  console.log('[CascadeEnrichment] Stage 2: Email & LinkedIn Discovery...');
  
  let verifiedEmail: string | null = null;
  let emailSource: EmailSource = null;
  let emailVerified = false;
  let emailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null = null;
  let foundLinkedin: string | null = existingLinkedin || null;
  let findymailVerified: boolean | null = null;
  let findymailVerifyStatus: string | null = null;
  
  // Step 2.1 — Validate Existing Email (Findymail Verify)
  if (email) {
    try {
      console.log(`[CascadeEnrichment] Step 2.1: Validating existing email with Findymail: ${email}`);
      const verifyResult = await verifyEmailFindymail(email);
      findymailVerified = verifyResult.status === 'valid';
      findymailVerifyStatus = verifyResult.rawStatus || verifyResult.status;
      
      if (verifyResult.status === 'valid') {
        verifiedEmail = email;
        emailSource = 'input_verified';
        emailVerified = true;
        emailStatus = 'valid';
        console.log(`[CascadeEnrichment] Email verified: ${email}`);
      } else {
        emailSource = 'input_invalid';
        emailStatus = verifyResult.status;
        console.log(`[CascadeEnrichment] Email ${verifyResult.status}: ${email}, continuing discovery...`);
      }
    } catch (error) {
      console.warn('[CascadeEnrichment] Findymail verify failed:', error);
      emailSource = 'input_invalid';
      emailStatus = 'unknown';
    }
  }
  
  // Step 2.2 — Find Email via Findymail (if no valid email yet)
  if (!emailVerified && companyDomain) {
    try {
      console.log(`[CascadeEnrichment] Step 2.2: Finding email via Findymail for ${firstName} ${lastName} @ ${companyDomain}`);
      const findResult = await findEmailByName(firstName, lastName, companyDomain);
      
      if (findResult.found && findResult.email) {
        verifiedEmail = findResult.email;
        emailSource = 'findymail_finder';
        emailVerified = true;
        emailStatus = 'valid';
        console.log(`[CascadeEnrichment] Findymail found email: ${findResult.email}`);
        
        if (findResult.linkedinUrl && !foundLinkedin) {
          foundLinkedin = findResult.linkedinUrl;
          console.log(`[CascadeEnrichment] Findymail also found LinkedIn: ${foundLinkedin}`);
        }
      } else {
        console.log('[CascadeEnrichment] Findymail finder: no email found');
      }
    } catch (error) {
      console.warn('[CascadeEnrichment] Findymail finder failed:', error);
    }
  }
  
  // Step 2.3 — Find Email via Hunter.io (if still no valid email)
  if (!emailVerified && companyDomain) {
    try {
      console.log(`[CascadeEnrichment] Step 2.3: Finding email via Hunter for ${firstName} ${lastName} @ ${companyDomain}`);
      const hunterResult = await findEmailHunter(firstName, lastName, companyDomain);
      
      if (hunterResult.email && hunterResult.confidence >= 0.7) {
        console.log(`[CascadeEnrichment] Hunter found email: ${hunterResult.email} (confidence: ${hunterResult.confidence})`);
        
        try {
          const reVerify = await verifyEmailFindymail(hunterResult.email);
          if (reVerify.status === 'valid') {
            verifiedEmail = hunterResult.email;
            emailSource = 'hunter_finder';
            emailVerified = true;
            emailStatus = 'valid';
            findymailVerified = true;
            findymailVerifyStatus = reVerify.rawStatus || 'valid';
          } else {
            verifiedEmail = hunterResult.email;
            emailSource = 'hunter_finder';
            emailVerified = false;
            emailStatus = reVerify.status;
            findymailVerified = false;
            findymailVerifyStatus = reVerify.rawStatus || reVerify.status;
          }
        } catch {
          verifiedEmail = hunterResult.email;
          emailSource = 'hunter_finder';
          emailVerified = false;
          emailStatus = 'unknown';
        }
      } else {
        console.log('[CascadeEnrichment] Hunter finder: no email found');
      }
    } catch (error) {
      console.warn('[CascadeEnrichment] Hunter finder failed:', error);
    }
  }
  
  // Step 2.4 — LinkedIn Reverse Lookup (Findymail) if we have any email but no LinkedIn
  const emailForReverseLookup = verifiedEmail || email;
  if (emailForReverseLookup && !foundLinkedin) {
    try {
      console.log(`[CascadeEnrichment] Step 2.4: Reverse email lookup for LinkedIn via Findymail: ${emailForReverseLookup}`);
      const reverseResult = await findLinkedInByEmail(emailForReverseLookup);
      
      if (reverseResult.found && reverseResult.linkedinUrl) {
        foundLinkedin = reverseResult.linkedinUrl;
        console.log(`[CascadeEnrichment] Found LinkedIn via reverse email: ${foundLinkedin}`);
      } else {
        console.log('[CascadeEnrichment] Reverse email: no LinkedIn found');
      }
    } catch (error) {
      console.warn('[CascadeEnrichment] Findymail reverse email failed:', error);
    }
  }
  
  console.log(`[CascadeEnrichment] Stage 2 complete — email: ${verifiedEmail || 'none'} (${emailSource}), linkedin: ${foundLinkedin || 'none'}`);
  
  // ═══════════════════════════════════════════════════════════════
  // STAGE 3: PDL Person Enrichment
  // ═══════════════════════════════════════════════════════════════
  console.log('[CascadeEnrichment] Stage 3: PDL Person Enrichment...');
  
  let pdlData: any = null;
  
  try {
    const pdlResult = await enrichPersonPDL(firstName, lastName, companyDomain || '', {
      location: location || undefined,
      companyName: companyName || undefined,
      email: verifiedEmail || email || undefined,
      linkedinUrl: foundLinkedin || undefined,
    });
    
    if (pdlResult.found) {
      console.log(`[CascadeEnrichment] PDL found: ${pdlResult.fullName} at ${pdlResult.companyName} (${pdlResult.companyDomain})`);
      pdlData = pdlResult;
      
      if (!foundLinkedin && pdlResult.linkedinUrl) {
        foundLinkedin = pdlResult.linkedinUrl;
        console.log(`[CascadeEnrichment] PDL provided LinkedIn: ${foundLinkedin}`);
      }
    } else {
      console.log('[CascadeEnrichment] PDL: no match found');
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] PDL enrichment failed:', error instanceof Error ? error.message : error);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STAGE 3.5: SERP LinkedIn Discovery (fallback when no LinkedIn found)
  // ═══════════════════════════════════════════════════════════════
  if (!foundLinkedin) {
    console.log('[CascadeEnrichment] Stage 3.5: SERP LinkedIn Discovery (no LinkedIn from Findymail/Hunter/PDL)...');
    
    try {
      const serpResult = await searchLinkedInProfile(
        firstName,
        lastName,
        companyName || companyDomain || null
      );
      
      if (serpResult.found && serpResult.linkedinUrl) {
        foundLinkedin = serpResult.linkedinUrl;
        console.log(`[CascadeEnrichment] SERP found LinkedIn: ${foundLinkedin} (confidence: ${serpResult.confidence})`);
      } else {
        console.log('[CascadeEnrichment] SERP LinkedIn: no match found');
      }
    } catch (error) {
      console.warn('[CascadeEnrichment] SERP LinkedIn search failed:', error instanceof Error ? error.message : error);
    }
  } else {
    console.log(`[CascadeEnrichment] Stage 3.5: Skipped — LinkedIn already found: ${foundLinkedin}`);
  }
  
  console.log(`[CascadeEnrichment] Pre-Crustdata state — linkedin: ${foundLinkedin || 'none'}, email: ${verifiedEmail || 'none'}`);
  
  // ═══════════════════════════════════════════════════════════════
  // STAGE 4: Crustdata Verification (Conditional)
  // ═══════════════════════════════════════════════════════════════
  let crustdataData: any = null;
  let confidenceFlag: ConfidenceFlag = 'no_match';
  let employerLeftDetected = false;
  let employerLeftReason: string | null = null;
  
  const pdlHasCompany = pdlData && pdlData.companyName && pdlData.companyDomain;
  const pdlDomainMatches = pdlHasCompany ? domainsMatch(pdlData.companyDomain, companyDomain ?? null) : false;
  const pdlCompanyEmpty = pdlData && !pdlData.companyName;
  const shouldRunCrustdata = 
    !pdlDomainMatches || 
    !pdlData || 
    !pdlData.companyDomain ||
    pdlCompanyEmpty;
  
  if (shouldRunCrustdata && (foundLinkedin || verifiedEmail)) {
    const reason = pdlCompanyEmpty 
      ? 'PDL returned no current employer — checking Crustdata for employment history'
      : 'domain mismatch or PDL incomplete';
    console.log(`[CascadeEnrichment] Stage 4: Crustdata Verification (${reason})...`);
    
    try {
      const crustdataResult = await enrichPersonCrustdata({
        linkedinUrl: foundLinkedin || undefined,
        email: !foundLinkedin ? (verifiedEmail || undefined) : undefined,
      });
      
      if (crustdataResult.found) {
        console.log(`[CascadeEnrichment] Crustdata verified: ${crustdataResult.title} at ${crustdataResult.companyName}`);
        crustdataData = crustdataResult;
        confidenceFlag = 'verified';
        
        if (companyDomain || companyName) {
          const crustdataCurrentCompanyMatches = 
            domainsMatch(crustdataResult.companyDomain, companyDomain ?? null) ||
            companiesMatch(crustdataResult.companyName, companyName ?? null);
          
          if (!crustdataCurrentCompanyMatches) {
            const wasEmployedThere = crustdataResult.experiences.some(exp => {
              if (exp.isCurrent) return false;
              const nameMatch = companiesMatch(exp.companyName, companyName ?? null);
              const domainMatch = domainsMatch(exp.companyDomain, companyDomain ?? null);
              return nameMatch || domainMatch;
            });
            
            if (wasEmployedThere) {
              const pastExp = crustdataResult.experiences.find(exp => {
                if (exp.isCurrent) return false;
                return companiesMatch(exp.companyName, companyName ?? null) || domainsMatch(exp.companyDomain, companyDomain ?? null);
              });
              employerLeftDetected = true;
              employerLeftReason = `${fullName} previously worked at ${companyName || companyDomain}${pastExp?.endDate ? ` (left ${pastExp.endDate})` : ''}, now at ${crustdataResult.companyName || 'unknown'}. Source: Crustdata employment history`;
              console.log(`[CascadeEnrichment] EMPLOYER LEFT DETECTED: ${employerLeftReason}`);
            } else if (pdlCompanyEmpty && crustdataResult.companyName && !crustdataCurrentCompanyMatches) {
              employerLeftDetected = true;
              employerLeftReason = `${fullName} now at ${crustdataResult.companyName} (was ${companyName || companyDomain} for this property). PDL shows no current employer, Crustdata shows different company. Source: Crustdata`;
              console.log(`[CascadeEnrichment] EMPLOYER LEFT DETECTED (new company): ${employerLeftReason}`);
            }
          }
        }
        
        if (!crustdataData.companyName && pdlCompanyEmpty && (companyDomain || companyName)) {
          const wasEmployedThere = crustdataResult.experiences.some(exp => {
            if (exp.isCurrent) return false;
            return companiesMatch(exp.companyName, companyName ?? null) || domainsMatch(exp.companyDomain, companyDomain ?? null);
          });
          if (wasEmployedThere) {
            employerLeftDetected = true;
            employerLeftReason = `${fullName} previously worked at ${companyName || companyDomain} but appears to no longer be employed there. Both PDL and Crustdata show no current employer. Source: Crustdata employment history`;
            console.log(`[CascadeEnrichment] EMPLOYER LEFT DETECTED (unemployed): ${employerLeftReason}`);
          }
        }
      } else {
        console.log('[CascadeEnrichment] Crustdata: no match found');
        confidenceFlag = pdlData ? 'unverified' : (verifiedEmail ? 'email_only' : 'no_match');
      }
    } catch (error) {
      console.warn('[CascadeEnrichment] Crustdata verification failed:', error instanceof Error ? error.message : error);
      confidenceFlag = pdlData ? 'unverified' : (verifiedEmail ? 'email_only' : 'no_match');
    }
  } else if (pdlDomainMatches) {
    confidenceFlag = 'pdl_matched';
    console.log('[CascadeEnrichment] Stage 4: Skipped — PDL domain matches input');
  } else if (!foundLinkedin && !verifiedEmail) {
    confidenceFlag = pdlData ? 'unverified' : 'no_match';
    console.log('[CascadeEnrichment] Stage 4: Skipped — no LinkedIn or email for Crustdata');
  }
  
  if (!pdlData && !crustdataData && !verifiedEmail) {
    console.log(`[CascadeEnrichment] No enrichment data found for: ${fullName}`);
    return buildEmptyResult(fullName, firstName, lastName, confidenceFlag);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // FINAL OUTPUT: Resolve fields with priority rules
  // ═══════════════════════════════════════════════════════════════
  
  const finalTitle = crustdataData?.title || pdlData?.title || title || null;
  const finalCompany = crustdataData?.companyName || (pdlDomainMatches ? pdlData?.companyName : null) || companyName || null;
  const finalCompanyDomain = crustdataData?.companyDomain || (pdlDomainMatches ? pdlData?.companyDomain : null) || companyDomain || null;
  const finalLinkedin = foundLinkedin || pdlData?.linkedinUrl || crustdataData?.linkedinUrl || null;
  const finalLocation = pdlData?.location || crustdataData?.location || location || null;
  const personalPhone = pdlData?.mobilePhone || null;
  const allPhones: string[] = Array.isArray(pdlData?.phonesJson)
    ? pdlData.phonesJson
        .map((p: any) => (typeof p === 'string' ? p : p?.number || p?.value || null))
        .filter((p: string | null): p is string => !!p)
    : [];
  const workPhone = allPhones.find(p => p !== personalPhone) || null;
  const finalPhone = personalPhone || allPhones[0] || null;
  
  const result: ContactEnrichmentResult = {
    found: true,
    providerId: pdlData?.raw?.id || pdlData?.raw?.data?.id || null,
    enrichmentSource: crustdataData ? 'crustdata' : (pdlData ? 'pdl' : (emailSource === 'findymail_finder' ? 'findymail' : (emailSource === 'hunter_finder' ? 'hunter' : 'ai'))),
    enrichedAt: new Date(),
    confidenceFlag,
    
    fullName: pdlData?.fullName || fullName,
    firstName: pdlData?.firstName || firstName,
    lastName: pdlData?.lastName || lastName,
    
    email: verifiedEmail || email || null,
    emailSource,
    emailVerified,
    emailStatus,
    
    phone: typeof finalPhone === 'string' ? finalPhone : null,
    mobilePhone: personalPhone,
    workPhone,
    title: finalTitle,
    
    company: finalCompany,
    companyDomain: finalCompanyDomain,
    linkedinUrl: finalLinkedin,
    location: finalLocation,
    photoUrl: pdlData?.photoUrl || crustdataData?.profilePictureUrl || null,
    
    seniority: pdlData?.titleRole || null,
    
    findymailVerified,
    findymailVerifyStatus,
    
    pdlRaw: pdlData?.raw || null,
    crustdataRaw: crustdataData?.raw || null,
    
    pdlFullName: pdlData?.fullName || null,
    pdlWorkEmail: pdlData?.workEmail || null,
    pdlEmailsJson: pdlData?.emailsJson || null,
    pdlPersonalEmails: pdlData?.personalEmails || null,
    pdlPhonesJson: pdlData?.phonesJson || null,
    pdlMobilePhone: pdlData?.mobilePhone || null,
    pdlLinkedinUrl: pdlData?.linkedinUrl || null,
    pdlTitle: pdlData?.title || null,
    pdlCompany: pdlData?.companyName || null,
    pdlCompanyDomain: pdlData?.companyDomain || null,
    pdlTitleRole: pdlData?.titleRole || null,
    pdlTitleLevels: pdlData?.titleLevels || null,
    pdlTitleClass: pdlData?.titleClass || null,
    pdlTitleSubRole: pdlData?.titleSubRole || null,
    pdlLocation: pdlData?.location || null,
    pdlCity: pdlData?.city || null,
    pdlState: pdlData?.state || null,
    pdlAddressesJson: pdlData?.addressesJson || null,
    pdlIndustry: pdlData?.industry || null,
    pdlGender: pdlData?.gender || null,
    pdlDatasetVersion: pdlData?.datasetVersion || null,
    
    crustdataTitle: crustdataData?.title || null,
    crustdataCompany: crustdataData?.companyName || null,
    crustdataCompanyDomain: crustdataData?.companyDomain || null,
    crustdataWorkEmail: crustdataData?.workEmail || null,
    crustdataLinkedinUrl: crustdataData?.linkedinUrl || null,
    crustdataProfilePictureUrl: crustdataData?.profilePictureUrl || null,
    crustdataLocation: crustdataData?.location || null,
    crustdataPersonId: crustdataData?.personId || null,
    crustdataEnriched: !!crustdataData,
    
    employerLeftDetected,
    employerLeftReason,
  };
  
  console.log(`[CascadeEnrichment] Contact enrichment complete for ${fullName}: confidence=${confidenceFlag}, source=${result.enrichmentSource}`);
  return result;
}

function buildEmptyResult(fullName: string, firstName: string, lastName: string, confidenceFlag: ConfidenceFlag): ContactEnrichmentResult {
  return {
    found: false,
    providerId: null,
    enrichmentSource: null,
    enrichedAt: null,
    confidenceFlag,
    fullName,
    firstName,
    lastName,
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
  };
}
