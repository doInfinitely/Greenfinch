import { db } from './db';
import { organizations } from './schema';
import { eq } from 'drizzle-orm';
import { enrichOrganizationCascade, OrganizationEnrichmentResult as CascadeResult } from './cascade-enrichment';

export interface OrganizationEnrichmentResult {
  success: boolean;
  orgId: string;
  enrichedData: CascadeResult | null;
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
  
  // Derive a name from the domain (e.g., "stockdale-investment-group.com" -> "Stockdale Investment Group")
  const derivedName = normalizedDomain
    .split('.')[0]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  
  const [inserted] = await db.insert(organizations)
    .values({
      name: derivedName,
      domain: normalizedDomain,
      enrichmentStatus: 'pending',
    })
    .returning({ id: organizations.id });
  
  return { id: inserted.id, isNew: true, needsEnrichment: true };
}

export async function enrichOrganizationByDomain(
  domain: string,
  options?: { forceRefresh?: boolean }
): Promise<OrganizationEnrichmentResult> {
  console.log(`[OrgEnrichment] Enriching organization with cascade (PDL → Crustdata): ${domain}`);
  
  if (!domain) {
    return { success: false, orgId: '', enrichedData: null, error: 'no_domain' };
  }
  
  const orgRecord = await findOrCreateOrgByDomain(domain);
  
  if (!orgRecord.needsEnrichment && !options?.forceRefresh) {
    console.log(`[OrgEnrichment] Organization ${domain} already enriched, skipping`);
    return { 
      success: true, 
      orgId: orgRecord.id,
      enrichedData: null,
    };
  }
  
  // Use cascade enrichment: Apollo → EnrichLayer → PDL
  const cascadeResult = await enrichOrganizationCascade(domain);
  
  if (!cascadeResult.found) {
    console.log(`[OrgEnrichment] No provider found company: ${domain}`);
    await db.update(organizations)
      .set({
        enrichmentStatus: 'failed',
        lastEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgRecord.id));
    
    return { success: false, orgId: orgRecord.id, enrichedData: null, error: 'not_found' };
  }
  
  // Extract LinkedIn handle from URL if it's a full URL
  let linkedinHandle = cascadeResult.linkedinUrl;
  if (linkedinHandle && linkedinHandle.includes('linkedin.com/company/')) {
    linkedinHandle = linkedinHandle.split('linkedin.com/company/')[1]?.replace(/\/$/, '') || linkedinHandle;
  }
  
  // Build update object
  const updateData: Record<string, any> = {
    name: cascadeResult.name || undefined,
    legalName: cascadeResult.name || undefined,
    description: cascadeResult.description || undefined,
    foundedYear: cascadeResult.foundedYear || undefined,
    
    industry: cascadeResult.industry || undefined,
    
    employees: cascadeResult.employeeCount || undefined,
    employeesRange: cascadeResult.employeesRange || undefined,
    
    location: cascadeResult.city && cascadeResult.state 
      ? `${cascadeResult.city}, ${cascadeResult.state}` 
      : (cascadeResult.city || cascadeResult.state || undefined),
    city: cascadeResult.city || undefined,
    state: cascadeResult.state || undefined,
    country: cascadeResult.country || undefined,
    
    linkedinHandle: linkedinHandle || undefined,
    
    // Apollo logo takes priority - it's set first in the cascade
    logoUrl: cascadeResult.logoUrl || undefined,
    
    phoneNumbers: cascadeResult.phone ? [cascadeResult.phone] : undefined,
    tags: cascadeResult.tags || undefined,
    
    // Provider tracking
    providerId: cascadeResult.providerId || undefined,
    enrichmentSource: cascadeResult.enrichmentSource || undefined,
    enrichmentStatus: 'complete',
    lastEnrichedAt: cascadeResult.enrichedAt || new Date(),
    rawEnrichmentJson: (cascadeResult.pdlRaw || cascadeResult.crustdataRaw) ? { pdl: cascadeResult.pdlRaw || null, crustdata: cascadeResult.crustdataRaw || null } : undefined,
    
    pdlEnriched: !!cascadeResult.pdlRaw,
    pdlEnrichedAt: cascadeResult.pdlRaw ? new Date() : undefined,
    pdlRawResponse: cascadeResult.pdlRaw || undefined,
    crustdataRawResponse: cascadeResult.crustdataRaw || undefined,
    crustdataEnriched: !!cascadeResult.crustdataRaw,
    crustdataEnrichedAt: cascadeResult.crustdataRaw ? new Date() : undefined,
    
    updatedAt: new Date(),
  };
  
  // Filter out undefined values
  const cleanUpdate = Object.fromEntries(
    Object.entries(updateData).filter(([_, v]) => v !== undefined)
  );
  
  await db.update(organizations)
    .set(cleanUpdate)
    .where(eq(organizations.id, orgRecord.id));
  
  console.log(`[OrgEnrichment] Successfully enriched ${domain} (${cascadeResult.name}) via ${cascadeResult.enrichmentSource} - Industry: ${cascadeResult.industry}, Employees: ${cascadeResult.employeesRange}`);
  
  return {
    success: true,
    orgId: orgRecord.id,
    enrichedData: cascadeResult,
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
