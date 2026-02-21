import { db } from './db';
import { organizations } from './schema';
import { eq } from 'drizzle-orm';
import { enrichOrganizationCascade, OrganizationEnrichmentResult as CascadeResult } from './cascade-enrichment';
import { enrichCompanyPDL } from './pdl';

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
  options?: { forceRefresh?: boolean; name?: string; linkedinUrl?: string }
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

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgRecord.id),
  });
  
  const cascadeName = options?.name || org?.name || undefined;
  const cascadeLinkedin = options?.linkedinUrl || (org?.linkedinHandle ? `https://linkedin.com/company/${org.linkedinHandle}` : undefined);
  
  const cascadeResult = await enrichOrganizationCascade(domain, {
    name: cascadeName,
    linkedinUrl: cascadeLinkedin,
  });
  
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
    twitterHandle: cascadeResult.twitterUrl 
      ? (cascadeResult.twitterUrl.includes('twitter.com/') || cascadeResult.twitterUrl.includes('x.com/')
        ? cascadeResult.twitterUrl.split('/').pop()?.replace(/\/$/, '') || cascadeResult.twitterUrl
        : cascadeResult.twitterUrl)
      : undefined,
    facebookHandle: cascadeResult.facebookUrl
      ? (cascadeResult.facebookUrl.includes('facebook.com/')
        ? cascadeResult.facebookUrl.split('facebook.com/')[1]?.replace(/\/$/, '') || cascadeResult.facebookUrl
        : cascadeResult.facebookUrl)
      : undefined,
    
    logoUrl: cascadeResult.logoUrl || undefined,
    
    phoneNumbers: cascadeResult.phone ? [cascadeResult.phone] : undefined,
    tags: cascadeResult.tags || undefined,
    
    // Provider tracking
    providerId: cascadeResult.providerId || undefined,
    enrichmentSource: cascadeResult.enrichmentSource || undefined,
    enrichmentStatus: 'complete',
    lastEnrichedAt: cascadeResult.enrichedAt || new Date(),
    rawEnrichmentJson: (cascadeResult.pdlRaw || cascadeResult.crustdataRaw) ? { pdl: cascadeResult.pdlRaw || null, crustdata: cascadeResult.crustdataRaw || null } : undefined,
    
    pdlCompanyId: cascadeResult.pdlCompanyId || undefined,
    affiliatedPdlIds: cascadeResult.affiliatedProfiles || undefined,

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
  
  if (cascadeResult.affiliatedProfiles && cascadeResult.affiliatedProfiles.length > 0) {
    resolveAffiliatedCompanies(orgRecord.id, cascadeResult.affiliatedProfiles)
      .catch(err => console.error(`[OrgEnrichment] Error resolving affiliated companies for ${domain}:`, err));
  }

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
  
  return enrichOrganizationByDomain(org.domain, {
    name: org.name || undefined,
    linkedinUrl: org.linkedinHandle ? `https://linkedin.com/company/${org.linkedinHandle}` : undefined,
  });
}

const MAX_AFFILIATED_LOOKUPS = 8;

