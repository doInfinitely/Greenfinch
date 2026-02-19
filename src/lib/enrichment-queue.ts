import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import { db } from './db';
import { properties, contacts, organizations, propertyContacts, propertyOrganizations, contactOrganizations } from './schema';
import { eq, or, and, isNull, inArray } from 'drizzle-orm';
import { runFocusedEnrichment, cleanupAISummary } from './ai-enrichment';
import type { FocusedEnrichmentResult, DiscoveredContact, DiscoveredOrganization } from './ai-enrichment';
import { enrichContactCascade } from './cascade-enrichment';
import { enrichOrganizationCascade } from './cascade-enrichment';
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
    .select({ id: properties.id })
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
  const discoveredOrgs = result.contacts.data.organizations || [];

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
        organizations: discoveredOrgs,
        timing: result.timing,
        sources: allSources,
      },
      updatedAt: new Date(),
    })
    .where(eq(properties.id, propertyId));

  console.log(`[SaveEnrichment] Updated property ${propertyKey} with enrichment data`);

  const orgIds: string[] = [];
  for (const org of discoveredOrgs) {
    try {
      const normalizedDomain = org.domain?.trim().toLowerCase() || null;

      let existingOrg = normalizedDomain
        ? await db.query.organizations.findFirst({
            where: eq(organizations.domain, normalizedDomain),
          })
        : null;

      let orgId: string;

      if (existingOrg) {
        orgId = existingOrg.id;
        console.log(`[SaveEnrichment] Found existing org: ${existingOrg.name} (${orgId})`);
      } else {
        const [inserted] = await db.insert(organizations)
          .values({
            name: org.name,
            domain: normalizedDomain,
            orgType: org.orgType,
            enrichmentSource: 'ai',
            enrichmentStatus: 'pending',
          })
          .onConflictDoNothing()
          .returning({ id: organizations.id });

        if (inserted) {
          orgId = inserted.id;
          console.log(`[SaveEnrichment] Created org: ${org.name} (${orgId})`);
        } else {
          const found = normalizedDomain
            ? await db.query.organizations.findFirst({
                where: eq(organizations.domain, normalizedDomain),
              })
            : null;
          if (!found) {
            console.warn(`[SaveEnrichment] Could not insert or find org: ${org.name}, skipping`);
            continue;
          }
          orgId = found.id;
          console.log(`[SaveEnrichment] Found existing org after conflict: ${org.name} (${orgId})`);
        }
      }

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
  for (const contact of discoveredContacts) {
    try {
      const normalized = normalizeEmail(contact.email);
      const normalizedNameVal = normalizeName(contact.name);

      let existingContact = normalized
        ? await db.query.contacts.findFirst({
            where: eq(contacts.normalizedEmail, normalized),
          })
        : null;

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
    } catch (err) {
      console.error(`[SaveEnrichment] Error saving contact ${contact.name}:`, err);
    }
  }

  const uniqueContactIds = [...new Set(contactIds)];
  const uniqueOrgIds = [...new Set(orgIds)];
  console.log(`[SaveEnrichment] Complete for ${propertyKey}: ${uniqueContactIds.length} contacts (${contactIds.length - uniqueContactIds.length} dupes removed), ${uniqueOrgIds.length} orgs (${orgIds.length - uniqueOrgIds.length} dupes removed)`);
  return { propertyId, contactIds: uniqueContactIds, orgIds: uniqueOrgIds };
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
      if (!org || !org.domain || org.enrichmentStatus === 'enriched') continue;

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
        if (result.pdlRaw) updateData.pdlRawResponse = result.pdlRaw;
        if (result.crustdataRaw) updateData.crustdataRawResponse = result.crustdataRaw;

        await db.update(organizations)
          .set(updateData)
          .where(eq(organizations.id, orgId));

        console.log(`[CascadeEnrichment] Org enriched: ${org.name} via ${result.enrichmentSource}`);
      }
    } catch (err) {
      console.error(`[CascadeEnrichment] Error enriching org ${orgId}:`, err);
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
          let markedFormer = false;
          let formerReason = '';

          if (result.employerLeftDetected) {
            formerReason = result.employerLeftReason || `${contact.fullName} no longer appears to be at ${aiCompany || 'the company'}`;
            console.log(`[RoleVerification] EMPLOYER LEFT: ${formerReason}`);
            markedFormer = true;
          } else {
            const enrichedCompany = result.crustdataCompany || result.pdlCompany;
            const enrichedDomain = result.crustdataCompanyDomain || result.pdlCompanyDomain;

            const nameMatch = companiesMatch(enrichedCompany, aiCompany);
            const domainMatch = domainsMatch(enrichedDomain, aiDomain);

            if (!nameMatch && !domainMatch) {
              const enrichedTitle = result.crustdataTitle || result.pdlTitle;
              formerReason = `${contact.fullName} now at ${enrichedCompany}${enrichedTitle ? ` as ${enrichedTitle}` : ''} (was ${aiCompany || 'unknown'} for this property). Source: ${result.crustdataCompany ? 'Crustdata' : 'PDL'}`;
              console.log(`[RoleVerification] MISMATCH: ${formerReason}`);
              markedFormer = true;
            }
          }

          if (markedFormer) {
            await db.update(propertyContacts)
              .set({
                relationshipStatus: 'former',
                relationshipStatusReason: formerReason,
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
    } catch (err) {
      console.error(`[CascadeEnrichment] Error enriching contact ${contactId}:`, err);
    }
  }
}

const replacementSearchCooldown = new Map<string, number>();

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

    let existingContact = normalizedEmailVal
      ? await db.query.contacts.findFirst({ where: eq(contacts.normalizedEmail, normalizedEmailVal) })
      : null;

    if (!existingContact && normalizedNameVal) {
      const candidates = await db.select().from(contacts).where(eq(contacts.normalizedName, normalizedNameVal));
      for (const c of candidates) {
        if (companiesMatch(c.employerName, formerCompany) || domainsMatch(c.companyDomain, formerCompanyDomain)) {
          existingContact = c;
          break;
        }
      }
    }

    const existingFormerLinks = await db.select().from(propertyContacts).where(
      and(
        eq(propertyContacts.propertyId, propertyId),
        eq(propertyContacts.relationshipStatus, 'former')
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
  errors: Array<{ propertyKey: string; error: string }>;
  concurrency: number;
}

interface QueueItem {
  propertyKey: string;
  propertyId?: string;
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

async function processPropertyItem(
  item: QueueItem,
  startTime: number
): Promise<{ success: boolean; error?: string }> {
  try {
    let property = await getPropertyFromPostgres(item.propertyKey);
    
    if (!property) {
      console.log(`[EnrichmentQueue] Property not in Postgres, trying Snowflake: ${item.propertyKey}`);
      property = await getPropertyByKey(item.propertyKey);
    }
    
    if (!property) {
      return { success: false, error: 'Property not found in database' };
    }

    const dcadProperty = (property as any).dcad || {
      parcelId: property.propertyKey,
      address: property.address,
      city: property.city,
      zip: property.zip,
      lat: property.lat,
      lon: property.lon,
      usedesc: property.usedesc?.[0] || '',
      usecode: property.usecode?.[0] || '',
      regridYearBuilt: property.yearBuilt || null,
      regridNumStories: property.numFloors || null,
      lotSqft: property.lotSqft || null,
      accountNum: '',
      divisionCd: 'COM',
      bizName: property.primaryOwner || null,
      ownerName1: property.allOwners?.[0] || null,
      ownerName2: property.allOwners?.[1] || null,
      buildingCount: 1,
      totalGrossBldgArea: property.buildingSqft || null,
      buildings: [],
    };
    const enrichmentResult = await runFocusedEnrichment(dcadProperty as any);
    
    const saved = await saveEnrichmentResults(item.propertyKey, enrichmentResult);
    
    if (saved.contactIds.length > 0 || saved.orgIds.length > 0) {
      console.log(`[EnrichmentQueue] Running cascade enrichment on ${saved.contactIds.length} contacts, ${saved.orgIds.length} orgs...`);
      await runCascadeEnrichmentOnSavedRecords(saved.contactIds, saved.orgIds, saved.propertyId);
    }
    
    return { success: true };
  } catch (error) {
    console.error(`[EnrichmentQueue] Error processing ${item.propertyKey}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
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

async function processQueueInternal(): Promise<void> {
  const startTime = Date.now();
  let batch = await getBatchStatus();
  const concurrencyLimit = batch?.concurrency || CONCURRENCY.PROPERTIES;
  const limit = pLimit(concurrencyLimit);
  
  console.log(`[EnrichmentQueue] Starting parallel processing with concurrency=${concurrencyLimit}`);

  try {
    const items = await getQueueItems();
    await setQueueItems([]); // Clear queue
    
    const promises = items.map((item, index) =>
      limit(async () => {
        const itemStart = Date.now();
        console.log(`[EnrichmentQueue] [${index + 1}/${items.length}] Processing: ${item.propertyKey}`);
        
        const result = await processPropertyItem(item, startTime);
        
        // Re-fetch batch status to get latest state (for distributed updates)
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
            });
          }
          updateProgressStats(batch, startTime);
          await setBatchStatus(batch); // Persist updated status
        }
        
        const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
        const status = result.success ? 'SUCCESS' : 'FAILED';
        const ppm = batch?.progress.propertiesPerMinute || 0;
        const eta = batch?.progress.estimatedSecondsRemaining;
        const etaStr = eta ? `ETA: ${Math.round(eta / 60)}m ${eta % 60}s` : '';
        
        console.log(`[EnrichmentQueue] [${index + 1}/${items.length}] ${status} (${elapsed}s) | Rate: ${ppm}/min | ${etaStr}`);
        
        return result;
      })
    );

    await Promise.all(promises);

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
            eq(properties.enrichmentStatus, 'enriched')
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
