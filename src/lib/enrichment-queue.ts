import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import { db } from './db';
import { properties, contacts, organizations, propertyContacts, propertyOrganizations, contactOrganizations } from './schema';
import { eq, or, and, isNull, inArray } from 'drizzle-orm';
import { runFocusedEnrichment, cleanupAISummary, EnrichmentStageError } from './ai-enrichment';
import type { FocusedEnrichmentResult, DiscoveredContact, EnrichmentStageCheckpoint } from './ai-enrichment';
import { isCircuitBreakerError } from './rate-limiter';
import { enrichContactCascade } from './cascade-enrichment';
import { enrichOrganizationCascade } from './cascade-enrichment';
import { areCompaniesAffiliated, ensureEmployerOrgEnriched, enrichOrganizationByDomain, resolveOrganization } from './organization-enrichment';
import { findExistingContactByIdentifiers, flagPotentialDuplicateById, normalizeName as normalizeNameDedup, normalizeDomain as normalizeDomainDedup } from './deduplication';
import { getPropertyByKey } from './snowflake';
import type { AggregatedProperty } from './snowflake';
import { CONCURRENCY } from './constants';
import { 
  isRedisConfigured, 
  acquireLock, 
  releaseLock, 
  hashSet, 
  hashGet, 
  hashGetAll,
  hashDelete,
  queueStateGet, 
  queueStateSet,
  queueStateDelete 
} from './redis';

const ENRICHMENT_MAX_BATCH_SIZE = parseInt(process.env.ENRICHMENT_MAX_BATCH_SIZE || '200', 10);

// Keys without prefix - queueStateGet/Set adds 'gf:queue:' prefix, acquireLock adds 'gf:lock:' prefix
const REDIS_BATCH_KEY = 'enrichment:batch';
const REDIS_QUEUE_KEY = 'enrichment:items';
const REDIS_LOCK_KEY = 'enrichment:batch';
const REDIS_RATE_LIMIT_KEY = 'enrichment:last_request';
const REDIS_CHECKPOINTS_KEY = 'enrichment:checkpoints';

const memoryCheckpoints = new Map<string, EnrichmentStageCheckpoint>();

async function getCheckpoint(propertyKey: string): Promise<EnrichmentStageCheckpoint | null> {
  if (isRedisConfigured()) {
    return await hashGet<EnrichmentStageCheckpoint>(REDIS_CHECKPOINTS_KEY, propertyKey);
  }
  return memoryCheckpoints.get(propertyKey) || null;
}

async function saveCheckpoint(propertyKey: string, checkpoint: EnrichmentStageCheckpoint): Promise<void> {
  if (isRedisConfigured()) {
    await hashSet(REDIS_CHECKPOINTS_KEY, propertyKey, checkpoint);
  }
  memoryCheckpoints.set(propertyKey, checkpoint);
}

async function clearCheckpoint(propertyKey: string): Promise<void> {
  if (isRedisConfigured()) {
    await hashDelete(REDIS_CHECKPOINTS_KEY, propertyKey);
  }
  memoryCheckpoints.delete(propertyKey);
}

async function getPropertyFromPostgres(propertyKey: string): Promise<AggregatedProperty | null> {
  const [dbProperty] = await db
    .select()
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  if (!dbProperty) {
    return null;
  }

  const rawParcels = (dbProperty.rawParcelsJson as any[]) || [];
  
  let totalParval = 0;
  let totalImprovval = 0;
  let maxLandval = 0;
  const usedesc: string[] = [];
  const usecode: string[] = [];
  const zoning: string[] = [];
  const zoningDescription: string[] = [];
  const allOwners: string[] = [];

  for (const parcel of rawParcels) {
    totalParval += parcel.parval || 0;
    totalImprovval += parcel.improvval || 0;
    maxLandval = Math.max(maxLandval, parcel.landval || 0);
    
    if (parcel.usedesc && !usedesc.includes(parcel.usedesc)) {
      usedesc.push(parcel.usedesc);
    }
    if (parcel.usecode && !usecode.includes(parcel.usecode)) {
      usecode.push(parcel.usecode);
    }
    if (parcel.zoning && !zoning.includes(parcel.zoning)) {
      zoning.push(parcel.zoning);
    }
    if (parcel.zoningDescription && !zoningDescription.includes(parcel.zoningDescription)) {
      zoningDescription.push(parcel.zoningDescription);
    }
    if (parcel.owner && !allOwners.includes(parcel.owner)) {
      allOwners.push(parcel.owner);
    }
    if (parcel.owner2 && !allOwners.includes(parcel.owner2)) {
      allOwners.push(parcel.owner2);
    }
  }

  if (dbProperty.regridOwner && !allOwners.includes(dbProperty.regridOwner)) {
    allOwners.unshift(dbProperty.regridOwner);
  }
  if (dbProperty.regridOwner2 && !allOwners.includes(dbProperty.regridOwner2)) {
    allOwners.push(dbProperty.regridOwner2);
  }

  return {
    propertyKey: dbProperty.propertyKey,
    sourceLlUuid: dbProperty.sourceLlUuid || dbProperty.propertyKey,
    llStackUuid: dbProperty.llStackUuid || null,
    address: dbProperty.regridAddress || '',
    city: dbProperty.city || '',
    state: dbProperty.state || 'TX',
    zip: dbProperty.zip || '',
    county: dbProperty.county || '',
    lat: dbProperty.lat || 0,
    lon: dbProperty.lon || 0,
    lotSqft: dbProperty.lotSqft || 0,
    buildingSqft: dbProperty.buildingSqft || null,
    yearBuilt: dbProperty.yearBuilt || null,
    numFloors: dbProperty.numFloors || null,
    totalParval,
    totalImprovval,
    landval: maxLandval,
    allOwners,
    primaryOwner: allOwners[0] || dbProperty.regridOwner || null,
    usedesc,
    usecode,
    zoning,
    zoningDescription,
    parcelCount: rawParcels.length || 1,
    rawParcelsJson: rawParcels,
  };
}

function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

