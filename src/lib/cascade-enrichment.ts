/**
 * Cascade Enrichment Service
 * 
 * Implements the enrichment cascade logic:
 * - Organizations: Apollo → EnrichLayer → PDL
 * - Contacts: ZeroBounce validation → SERP LinkedIn → Apollo → EnrichLayer → PDL
 * 
 * Key behaviors:
 * - Stop contact enrichment early if valid email + LinkedIn found
 * - Track provider ID and source for all enriched records
 * - Map all provider responses to a unified Apollo-based data structure
 */

import { enrichCompanyApollo, enrichPersonApollo } from './apollo';
import { enrichCompanyByDomain as enrichCompanyEnrichLayer, lookupPerson as lookupPersonEnrichLayer, enrichLinkedInProfile } from './enrichlayer';
import { enrichCompanyPDL, enrichPersonPDL } from './pdl';
import { validateEmail as validateEmailZeroBounce } from './zerobounce';

// Unified organization enrichment result (Apollo-based schema)
export interface OrganizationEnrichmentResult {
  found: boolean;
  providerId: string | null;
  enrichmentSource: 'apollo' | 'enrichlayer' | 'pdl' | null;
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
  
  raw: any;
}

// Unified contact enrichment result (Apollo-based schema)
export interface ContactEnrichmentResult {
  found: boolean;
  providerId: string | null;
  enrichmentSource: 'apollo' | 'enrichlayer' | 'pdl' | 'ai' | null;
  enrichedAt: Date | null;
  
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null;
  phone: string | null;
  title: string | null;
  
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  photoUrl: string | null;
  
  seniority: string | null;
  
  raw: any;
}

/**
 * Enrich an organization using the cascade: Apollo → EnrichLayer → PDL
 * Returns the first successful result with provider tracking
 */
