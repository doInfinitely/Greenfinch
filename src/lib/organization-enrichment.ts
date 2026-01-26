import { db } from './db';
import { organizations } from './schema';
import { eq } from 'drizzle-orm';
import { enrichCompanyByDomain, CompanyEnrichmentResult } from './hunter';

export interface OrganizationEnrichmentResult {
  success: boolean;
  orgId: string;
  enrichedData: CompanyEnrichmentResult['data'] | null;
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
  
  const enrichResult = await enrichCompanyByDomain(domain);
  
  if (!enrichResult.success || !enrichResult.data) {
    console.log(`[OrgEnrichment] Failed to enrich ${domain}: ${enrichResult.error}`);
    await db.update(organizations)
      .set({
        enrichmentStatus: 'failed',
        lastEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgRecord.id));
    
    return { success: false, orgId: orgRecord.id, enrichedData: null, error: enrichResult.error };
  }
  
  const data = enrichResult.data;
  let parentOrgId: string | undefined;
  let ultimateParentOrgId: string | undefined;
  
  const normalizedDomain = normalizeDomain(domain);
  const normalizedParent = data.parentDomain ? normalizeDomain(data.parentDomain) : null;
  const normalizedUltimateParent = data.ultimateParentDomain ? normalizeDomain(data.ultimateParentDomain) : null;
  
  if (depth < maxDepth) {
    if (normalizedParent && normalizedParent !== normalizedDomain) {
      console.log(`[OrgEnrichment] Found parent domain: ${data.parentDomain}`);
      const parentResult = await enrichOrganizationByDomain(data.parentDomain!, depth + 1, maxDepth);
      if (parentResult.success) {
        parentOrgId = parentResult.orgId;
      }
    }
    
    if (normalizedUltimateParent && normalizedUltimateParent !== normalizedDomain && normalizedUltimateParent !== normalizedParent) {
      console.log(`[OrgEnrichment] Found ultimate parent domain: ${data.ultimateParentDomain}`);
      const ultimateParentResult = await enrichOrganizationByDomain(data.ultimateParentDomain!, depth + 1, maxDepth);
      if (ultimateParentResult.success) {
        ultimateParentOrgId = ultimateParentResult.orgId;
      }
    }
  }
  
  await db.update(organizations)
    .set({
      name: data.name || undefined,
      legalName: data.legalName || undefined,
      domainAliases: data.domainAliases.length > 0 ? data.domainAliases : undefined,
      description: data.description || undefined,
      foundedYear: data.foundedYear || undefined,
      
      sector: data.sector || undefined,
      industryGroup: data.industryGroup || undefined,
      industry: data.industry || undefined,
      subIndustry: data.subIndustry || undefined,
      gicsCode: data.gicsCode || undefined,
      sicCode: data.sicCode || undefined,
      naicsCode: data.naicsCode || undefined,
      tags: data.tags.length > 0 ? data.tags : undefined,
      
      employees: data.employees || undefined,
      employeesRange: data.employeesRange || undefined,
      estimatedAnnualRevenue: data.estimatedAnnualRevenue || undefined,
      
      location: data.location || undefined,
      streetAddress: data.streetAddress || undefined,
      city: data.city || undefined,
      state: data.state || undefined,
      stateCode: data.stateCode || undefined,
      postalCode: data.postalCode || undefined,
      country: data.country || undefined,
      countryCode: data.countryCode || undefined,
      lat: data.lat || undefined,
      lng: data.lng || undefined,
      
      linkedinHandle: data.linkedinHandle || undefined,
      twitterHandle: data.twitterHandle || undefined,
      facebookHandle: data.facebookHandle || undefined,
      crunchbaseHandle: data.crunchbaseHandle || undefined,
      
      logoUrl: data.logoUrl || undefined,
      
      parentDomain: data.parentDomain || undefined,
      parentOrgId: parentOrgId || undefined,
      ultimateParentDomain: data.ultimateParentDomain || undefined,
      ultimateParentOrgId: ultimateParentOrgId || undefined,
      
      tech: data.tech.length > 0 ? data.tech : undefined,
      techCategories: data.techCategories.length > 0 ? data.techCategories : undefined,
      
      phoneNumbers: data.phoneNumbers.length > 0 ? data.phoneNumbers : undefined,
      emailAddresses: data.emailAddresses.length > 0 ? data.emailAddresses : undefined,
      
      enrichmentSource: 'hunter',
      enrichmentStatus: 'complete',
      lastEnrichedAt: new Date(),
      rawEnrichmentJson: enrichResult.data,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgRecord.id));
  
  console.log(`[OrgEnrichment] Successfully enriched ${domain} (${data.name})`);
  
  return {
    success: true,
    orgId: orgRecord.id,
    enrichedData: data,
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