function normalizeName(name: string | null): string | null {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function saveEnrichmentResults(
  propertyKey: string,
  result: FocusedEnrichmentResult
): Promise<{ propertyId: string; contactIds: string[]; orgIds: string[] }> {
  const [dbProperty] = await db
    .select({ id: properties.id, city: properties.city, state: properties.state, zip: properties.zip })
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  if (!dbProperty) {
    throw new Error(`Property not found for key: ${propertyKey}`);
  }

  const propertyId = dbProperty.id;
  const classification = result.classification.data;
  const ownership = result.ownership.data;
  const physical = result.physical.data;
  const discoveredContacts = result.contacts.data.contacts || [];

  const allSummaries = [
    result.classification.summary,
    result.ownership.summary,
    result.contacts.summary,
  ].filter(Boolean).join('\n\n');

  let cleanedSummary = allSummaries;
  try {
    if (allSummaries.length > 50) {
      cleanedSummary = await cleanupAISummary(allSummaries);
    }
  } catch (e) {
    console.warn('[SaveEnrichment] Summary cleanup failed, using raw:', e);
  }

  const allSources = [
    ...(result.classification.sources || []),
    ...(result.ownership.sources || []),
    ...(result.contacts.sources || []),
  ];

  await db.update(properties)
    .set({
      commonName: classification.propertyName || undefined,
      validatedAddress: classification.canonicalAddress || undefined,
      assetCategory: classification.category || undefined,
      assetSubcategory: classification.subcategory || undefined,
      categoryConfidence: classification.confidence || undefined,
      propertyClass: classification.propertyClass || undefined,
      beneficialOwner: ownership.beneficialOwner?.name || undefined,
      beneficialOwnerType: ownership.beneficialOwner?.type || undefined,
      beneficialOwnerConfidence: ownership.beneficialOwner?.confidence || undefined,
      managementCompany: ownership.managementCompany?.name || undefined,
      managementCompanyDomain: ownership.managementCompany?.domain || undefined,
      managementConfidence: ownership.managementCompany?.confidence || undefined,
      propertyWebsite: ownership.propertyWebsite || undefined,
      propertyPhone: ownership.propertyPhone || undefined,
      aiLotAcres: physical.lotAcres || undefined,
      aiLotAcresConfidence: physical.lotAcresConfidence || undefined,
      aiNetSqft: physical.netSqft || undefined,
      aiNetSqftConfidence: physical.netSqftConfidence || undefined,
      aiRationale: cleanedSummary || undefined,
      enrichmentSources: allSources.length > 0 ? allSources.map(s => s.url).filter(Boolean) : undefined,
      enrichmentStatus: 'enriched',
      lastEnrichedAt: new Date(),
      enrichmentJson: {
        classification: result.classification.data,
        ownership: result.ownership.data,
        physical: result.physical.data,
        contacts: discoveredContacts,
        noContactsReason: discoveredContacts.length === 0 ? (result.contacts.summary || 'No verifiable contacts found') : undefined,
        timing: result.timing,
        sources: allSources,
      },
      updatedAt: new Date(),
    })
    .where(eq(properties.id, propertyId));

  console.log(`[SaveEnrichment] Updated property ${propertyKey} with enrichment data`);

  interface DerivedOrg { name: string; domain: string | null; orgType: string; roles: string[]; }
  const allOrgs: DerivedOrg[] = [];
  const existingDomains = new Set<string>();
  const existingNames = new Set<string>();

  if (ownership.managementCompany?.name && ownership.managementCompany.confidence > 0) {
    const mgmtDomain = ownership.managementCompany.domain?.trim().toLowerCase() || null;
    const mgmtName = ownership.managementCompany.name.trim().toLowerCase();
    console.log(`[SaveEnrichment] Adding org from ownership mgmt: ${ownership.managementCompany.name}`);
    allOrgs.push({
      name: ownership.managementCompany.name,
      domain: ownership.managementCompany.domain || null,
      orgType: 'management',
      roles: ['property_manager'],
    });
    if (mgmtDomain) existingDomains.add(mgmtDomain);
    existingNames.add(mgmtName);
  }

  if (ownership.beneficialOwner?.name && ownership.beneficialOwner.confidence > 0) {
    const ownerName = ownership.beneficialOwner.name.trim().toLowerCase();
    if (!existingNames.has(ownerName)) {
      let ownerDomain: string | null = null;
      const ownerNameNorm = ownerName.replace(/[^a-z0-9]/g, '');
      for (const contact of discoveredContacts) {
        if (contact.companyDomain && contact.company) {
          const contactCompanyNorm = contact.company.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
          if (contactCompanyNorm.includes(ownerNameNorm) || ownerNameNorm.includes(contactCompanyNorm)) {
            ownerDomain = contact.companyDomain;
            console.log(`[SaveEnrichment] Found domain for owner "${ownership.beneficialOwner.name}" from contact ${contact.name}: ${ownerDomain}`);
            break;
          }
        }
      }
      console.log(`[SaveEnrichment] Adding org from ownership owner: ${ownership.beneficialOwner.name} (domain: ${ownerDomain || 'none'})`);
      allOrgs.push({
        name: ownership.beneficialOwner.name,
        domain: ownerDomain,
        orgType: ownership.beneficialOwner.type || 'owner',
        roles: ['owner'],
      });
      if (ownerDomain) existingDomains.add(ownerDomain);
      existingNames.add(ownerName);
    }
  }

  for (const contact of discoveredContacts) {
    if (!contact.company) continue;
    const cName = contact.company.trim().toLowerCase();
    const cDomain = contact.companyDomain?.trim().toLowerCase() || null;
    if (existingNames.has(cName) || (cDomain && existingDomains.has(cDomain))) continue;
    console.log(`[SaveEnrichment] Deriving org from contact ${contact.name}: ${contact.company}`);
    allOrgs.push({
      name: contact.company,
      domain: contact.companyDomain || null,
      orgType: 'related',
      roles: [contact.role || 'related'],
    });
    existingNames.add(cName);
    if (cDomain) existingDomains.add(cDomain);
  }

  const orgIds: string[] = [];
  const resolvedOrgIds = new Set<string>();

  for (const org of allOrgs) {
    try {
      const result = await resolveOrganization({
        name: org.name,
        domain: org.domain,
        locality: dbProperty.city || undefined,
        region: dbProperty.state || undefined,
        postalCode: dbProperty.zip || undefined,
      });
      const orgId = result.orgId;
      console.log(`[SaveEnrichment] Resolved ${org.orgType || 'related'} org "${org.name}" → ${orgId} (${result.matchedBy}, new=${result.isNew}, pdl=${result.pdlEnriched})`);

      if (resolvedOrgIds.has(orgId)) {
        console.log(`[SaveEnrichment] Org ${orgId} already processed, adding role only`);
      }
      resolvedOrgIds.add(orgId);
      orgIds.push(orgId);

      await db.insert(propertyOrganizations)
        .values({
          propertyId,
          orgId,
          role: org.roles?.[0] || org.orgType || 'related',
        })
        .onConflictDoNothing();
    } catch (err) {
      console.error(`[SaveEnrichment] Error saving org ${org.name}:`, err);
    }
  }

  const contactIds: string[] = [];
  if (discoveredContacts.length === 0) {
    console.log(`[SaveEnrichment] No contacts to save for ${propertyKey}`);
  } else {
    console.log(`[SaveEnrichment] Saving ${discoveredContacts.length} contacts for ${propertyKey}: ${discoveredContacts.map((c: any) => c.name).join(', ')}`);
  }
  for (const contact of discoveredContacts) {
    try {
      const normalized = normalizeEmail(contact.email);
      const normalizedNameVal = normalizeName(contact.name);

      const contactLockIdentifier = normalized
        ? normalized
        : normalizedNameVal
          ? `${normalizedNameVal}::${contact.companyDomain?.toLowerCase() || contact.company?.toLowerCase() || ''}`
          : `${contact.name?.toLowerCase() || 'unknown'}`;
      const contactLockKey = `contact:create:${contactLockIdentifier}`;
      let lockAcquired = false;
      const maxLockRetries = 5;
      for (let attempt = 0; attempt < maxLockRetries; attempt++) {
        try {
          lockAcquired = await acquireLock(contactLockKey, 30);
          if (lockAcquired) break;
        } catch {}
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      }

      try {
        let existingContact = await findExistingContactByIdentifiers({
          email: contact.email,
          name: contact.name,
          companyDomain: contact.companyDomain,
          employerName: contact.company,
        }, { autoMergeNameMatches: true });

        let contactId: string;

        if (existingContact) {
          contactId = existingContact.id;
          await db.update(contacts)
            .set({
              title: contact.title || existingContact.title,
              companyDomain: contact.companyDomain || existingContact.companyDomain,
              employerName: contact.company || existingContact.employerName,
              phone: contact.phone || existingContact.phone,
              phoneLabel: contact.phoneLabel || existingContact.phoneLabel,
              aiPhone: contact.phone || existingContact.aiPhone,
              aiPhoneLabel: contact.phoneLabel || existingContact.aiPhoneLabel,
              aiPhoneConfidence: contact.phoneConfidence || existingContact.aiPhoneConfidence,
              contactType: contact.contactType || existingContact.contactType,
              location: contact.location || existingContact.location,
              updatedAt: new Date(),
            })
            .where(eq(contacts.id, existingContact.id));
          console.log(`[SaveEnrichment] Updated existing contact: ${contact.name} (${contactId})`);
        } else {
          const [inserted] = await db.insert(contacts)
            .values({
              fullName: contact.name,
              normalizedName: normalizedNameVal,
              nameConfidence: 0.8,
              email: contact.email,
              normalizedEmail: normalized,
              emailConfidence: contact.email ? 0.7 : null,
              emailSource: contact.emailSource || null,
              emailValidationStatus: contact.email ? 'pending' : null,
              phone: contact.phone,
              phoneLabel: contact.phoneLabel,
              phoneConfidence: contact.phoneConfidence,
              aiPhone: contact.phone,
              aiPhoneLabel: contact.phoneLabel,
              aiPhoneConfidence: contact.phoneConfidence,
              title: contact.title,
              titleConfidence: contact.title ? 0.7 : null,
              companyDomain: contact.companyDomain,
              employerName: contact.company,
              contactType: contact.contactType,
              location: contact.location,
              source: 'ai',
              enrichmentSource: 'ai',
              contactRationale: `AI-discovered: ${contact.role} (rank #${contact.priorityRank})`,
            })
            .onConflictDoNothing()
            .returning({ id: contacts.id });

          if (inserted) {
            contactId = inserted.id;
          } else {
            const found = normalized
              ? await db.query.contacts.findFirst({
                  where: eq(contacts.normalizedEmail, normalized),
                })
              : null;
            if (!found) {
              console.warn(`[SaveEnrichment] Could not insert or find contact: ${contact.name}, skipping`);
              continue;
            }
            contactId = found.id;
          }
          console.log(`[SaveEnrichment] Created contact: ${contact.name} (${contactId})`);

          const nnDedup = normalizeNameDedup(contact.name);
          const ndDedup = normalizeDomainDedup(contact.companyDomain);
          if (nnDedup) {
            const candidates = await db.select().from(contacts).where(eq(contacts.normalizedName, nnDedup));
            for (const c of candidates) {
              if (c.id === contactId) continue;
              if (ndDedup && normalizeDomainDedup(c.companyDomain) === ndDedup) {
                await flagPotentialDuplicateById(c.id, contactId, 'name_domain', `${nnDedup}::${ndDedup}`);
              } else if (contact.company && c.employerName && c.employerName.toLowerCase().trim() === contact.company.toLowerCase().trim()) {
                await flagPotentialDuplicateById(c.id, contactId, 'name_employer', `${nnDedup}::${contact.company.toLowerCase().trim()}`);
              }
            }
          }
        }

        contactIds.push(contactId);

        await db.insert(propertyContacts)
          .values({
            propertyId,
            contactId,
            role: contact.role,
            confidenceScore: contact.roleConfidence,
            discoveredAt: new Date(),
          })
          .onConflictDoNothing();

        if (contact.companyDomain) {
          const matchingOrg = await db.query.organizations.findFirst({
            where: eq(organizations.domain, contact.companyDomain.trim().toLowerCase()),
          });

          if (matchingOrg) {
            await db.insert(contactOrganizations)
              .values({
                contactId,
                orgId: matchingOrg.id,
                title: contact.title,
                isCurrent: true,
              })
              .onConflictDoNothing();
          }
        }
      } finally {
        if (lockAcquired) {
          try { await releaseLock(contactLockKey); } catch {}
        }
      }
    } catch (err) {
      console.error(`[SaveEnrichment] Error saving contact ${contact.name}:`, err);
    }
  }

  const uniqueContactIds = [...new Set(contactIds)];
  const uniqueOrgIds = [...new Set(orgIds)];
  console.log(`[SaveEnrichment] Complete for ${propertyKey}: ${uniqueContactIds.length} contacts (${contactIds.length - uniqueContactIds.length} dupes removed), ${uniqueOrgIds.length} orgs (${orgIds.length - uniqueOrgIds.length} dupes removed)`);
  return { propertyId, contactIds: uniqueContactIds, orgIds: uniqueOrgIds };
}

async function savePartialEnrichment(propertyKey: string, checkpoint: EnrichmentStageCheckpoint): Promise<void> {
  const [dbProperty] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  if (!dbProperty) return;

  const updateData: Record<string, any> = {
    enrichmentStatus: 'partial',
    updatedAt: new Date(),
  };

  if (checkpoint.classification) {
    const c = checkpoint.classification.data;
    if (c.propertyName) updateData.commonName = c.propertyName;
    if (c.canonicalAddress) updateData.validatedAddress = c.canonicalAddress;
    if (c.category) updateData.assetCategory = c.category;
    if (c.subcategory) updateData.assetSubcategory = c.subcategory;
    if (c.confidence) updateData.categoryConfidence = c.confidence;
    if (c.propertyClass) updateData.propertyClass = c.propertyClass;
  }

  if (checkpoint.ownership) {
    const o = checkpoint.ownership.data;
    if (o.beneficialOwner?.name) updateData.beneficialOwner = o.beneficialOwner.name;
    if (o.beneficialOwner?.type) updateData.beneficialOwnerType = o.beneficialOwner.type;
    if (o.managementCompany?.name) updateData.managementCompany = o.managementCompany.name;
    if (o.managementCompany?.domain) updateData.managementCompanyDomain = o.managementCompany.domain;
    if (o.propertyWebsite) updateData.propertyWebsite = o.propertyWebsite;
    if (o.propertyPhone) updateData.propertyPhone = o.propertyPhone;
  }

  updateData.enrichmentJson = {
    checkpoint: {
      lastCompletedStage: checkpoint.lastCompletedStage,
      failedStage: checkpoint.failedStage,
      failureError: checkpoint.failureError,
      failureCount: checkpoint.failureCount,
      timing: checkpoint.timing,
    },
    ...(checkpoint.classification ? { classification: checkpoint.classification.data } : {}),
    ...(checkpoint.ownership ? { ownership: checkpoint.ownership.data } : {}),
  };

  await db.update(properties)
    .set(updateData)
    .where(eq(properties.id, dbProperty.id));

  console.log(`[EnrichmentQueue] Saved partial enrichment for ${propertyKey} (last stage: ${checkpoint.lastCompletedStage})`);
}

function normalizeCompanyForComparison(name: string | null | undefined): string {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(llc|llp|inc|corp|co|ltd|lp|group|holdings|partners|properties|management|company|enterprises|realty|real estate)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function companiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const normA = normalizeCompanyForComparison(a);
  const normB = normalizeCompanyForComparison(b);
  if (!normA || !normB) return true;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  return false;
}

function domainsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const cleanA = a.toLowerCase().replace(/^www\./, '');
  const cleanB = b.toLowerCase().replace(/^www\./, '');
  return cleanA === cleanB;
}