export async function enrichOrganizationCascade(domain: string): Promise<OrganizationEnrichmentResult> {
  const normalizedDomain = domain.toLowerCase().trim().replace(/^www\./, '');
  console.log(`[CascadeEnrichment] Starting org enrichment for domain: ${normalizedDomain}`);
  
  // Try Apollo first
  try {
    console.log('[CascadeEnrichment] Trying Apollo.io...');
    const apolloResult = await enrichCompanyApollo(normalizedDomain);
    
    if (apolloResult.found) {
      console.log(`[CascadeEnrichment] Apollo found: ${apolloResult.name}`);
      return {
        found: true,
        providerId: apolloResult.raw?.organization?.id || null,
        enrichmentSource: 'apollo',
        enrichedAt: new Date(),
        
        name: apolloResult.name || null,
        description: apolloResult.description || null,
        industry: apolloResult.industry || null,
        employeeCount: apolloResult.employeeCount || null,
        employeesRange: apolloResult.employeeCount ? getEmployeeRange(apolloResult.employeeCount) : null,
        foundedYear: apolloResult.foundedYear || null,
        
        city: apolloResult.city || null,
        state: apolloResult.state || null,
        country: apolloResult.country || null,
        
        website: apolloResult.website || null,
        linkedinUrl: apolloResult.linkedinUrl || null,
        twitterUrl: apolloResult.twitterUrl || null,
        facebookUrl: apolloResult.facebookUrl || null,
        logoUrl: apolloResult.logoUrl || null, // Apollo logo takes priority
        phone: apolloResult.phone || null,
        
        sicCodes: apolloResult.sicCodes || null,
        naicsCodes: apolloResult.naicsCodes || null,
        tags: apolloResult.keywords || null,
        
        raw: apolloResult.raw,
      };
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] Apollo failed:', error instanceof Error ? error.message : error);
  }
  
  // Try EnrichLayer second
  try {
    console.log('[CascadeEnrichment] Trying EnrichLayer...');
    const enrichLayerResult = await enrichCompanyEnrichLayer(normalizedDomain);
    
    if (enrichLayerResult.success && enrichLayerResult.data) {
      console.log(`[CascadeEnrichment] EnrichLayer found: ${enrichLayerResult.data.name}`);
      const data = enrichLayerResult.data;
      
      // Calculate employee range from company size if available
      let employeeCount: number | null = null;
      let employeesRange: string | null = null;
      if (data.companySize) {
        const [min, max] = data.companySize;
        if (min !== null && max !== null) {
          employeeCount = Math.round((min + max) / 2);
          employeesRange = `${min}-${max}`;
        } else if (min !== null) {
          employeeCount = min;
          employeesRange = `${min}+`;
        }
      }
      
      return {
        found: true,
        providerId: data.linkedinHandle || null,
        enrichmentSource: 'enrichlayer',
        enrichedAt: new Date(),
        
        name: data.name || null,
        description: data.description || null,
        industry: data.industry || null,
        employeeCount,
        employeesRange,
        foundedYear: data.foundedYear || null,
        
        city: data.headquarter?.city || null,
        state: data.headquarter?.state || null,
        country: data.headquarter?.country || null,
        
        website: data.website || null,
        linkedinUrl: data.linkedinHandle ? `https://linkedin.com/company/${data.linkedinHandle}` : null,
        twitterUrl: data.twitterHandle ? `https://twitter.com/${data.twitterHandle}` : null,
        facebookUrl: data.facebookHandle ? `https://facebook.com/${data.facebookHandle}` : null,
        logoUrl: data.logoUrl || null,
        phone: data.phoneNumber || null,
        
        sicCodes: null,
        naicsCodes: null,
        tags: data.categories || null,
        
        raw: enrichLayerResult,
      };
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] EnrichLayer failed:', error instanceof Error ? error.message : error);
  }
  
  // Try PDL last
  try {
    console.log('[CascadeEnrichment] Trying PDL...');
    const pdlResult = await enrichCompanyPDL(normalizedDomain);
    
    if (pdlResult.found) {
      console.log(`[CascadeEnrichment] PDL found: ${pdlResult.name}`);
      return {
        found: true,
        providerId: pdlResult.raw?.id || null,
        enrichmentSource: 'pdl',
        enrichedAt: new Date(),
        
        name: pdlResult.name || null,
        description: pdlResult.description || null,
        industry: pdlResult.industry || null,
        employeeCount: pdlResult.employeeCount || null,
        employeesRange: pdlResult.employeeRange || null,
        foundedYear: pdlResult.foundedYear || null,
        
        city: pdlResult.city || null,
        state: pdlResult.state || null,
        country: pdlResult.country || null,
        
        website: pdlResult.website || null,
        linkedinUrl: pdlResult.linkedinUrl || null,
        twitterUrl: null,
        facebookUrl: null,
        logoUrl: null,
        phone: null,
        
        sicCodes: null,
        naicsCodes: null,
        tags: null,
        
        raw: pdlResult.raw,
      };
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] PDL failed:', error instanceof Error ? error.message : error);
  }
  
  console.log(`[CascadeEnrichment] No provider found match for domain: ${normalizedDomain}`);
  return {
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
    raw: null,
  };
}

export interface ContactEnrichmentInput {
  fullName: string;
  email?: string | null;
  companyDomain?: string | null;
  title?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
}

/**
 * Validate an email and check if it's truly valid (not catch-all)
 */
async function validateEmailStrict(email: string): Promise<{ valid: boolean; status: 'valid' | 'invalid' | 'catch-all' | 'unknown' }> {
  try {
    const result = await validateEmailZeroBounce(email);
    // Only consider 'valid' as valid - catch-all is treated as invalid per requirements
    const isValid = result.status === 'valid';
    console.log(`[CascadeEnrichment] ZeroBounce validation for ${email}: ${result.status} (valid=${isValid})`);
    return { valid: isValid, status: result.status };
  } catch (error) {
    console.warn('[CascadeEnrichment] ZeroBounce validation failed:', error);
    return { valid: false, status: 'unknown' };
  }
}

/**
 * Parse full name into first and last name
 */
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

/**
 * Enrich a contact using the cascade logic:
 * 1. If email exists: ZeroBounce validation
 * 2. If valid email: SERP API for LinkedIn
 * 3. If valid email + LinkedIn found: STOP (early exit)
 * 4. If invalid/missing email OR no LinkedIn: Apollo → EnrichLayer → PDL cascade
 */
