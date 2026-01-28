import { db } from './db';
import { organizations } from './schema';
import { eq } from 'drizzle-orm';
import { enrichCompanyPDL, PDLCompanyResult } from './pdl';

export interface OrganizationEnrichmentResult {
  success: boolean;
  orgId: string;
  enrichedData: PDLCompanyResult | null;
  error?: string;
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^www\./, '');
}

async function findOrCreateOrgByDomain(domain: string): Promise<{ id: string; isNew: boolean; needsEnrichment: boolean }> {
  const normalizedDomain = normalizeDomain(domain);
  
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.domain, normalizedDomain),
  });
  
  if (existing) {
    // Enrich with PDL if not already PDL enriched (even if legacy enrichment is complete)
    const needsEnrichment = !existing.pdlEnriched;
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
  domain: string
): Promise<OrganizationEnrichmentResult> {
  console.log(`[OrgEnrichment] Enriching organization with PDL: ${domain}`);
  
  if (!domain) {
    return { success: false, orgId: '', enrichedData: null, error: 'no_domain' };
  }
  
  const orgRecord = await findOrCreateOrgByDomain(domain);
  
  if (!orgRecord.needsEnrichment) {
    console.log(`[OrgEnrichment] Organization ${domain} already enriched with PDL, skipping`);
    return { 
      success: true, 
      orgId: orgRecord.id,
      enrichedData: null,
    };
  }
  
  // Use PDL for company enrichment
  const pdlResult = await enrichCompanyPDL(domain);
  
  if (!pdlResult.found) {
    console.log(`[OrgEnrichment] PDL did not find company: ${domain}`);
    await db.update(organizations)
      .set({
        enrichmentStatus: 'failed',
        lastEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgRecord.id));
    
    return { success: false, orgId: orgRecord.id, enrichedData: null, error: 'pdl_not_found' };
  }
  
  // Extract LinkedIn handle from URL if it's a full URL
  let linkedinHandle = pdlResult.linkedinUrl;
  if (linkedinHandle && linkedinHandle.includes('linkedin.com/company/')) {
    linkedinHandle = linkedinHandle.split('linkedin.com/company/')[1]?.replace(/\/$/, '') || linkedinHandle;
  }
  
  await db.update(organizations)
    .set({
      name: pdlResult.name || undefined,
      legalName: pdlResult.name || undefined,
      description: pdlResult.description || undefined,
      foundedYear: pdlResult.foundedYear || undefined,
      
      industry: pdlResult.industry || undefined,
      
      employees: pdlResult.employeeCount || undefined,
      employeesRange: pdlResult.employeeRange || undefined,
      
      location: pdlResult.city && pdlResult.state 
        ? `${pdlResult.city}, ${pdlResult.state}` 
        : (pdlResult.city || pdlResult.state || undefined),
      city: pdlResult.city || undefined,
      state: pdlResult.state || undefined,
      
      linkedinHandle: linkedinHandle || undefined,
      
      logoUrl: pdlResult.logoUrl || undefined,
      
      enrichmentSource: 'pdl',
      enrichmentStatus: 'complete',
      lastEnrichedAt: new Date(),
      pdlEnriched: true,
      pdlEnrichedAt: new Date(),
      rawEnrichmentJson: { pdl: pdlResult },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgRecord.id));
  
  console.log(`[OrgEnrichment] Successfully enriched ${domain} (${pdlResult.displayName || pdlResult.name}) with PDL - Industry: ${pdlResult.industry}, Employees: ${pdlResult.employeeRange}`);
  
  return {
    success: true,
    orgId: orgRecord.id,
    enrichedData: pdlResult,
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