export async function runCascadeEnrichmentOnSavedRecords(
  contactIds: string[],
  orgIds: string[],
  propertyId?: string
): Promise<void> {
  for (const orgId of orgIds) {
    try {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
      });
      if (!org || org.enrichmentStatus === 'enriched') continue;

      if (!org.domain && org.name) {
        console.log(`[CascadeEnrichment] Org has no domain, attempting PDL name lookup: ${org.name}`);
        try {
          const { enrichOrganizationById } = await import('./organization-enrichment');
          const nameResult = await enrichOrganizationById(org.id);
          if (nameResult?.success) {
            console.log(`[CascadeEnrichment] Enriched domain-less org: ${org.name}`);
          } else {
            console.log(`[CascadeEnrichment] Could not enrich ${org.name}: ${nameResult?.error || 'unknown'}`);
          }
        } catch (err) {
          console.error(`[CascadeEnrichment] Error in name-based org enrichment for ${org.name}:`, err);
        }
        continue;
      }

      if (!org.domain) continue;

      console.log(`[CascadeEnrichment] Enriching org: ${org.name} (${org.domain})`);
      const result = await enrichOrganizationCascade(org.domain, {
        name: org.name || undefined,
        linkedinUrl: org.linkedinHandle ? `https://linkedin.com/company/${org.linkedinHandle}` : undefined,
      });

      if (result.found) {
        const updateData: Record<string, any> = {
          enrichmentStatus: 'enriched',
          enrichedAt: new Date(),
          updatedAt: new Date(),
        };
        if (result.enrichmentSource) updateData.enrichmentSource = result.enrichmentSource;
        if (result.providerId) updateData.providerId = result.providerId;
        if (result.description) updateData.description = result.description;
        if (result.industry) updateData.industry = result.industry;
        if (result.employeeCount) updateData.employeeCount = result.employeeCount;
        if (result.employeesRange) updateData.employeesRange = result.employeesRange;
        if (result.foundedYear) updateData.foundedYear = result.foundedYear;
        if (result.city) updateData.city = result.city;
        if (result.state) updateData.state = result.state;
        if (result.country) updateData.country = result.country;
        if (result.website) updateData.website = result.website;
        if (result.linkedinUrl) updateData.linkedinUrl = result.linkedinUrl;
        if (result.twitterUrl) updateData.twitterUrl = result.twitterUrl;
        if (result.facebookUrl) updateData.facebookUrl = result.facebookUrl;
        if (result.logoUrl) updateData.logoUrl = result.logoUrl;
        if (result.phone) updateData.phone = result.phone;
        if (result.sicCodes) updateData.sicCodes = result.sicCodes;
        if (result.naicsCodes) updateData.naicsCodes = result.naicsCodes;
        if (result.tags) updateData.tags = result.tags;
        if (result.pdlRaw) {
          updateData.pdlRawResponse = result.pdlRaw;
          updateData.pdlEnriched = true;
          updateData.pdlEnrichedAt = new Date();
        }
        if (result.pdlCompanyId) updateData.pdlCompanyId = result.pdlCompanyId;
        if (result.affiliatedProfiles) updateData.affiliatedPdlIds = result.affiliatedProfiles;
        if (result.datasetVersion) updateData.pdlDataVersion = result.datasetVersion;
        if (result.crustdataRaw) {
          updateData.crustdataRawResponse = result.crustdataRaw;
          updateData.crustdataEnriched = true;
          updateData.crustdataEnrichedAt = new Date();
        }

        await db.update(organizations)
          .set(updateData)
          .where(eq(organizations.id, orgId));

        console.log(`[CascadeEnrichment] Org enriched: ${org.name} via ${result.enrichmentSource}`);
      }
    } catch (err) {
      console.error(`[CascadeEnrichment] Error enriching org ${orgId}:`, err);
    }
  }

  let propertyCity: string | null = null;
  let propertyState: string | null = null;
  let propertyZip: string | null = null;
  if (propertyId) {
    try {
      const propLoc = await db.select({ city: properties.city, state: properties.state, zip: properties.zip })
        .from(properties).where(eq(properties.id, propertyId)).limit(1);
      if (propLoc[0]) {
        propertyCity = propLoc[0].city;
        propertyState = propLoc[0].state;
        propertyZip = propLoc[0].zip;
      }
    } catch {}
  }

  const propertyOrgDomains = new Set<string>();
  const propertyOrgNames = new Set<string>();
  if (propertyId) {
    try {
      const propOrgs = await db.select({ orgId: propertyOrganizations.orgId })
        .from(propertyOrganizations)
        .where(eq(propertyOrganizations.propertyId, propertyId));
      const propOrgIds = propOrgs.map(po => po.orgId).filter((id): id is string => !!id);
      if (propOrgIds.length > 0) {
        const orgsData = await db.select({ domain: organizations.domain, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, propOrgIds));
        for (const o of orgsData) {
          if (o.domain) propertyOrgDomains.add(o.domain.toLowerCase().replace(/^www\./, ''));
          if (o.name) propertyOrgNames.add(o.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
        }
      }
    } catch (err) {
      console.warn('[CascadeEnrichment] Failed to load property orgs for employer gating:', err instanceof Error ? err.message : err);
    }
  }

  for (const contactId of contactIds) {
    try {
      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.id, contactId),
      });
      if (!contact || !contact.fullName) continue;
      if (contact.confidenceFlag === 'verified' || contact.confidenceFlag === 'pdl_matched') {
        console.log(`[CascadeEnrichment] Skipping already-enriched contact: ${contact.fullName} (${contact.confidenceFlag})`);
        continue;
      }
      if (contact.enrichmentSource && contact.enrichmentSource !== 'ai') {
        console.log(`[CascadeEnrichment] Skipping contact already processed by cascade: ${contact.fullName} (source: ${contact.enrichmentSource}, flag: ${contact.confidenceFlag})`);
        continue;
      }

      console.log(`[CascadeEnrichment] Enriching contact: ${contact.fullName} (${contact.email || 'no email'})`);

      const result = await enrichContactCascade({
        fullName: contact.fullName,
        email: contact.email,
        companyDomain: contact.companyDomain,
        companyName: contact.employerName,
        title: contact.title,
        location: contact.location || 'Dallas, TX',
        linkedinUrl: contact.linkedinUrl,
      });

      if (!result.found) {
        console.log(`[CascadeEnrichment] No data found for contact: ${contact.fullName} (${result.confidenceFlag})`);
        await db.update(contacts)
          .set({ confidenceFlag: result.confidenceFlag, updatedAt: new Date() })
          .where(eq(contacts.id, contactId));
        continue;
      }

      const updateData: Record<string, any> = {
        updatedAt: new Date(),
        confidenceFlag: result.confidenceFlag,
        enrichmentSource: result.enrichmentSource,
      };

      if (result.linkedinUrl) {
        updateData.linkedinUrl = result.linkedinUrl;
        updateData.linkedinConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
        updateData.linkedinStatus = result.confidenceFlag === 'verified' ? 'verified' : 'enriched';
      }
      if (result.email) {
        updateData.email = result.email;
        updateData.normalizedEmail = result.email.toLowerCase();
        updateData.emailConfidence = result.emailVerified ? 0.95 : 0.70;
        updateData.emailSource = result.emailSource;
        updateData.emailValidationStatus = result.emailStatus;
      }
      if (result.phone) {
        updateData.phone = result.phone;
        updateData.phoneConfidence = result.confidenceFlag === 'pdl_matched' ? 0.85 : 0.70;
        updateData.phoneSource = 'pdl';
        if (result.mobilePhone && result.phone === result.mobilePhone) {
          updateData.phoneLabel = 'mobile';
        } else {
          updateData.phoneLabel = 'direct_work';
        }
      }
      if (result.mobilePhone) {
        updateData.enrichmentPhonePersonal = result.mobilePhone;
      }
      if (result.workPhone) {
        updateData.enrichmentPhoneWork = result.workPhone;
      }
      if (result.employerLeftDetected) {
        const currentTitle = result.pdlTitle || result.crustdataTitle || result.title || null;
        const currentCompany = result.pdlCompany || result.crustdataCompany || null;
        const currentDomain = result.pdlCompanyDomain || result.crustdataCompanyDomain || null;
        if (currentTitle) {
          updateData.title = currentTitle;
          updateData.titleConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
        }
        if (currentCompany) {
          updateData.employerName = currentCompany;
        }
        if (currentDomain) {
          updateData.companyDomain = currentDomain;
        }
      } else {
        if (result.title && !contact.title) {
          updateData.title = result.title;
          updateData.titleConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
        }
        if (result.company && !contact.employerName) {
          updateData.employerName = result.company;
        }
        if (result.companyDomain && !contact.companyDomain) {
          updateData.companyDomain = result.companyDomain;
        }
      }
      if (result.photoUrl) {
        updateData.photoUrl = result.photoUrl;
      }
      if (result.location && !contact.location) {
        updateData.location = result.location;
      }
      if (result.seniority) {
        updateData.seniority = result.seniority;
      }

      updateData.findymailVerified = result.findymailVerified;
      updateData.findymailVerifyStatus = result.findymailVerifyStatus;
      updateData.pdlRawResponse = result.pdlRaw;
      updateData.crustdataRawResponse = result.crustdataRaw;
      updateData.pdlFullName = result.pdlFullName;
      updateData.pdlWorkEmail = result.pdlWorkEmail;
      updateData.pdlEmailsJson = result.pdlEmailsJson;
      updateData.pdlPersonalEmails = result.pdlPersonalEmails;
      updateData.pdlPhonesJson = result.pdlPhonesJson;
      updateData.pdlMobilePhone = result.pdlMobilePhone;
      updateData.pdlLinkedinUrl = result.pdlLinkedinUrl;
      updateData.pdlTitle = result.pdlTitle;
      updateData.pdlCompany = result.pdlCompany;
      updateData.pdlCompanyDomain = result.pdlCompanyDomain;
      updateData.pdlTitleRole = result.pdlTitleRole;
      updateData.pdlTitleLevels = result.pdlTitleLevels;
      updateData.pdlTitleClass = result.pdlTitleClass;
      updateData.pdlTitleSubRole = result.pdlTitleSubRole;
      updateData.pdlLocation = result.pdlLocation;
      updateData.pdlCity = result.pdlCity;
      updateData.pdlState = result.pdlState;
      updateData.pdlAddressesJson = result.pdlAddressesJson;
      updateData.pdlIndustry = result.pdlIndustry;
      updateData.pdlGender = result.pdlGender;
      updateData.pdlDatasetVersion = result.pdlDatasetVersion;
      updateData.crustdataTitle = result.crustdataTitle;
      updateData.crustdataCompany = result.crustdataCompany;
      updateData.crustdataCompanyDomain = result.crustdataCompanyDomain;
      updateData.crustdataWorkEmail = result.crustdataWorkEmail;
      updateData.crustdataLinkedinUrl = result.crustdataLinkedinUrl;
      updateData.crustdataLocation = result.crustdataLocation;
      updateData.crustdataPersonId = result.crustdataPersonId;
      updateData.crustdataEnriched = result.crustdataEnriched;
      if (result.crustdataEnriched) {
        updateData.crustdataEnrichedAt = new Date();
      }
      updateData.providerId = result.providerId;

      const cleanUpdate = Object.fromEntries(
        Object.entries(updateData).filter(([_, v]) => v !== undefined)
      );

      await db.update(contacts)
        .set(cleanUpdate)
        .where(eq(contacts.id, contactId));

      console.log(`[CascadeEnrichment] Contact enriched: ${contact.fullName} (${result.confidenceFlag})`);

      if (propertyId && (result.pdlCompany || result.crustdataCompany || result.employerLeftDetected)) {
        try {
          const aiCompany = contact.employerName;
          const aiDomain = contact.companyDomain;
          let jobChangeDetected = false;
          let changeReason = '';

          if (result.employerLeftDetected) {
            changeReason = result.employerLeftReason || `${contact.fullName} no longer appears to be at ${aiCompany || 'the company'}`;
            console.log(`[RoleVerification] EMPLOYER LEFT: ${changeReason}`);
            jobChangeDetected = true;
          } else {
            const hasCrustdataCompany = !!result.crustdataCompany;
            const enrichedCompany = result.crustdataCompany || result.pdlCompany;
            const enrichedDomain = result.crustdataCompanyDomain || result.pdlCompanyDomain;

            const nameMatch = companiesMatch(enrichedCompany, aiCompany);
            const domainMatch = domainsMatch(enrichedDomain, aiDomain);

            if (!nameMatch && !domainMatch && enrichedCompany) {
              const enrichedTitle = result.crustdataTitle || result.pdlTitle;
              const pdlTitle = result.pdlTitle || '';
              const isVolunteerOrBoard = /\b(volunteer|board member|commissioner|advisory|trustee|fellow|adjunct)\b/i.test(pdlTitle);

              const titleStillMatches = contact.title && enrichedTitle && 
                contact.title.toLowerCase().replace(/[^a-z0-9]/g, '') === enrichedTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

              let affiliated = false;
              try {
                affiliated = await areCompaniesAffiliated(aiDomain, enrichedDomain, aiCompany, enrichedCompany);
                if (affiliated) {
                  console.log(`[RoleVerification] Companies are affiliated (parent/subsidiary): "${aiCompany}" (${aiDomain}) ↔ "${enrichedCompany}" (${enrichedDomain}) — skipping job change flag`);
                }
              } catch (err) {
                console.warn('[RoleVerification] Affiliation check failed, continuing with other checks:', err instanceof Error ? err.message : err);
              }

              if (affiliated) {
                // Parent/subsidiary — not a job change
              } else if (!hasCrustdataCompany && isVolunteerOrBoard) {
                console.log(`[RoleVerification] Skipping PDL-only mismatch — PDL title "${pdlTitle}" appears to be a volunteer/board role, not primary employment`);
              } else if (!hasCrustdataCompany && result.crustdataTitle && companiesMatch(result.crustdataTitle, contact.title)) {
                console.log(`[RoleVerification] Skipping PDL-only mismatch — Crustdata title "${result.crustdataTitle}" matches AI title, but Crustdata has no company. PDL company "${enrichedCompany}" may not be primary employer`);
              } else if (!hasCrustdataCompany && titleStillMatches) {
                console.log(`[RoleVerification] Skipping PDL-only mismatch — title "${enrichedTitle}" matches existing title "${contact.title}". PDL company "${enrichedCompany}" is likely a parent/subsidiary of "${aiCompany}"`);
              } else {
                changeReason = `${contact.fullName} now at ${enrichedCompany}${enrichedTitle ? ` as ${enrichedTitle}` : ''} (was ${aiCompany || 'unknown'} for this property). Source: ${hasCrustdataCompany ? 'Crustdata' : 'PDL'}`;
                console.log(`[RoleVerification] MISMATCH: ${changeReason}`);
                jobChangeDetected = true;
              }
            }
          }

          if (jobChangeDetected) {
            await db.update(propertyContacts)
              .set({
                relationshipStatus: 'job_change_detected',
                relationshipStatusReason: changeReason,
                relationshipVerifiedAt: new Date(),
              })
              .where(
                and(
                  eq(propertyContacts.propertyId, propertyId),
                  eq(propertyContacts.contactId, contactId)
                )
              );

            const [pcRow, prop] = await Promise.all([
              db.query.propertyContacts.findFirst({
                where: and(
                  eq(propertyContacts.propertyId, propertyId),
                  eq(propertyContacts.contactId, contactId)
                ),
              }),
              db.query.properties.findFirst({
                where: eq(properties.id, propertyId),
              }),
            ]);

            searchForReplacement(
              propertyId,
              pcRow?.role || contact.title,
              aiCompany,
              aiDomain,
              prop?.validatedAddress || prop?.regridAddress || undefined
            ).catch(err => console.error('[RoleVerification] Replacement search error:', err));
          } else {
            await db.update(propertyContacts)
              .set({
                relationshipStatus: 'active',
                relationshipVerifiedAt: new Date(),
              })
              .where(
                and(
                  eq(propertyContacts.propertyId, propertyId),
                  eq(propertyContacts.contactId, contactId)
                )
              );
          }
        } catch (verifyErr) {
          console.error(`[RoleVerification] Error verifying role for ${contact.fullName}:`, verifyErr);
        }
      }

      const employerDomain = result.pdlCompanyDomain || result.crustdataCompanyDomain || result.companyDomain || contact.companyDomain;
      const employerName = result.pdlCompany || result.crustdataCompany || result.company || contact.employerName;
      const employerPdlId = result.companyPdlId || null;

      if (employerDomain || employerName || employerPdlId) {
        let isPropertyRelevantEmployer = propertyOrgDomains.size === 0 && propertyOrgNames.size === 0;
        if (!isPropertyRelevantEmployer && employerDomain) {
          const cleanDomain = employerDomain.toLowerCase().replace(/^www\./, '');
          isPropertyRelevantEmployer = propertyOrgDomains.has(cleanDomain);
        }
        if (!isPropertyRelevantEmployer && employerName) {
          const cleanName = employerName.toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const pName of propertyOrgNames) {
            if (cleanName === pName || cleanName.includes(pName) || pName.includes(cleanName)) {
              isPropertyRelevantEmployer = true;
              break;
            }
          }
        }

        if (isPropertyRelevantEmployer) {
          ensureEmployerOrgEnriched({
            contactId,
            companyDomain: employerDomain || null,
            companyName: employerName || null,
            companyPdlId: employerPdlId,
            contactTitle: result.pdlTitle || result.crustdataTitle || result.title || contact.title || null,
            locality: propertyCity,
            region: propertyState,
            postalCode: propertyZip,
          }).catch(err => {
            console.error(`[CascadeEnrichment] Error ensuring employer org for ${contact.fullName}:`, err instanceof Error ? err.message : err);
          });
        } else {
          console.log(`[CascadeEnrichment] Skipping employer org enrichment for "${contact.fullName}" — employer "${employerName || employerDomain}" is not a property-relevant org`);
        }
      }
    } catch (err) {
      console.error(`[CascadeEnrichment] Error enriching contact ${contactId}:`, err);
    }
  }
}

