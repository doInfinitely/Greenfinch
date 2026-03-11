import { db } from './db';
import { organizations, contactOrganizations, propertyOrganizations, properties } from './schema';
import { eq, inArray } from 'drizzle-orm';
import pLimit from 'p-limit';
import { enrichOrganizationCascade, OrganizationEnrichmentResult as CascadeResult } from './cascade-enrichment';
import { enrichCompanyPDL, type PDLCompanyResult } from './pdl';
import { normalizeDomain } from './normalization';
import { acquireLock, releaseLock } from './redis';

export interface OrganizationEnrichmentResult {
  success: boolean;
  orgId: string;
  enrichedData: CascadeResult | null;
  error?: string;
}

export interface ResolveOrgInput {
  name: string;
  domain?: string | null;
  linkedinUrl?: string | null;
  pdlCompanyId?: string | null;
  locality?: string | null;
  region?: string | null;
  streetAddress?: string | null;
  postalCode?: string | null;
}

export interface ResolveOrgResult {
  orgId: string;
  isNew: boolean;
  matchedBy: 'pdl_company_id' | 'domain' | 'name' | 'created';
  pdlEnriched: boolean;
}

type OrgRecord = typeof organizations.$inferSelect;

async function findExistingOrgInDb(input: {
  pdlCompanyId?: string | null;
  domain?: string | null;
}): Promise<{ org: OrgRecord; matchedBy: 'pdl_company_id' | 'domain' } | null> {
  if (input.pdlCompanyId) {
    const byPdlId = await db.query.organizations.findFirst({
      where: eq(organizations.pdlCompanyId, input.pdlCompanyId),
    });
    if (byPdlId) return { org: byPdlId, matchedBy: 'pdl_company_id' };
  }

  if (input.domain) {
    const norm = normalizeDomain(input.domain);
    const byDomain = await db.query.organizations.findFirst({
      where: eq(organizations.domain, norm),
    });
    if (byDomain) return { org: byDomain, matchedBy: 'domain' };
  }

  return null;
}

function buildPdlUpdateData(pdlResult: PDLCompanyResult): Record<string, any> {
  const domain = pdlResult.website
    ? pdlResult.website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    : null;

  const linkedinHandle = pdlResult.linkedinUrl
    ? (pdlResult.linkedinUrl.includes('linkedin.com/company/')
      ? pdlResult.linkedinUrl.split('linkedin.com/company/')[1]?.replace(/\/$/, '')
      : pdlResult.linkedinUrl)
    : null;

  const update: Record<string, any> = {
    pdlCompanyId: pdlResult.pdlCompanyId,
    pdlEnriched: true,
    pdlEnrichedAt: new Date(),
    pdlDataVersion: pdlResult.datasetVersion || undefined,
    pdlRawResponse: pdlResult.raw || undefined,
    enrichmentSource: 'pdl',
    enrichmentStatus: 'complete',
    lastEnrichedAt: new Date(),
    updatedAt: new Date(),
  };

  if (pdlResult.displayName || pdlResult.name) update.name = pdlResult.displayName || pdlResult.name;
  if (domain) update.domain = domain;
  if (pdlResult.description) update.description = pdlResult.description;
  if (pdlResult.industry) update.industry = pdlResult.industry;
  if (pdlResult.employeeCount) update.employees = pdlResult.employeeCount;
  if (pdlResult.employeeRange) update.employeesRange = pdlResult.employeeRange;
  if (pdlResult.foundedYear) update.foundedYear = pdlResult.foundedYear;
  if (pdlResult.city) update.city = pdlResult.city;
  if (pdlResult.state) update.state = pdlResult.state;
  if (pdlResult.country) update.country = pdlResult.country;
  if (pdlResult.logoUrl) update.logoUrl = pdlResult.logoUrl;
  if (linkedinHandle) update.linkedinHandle = linkedinHandle;
  if (pdlResult.affiliatedProfiles) update.affiliatedPdlIds = pdlResult.affiliatedProfiles;

  return Object.fromEntries(Object.entries(update).filter(([_, v]) => v !== undefined));
}

