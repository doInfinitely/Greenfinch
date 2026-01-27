import { db } from './db';
import { organizations } from './schema';
import { eq } from 'drizzle-orm';
import { enrichCompanyByDomain as hunterEnrichCompany, CompanyEnrichmentResult } from './hunter';
import { enrichCompanyByDomain as enrichLayerEnrichCompany, CompanyProfileResult } from './enrichlayer';

export interface OrganizationEnrichmentResult {
  success: boolean;
  orgId: string;
  enrichedData: CompanyEnrichmentResult['data'] | null;
  enrichLayerData?: CompanyProfileResult['data'] | null;
  parentOrgId?: string;
  ultimateParentOrgId?: string;
  error?: string;
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim();
}

async function findOrCreateOrgByDomain(domain: string): Promise<{ id: string; isNew: boolean; needsEnrichment: boolean }> {
  const normalizedDomain = normalizeDomain(domain);
  
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.domain, normalizedDomain),
  });
  
  if (existing) {
    const needsEnrichment = existing.enrichmentStatus !== 'complete';
    return { id: existing.id, isNew: false, needsEnrichment };
  }
  
  const [inserted] = await db.insert(organizations)
    .values({
      domain: normalizedDomain,
      enrichmentStatus: 'pending',
    })
    .returning({ id: organizations.id });
  
  return { id: inserted.id, isNew: true, needsEnrichment: true };
}

