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
  verifyEmail as verifyEmailFindymail 
} from './findymail';

// Email Verification Providers
export { 
  validateEmail as validateEmailLeadMagic,
  findEmail as findEmailLeadMagic 
} from './leadmagic';
export { validateEmail as validateEmailZeroBounce } from './zerobounce';
export { validateEmail as validateEmailNeverBounce } from './neverbounce';

// Type exports for convenience
export type { PDLPersonResult, PDLCompanyResult } from './pdl';
export type { EmailFindResult } from './hunter';
export type { EmailValidationResult as LeadMagicValidationResult } from './leadmagic';
export type { EmailValidationResult as NeverBounceValidationResult } from './neverbounce';