const replacementSearchCooldown = new Map<string, number>();
const MAX_COOLDOWN_ENTRIES = 5000;

function cleanupReplacementCooldown(): void {
  const now = Date.now();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;
  let removedCount = 0;

  for (const [key, timestamp] of replacementSearchCooldown.entries()) {
    if (now - timestamp > twentyFourHoursMs) {
      replacementSearchCooldown.delete(key);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`[CleanupCooldown] Removed ${removedCount} expired entries from replacementSearchCooldown`);
  }

  // If the map still exceeds max entries after cleanup, remove oldest entries
  if (replacementSearchCooldown.size > MAX_COOLDOWN_ENTRIES) {
    const entriesToRemove = replacementSearchCooldown.size - MAX_COOLDOWN_ENTRIES;
    let removed = 0;
    for (const [key, timestamp] of replacementSearchCooldown.entries()) {
      if (removed >= entriesToRemove) break;
      replacementSearchCooldown.delete(key);
      removed++;
    }
    console.log(`[CleanupCooldown] Removed ${removed} oldest entries to enforce MAX_COOLDOWN_ENTRIES limit`);
  }
}

async function searchForReplacement(
  propertyId: string,
  formerRole: string | null,
  formerCompany: string | null,
  formerCompanyDomain: string | null,
  propertyAddress?: string
): Promise<void> {
  if (!formerCompany && !formerCompanyDomain) return;
  
  const cooldownKey = `${propertyId}:${formerRole || 'default'}:${formerCompany || formerCompanyDomain}`;
  const lastSearch = replacementSearchCooldown.get(cooldownKey) || 0;
  if (Date.now() - lastSearch < 24 * 60 * 60 * 1000) {
    console.log(`[ReplacementSearch] Skipping - cooldown active for ${cooldownKey}`);
    return;
  }
  replacementSearchCooldown.set(cooldownKey, Date.now());

  const roleDesc = formerRole || 'property manager';
  const company = formerCompany || formerCompanyDomain || 'the company';
  
  console.log(`[ReplacementSearch] Searching for replacement ${roleDesc} at ${company} for property ${propertyId}`);
  
  try {
    const { searchForReplacementContact } = await import('./ai-enrichment');
    const result = await searchForReplacementContact(roleDesc, company, propertyAddress);

    if (!result?.name) {
      console.log('[ReplacementSearch] No replacement found');
      return;
    }

    console.log(`[ReplacementSearch] Found potential replacement: ${result.name} - ${result.title || 'unknown title'}`);

    const normalizedNameVal = normalizeName(result.name);
    const normalizedEmailVal = result.email ? normalizeEmail(result.email) : null;

    let existingContact = await findExistingContactByIdentifiers({
      email: result.email,
      name: result.name,
      companyDomain: formerCompanyDomain,
      employerName: result.company || formerCompany,
    });

    const existingFormerLinks = await db.select().from(propertyContacts).where(
      and(
        eq(propertyContacts.propertyId, propertyId),
        eq(propertyContacts.relationshipStatus, 'job_change_detected')
      )
    );
    for (const link of existingFormerLinks) {
      if (!link.contactId) continue;
      const formerContact = await db.query.contacts.findFirst({ where: eq(contacts.id, link.contactId) });
      if (formerContact && normalizeName(formerContact.fullName) === normalizedNameVal) {
        console.log(`[ReplacementSearch] "${result.name}" matches a former contact on this property, skipping`);
        return;
      }
    }

    let contactId: string;

    if (existingContact) {
      contactId = existingContact.id;
      console.log(`[ReplacementSearch] Replacement matches existing contact: ${existingContact.fullName} (${contactId})`);
    } else {
      const [newContact] = await db.insert(contacts)
        .values({
          fullName: result.name,
          normalizedName: normalizedNameVal,
          email: result.email || null,
          normalizedEmail: normalizedEmailVal,
          title: result.title || null,
          employerName: result.company || formerCompany,
          companyDomain: formerCompanyDomain,
          contactType: 'individual',
          confidenceFlag: 'ai_only',
          emailValidationStatus: result.email ? 'pending' : null,
        })
        .returning();
      contactId = newContact.id;
      console.log(`[ReplacementSearch] Created new replacement contact: ${result.name} (${contactId})`);
    }

    const existingLink = await db.query.propertyContacts.findFirst({
      where: and(
        eq(propertyContacts.propertyId, propertyId),
        eq(propertyContacts.contactId, contactId)
      ),
    });

    if (!existingLink) {
      await db.insert(propertyContacts).values({
        propertyId,
        contactId,
        role: formerRole || 'property_manager',
        confidenceScore: 0.5,
        relationshipConfidence: 'medium',
        relationshipNote: `Replacement found via AI search after previous contact left role`,
        relationshipStatus: 'active',
        relationshipVerifiedAt: new Date(),
      });
      console.log(`[ReplacementSearch] Linked replacement ${result.name} to property ${propertyId}`);

      try {
        const cascadeResult = await enrichContactCascade({
          fullName: result.name,
          email: result.email || undefined,
          companyDomain: formerCompanyDomain || undefined,
          companyName: result.company || formerCompany || undefined,
          title: result.title || undefined,
          location: 'Dallas, TX',
        });

        if (cascadeResult.found) {
          const updateData: Record<string, any> = {
            updatedAt: new Date(),
            confidenceFlag: cascadeResult.confidenceFlag,
            enrichmentSource: cascadeResult.enrichmentSource,
          };
          if (cascadeResult.email) {
            updateData.email = cascadeResult.email;
            updateData.normalizedEmail = cascadeResult.email.toLowerCase();
            updateData.emailSource = cascadeResult.emailSource;
            updateData.emailValidationStatus = cascadeResult.emailStatus;
          }
          if (cascadeResult.linkedinUrl) updateData.linkedinUrl = cascadeResult.linkedinUrl;
          if (cascadeResult.phone) updateData.phone = cascadeResult.phone;
          if (cascadeResult.mobilePhone) updateData.enrichmentPhonePersonal = cascadeResult.mobilePhone;
          if (cascadeResult.workPhone) updateData.enrichmentPhoneWork = cascadeResult.workPhone;
          if (cascadeResult.title) updateData.title = cascadeResult.title;
          if (cascadeResult.company) updateData.employerName = cascadeResult.company;

          updateData.pdlTitle = cascadeResult.pdlTitle;
          updateData.pdlCompany = cascadeResult.pdlCompany;
          updateData.pdlCompanyDomain = cascadeResult.pdlCompanyDomain;
          updateData.crustdataTitle = cascadeResult.crustdataTitle;
          updateData.crustdataCompany = cascadeResult.crustdataCompany;
          updateData.providerId = cascadeResult.providerId;

          const cleanUpdate = Object.fromEntries(
            Object.entries(updateData).filter(([_, v]) => v !== undefined)
          );
          await db.update(contacts).set(cleanUpdate).where(eq(contacts.id, contactId));
          console.log(`[ReplacementSearch] Replacement enriched: ${result.name} (${cascadeResult.confidenceFlag})`);
        }
      } catch (enrichErr) {
        console.error(`[ReplacementSearch] Error enriching replacement:`, enrichErr);
      }
    } else {
      console.log(`[ReplacementSearch] Replacement ${result.name} already linked to property`);
    }
  } catch (error) {
    console.error('[ReplacementSearch] Error:', error);
  }
}