export async function enrichOrganizationByDomain(
  domain: string,
  depth: number = 0,
  maxDepth: number = 2
): Promise<OrganizationEnrichmentResult> {
  console.log(`[OrgEnrichment] Enriching organization: ${domain} (depth: ${depth})`);
  
  if (!domain) {
    return { success: false, orgId: '', enrichedData: null, error: 'no_domain' };
  }
  
  const orgRecord = await findOrCreateOrgByDomain(domain);
  
  if (!orgRecord.needsEnrichment) {
    console.log(`[OrgEnrichment] Organization ${domain} already enriched, skipping`);
    const existing = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgRecord.id),
    });
    return { 
      success: true, 
      orgId: orgRecord.id,
      enrichedData: null,
      parentOrgId: existing?.parentOrgId || undefined,
      ultimateParentOrgId: existing?.ultimateParentOrgId || undefined,
    };
  }
  
  // Step 1: Get Hunter.io data for contact info, social profiles, tech stack, parent domains
  const hunterResult = await hunterEnrichCompany(domain);
  
  // Step 2: Get EnrichLayer data for accurate industry classification
  const enrichLayerResult = await enrichLayerEnrichCompany(domain);
  
  // If both fail, mark as failed
  if ((!hunterResult.success || !hunterResult.data) && (!enrichLayerResult.success || !enrichLayerResult.data)) {
    console.log(`[OrgEnrichment] Both enrichment sources failed for ${domain}`);
    await db.update(organizations)
      .set({
        enrichmentStatus: 'failed',
        lastEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgRecord.id));
    
    return { success: false, orgId: orgRecord.id, enrichedData: null, error: hunterResult.error || enrichLayerResult.error };
  }
  
  const hunterData = hunterResult.data;
  const elData = enrichLayerResult.data;
  
  let parentOrgId: string | undefined;
  let ultimateParentOrgId: string | undefined;
  
  const normalizedDomain = normalizeDomain(domain);
  const normalizedParent = hunterData?.parentDomain ? normalizeDomain(hunterData.parentDomain) : null;
  const normalizedUltimateParent = hunterData?.ultimateParentDomain ? normalizeDomain(hunterData.ultimateParentDomain) : null;
  
  if (depth < maxDepth) {
    if (normalizedParent && normalizedParent !== normalizedDomain) {
      console.log(`[OrgEnrichment] Found parent domain: ${hunterData?.parentDomain}`);
      const parentResult = await enrichOrganizationByDomain(hunterData!.parentDomain!, depth + 1, maxDepth);
      if (parentResult.success) {
        parentOrgId = parentResult.orgId;
      }
    }
    
    if (normalizedUltimateParent && normalizedUltimateParent !== normalizedDomain && normalizedUltimateParent !== normalizedParent) {
      console.log(`[OrgEnrichment] Found ultimate parent domain: ${hunterData?.ultimateParentDomain}`);
      const ultimateParentResult = await enrichOrganizationByDomain(hunterData!.ultimateParentDomain!, depth + 1, maxDepth);
      if (ultimateParentResult.success) {
        ultimateParentOrgId = ultimateParentResult.orgId;
      }
    }
  }
  
  // Map EnrichLayer industry to sector (EnrichLayer provides single industry field)
  // EnrichLayer categories are more detailed and go into tags
  const enrichLayerIndustry = elData?.industry || null;
  const enrichLayerCategories = elData?.categories || [];
  
  // Build location string from EnrichLayer HQ data
  const elLocation = elData?.headquarter 
    ? [elData.headquarter.city, elData.headquarter.state, elData.headquarter.country].filter(Boolean).join(', ')
    : null;
  
  await db.update(organizations)
    .set({
      // Basic info - prefer EnrichLayer name/description if available, fall back to Hunter
      name: elData?.name || hunterData?.name || undefined,
      legalName: hunterData?.legalName || undefined,
      domainAliases: hunterData?.domainAliases && hunterData.domainAliases.length > 0 ? hunterData.domainAliases : undefined,
      description: elData?.description || hunterData?.description || undefined,
      foundedYear: elData?.foundedYear || hunterData?.foundedYear || undefined,
      
      // Industry - use EnrichLayer (more accurate) - explicitly set to null to clear old Hunter.io data
      sector: enrichLayerIndustry || null, // EnrichLayer's industry is really more like a sector
      industryGroup: null, // EnrichLayer doesn't provide this level - clear old data
      industry: enrichLayerIndustry || null,
      subIndustry: null, // EnrichLayer doesn't provide this level - clear old data
      gicsCode: null, // EnrichLayer doesn't provide GICS - clear old data
      sicCode: null, // EnrichLayer doesn't provide SIC - clear old data
      naicsCode: null, // EnrichLayer doesn't provide NAICS - clear old data
      // Use EnrichLayer categories as tags (they're very detailed like "Hospitals and Health Care", "Medical Practices")
      tags: enrichLayerCategories.length > 0 ? enrichLayerCategories : (hunterData?.tags || undefined),
      
      // Company size - prefer EnrichLayer
      employees: elData?.companySize?.[0] || hunterData?.employees || undefined,
      employeesRange: hunterData?.employeesRange || undefined,
      estimatedAnnualRevenue: hunterData?.estimatedAnnualRevenue || undefined,
      
      // Location - prefer EnrichLayer HQ data
      location: elLocation || hunterData?.location || undefined,
      streetAddress: elData?.headquarter?.streetAddress || hunterData?.streetAddress || undefined,
      city: elData?.headquarter?.city || hunterData?.city || undefined,
      state: elData?.headquarter?.state || hunterData?.state || undefined,
      stateCode: hunterData?.stateCode || undefined,
      postalCode: elData?.headquarter?.postalCode || hunterData?.postalCode || undefined,
      country: elData?.headquarter?.country || hunterData?.country || undefined,
      countryCode: hunterData?.countryCode || undefined,
      lat: hunterData?.lat || undefined,
      lng: hunterData?.lng || undefined,
      
      // Social handles - combine from both sources
      linkedinHandle: elData?.linkedinHandle || hunterData?.linkedinHandle || undefined,
      twitterHandle: elData?.twitterHandle || hunterData?.twitterHandle || undefined,
      facebookHandle: elData?.facebookHandle || hunterData?.facebookHandle || undefined,
      crunchbaseHandle: hunterData?.crunchbaseHandle || undefined,
      
      // Logo - prefer EnrichLayer (LinkedIn sourced)
      logoUrl: elData?.logoUrl || hunterData?.logoUrl || undefined,
      
      // Parent domains from Hunter
      parentDomain: hunterData?.parentDomain || undefined,
      parentOrgId: parentOrgId || undefined,
      ultimateParentDomain: hunterData?.ultimateParentDomain || undefined,
      ultimateParentOrgId: ultimateParentOrgId || undefined,
      
      // Tech stack from Hunter
      tech: hunterData?.tech && hunterData.tech.length > 0 ? hunterData.tech : undefined,
      techCategories: hunterData?.techCategories && hunterData.techCategories.length > 0 ? hunterData.techCategories : undefined,
      
      // Contact info from Hunter
      phoneNumbers: hunterData?.phoneNumbers && hunterData.phoneNumbers.length > 0 
        ? hunterData.phoneNumbers 
        : (elData?.phoneNumber ? [elData.phoneNumber] : undefined),
      emailAddresses: hunterData?.emailAddresses && hunterData.emailAddresses.length > 0 ? hunterData.emailAddresses : undefined,
      
      enrichmentSource: 'hunter+enrichlayer',
      enrichmentStatus: 'complete',
      lastEnrichedAt: new Date(),
      rawEnrichmentJson: { hunter: hunterResult.data, enrichLayer: enrichLayerResult.data },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgRecord.id));
  
  console.log(`[OrgEnrichment] Successfully enriched ${domain} (${elData?.name || hunterData?.name}) with EnrichLayer industry: ${enrichLayerIndustry}`);
  
  return {
    success: true,
    orgId: orgRecord.id,
    enrichedData: hunterData || null,
    enrichLayerData: elData,
    parentOrgId,
    ultimateParentOrgId,
  };
}

export async function enrichOrganizationById(orgId: string): Promise<OrganizationEnrichmentResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  
  if (!org) {
    return { success: false, orgId, enrichedData: null, error: 'org_not_found' };
  }
  
  if (!org.domain) {
    return { success: false, orgId, enrichedData: null, error: 'no_domain' };
  }
  
  return enrichOrganizationByDomain(org.domain);
}