export async function resolveOrganization(input: ResolveOrgInput): Promise<ResolveOrgResult> {
  const { name, domain, linkedinUrl, pdlCompanyId: inputPdlId, locality, region, streetAddress, postalCode } = input;
  const normalizedDomain = domain ? normalizeDomain(domain) : null;

  const orgLockIdentifier = normalizedDomain || name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const orgLockKey = `org:resolve:${orgLockIdentifier}`;
  let orgLockAcquired = false;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        orgLockAcquired = await acquireLock(orgLockKey, 60);
        if (orgLockAcquired) break;
      } catch {}
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
    }
  } catch {}

  try {

  console.log(`[ResolveOrg] Resolving: "${name}" (domain=${normalizedDomain}, pdlId=${inputPdlId || 'none'}, loc=${locality || 'none'},${region || 'none'})`);

  if (inputPdlId) {
    const byPdlId = await db.query.organizations.findFirst({
      where: eq(organizations.pdlCompanyId, inputPdlId),
    });
    if (byPdlId) {
      console.log(`[ResolveOrg] Matched by PDL ID: "${byPdlId.name}" (${byPdlId.id})`);
      return { orgId: byPdlId.id, isNew: false, matchedBy: 'pdl_company_id', pdlEnriched: byPdlId.pdlEnriched ?? false };
    }
  }

  if (normalizedDomain) {
    const byDomain = await db.query.organizations.findFirst({
      where: eq(organizations.domain, normalizedDomain),
    });
    if (byDomain) {
      console.log(`[ResolveOrg] Matched by domain: "${byDomain.name}" (${byDomain.id})`);
      return { orgId: byDomain.id, isNew: false, matchedBy: 'domain', pdlEnriched: byDomain.pdlEnriched ?? false };
    }
  }

  console.log(`[ResolveOrg] No local match for "${name}" — calling PDL for identity resolution`);

  let pdlResult: PDLCompanyResult | null = null;
  let resolvedPdlId = inputPdlId || null;

  try {
    pdlResult = await enrichCompanyPDL(normalizedDomain || '', {
      name,
      linkedinUrl: linkedinUrl || undefined,
      pdlId: inputPdlId || undefined,
      locality: locality || undefined,
      region: region || undefined,
      streetAddress: streetAddress || undefined,
      postalCode: postalCode || undefined,
    });

    if (pdlResult.found && pdlResult.pdlCompanyId) {
      resolvedPdlId = pdlResult.pdlCompanyId;
      console.log(`[ResolveOrg] PDL found: "${pdlResult.name}" (ID=${resolvedPdlId})`);
    } else {
      console.log(`[ResolveOrg] PDL did not find a match for "${name}"`);
    }
  } catch (err) {
    console.warn(`[ResolveOrg] PDL lookup failed for "${name}":`, err instanceof Error ? err.message : err);
  }

  const pdlDomain = pdlResult?.found && pdlResult.website
    ? pdlResult.website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    : null;

  if (resolvedPdlId || pdlDomain) {
    const match = await findExistingOrgInDb({
      pdlCompanyId: resolvedPdlId,
      domain: pdlDomain,
    });

    if (match) {
      console.log(`[ResolveOrg] Matched existing org via PDL data: "${match.org.name}" (${match.org.id}) by ${match.matchedBy}`);

      if (pdlResult?.found && pdlResult.pdlCompanyId) {
        const updateData = buildPdlUpdateData(pdlResult);
        if (!match.org.pdlEnriched || match.org.pdlCompanyId !== pdlResult.pdlCompanyId) {
          await db.update(organizations)
            .set(updateData)
            .where(eq(organizations.id, match.org.id));
          console.log(`[ResolveOrg] Updated org "${match.org.name}" with PDL data`);
        }
      }

      return {
        orgId: match.org.id,
        isNew: false,
        matchedBy: match.matchedBy,
        pdlEnriched: !!(pdlResult?.found),
      };
    }
  }

  const insertData: Record<string, any> = {
    name,
    domain: normalizedDomain || pdlDomain || undefined,
    enrichmentStatus: pdlResult?.found ? 'complete' : 'pending',
  };

  if (pdlResult?.found) {
    Object.assign(insertData, buildPdlUpdateData(pdlResult));
  }

  const cleanInsert = Object.fromEntries(
    Object.entries(insertData).filter(([_, v]) => v !== undefined)
  );

  const [inserted] = await db.insert(organizations)
    .values(cleanInsert)
    .onConflictDoNothing()
    .returning({ id: organizations.id });

  if (inserted) {
    console.log(`[ResolveOrg] Created new org: "${name}" (${inserted.id}), PDL=${pdlResult?.found ? 'yes' : 'no'}`);

    if (pdlResult?.found && pdlResult.affiliatedProfiles?.length) {
      resolveAffiliatedCompanies(inserted.id, pdlResult.affiliatedProfiles)
        .catch(err => console.error(`[ResolveOrg] Error resolving affiliates:`, err));
    }

    return {
      orgId: inserted.id,
      isNew: true,
      matchedBy: 'created',
      pdlEnriched: !!(pdlResult?.found),
    };
  }

  const fallback = await findExistingOrgInDb({
    pdlCompanyId: resolvedPdlId,
    domain: normalizedDomain || pdlDomain,
  });

  if (fallback) {
    console.log(`[ResolveOrg] Found org after conflict: "${fallback.org.name}" (${fallback.org.id})`);
    return {
      orgId: fallback.org.id,
      isNew: false,
      matchedBy: fallback.matchedBy,
      pdlEnriched: !!(pdlResult?.found),
    };
  }

  throw new Error(`[ResolveOrg] Failed to create or find org: "${name}"`);

  } finally {
    if (orgLockAcquired) {
      try { await releaseLock(orgLockKey); } catch {}
    }
  }
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
  options?: { forceRefresh?: boolean; name?: string; linkedinUrl?: string; clerkOrgId?: string }
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
    clerkOrgId: options?.clerkOrgId,
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

    parentDomain: cascadeResult.parentDomain || undefined,
    ultimateParentDomain: cascadeResult.ultimateParentDomain || undefined,

    pdlEnriched: !!cascadeResult.pdlRaw,
    pdlEnrichedAt: cascadeResult.pdlRaw ? new Date() : undefined,
    pdlDataVersion: cascadeResult.datasetVersion || undefined,
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

  if (cascadeResult.parentDomain) {
    resolveParentHierarchy(orgRecord.id, cascadeResult.parentDomain)
      .catch(err => console.error(`[OrgEnrichment] Error resolving parent hierarchy for ${domain}:`, err));
  }

  return {
    success: true,
    orgId: orgRecord.id,
    enrichedData: cascadeResult,
  };
}