export interface QueueProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  propertiesPerMinute?: number;
  estimatedSecondsRemaining?: number;
}

export interface BatchStatus {
  batchId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: QueueProgress;
  startedAt: Date | null;
  completedAt: Date | null;
  errors: Array<{ propertyKey: string; error: string; stage?: string; retryable?: boolean }>;
  concurrency: number;
}

interface QueueItem {
  propertyKey: string;
  propertyId?: string;
  retryAttempt?: number;
  lastFailedStage?: string;
}

// In-memory fallback state (used when Redis is not configured)
let memoryBatch: BatchStatus | null = null;
let memoryQueue: QueueItem[] = [];
let memoryIsProcessing = false;
let memoryLastRequestTime = 0;
let memoryBatchStartLock = false;
const INDIVIDUAL_RATE_LIMIT_MS = 2000; // 2 seconds between individual requests
const BATCH_LOCK_TTL_SECONDS = 300; // 5 minute lock for batch operations

// Redis-backed state management with in-memory fallback
async function getBatchStatus(): Promise<BatchStatus | null> {
  if (isRedisConfigured()) {
    return await queueStateGet<BatchStatus>(REDIS_BATCH_KEY);
  }
  return memoryBatch;
}

async function setBatchStatus(batch: BatchStatus): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateSet(REDIS_BATCH_KEY, batch, 3600); // 1 hour TTL
  }
  memoryBatch = batch;
}