export async function enrichContactCascade(
  input: ContactEnrichmentInput,
  serpSearch?: (name: string, company: string | null) => Promise<{ linkedinUrl: string | null; confidence: number }>
): Promise<ContactEnrichmentResult> {
  const { fullName, email, companyDomain, title, location, linkedinUrl: existingLinkedin } = input;
  const { firstName, lastName } = parseFullName(fullName);
  
  console.log(`[CascadeEnrichment] Starting contact enrichment for: ${fullName} (${email || 'no email'})`);
  
  let validatedEmail: string | null = null;
  let emailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null = null;
  let foundLinkedin: string | null = existingLinkedin || null;
  
  // Step 1: If email exists, validate with ZeroBounce
  if (email) {
    const validation = await validateEmailStrict(email);
    emailStatus = validation.status;
    
    if (validation.valid) {
      validatedEmail = email;
      console.log(`[CascadeEnrichment] Email validated: ${email}`);
      
      // Step 2: If valid email, search for LinkedIn via SERP
      if (!foundLinkedin && serpSearch) {
        try {
          const serpResult = await serpSearch(fullName, companyDomain || null);
          if (serpResult.linkedinUrl && serpResult.confidence >= 0.6) {
            foundLinkedin = serpResult.linkedinUrl;
            console.log(`[CascadeEnrichment] SERP found LinkedIn: ${foundLinkedin} (confidence: ${serpResult.confidence})`);
          }
        } catch (error) {
          console.warn('[CascadeEnrichment] SERP LinkedIn search failed:', error);
        }
      }
      
      // Step 3: Early exit if we have valid email AND LinkedIn
      if (validatedEmail && foundLinkedin) {
        console.log(`[CascadeEnrichment] Early exit - valid email + LinkedIn found for ${fullName}`);
        return {
          found: true,
          providerId: null,
          enrichmentSource: 'ai', // Original AI-discovered data validated
          enrichedAt: new Date(),
          fullName,
          firstName,
          lastName,
          email: validatedEmail,
          emailStatus: 'valid',
          phone: null,
          title: title || null,
          company: null,
          companyDomain: companyDomain || null,
          linkedinUrl: foundLinkedin,
          location: location || null,
          photoUrl: null,
          seniority: null,
          raw: { validationSource: 'zerobounce+serp' },
        };
      }
    } else {
      console.log(`[CascadeEnrichment] Email invalid/catch-all: ${email} (${emailStatus})`);
    }
  }
  
  // Step 4: Need to enrich via providers - Apollo → EnrichLayer → PDL
  console.log(`[CascadeEnrichment] Starting provider cascade for ${fullName}...`);
  
  // Try Apollo first
  try {
    console.log('[CascadeEnrichment] Trying Apollo.io for contact...');
    const apolloResult = await enrichPersonApollo(firstName, lastName, companyDomain || undefined, {
      revealEmails: true,
      revealPhone: true,
      useWaterfallPhone: true,  // Phone numbers delivered via webhook
      linkedinUrl: foundLinkedin || undefined,  // Improves match rate
    });
    
    if (apolloResult.found && (apolloResult.linkedinUrl || apolloResult.email || apolloResult.title)) {
      console.log(`[CascadeEnrichment] Apollo found contact: ${apolloResult.fullName}`);
      
      // Validate the Apollo email if we got one
      let apolloEmailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null = null;
      if (apolloResult.email) {
        const validation = await validateEmailStrict(apolloResult.email);
        apolloEmailStatus = validation.status;
      }
      
      return {
        found: true,
        providerId: apolloResult.raw?.person?.id || null,
        enrichmentSource: 'apollo',
        enrichedAt: new Date(),
        fullName: apolloResult.fullName || fullName,
        firstName: apolloResult.firstName || firstName,
        lastName: apolloResult.lastName || lastName,
        email: apolloResult.email || validatedEmail,
        emailStatus: apolloEmailStatus || emailStatus,
        phone: apolloResult.phone || null,
        title: apolloResult.title || title || null,
        company: apolloResult.company || null,
        companyDomain: apolloResult.companyDomain || companyDomain || null,
        linkedinUrl: apolloResult.linkedinUrl || foundLinkedin,
        location: apolloResult.location || location || null,
        photoUrl: null,
        seniority: apolloResult.seniority || null,
        raw: apolloResult.raw,
      };
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] Apollo contact enrichment failed:', error instanceof Error ? error.message : error);
  }
  
  // Try EnrichLayer second
  try {
    console.log('[CascadeEnrichment] Trying EnrichLayer for contact...');
    const enrichLayerResult = await lookupPersonEnrichLayer({
      firstName,
      lastName,
      companyDomain: companyDomain || undefined,
      title: title || undefined,
      location: location || undefined,
    });
    
    if (enrichLayerResult.success && (enrichLayerResult.linkedinUrl || enrichLayerResult.email)) {
      console.log(`[CascadeEnrichment] EnrichLayer found contact: ${enrichLayerResult.fullName || fullName}`);
      
      // Validate the EnrichLayer email if we got one
      let elEmailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null = null;
      if (enrichLayerResult.email) {
        const validation = await validateEmailStrict(enrichLayerResult.email);
        elEmailStatus = validation.status;
      }
      
      return {
        found: true,
        providerId: enrichLayerResult.linkedinUrl || null, // Use LinkedIn URL as identifier
        enrichmentSource: 'enrichlayer',
        enrichedAt: new Date(),
        fullName: enrichLayerResult.fullName || fullName,
        firstName: enrichLayerResult.firstName || firstName,
        lastName: enrichLayerResult.lastName || lastName,
        email: enrichLayerResult.email || validatedEmail,
        emailStatus: elEmailStatus || emailStatus,
        phone: enrichLayerResult.phone || null,
        title: enrichLayerResult.title || title || null,
        company: enrichLayerResult.company || null,
        companyDomain: companyDomain || null,
        linkedinUrl: enrichLayerResult.linkedinUrl || foundLinkedin,
        location: enrichLayerResult.location || location || null,
        photoUrl: enrichLayerResult.profilePicture || null,
        seniority: null,
        raw: enrichLayerResult.rawResponse,
      };
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] EnrichLayer contact enrichment failed:', error instanceof Error ? error.message : error);
  }
  
  // Try PDL last
  try {
    console.log('[CascadeEnrichment] Trying PDL for contact...');
    const pdlResult = await enrichPersonPDL(firstName, lastName, companyDomain || '', {
      location: location || undefined,
    });
    
    if (pdlResult.found && (pdlResult.linkedinUrl || pdlResult.email)) {
      console.log(`[CascadeEnrichment] PDL found contact: ${pdlResult.fullName}`);
      
      // Validate the PDL email if we got one
      let pdlEmailStatus: 'valid' | 'invalid' | 'catch-all' | 'unknown' | null = null;
      if (pdlResult.email) {
        const validation = await validateEmailStrict(pdlResult.email);
        pdlEmailStatus = validation.status;
      }
      
      return {
        found: true,
        providerId: pdlResult.raw?.id || null,
        enrichmentSource: 'pdl',
        enrichedAt: new Date(),
        fullName: pdlResult.fullName || fullName,
        firstName: pdlResult.firstName || firstName,
        lastName: pdlResult.lastName || lastName,
        email: pdlResult.email || validatedEmail,
        emailStatus: pdlEmailStatus || emailStatus,
        phone: null,
        title: pdlResult.title || title || null,
        company: pdlResult.companyName || null,
        companyDomain: pdlResult.companyDomain || companyDomain || null,
        linkedinUrl: pdlResult.linkedinUrl || foundLinkedin,
        location: pdlResult.location || location || null,
        photoUrl: pdlResult.photoUrl || null,
        seniority: null,
        raw: pdlResult.raw,
      };
    }
  } catch (error) {
    console.warn('[CascadeEnrichment] PDL contact enrichment failed:', error instanceof Error ? error.message : error);
  }
  
  // No provider found a match - return original data with validation status
  console.log(`[CascadeEnrichment] No provider found match for contact: ${fullName}`);
  return {
    found: false,
    providerId: null,
    enrichmentSource: null,
    enrichedAt: null,
    fullName,
    firstName,
    lastName,
    email: validatedEmail || email || null,
    emailStatus,
    phone: null,
    title: title || null,
    company: null,
    companyDomain: companyDomain || null,
    linkedinUrl: foundLinkedin,
    location: location || null,
    photoUrl: null,
    seniority: null,
    raw: null,
  };
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