export async function enrichOrganizationById(orgId: string, options?: { clerkOrgId?: string }): Promise<OrganizationEnrichmentResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  
  if (!org) {
    return { success: false, orgId, enrichedData: null, error: 'org_not_found' };
  }
  
  if (org.domain) {
    return enrichOrganizationByDomain(org.domain, {
      name: org.name || undefined,
      linkedinUrl: org.linkedinHandle ? `https://linkedin.com/company/${org.linkedinHandle}` : undefined,
      clerkOrgId: options?.clerkOrgId,
    });
  }

  if (!org.name) {
    return { success: false, orgId, enrichedData: null, error: 'no_identifiers' };
  }

  let locality: string | undefined;
  let region: string | undefined;
  let postalCode: string | undefined;
  try {
    const propLink = await db.select({ propertyId: propertyOrganizations.propertyId })
      .from(propertyOrganizations).where(eq(propertyOrganizations.orgId, orgId)).limit(1);
    if (propLink[0]?.propertyId) {
      const [prop] = await db.select({ city: properties.city, state: properties.state, zip: properties.zip })
        .from(properties).where(eq(properties.id, propLink[0].propertyId)).limit(1);
      if (prop) {
        locality = prop.city || undefined;
        region = prop.state || undefined;
        postalCode = prop.zip || undefined;
      }
    }
  } catch {}

  console.log(`[OrgEnrichment] No domain for "${org.name}", trying PDL by name + location (${locality || 'unknown'}, ${region || 'unknown'})`);

  try {
    const pdlResult = await enrichCompanyPDL('', {
      name: org.name,
      linkedinUrl: org.linkedinHandle ? `https://linkedin.com/company/${org.linkedinHandle}` : undefined,
      locality,
      region,
      postalCode,
      clerkOrgId: options?.clerkOrgId,
    });

    if (pdlResult.found && pdlResult.pdlCompanyId) {
      const updateData = buildPdlUpdateData(pdlResult);
      await db.update(organizations)
        .set(updateData)
        .where(eq(organizations.id, orgId));
      console.log(`[OrgEnrichment] PDL enriched "${org.name}" by name: ${pdlResult.name} (${pdlResult.website || 'no website'})`);

      if (pdlResult.affiliatedProfiles?.length) {
        resolveAffiliatedCompanies(orgId, pdlResult.affiliatedProfiles)
          .catch(err => console.error(`[OrgEnrichment] Error resolving affiliates for ${org.name}:`, err));
      }

      return { success: true, orgId, enrichedData: null };
    }

    console.log(`[OrgEnrichment] PDL found nothing for "${org.name}" by name`);
    return { success: false, orgId, enrichedData: null, error: 'pdl_not_found' };
  } catch (err) {
    console.error(`[OrgEnrichment] PDL name-based enrichment failed for "${org.name}":`, err instanceof Error ? err.message : err);
    return { success: false, orgId, enrichedData: null, error: 'pdl_error' };
  }
}