export async function resolveAffiliatedCompanies(
  orgId: string,
  affiliatedPdlIds: string[]
): Promise<void> {
  if (!affiliatedPdlIds || affiliatedPdlIds.length === 0) return;

  const idsToResolve = affiliatedPdlIds.slice(0, MAX_AFFILIATED_LOOKUPS);
  console.log(`[OrgEnrichment] Resolving ${idsToResolve.length} affiliated companies for org ${orgId}`);

  for (const pdlId of idsToResolve) {
    try {
      const existing = await db.query.organizations.findFirst({
        where: eq(organizations.pdlCompanyId, pdlId),
      });

      if (existing) {
        console.log(`[OrgEnrichment] Affiliated company ${pdlId} already in DB as "${existing.name}" (${existing.domain})`);
        continue;
      }

      const pdlResult = await enrichCompanyPDL('', { pdlId });
      if (!pdlResult.found || !pdlResult.name) {
        console.log(`[OrgEnrichment] PDL lookup for affiliated ID ${pdlId} — not found`);
        continue;
      }

      const domain = pdlResult.website
        ? pdlResult.website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
        : null;

      if (domain) {
        const existingByDomain = await db.query.organizations.findFirst({
          where: eq(organizations.domain, domain),
        });

        if (existingByDomain) {
          if (!existingByDomain.pdlCompanyId) {
            await db.update(organizations)
              .set({
                pdlCompanyId: pdlResult.pdlCompanyId,
                affiliatedPdlIds: pdlResult.affiliatedProfiles || undefined,
                updatedAt: new Date(),
              })
              .where(eq(organizations.id, existingByDomain.id));
          }
          console.log(`[OrgEnrichment] Affiliated company ${pdlId} matched existing org "${existingByDomain.name}" by domain ${domain}`);
          continue;
        }
      }

      const displayName = pdlResult.displayName || pdlResult.name;
      const [inserted] = await db.insert(organizations)
        .values({
          name: displayName,
          domain: domain || undefined,
          pdlCompanyId: pdlResult.pdlCompanyId,
          affiliatedPdlIds: pdlResult.affiliatedProfiles || undefined,
          description: pdlResult.description || undefined,
          industry: pdlResult.industry || undefined,
          employees: pdlResult.employeeCount || undefined,
          employeesRange: pdlResult.employeeRange || undefined,
          foundedYear: pdlResult.foundedYear || undefined,
          city: pdlResult.city || undefined,
          state: pdlResult.state || undefined,
          country: pdlResult.country || undefined,
          logoUrl: pdlResult.logoUrl || undefined,
          enrichmentSource: 'pdl',
          enrichmentStatus: 'complete',
          pdlEnriched: true,
          pdlEnrichedAt: new Date(),
          pdlRawResponse: pdlResult.raw || undefined,
          lastEnrichedAt: new Date(),
        })
        .returning({ id: organizations.id });

      console.log(`[OrgEnrichment] Created affiliated company "${displayName}" (${domain || 'no domain'}) — PDL ID: ${pdlId}`);
    } catch (err) {
      console.error(`[OrgEnrichment] Error resolving affiliated company ${pdlId}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function findOrgByDomainOrName(domain: string | null, companyName: string | null): Promise<typeof organizations.$inferSelect | null> {
  if (domain) {
    const norm = domain.toLowerCase().trim().replace(/^www\./, '');
    const byDomain = await db.query.organizations.findFirst({ where: eq(organizations.domain, norm) });
    if (byDomain) return byDomain;
  }
  if (companyName) {
    const byName = await db.query.organizations.findFirst({ where: eq(organizations.name, companyName) });
    if (byName) return byName;
  }
  return null;
}

export async function areCompaniesAffiliated(
  domain1: string | null,
  domain2: string | null,
  companyName1?: string | null,
  companyName2?: string | null
): Promise<boolean> {
  if (domain1 && domain2) {
    const norm1 = domain1.toLowerCase().trim().replace(/^www\./, '');
    const norm2 = domain2.toLowerCase().trim().replace(/^www\./, '');
    if (norm1 === norm2) return true;
  }

  const [org1, org2] = await Promise.all([
    findOrgByDomainOrName(domain1, companyName1 || null),
    findOrgByDomainOrName(domain2, companyName2 || null),
  ]);

  if (!org1 || !org2) return false;

  if (org1.pdlCompanyId && org2.affiliatedPdlIds) {
    const affiliates2 = org2.affiliatedPdlIds as string[];
    if (affiliates2.includes(org1.pdlCompanyId)) return true;
  }
  if (org2.pdlCompanyId && org1.affiliatedPdlIds) {
    const affiliates1 = org1.affiliatedPdlIds as string[];
    if (affiliates1.includes(org2.pdlCompanyId)) return true;
  }

  if (org1.pdlCompanyId && org2.pdlCompanyId && org1.pdlCompanyId === org2.pdlCompanyId) return true;

  const norm1 = org1.domain?.toLowerCase().trim().replace(/^www\./, '') || '';
  const norm2 = org2.domain?.toLowerCase().trim().replace(/^www\./, '') || '';

  if (norm1 && norm2 && norm1 === norm2) return true;

  if (org1.parentDomain === norm2 || org2.parentDomain === norm1) return true;
  if (norm1 && org2.ultimateParentDomain === norm1) return true;
  if (norm2 && org1.ultimateParentDomain === norm2) return true;
  if (org1.ultimateParentDomain && org2.ultimateParentDomain && 
      org1.ultimateParentDomain === org2.ultimateParentDomain) return true;

  if (org1.parentOrgId === org2.id || org2.parentOrgId === org1.id) return true;
  if (org1.ultimateParentOrgId && org1.ultimateParentOrgId === org2.ultimateParentOrgId) return true;

  return false;
}
