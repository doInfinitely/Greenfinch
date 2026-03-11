// ============================================================================
// AI Enrichment — Stage 2R: Simplified Residential Owner Lookup
//
// For residential properties, ownership is straightforward: the deed owner
// IS the owner (no PM/mgmt chain). We extract the owner from the appraisal
// record and optionally do a simple PDL person lookup on the deed owner name.
//
// This bypasses the full Stage 2 ownership search sequence that looks for
// PM companies, beneficial owners behind LLCs, etc.
// ============================================================================

import type { CommercialProperty } from '../../property-types';
import type { StageResult, OwnershipInfo, PropertyClassification } from '../types';
import type { MarketConfig } from '../../markets/types';

/**
 * Run Stage 2R — simplified ownership for residential properties.
 *
 * Returns the deed owner as the beneficial owner with no management company.
 * The owner name comes directly from the CAD record.
 */
export async function identifyResidentialOwner(
  property: CommercialProperty,
  classification: PropertyClassification,
  options: { market?: MarketConfig; clerkOrgId?: string } = {}
): Promise<StageResult<OwnershipInfo>> {
  const ownerName = property.ownerName1 || property.bizName || 'Unknown';
  const secondaryOwner = property.ownerName2 || null;

  // Determine owner type from name patterns
  let ownerType: 'Individual' | 'Corporation' | null = 'Individual';
  const nameUpper = ownerName.toUpperCase();
  if (
    nameUpper.includes('LLC') || nameUpper.includes('INC') ||
    nameUpper.includes('CORP') || nameUpper.includes('LTD') ||
    nameUpper.includes('LP') || nameUpper.includes('TRUST')
  ) {
    ownerType = 'Corporation';
  }

  const ownership: OwnershipInfo = {
    beneficialOwner: {
      name: ownerName,
      type: ownerType,
      domain: null,
      confidence: 0.8, // High confidence — direct from deed record
    },
    managementCompany: {
      name: null,
      domain: null,
      confidence: 0,
    },
    additionalOwners: secondaryOwner ? [{
      name: secondaryOwner,
      type: null,
      domain: null,
      confidence: 0.6,
    }] : [],
    additionalManagementCompanies: [],
    propertyWebsite: null,
    propertyPhone: property.ownerPhone || null,
  };

  const summary = `Residential property owned by ${ownerName}${secondaryOwner ? ` and ${secondaryOwner}` : ''}. No property management company expected.`;

  return {
    data: ownership,
    summary,
    sources: [],
  };
}