export async function ensureEmployerOrgEnriched(opts: {
  contactId: string;
  companyDomain: string | null;
  companyName: string | null;
  companyPdlId: string | null;
  contactTitle: string | null;
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
}): Promise<{ orgId: string | null }> {
  const { contactId, companyDomain, companyName, companyPdlId, contactTitle, locality, region, postalCode } = opts;

  if (!companyDomain && !companyName && !companyPdlId) {
    return { orgId: null };
  }

  try {
    const orgName = companyName || (companyDomain
      ? companyDomain.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Unknown');

    const result = await resolveOrganization({
      name: orgName,
      domain: companyDomain,
      pdlCompanyId: companyPdlId,
      locality: locality || undefined,
      region: region || undefined,
      postalCode: postalCode || undefined,
    });

    console.log(`[OrgEnrichment] Employer org resolved: "${orgName}" → ${result.orgId} (${result.matchedBy}, new=${result.isNew}, pdl=${result.pdlEnriched})`);

    await db.insert(contactOrganizations)
      .values({
        contactId,
        orgId: result.orgId,
        title: contactTitle,
        isCurrent: true,
      })
      .onConflictDoNothing();

    return { orgId: result.orgId };
  } catch (err) {
    console.error(`[OrgEnrichment] Error ensuring employer org enriched for contact ${contactId}:`, err instanceof Error ? err.message : err);
    return { orgId: null };
  }
}

const MAX_AFFILIATED_LOOKUPS = 8;

export async function resolveAffiliatedCompanies(
  orgId: string,
  affiliatedPdlIds: string[]
): Promise<void> {
  if (!affiliatedPdlIds || affiliatedPdlIds.length === 0) return;

  const idsToResolve = affiliatedPdlIds.slice(0, MAX_AFFILIATED_LOOKUPS);
  console.log(`[OrgEnrichment] Resolving ${idsToResolve.length} affiliated companies for org ${orgId}`);

  const existingByPdlId = await db.select({ id: organizations.id, name: organizations.name, domain: organizations.domain, pdlCompanyId: organizations.pdlCompanyId })
    .from(organizations)
    .where(inArray(organizations.pdlCompanyId, idsToResolve));
  const knownPdlIds = new Set(existingByPdlId.map(o => o.pdlCompanyId));

  const unknownIds = idsToResolve.filter(id => !knownPdlIds.has(id));
  if (unknownIds.length === 0) {
    console.log(`[OrgEnrichment] All ${idsToResolve.length} affiliated companies already in DB`);
    return;
  }

  console.log(`[OrgEnrichment] ${knownPdlIds.size} already in DB, resolving ${unknownIds.length} new affiliated companies`);

  const limit = pLimit(4);
  await Promise.allSettled(unknownIds.map(pdlId => limit(async () => {
    try {
      const pdlResult = await enrichCompanyPDL('', { pdlId });
      if (!pdlResult.found || !pdlResult.name) {
        console.log(`[OrgEnrichment] PDL lookup for affiliated ID ${pdlId} — not found`);
        return;
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
          return;
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
  })));
}

/**
 * Resolve parent hierarchy for an org after enrichment writes parentDomain.
 * 1. Find or create an org record for parentDomain
 * 2. Set parentOrgId on the child org
 * 3. Walk up the parent chain to compute ultimateParentOrgId (max depth 10, cycle detection)
 * 4. Set ultimateParentDomain from the resolved ultimate parent
 */
export async function resolveParentHierarchy(
  orgId: string,
  parentDomain: string
): Promise<void> {
  const normalizedParentDomain = normalizeDomain(parentDomain);
  if (!normalizedParentDomain) return;

  console.log(`[OrgHierarchy] Resolving parent hierarchy for org ${orgId}, parentDomain=${normalizedParentDomain}`);

  // Find or create the parent org
  const parentOrg = await findOrCreateOrgByDomain(normalizedParentDomain);

  // Don't set self as parent
  if (parentOrg.id === orgId) {
    console.log(`[OrgHierarchy] Skipping self-reference for org ${orgId}`);
    return;
  }

  // Walk up the parent chain to find the ultimate parent (max depth 10, cycle detection)
  let ultimateParentId = parentOrg.id;
  let ultimateParentDomain = normalizedParentDomain;
  const visited = new Set<string>([orgId, parentOrg.id]);

  for (let depth = 0; depth < 10; depth++) {
    const current = await db.query.organizations.findFirst({
      where: eq(organizations.id, ultimateParentId),
      columns: { id: true, parentOrgId: true, domain: true },
    });

    if (!current?.parentOrgId || visited.has(current.parentOrgId)) break;

    visited.add(current.parentOrgId);
    ultimateParentId = current.parentOrgId;

    const nextParent = await db.query.organizations.findFirst({
      where: eq(organizations.id, ultimateParentId),
      columns: { domain: true },
    });
    if (nextParent?.domain) ultimateParentDomain = nextParent.domain;
  }

  // Update the child org with resolved IDs
  const updateData: Record<string, any> = {
    parentOrgId: parentOrg.id,
    updatedAt: new Date(),
  };

  // Only set ultimate parent if it differs from the direct parent
  if (ultimateParentId !== parentOrg.id) {
    updateData.ultimateParentOrgId = ultimateParentId;
    updateData.ultimateParentDomain = ultimateParentDomain;
  } else {
    updateData.ultimateParentOrgId = null;
    updateData.ultimateParentDomain = null;
  }

  await db.update(organizations)
    .set(updateData)
    .where(eq(organizations.id, orgId));

  console.log(`[OrgHierarchy] Resolved: org ${orgId} → parent ${parentOrg.id}${ultimateParentId !== parentOrg.id ? ` → ultimate ${ultimateParentId}` : ''}`);
}

async function findOrgByDomainOrName(domain: string | null, companyName: string | null): Promise<typeof organizations.$inferSelect | null> {
  if (domain) {
    const norm = normalizeDomain(domain);
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
    const norm1 = normalizeDomain(domain1);
    const norm2 = normalizeDomain(domain2);
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

  const norm1 = org1.domain ? normalizeDomain(org1.domain) : '';
  const norm2 = org2.domain ? normalizeDomain(org2.domain) : '';

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