async function clearBatchStatus(): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateDelete(REDIS_BATCH_KEY);
  }
  memoryBatch = null;
}

async function getQueueItems(): Promise<QueueItem[]> {
  if (isRedisConfigured()) {
    const items = await queueStateGet<QueueItem[]>(REDIS_QUEUE_KEY);
    return items || [];
  }
  return memoryQueue;
}

async function setQueueItems(items: QueueItem[]): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateSet(REDIS_QUEUE_KEY, items, 3600);
  }
  memoryQueue = items;
}

async function getLastRequestTime(): Promise<number> {
  if (isRedisConfigured()) {
    const time = await queueStateGet<number>(REDIS_RATE_LIMIT_KEY);
    return time || 0;
  }
  return memoryLastRequestTime;
}

async function setLastRequestTime(time: number): Promise<void> {
  if (isRedisConfigured()) {
    await queueStateSet(REDIS_RATE_LIMIT_KEY, time, 60); // 1 minute TTL
  }
  memoryLastRequestTime = time;
}

export async function getQueueStatus(): Promise<BatchStatus | null> {
  return getBatchStatus();
}

const STALE_BATCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes with no progress = stale

export async function isBatchRunning(): Promise<boolean> {
  const batch = await getBatchStatus();
  if (!batch || batch.status !== 'running') return false;

  if (isRedisConfigured()) {
    const startedAt = batch.startedAt ? new Date(batch.startedAt).getTime() : 0;
    const elapsed = Date.now() - startedAt;
    if (elapsed > STALE_BATCH_TIMEOUT_MS && batch.progress.processed === 0) {
      console.warn(`[EnrichmentQueue] Detected stale batch ${batch.batchId} - started ${Math.round(elapsed / 1000)}s ago with 0 progress. Auto-cancelling.`);
      batch.status = 'failed';
      batch.completedAt = new Date();
      batch.errors.push({ propertyKey: '', error: 'Batch became stale (server restart or timeout)' });
      await setBatchStatus(batch);
      await releaseLock(REDIS_LOCK_KEY);
      return false;
    }
    return true;
  }
  return memoryIsProcessing;
}

export async function cancelBatch(): Promise<{ cancelled: boolean; message: string }> {
  const batch = await getBatchStatus();
  if (!batch || batch.status !== 'running') {
    return { cancelled: false, message: 'No running batch to cancel' };
  }
  batch.status = 'failed';
  batch.completedAt = new Date();
  batch.errors.push({ propertyKey: '', error: 'Manually cancelled by admin' });
  await setBatchStatus(batch);
  memoryIsProcessing = false;
  if (isRedisConfigured()) {
    await releaseLock(REDIS_LOCK_KEY);
  }
  console.log(`[EnrichmentQueue] Batch ${batch.batchId} cancelled by admin`);
  return { cancelled: true, message: `Batch ${batch.batchId} cancelled. Processed ${batch.progress.processed}/${batch.progress.total}.` };
}

export async function checkRateLimitForIndividual(): Promise<boolean> {
  const now = Date.now();
  const lastTime = await getLastRequestTime();
  return now - lastTime >= INDIVIDUAL_RATE_LIMIT_MS;
}

export async function updateLastRequestTime(): Promise<void> {
  await setLastRequestTime(Date.now());
}

export async function addToQueue(items: QueueItem[]): Promise<void> {
  const currentQueue = await getQueueItems();
  await setQueueItems([...currentQueue, ...items]);
}

export async function processPropertyItem(
  item: { propertyKey: string; retryAttempt?: number; lastFailedStage?: string },
  startTime: number
): Promise<{ success: boolean; error?: string; failedStage?: string; isRetryable?: boolean }> {
  try {
    let property = await getPropertyFromPostgres(item.propertyKey);
    
    if (!property) {
      console.log(`[EnrichmentQueue] Property not in Postgres, trying Snowflake: ${item.propertyKey}`);
      property = await getPropertyByKey(item.propertyKey);
    }
    
    if (!property) {
      return { success: false, error: 'Property not found in database' };
    }

    const dbProp = property as any;
    const dcadProperty = dbProp.dcad || {
      parcelId: dbProp.propertyKey,
      address: dbProp.address || dbProp.regridAddress || '',
      city: dbProp.city || '',
      zip: dbProp.zip || '',
      lat: dbProp.lat || 0,
      lon: dbProp.lon || 0,
      usedesc: dbProp.usedesc?.[0] || dbProp.dcadZoning || '',
      usecode: dbProp.usecode?.[0] || '',
      sptdCode: dbProp.dcadSptdCode || null,
      regridYearBuilt: dbProp.yearBuilt || dbProp.dcadOldestYearBuilt || null,
      regridNumStories: dbProp.numFloors || null,
      lotSqft: dbProp.lotSqft || null,
      lotAcres: dbProp.lotSqft ? dbProp.lotSqft / 43560 : (dbProp.dcadLandArea || null),
      accountNum: dbProp.dcadAccountNum || '',
      gisParcelId: dbProp.dcadGisParcelId || null,
      divisionCd: dbProp.dcadDivisionCd || 'COM',
      dcadImprovVal: dbProp.dcadImprovVal || null,
      dcadLandVal: dbProp.dcadLandVal || null,
      dcadTotalVal: dbProp.dcadTotalVal || null,
      bizName: dbProp.dcadBizName || dbProp.primaryOwner || null,
      ownerName1: dbProp.dcadOwnerName1 || dbProp.allOwners?.[0] || null,
      ownerName2: dbProp.dcadOwnerName2 || dbProp.allOwners?.[1] || null,
      buildingCount: dbProp.dcadBuildingCount || 1,
      totalGrossBldgArea: dbProp.dcadTotalGrossBldgArea || dbProp.buildingSqft || null,
      buildings: dbProp.dcadBuildings || [],
    };

    const checkpoint = await getCheckpoint(item.propertyKey);
    if (checkpoint?.lastCompletedStage) {
      console.log(`[EnrichmentQueue] Resuming ${item.propertyKey} from checkpoint (last stage: ${checkpoint.lastCompletedStage}, attempts: ${checkpoint.failureCount || 0})`);
    }
    const enrichmentResult = await runFocusedEnrichment(dcadProperty as any, checkpoint);
    
    const saved = await saveEnrichmentResults(item.propertyKey, enrichmentResult);

    await clearCheckpoint(item.propertyKey);
    
    if (saved.contactIds.length > 0 || saved.orgIds.length > 0) {
      console.log(`[EnrichmentQueue] Running cascade enrichment on ${saved.contactIds.length} contacts, ${saved.orgIds.length} orgs...`);
      await runCascadeEnrichmentOnSavedRecords(saved.contactIds, saved.orgIds, saved.propertyId);
    }
    
    return { success: true };
  } catch (error) {
    console.error(`[EnrichmentQueue] Error processing ${item.propertyKey}:`, error);

    if (error instanceof EnrichmentStageError) {
      const cp = error.checkpoint;
      cp.failureCount = (cp.failureCount || 0) + 1;
      await saveCheckpoint(item.propertyKey, cp);

      if (cp.classification && cp.physical) {
        try {
          await savePartialEnrichment(item.propertyKey, cp);
        } catch (saveErr) {
          console.error(`[EnrichmentQueue] Error saving partial enrichment:`, saveErr);
        }
      }

      return {
        success: false,
        error: error.message,
        failedStage: error.stage,
        isRetryable: (cp.failureCount || 0) < 3
      };
    }

    if (isCircuitBreakerError(error)) {
      return { success: false, error: `Circuit breaker open: ${error.message}`, isRetryable: true };
    }

    const msg = error instanceof Error ? error.message : String(error);
    const isTransient = /timeout|rate.limit|ECONNRESET|ENOTFOUND|fetch.failed|429|503|502/i.test(msg);
    return { success: false, error: msg, isRetryable: isTransient };
  }
}

function updateProgressStats(batch: BatchStatus, startTime: number): void {
  const elapsedMs = Date.now() - startTime;
  const elapsedMinutes = elapsedMs / 60000;
  
  if (elapsedMinutes > 0 && batch.progress.processed > 0) {
    batch.progress.propertiesPerMinute = Math.round(
      batch.progress.processed / elapsedMinutes
    );
    
    const remaining = batch.progress.total - batch.progress.processed;
    if (batch.progress.propertiesPerMinute > 0) {
      batch.progress.estimatedSecondsRemaining = Math.round(
        (remaining / batch.progress.propertiesPerMinute) * 60
      );
    }
  }
}

export async function processQueue(): Promise<void> {
  // Check if already processing
  if (await isBatchRunning()) {
    console.log('[EnrichmentQueue] Already processing, skipping');
    return;
  }

  const queue = await getQueueItems();
  if (queue.length === 0) {
    console.log('[EnrichmentQueue] Queue is empty');
    return;
  }

  // For in-memory mode, set the flag
  memoryIsProcessing = true;
  return processQueueInternal();
}

class AdaptiveConcurrencyController {
  private currentConcurrency: number;
  private readonly minConcurrency: number;
  private readonly maxConcurrency: number;
  private recentResults: Array<{ success: boolean; timestamp: number }> = [];
  private readonly windowSize = 10;
  private readonly errorThresholdDown = 0.4;
  private readonly errorThresholdUp = 0.1;
  private lastAdjustment = 0;
  private readonly adjustCooldownMs = 30000;

  constructor(initial: number, min: number = 3, max?: number) {
    this.currentConcurrency = initial;
    this.minConcurrency = min;
    this.maxConcurrency = max || initial;
  }

  recordResult(success: boolean): void {
    this.recentResults.push({ success, timestamp: Date.now() });
    if (this.recentResults.length > this.windowSize) {
      this.recentResults.shift();
    }
  }

  shouldThrottle(): boolean {
    if (this.recentResults.length < 5) return false;
    const errorRate = this.recentResults.filter(r => !r.success).length / this.recentResults.length;
    return errorRate >= this.errorThresholdDown;
  }

  adjust(): { changed: boolean; newConcurrency: number; reason?: string } {
    if (Date.now() - this.lastAdjustment < this.adjustCooldownMs) {
      return { changed: false, newConcurrency: this.currentConcurrency };
    }
    if (this.recentResults.length < 5) {
      return { changed: false, newConcurrency: this.currentConcurrency };
    }

    const errorRate = this.recentResults.filter(r => !r.success).length / this.recentResults.length;

    if (errorRate >= this.errorThresholdDown && this.currentConcurrency > this.minConcurrency) {
      const newVal = Math.max(this.minConcurrency, Math.floor(this.currentConcurrency * 0.6));
      if (newVal < this.currentConcurrency) {
        const reason = `Error rate ${(errorRate * 100).toFixed(0)}% ≥ ${(this.errorThresholdDown * 100).toFixed(0)}% → reducing ${this.currentConcurrency} → ${newVal}`;
        this.currentConcurrency = newVal;
        this.lastAdjustment = Date.now();
        this.recentResults = [];
        return { changed: true, newConcurrency: newVal, reason };
      }
    } else if (errorRate <= this.errorThresholdUp && this.currentConcurrency < this.maxConcurrency) {
      const newVal = Math.min(this.maxConcurrency, this.currentConcurrency + 2);
      if (newVal > this.currentConcurrency) {
        const reason = `Error rate ${(errorRate * 100).toFixed(0)}% ≤ ${(this.errorThresholdUp * 100).toFixed(0)}% → increasing ${this.currentConcurrency} → ${newVal}`;
        this.currentConcurrency = newVal;
        this.lastAdjustment = Date.now();
        this.recentResults = [];
        return { changed: true, newConcurrency: newVal, reason };
      }
    }

    return { changed: false, newConcurrency: this.currentConcurrency };
  }

  get concurrency(): number {
    return this.currentConcurrency;
  }
}

async function processQueueInternal(): Promise<void> {
  const startTime = Date.now();
  let batch = await getBatchStatus();
  const concurrencyLimit = batch?.concurrency || CONCURRENCY.PROPERTIES;
  const adaptiveController = new AdaptiveConcurrencyController(concurrencyLimit, 3, concurrencyLimit);
  
  console.log(`[EnrichmentQueue] Starting wave-based processing with initial concurrency=${concurrencyLimit} (adaptive)`);

  try {
    const items = await getQueueItems();
    await setQueueItems([]); // Clear queue
    
    let processedIndex = 0;
    
    while (processedIndex < items.length) {
      const currentConcurrency = adaptiveController.concurrency;
      const waveEnd = Math.min(processedIndex + currentConcurrency, items.length);
      const waveItems = items.slice(processedIndex, waveEnd);
      const waveNum = Math.floor(processedIndex / Math.max(currentConcurrency, 1)) + 1;
      
      console.log(`[EnrichmentQueue] Wave ${waveNum}: items ${processedIndex + 1}-${waveEnd}/${items.length}, concurrency=${currentConcurrency}`);
      
      const waveLimit = pLimit(currentConcurrency);
      
      const wavePromises = waveItems.map((item, waveIdx) => {
        const globalIndex = processedIndex + waveIdx;
        return waveLimit(async () => {
          const itemStart = Date.now();
          console.log(`[EnrichmentQueue] [${globalIndex + 1}/${items.length}] Processing: ${item.propertyKey}`);
          
          if (adaptiveController.shouldThrottle()) {
            const throttleDelay = 2000 + Math.random() * 3000;
            console.log(`[EnrichmentQueue] Throttling ${item.propertyKey} for ${Math.round(throttleDelay)}ms due to high error rate`);
            await new Promise(resolve => setTimeout(resolve, throttleDelay));
          }

          const result = await processPropertyItem(item, startTime);
          
          adaptiveController.recordResult(result.success);

          batch = await getBatchStatus();
          if (batch) {
            batch.progress.processed++;
            if (result.success) {
              batch.progress.succeeded++;
            } else {
              batch.progress.failed++;
              batch.errors.push({
                propertyKey: item.propertyKey,
                error: result.error || 'Unknown error',
                stage: result.failedStage,
                retryable: result.isRetryable,
              });
            }
            updateProgressStats(batch, startTime);
            await setBatchStatus(batch);
          }
          
          const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
          const status = result.success ? 'SUCCESS' : 'FAILED';
          const ppm = batch?.progress.propertiesPerMinute || 0;
          const eta = batch?.progress.estimatedSecondsRemaining;
          const etaStr = eta ? `ETA: ${Math.round(eta / 60)}m ${eta % 60}s` : '';
          
          console.log(`[EnrichmentQueue] [${globalIndex + 1}/${items.length}] ${status} (${elapsed}s) | Rate: ${ppm}/min | Concurrency: ${currentConcurrency} | ${etaStr}`);
          
          return result;
        });
      });

      await Promise.all(wavePromises);
      
      const adjustment = adaptiveController.adjust();
      if (adjustment.changed) {
        console.log(`[EnrichmentQueue] Adaptive concurrency between waves: ${adjustment.reason}`);
      }
      
      processedIndex = waveEnd;
    }

    const retryableItems = batch ? batch.errors
      .filter(e => e.retryable && e.propertyKey)
      .map(e => ({ propertyKey: e.propertyKey, retryAttempt: 1, lastFailedStage: e.stage })) : [];

    if (retryableItems.length > 0 && batch) {
      console.log(`[EnrichmentQueue] Starting retry pass for ${retryableItems.length} failed properties...`);

      const retryDelay = 10000;
      await new Promise(resolve => setTimeout(resolve, retryDelay));

      const retryConcurrency = Math.max(3, Math.floor(concurrencyLimit / 3));
      const retryLimit = pLimit(retryConcurrency);

      const permanentErrors = batch.errors.filter(e => !e.retryable || !e.propertyKey);
      batch.errors = permanentErrors;

      const retryPromises = retryableItems.map((item) =>
        retryLimit(async () => {
          console.log(`[EnrichmentQueue] RETRY [attempt ${(item.retryAttempt || 0) + 1}] Processing: ${item.propertyKey} (failed at: ${item.lastFailedStage || 'unknown'})`);

          const result = await processPropertyItem(item, startTime);

          batch = await getBatchStatus();
          if (batch) {
            if (result.success) {
              batch.progress.succeeded++;
              batch.progress.failed--;
            } else {
              batch.errors.push({
                propertyKey: item.propertyKey,
                error: `Retry failed: ${result.error}`,
                stage: result.failedStage,
                retryable: false,
              });
            }
            await setBatchStatus(batch);
          }

          return result;
        })
      );

      await Promise.all(retryPromises);
      console.log(`[EnrichmentQueue] Retry pass complete`);
    }

    batch = await getBatchStatus();
    if (batch) {
      batch.status = 'completed';
      batch.completedAt = new Date();
      await setBatchStatus(batch);
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalRate = batch.progress.propertiesPerMinute || 0;
      console.log(`[EnrichmentQueue] Batch complete: ${batch.progress.succeeded}/${batch.progress.total} succeeded in ${totalTime}s (${finalRate}/min)`);
    }
    
    // Release distributed lock if using Redis
    if (isRedisConfigured()) {
      await releaseLock(REDIS_LOCK_KEY);
    }
  } catch (error) {
    console.error('[EnrichmentQueue] Queue processing failed:', error);
    batch = await getBatchStatus();
    if (batch) {
      batch.status = 'failed';
      batch.completedAt = new Date();
      await setBatchStatus(batch);
    }
    if (isRedisConfigured()) {
      await releaseLock(REDIS_LOCK_KEY);
    }
  } finally {
    memoryIsProcessing = false;
  }
}

export interface StartBatchOptions {
  propertyIds?: string[];
  propertyKeys?: string[];
  limit?: number;
  onlyUnenriched?: boolean;
  concurrency?: number;
}

export async function startBatch(options: StartBatchOptions): Promise<BatchStatus> {
  // Clean up expired cooldown entries
  cleanupReplacementCooldown();
  
  // Try to acquire distributed lock (Redis) or in-memory lock
  if (isRedisConfigured()) {
    const lockAcquired = await acquireLock(REDIS_LOCK_KEY, BATCH_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      throw new Error('Another batch start is in progress. Please wait.');
    }
  } else {
    if (memoryBatchStartLock) {
      throw new Error('Another batch start is in progress. Please wait.');
    }
    memoryBatchStartLock = true;
  }
  
  try {
    if (await isBatchRunning()) {
      throw new Error('A batch is already running. Please wait for it to complete.');
    }

    const batchId = uuidv4();
    const batchLimit = Math.min(options.limit || ENRICHMENT_MAX_BATCH_SIZE, ENRICHMENT_MAX_BATCH_SIZE);
    const concurrency = options.concurrency || CONCURRENCY.PROPERTIES;
    
    let propertyKeysToEnrich: string[] = [];

    if (options.propertyKeys && options.propertyKeys.length > 0) {
      propertyKeysToEnrich = options.propertyKeys.slice(0, batchLimit);
    } else if (options.propertyIds && options.propertyIds.length > 0) {
      const propertiesFromDb = await db.query.properties.findMany({
        where: inArray(properties.id, options.propertyIds.slice(0, batchLimit)),
        columns: { propertyKey: true },
      });
      propertyKeysToEnrich = propertiesFromDb.map(p => p.propertyKey);
    } else if (options.onlyUnenriched) {
      // Only enrich parent properties (not constituents like parking decks)
      const unenrichedProperties = await db.query.properties.findMany({
        where: and(
          eq(properties.isParentProperty, true),
          or(
            isNull(properties.enrichmentStatus),
            eq(properties.enrichmentStatus, 'pending'),
            eq(properties.enrichmentStatus, 'partial')
          )
        ),
        columns: { propertyKey: true },
        limit: batchLimit,
      });
      propertyKeysToEnrich = unenrichedProperties.map(p => p.propertyKey);
    }

    if (propertyKeysToEnrich.length === 0) {
      throw new Error('No properties found to enrich');
    }

    const newBatch: BatchStatus = {
      batchId,
      status: 'running',
      progress: {
        total: propertyKeysToEnrich.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      },
      startedAt: new Date(),
      completedAt: null,
      errors: [],
      concurrency,
    };
    
    // Clear queue and set batch status
    await setQueueItems([]);
    await setBatchStatus(newBatch);

    console.log(`[EnrichmentQueue] Starting batch ${batchId}: ${propertyKeysToEnrich.length} properties with concurrency=${concurrency}`);

    await addToQueue(propertyKeysToEnrich.map(key => ({ propertyKey: key })));

    // Set in-memory processing flag for fallback mode
    memoryIsProcessing = true;
    
    // Start background processing
    processQueueInternal().catch(async (error) => {
      console.error('[EnrichmentQueue] Background processing error:', error);
      memoryIsProcessing = false;
      const batch = await getBatchStatus();
      if (batch) {
        batch.status = 'failed';
        batch.completedAt = new Date();
        await setBatchStatus(batch);
      }
      if (isRedisConfigured()) {
        await releaseLock(REDIS_LOCK_KEY);
      }
    });

    return newBatch;
  } finally {
    // Release in-memory lock (Redis lock is held until processing completes)
    if (!isRedisConfigured()) {
      memoryBatchStartLock = false;
    }
  }
}

export function getMaxBatchSize(): number {
  return ENRICHMENT_MAX_BATCH_SIZE;
}
