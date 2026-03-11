/**
 * Deduplication Service
 * 
 * Handles merging duplicate contacts and organizations:
 * - Organizations: merged by normalized domain
 * - Contacts: merged by same name + similar domain, or same validated email
 * 
 * The most recently Apollo-enriched record takes precedence.
 */

import { db } from './db';
import { 
  contacts, 
  organizations, 
  propertyContacts, 
  propertyOrganizations, 
  contactOrganizations,
  contactLinkedinFlags,
  dataIssues,
  listItems,
  potentialDuplicates as potentialDuplicatesTable,
  propertyFlags,
  propertyPipeline,
  propertyNotes,
  propertyActivity,
  propertyActions,
  propertyViews,
  adminAuditLog,
  properties,
} from './schema';
import { eq, sql, and, or, isNotNull, isNull } from 'drizzle-orm';

/**
 * Normalize domain for dedup comparison.
 * Strips hyphens AND www prefix, lowercases.
 * More aggressive than normalization.ts version — used only for duplicate matching.
 */
export function normalizeDomainForDedup(domain: string | null | undefined): string {
  if (!domain) return '';
  return domain.toLowerCase().trim().replace(/^www\./, '').replace(/-/g, '');
}

/**
 * Normalize name for comparison
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.toLowerCase().trim();
}

interface DuplicateGroup<T> {
  key: string;
  items: T[];
  keepId: string;
  deleteIds: string[];
}

interface DeduplicationResult {
  organizationsMerged: number;
  contactsMerged: number;
  errors: string[];
}

/**
 * Find duplicate organizations by normalized domain.
 * Uses SQL GROUP BY to identify duplicates without loading all rows.
 */
export async function findDuplicateOrganizations(): Promise<DuplicateGroup<typeof organizations.$inferSelect>[]> {
  // Find domains that have more than one org
  const duplicateDomains = await db
    .select({
      normalizedDomain: sql<string>`LOWER(REPLACE(REPLACE(${organizations.domain}, 'www.', ''), '-', ''))`.as('normalized_domain'),
      count: sql<number>`COUNT(*)`.as('count')
    })
    .from(organizations)
    .where(isNotNull(organizations.domain))
    .groupBy(sql`LOWER(REPLACE(REPLACE(${organizations.domain}, 'www.', ''), '-', ''))`)
    .having(sql`COUNT(*) > 1`);

  const duplicates: DuplicateGroup<typeof organizations.$inferSelect>[] = [];

  for (const { normalizedDomain } of duplicateDomains) {
    if (!normalizedDomain) continue;

    const orgs = await db
      .select()
      .from(organizations)
      .where(sql`LOWER(REPLACE(REPLACE(${organizations.domain}, 'www.', ''), '-', '')) = ${normalizedDomain}`)
      .orderBy(sql`CASE WHEN ${organizations.providerId} IS NOT NULL THEN 0 ELSE 1 END`, sql`${organizations.lastEnrichedAt} DESC NULLS LAST`);

    if (orgs.length > 1) {
      duplicates.push({
        key: normalizedDomain,
        items: orgs,
        keepId: orgs[0].id,
        deleteIds: orgs.slice(1).map(o => o.id),
      });
    }
  }

  return duplicates;
}

interface FindDuplicatesResult {
  autoMerge: DuplicateGroup<typeof contacts.$inferSelect>[];
  potentialDuplicates: { contactIdA: string; contactIdB: string; matchType: string; matchKey: string }[];
}

/**
 * Find duplicate contacts by:
 * 1. Same email → auto-merge
 * 2. Same LinkedIn profile slug → auto-merge
 * 3. Same name + similar domain → flag as potential duplicate (admin review)
 * 
 * Returns auto-merge groups and potential duplicates separately.
 */
export async function findDuplicateContacts(): Promise<FindDuplicatesResult> {
  const processedIds = new Set<string>();
  const autoMerge: DuplicateGroup<typeof contacts.$inferSelect>[] = [];
  const potentialDuplicates: { contactIdA: string; contactIdB: string; matchType: string; matchKey: string }[] = [];

  // --- Pass 1: Email duplicates (SQL GROUP BY) ---
  const duplicateEmails = await db
    .select({
      normalizedEmail: sql<string>`LOWER(TRIM(${contacts.normalizedEmail}))`.as('norm_email'),
      count: sql<number>`COUNT(*)`.as('count')
    })
    .from(contacts)
    .where(isNotNull(contacts.normalizedEmail))
    .groupBy(sql`LOWER(TRIM(${contacts.normalizedEmail}))`)
    .having(sql`COUNT(*) > 1`);

  for (const { normalizedEmail } of duplicateEmails) {
    if (!normalizedEmail) continue;
    const contactList = await db
      .select()
      .from(contacts)
      .where(sql`LOWER(TRIM(${contacts.normalizedEmail})) = ${normalizedEmail}`);

    if (contactList.length > 1) {
      contactList.sort(sortContactsByPriority);
      autoMerge.push({
        key: `email::${normalizedEmail}`,
        items: contactList,
        keepId: contactList[0].id,
        deleteIds: contactList.slice(1).map(c => c.id),
      });
      contactList.forEach(c => processedIds.add(c.id));
    }
  }

  // --- Pass 2: LinkedIn duplicates ---
  // LinkedIn slugs require regex extraction, so we still need to load contacts with LinkedIn URLs
  // but only those that have at least one LinkedIn URL and weren't already processed
  const linkedinContacts = await db.select().from(contacts).where(
    or(
      isNotNull(contacts.linkedinUrl),
      isNotNull(contacts.pdlLinkedinUrl),
      isNotNull(contacts.crustdataLinkedinUrl)
    )
  );

  const linkedinMap = new Map<string, (typeof contacts.$inferSelect)[]>();
  for (const contact of linkedinContacts) {
    if (processedIds.has(contact.id)) continue;
    const slugs = [
      normalizeLinkedinSlug(contact.linkedinUrl),
      normalizeLinkedinSlug(contact.pdlLinkedinUrl),
      normalizeLinkedinSlug(contact.crustdataLinkedinUrl),
    ].filter(Boolean) as string[];
    const primarySlug = slugs[0];
    if (!primarySlug) continue;
    if (!linkedinMap.has(primarySlug)) {
      linkedinMap.set(primarySlug, []);
    }
    const existing = linkedinMap.get(primarySlug)!;
    if (!existing.find(c => c.id === contact.id)) {
      existing.push(contact);
    }
  }

  for (const [slug, contactList] of linkedinMap) {
    if (contactList.length > 1) {
      contactList.sort(sortContactsByPriority);
      autoMerge.push({
        key: `linkedin::${slug}`,
        items: contactList,
        keepId: contactList[0].id,
        deleteIds: contactList.slice(1).map(c => c.id),
      });
      contactList.forEach(c => processedIds.add(c.id));
    }
  }

  // --- Pass 3: Name+domain potential duplicates (SQL GROUP BY on normalized_name) ---
  const duplicateNames = await db
    .select({
      normalizedName: contacts.normalizedName,
      count: sql<number>`COUNT(*)`.as('count')
    })
    .from(contacts)
    .where(isNotNull(contacts.normalizedName))
    .groupBy(contacts.normalizedName)
    .having(sql`COUNT(*) > 1`);

  for (const { normalizedName } of duplicateNames) {
    if (!normalizedName) continue;
    const nameContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.normalizedName, normalizedName));

    // Sub-group by normalized domain for name+domain pass
    const domainSubMap = new Map<string, (typeof contacts.$inferSelect)[]>();
    // Sub-group by employer for name+employer pass
    const employerSubMap = new Map<string, (typeof contacts.$inferSelect)[]>();

    for (const contact of nameContacts) {
      if (processedIds.has(contact.id)) continue;

      const normalizedDomain = normalizeDomainForDedup(contact.companyDomain);
      const domainKey = `${normalizedName}::${normalizedDomain}`;
      if (!domainSubMap.has(domainKey)) {
        domainSubMap.set(domainKey, []);
      }
      domainSubMap.get(domainKey)!.push(contact);
    }

    for (const [key, contactList] of domainSubMap) {
      if (contactList.length > 1) {
        contactList.sort(sortContactsByPriority);
        const primary = contactList[0];
        for (const dup of contactList.slice(1)) {
          potentialDuplicates.push({
            contactIdA: primary.id,
            contactIdB: dup.id,
            matchType: 'name_domain',
            matchKey: key,
          });
          processedIds.add(dup.id);
        }
        processedIds.add(primary.id);
      }
    }

    for (const contact of nameContacts) {
      if (processedIds.has(contact.id)) continue;
      const employer = contact.employerName?.toLowerCase().trim();
      if (!employer) continue;
      const empKey = `${normalizedName}::${employer}`;
      if (!employerSubMap.has(empKey)) {
        employerSubMap.set(empKey, []);
      }
      employerSubMap.get(empKey)!.push(contact);
    }

    for (const [key, contactList] of employerSubMap) {
      if (contactList.length > 1) {
        contactList.sort(sortContactsByPriority);
        const primary = contactList[0];
        for (const dup of contactList.slice(1)) {
          potentialDuplicates.push({
            contactIdA: primary.id,
            contactIdB: dup.id,
            matchType: 'name_employer',
            matchKey: key,
          });
        }
      }
    }
  }

  return { autoMerge, potentialDuplicates };
}

function sortContactsByPriority(a: typeof contacts.$inferSelect, b: typeof contacts.$inferSelect): number {
  // Prefer records with valid email
  const aHasValidEmail = a.emailValidationStatus === 'valid';
  const bHasValidEmail = b.emailValidationStatus === 'valid';
  if (aHasValidEmail && !bHasValidEmail) return -1;
  if (!aHasValidEmail && bHasValidEmail) return 1;
  
  // Then prefer records with Apollo providerId
  if (a.providerId && !b.providerId) return -1;
  if (!a.providerId && b.providerId) return 1;
  
  // Then by most recent enrichment
  const aDate = a.enrichedAt?.getTime() || 0;
  const bDate = b.enrichedAt?.getTime() || 0;
  return bDate - aDate;
}

/**
 * Merge duplicate organizations
 * Updates all foreign key references and deletes duplicates
 */
export async function mergeOrganizationPair(keepOrgId: string, deleteOrgId: string): Promise<{ success: boolean; error?: string; stats: { propertyLinksReassigned: number; propertyLinksRemoved: number; contactLinksReassigned: number; contactLinksRemoved: number; listItemsReassigned: number; } }> {
  const stats = { propertyLinksReassigned: 0, propertyLinksRemoved: 0, contactLinksReassigned: 0, contactLinksRemoved: 0, listItemsReassigned: 0 };

  try {
    const [keepOrg] = await db.select().from(organizations).where(eq(organizations.id, keepOrgId));
    const [deleteOrg] = await db.select().from(organizations).where(eq(organizations.id, deleteOrgId));
    if (!keepOrg || !deleteOrg) return { success: false, error: 'One or both organizations not found', stats };
    if (keepOrgId === deleteOrgId) return { success: false, error: 'Cannot merge an organization with itself', stats };

    console.log(`[Dedup] Merging org "${deleteOrg.name}" (${deleteOrgId}) into "${keepOrg.name}" (${keepOrgId})`);

    await db.transaction(async (tx) => {
      const keepPropLinks = await tx.select().from(propertyOrganizations).where(eq(propertyOrganizations.orgId, keepOrgId));
      const keepPropKeys = new Set(keepPropLinks.map(l => `${l.propertyId}::${l.role}`));

      const deletePropLinks = await tx.select().from(propertyOrganizations).where(eq(propertyOrganizations.orgId, deleteOrgId));
      for (const link of deletePropLinks) {
        const key = `${link.propertyId}::${link.role}`;
        if (keepPropKeys.has(key)) {
          await tx.delete(propertyOrganizations).where(eq(propertyOrganizations.id, link.id));
          stats.propertyLinksRemoved++;
        } else {
          await tx.update(propertyOrganizations).set({ orgId: keepOrgId }).where(eq(propertyOrganizations.id, link.id));
          keepPropKeys.add(key);
          stats.propertyLinksReassigned++;
        }
      }

      const keepContactLinks = await tx.select().from(contactOrganizations).where(eq(contactOrganizations.orgId, keepOrgId));
      const keepContactKeys = new Set(keepContactLinks.map(l => l.contactId));

      const deleteContactLinks = await tx.select().from(contactOrganizations).where(eq(contactOrganizations.orgId, deleteOrgId));
      for (const link of deleteContactLinks) {
        if (keepContactKeys.has(link.contactId)) {
          await tx.delete(contactOrganizations).where(eq(contactOrganizations.id, link.id));
          stats.contactLinksRemoved++;
        } else {
          await tx.update(contactOrganizations).set({ orgId: keepOrgId }).where(eq(contactOrganizations.id, link.id));
          keepContactKeys.add(link.contactId);
          stats.contactLinksReassigned++;
        }
      }

      await tx.update(organizations).set({ parentOrgId: keepOrgId }).where(eq(organizations.parentOrgId, deleteOrgId));
      await tx.update(organizations).set({ ultimateParentOrgId: keepOrgId }).where(eq(organizations.ultimateParentOrgId, deleteOrgId));

      const listItemUpdated = await tx.update(listItems).set({ itemId: keepOrgId }).where(eq(listItems.itemId, deleteOrgId)).returning();
      stats.listItemsReassigned = listItemUpdated.length;

      const fieldsToMerge = [
        'legalName', 'description', 'foundedYear', 'sector', 'industryGroup', 'industry',
        'subIndustry', 'employees', 'employeesRange', 'location', 'city', 'state',
        'linkedinHandle', 'twitterHandle', 'logoUrl', 'phoneNumbers', 'emailAddresses',
      ] as const;
      const updates: Record<string, unknown> = {};
      for (const field of fieldsToMerge) {
        if (!keepOrg[field] && deleteOrg[field]) {
          updates[field] = deleteOrg[field];
        }
      }
      if (!keepOrg.domain && deleteOrg.domain) {
        updates.domain = deleteOrg.domain;
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await tx.update(organizations).set(updates).where(eq(organizations.id, keepOrgId));
      }

      await tx.delete(organizations).where(eq(organizations.id, deleteOrgId));

      // Audit log
      try {
        await tx.insert(adminAuditLog).values({
          action: 'merge_organization',
          targetTable: 'organizations',
          metadata: { keepId: keepOrgId, deleteId: deleteOrgId, stats },
        });
      } catch {}
    });

    console.log(`[Dedup] Org merge complete: ${JSON.stringify(stats)}`);
    return { success: true, stats };
  } catch (error) {
    const errMsg = `Failed to merge orgs: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error(`[Dedup] ${errMsg}`);
    return { success: false, error: errMsg, stats };
  }
}

async function mergeOrganizations(duplicates: DuplicateGroup<typeof organizations.$inferSelect>[]): Promise<{ merged: number; errors: string[] }> {
  let merged = 0;
  const errors: string[] = [];
  
  for (const group of duplicates) {
    try {
      console.log(`[Dedup] Merging ${group.deleteIds.length} duplicate orgs into ${group.keepId} (domain: ${group.key})`);
      
      for (const deleteId of group.deleteIds) {
        const result = await mergeOrganizationPair(group.keepId, deleteId);
        if (result.success) {
          merged++;
        } else {
          errors.push(result.error || 'Unknown error');
        }
      }
    } catch (error) {
      const errMsg = `Failed to merge org ${group.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[Dedup] ${errMsg}`);
      errors.push(errMsg);
    }
  }
  
  return { merged, errors };
}

/**
 * Smart field-level merge for contacts.
 * Picks the best value for each field from keep and delete contacts.
 * Returns an update object with only the fields that should be updated.
 */
export function smartMergeContactFields(
  keep: typeof contacts.$inferSelect,
  del: typeof contacts.$inferSelect
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const fieldsUpdated: string[] = [];

  // Email: prefer 'valid' validation status, then most recently enriched
  if (!keep.email && del.email) {
    updates.email = del.email;
    updates.normalizedEmail = del.normalizedEmail;
    updates.emailValidationStatus = del.emailValidationStatus;
    fieldsUpdated.push('email');
  } else if (keep.email && del.email && del.emailValidationStatus === 'valid' && keep.emailValidationStatus !== 'valid') {
    updates.email = del.email;
    updates.normalizedEmail = del.normalizedEmail;
    updates.emailValidationStatus = del.emailValidationStatus;
    fieldsUpdated.push('email');
  }

  // Phone: prefer higher phoneConfidence
  if (!keep.phone && del.phone) {
    updates.phone = del.phone;
    if (del.phoneConfidence) updates.phoneConfidence = del.phoneConfidence;
    fieldsUpdated.push('phone');
  } else if (keep.phone && del.phone && (del.phoneConfidence || 0) > (keep.phoneConfidence || 0)) {
    updates.phone = del.phone;
    updates.phoneConfidence = del.phoneConfidence;
    fieldsUpdated.push('phone');
  }

  // LinkedIn URL: prefer non-null, prefer enrichment source
  if (!keep.linkedinUrl && del.linkedinUrl) {
    updates.linkedinUrl = del.linkedinUrl;
    fieldsUpdated.push('linkedinUrl');
  }
  if (!keep.pdlLinkedinUrl && del.pdlLinkedinUrl) {
    updates.pdlLinkedinUrl = del.pdlLinkedinUrl;
    fieldsUpdated.push('pdlLinkedinUrl');
  }

  // Title, employer: prefer most recently enriched
  const keepDate = keep.enrichedAt?.getTime() || 0;
  const delDate = del.enrichedAt?.getTime() || 0;

  if (!keep.title && del.title) {
    updates.title = del.title;
    fieldsUpdated.push('title');
  } else if (keep.title && del.title && delDate > keepDate) {
    updates.title = del.title;
    fieldsUpdated.push('title');
  }

  if (!keep.employerName && del.employerName) {
    updates.employerName = del.employerName;
    fieldsUpdated.push('employerName');
  } else if (keep.employerName && del.employerName && delDate > keepDate) {
    updates.employerName = del.employerName;
    fieldsUpdated.push('employerName');
  }

  // Photo URL: prefer non-null
  if (!keep.photoUrl && del.photoUrl) {
    updates.photoUrl = del.photoUrl;
    fieldsUpdated.push('photoUrl');
  }

  // JSON arrays: merge/union PDL emails and phones
  if (del.pdlEmailsJson) {
    const keepEmails = (keep.pdlEmailsJson as any[] | null) || [];
    const delEmails = (del.pdlEmailsJson as any[] | null) || [];
    if (delEmails.length > 0) {
      const existingAddresses = new Set(keepEmails.map((e: any) => e.address?.toLowerCase()));
      const merged = [...keepEmails];
      for (const e of delEmails) {
        if (!existingAddresses.has(e.address?.toLowerCase())) {
          merged.push(e);
        }
      }
      if (merged.length > keepEmails.length) {
        updates.pdlEmailsJson = merged;
        fieldsUpdated.push('pdlEmailsJson');
      }
    }
  }

  if (del.pdlPhonesJson) {
    const keepPhones = (keep.pdlPhonesJson as any[] | null) || [];
    const delPhones = (del.pdlPhonesJson as any[] | null) || [];
    if (delPhones.length > 0) {
      const existingNumbers = new Set(keepPhones.map((p: any) => p.number));
      const merged = [...keepPhones];
      for (const p of delPhones) {
        if (!existingNumbers.has(p.number)) {
          merged.push(p);
        }
      }
      if (merged.length > keepPhones.length) {
        updates.pdlPhonesJson = merged;
        fieldsUpdated.push('pdlPhonesJson');
      }
    }
  }

  // Simple fill-in for remaining fields
  const fillFields = [
    'companyDomain', 'source', 'crustdataLinkedinUrl',
    'providerId', 'normalizedName',
  ] as const;
  for (const field of fillFields) {
    if (!keep[field] && del[field]) {
      (updates as any)[field] = del[field];
      fieldsUpdated.push(field);
    }
  }

  (updates as any)._fieldsUpdated = fieldsUpdated;
  return updates;
}

/**
 * Smart field-level merge for properties.
 * Picks the best value for each field from keep and delete properties.
 */
export function smartMergePropertyFields(
  keep: typeof properties.$inferSelect,
  del: typeof properties.$inferSelect
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const fieldsUpdated: string[] = [];

  // Address: prefer validatedAddress > regridAddress, higher confidence
  if (!keep.validatedAddress && del.validatedAddress) {
    updates.validatedAddress = del.validatedAddress;
    updates.validatedAddressConfidence = del.validatedAddressConfidence;
    fieldsUpdated.push('validatedAddress');
  } else if (keep.validatedAddress && del.validatedAddress &&
    (del.validatedAddressConfidence || 0) > (keep.validatedAddressConfidence || 0)) {
    updates.validatedAddress = del.validatedAddress;
    updates.validatedAddressConfidence = del.validatedAddressConfidence;
    fieldsUpdated.push('validatedAddress');
  }

  if (!keep.regridAddress && del.regridAddress) {
    updates.regridAddress = del.regridAddress;
    fieldsUpdated.push('regridAddress');
  }

  // Classification: prefer higher confidence
  if (!keep.assetCategory && del.assetCategory) {
    updates.assetCategory = del.assetCategory;
    updates.assetSubcategory = del.assetSubcategory;
    updates.categoryConfidence = del.categoryConfidence;
    fieldsUpdated.push('assetCategory');
  } else if (keep.assetCategory && del.assetCategory &&
    (del.categoryConfidence || 0) > (keep.categoryConfidence || 0)) {
    updates.assetCategory = del.assetCategory;
    updates.assetSubcategory = del.assetSubcategory;
    updates.categoryConfidence = del.categoryConfidence;
    fieldsUpdated.push('assetCategory');
  }

  // Property class: prefer higher confidence
  if (!keep.propertyClass && del.propertyClass) {
    updates.propertyClass = del.propertyClass;
    updates.propertyClassConfidence = del.propertyClassConfidence;
    fieldsUpdated.push('propertyClass');
  } else if (keep.propertyClass && del.propertyClass &&
    (del.propertyClassConfidence || 0) > (keep.propertyClassConfidence || 0)) {
    updates.propertyClass = del.propertyClass;
    updates.propertyClassConfidence = del.propertyClassConfidence;
    fieldsUpdated.push('propertyClass');
  }

  // DCAD data: prefer non-null
  const dcadFields = [
    'dcadOwnerName1', 'dcadOwnerName2', 'dcadBizName',
    'dcadOwnerAddress', 'dcadOwnerCity', 'dcadOwnerState',
    'dcadOwnerZip', 'dcadOwnerPhone',
  ] as const;
  for (const field of dcadFields) {
    if (!keep[field] && del[field]) {
      (updates as any)[field] = del[field];
      fieldsUpdated.push(field);
    }
  }

  // Ownership: prefer non-null with higher confidence
  if (!keep.beneficialOwner && del.beneficialOwner) {
    updates.beneficialOwner = del.beneficialOwner;
    updates.beneficialOwnerConfidence = del.beneficialOwnerConfidence;
    updates.beneficialOwnerType = del.beneficialOwnerType;
    updates.beneficialOwnerDomain = del.beneficialOwnerDomain;
    fieldsUpdated.push('beneficialOwner');
  } else if (keep.beneficialOwner && del.beneficialOwner &&
    (del.beneficialOwnerConfidence || 0) > (keep.beneficialOwnerConfidence || 0)) {
    updates.beneficialOwner = del.beneficialOwner;
    updates.beneficialOwnerConfidence = del.beneficialOwnerConfidence;
    updates.beneficialOwnerType = del.beneficialOwnerType;
    updates.beneficialOwnerDomain = del.beneficialOwnerDomain;
    fieldsUpdated.push('beneficialOwner');
  }

  // Management: prefer non-null with higher confidence
  if (!keep.managementCompany && del.managementCompany) {
    updates.managementCompany = del.managementCompany;
    updates.managementCompanyDomain = del.managementCompanyDomain;
    updates.managementConfidence = del.managementConfidence;
    updates.managementType = del.managementType;
    fieldsUpdated.push('managementCompany');
  } else if (keep.managementCompany && del.managementCompany &&
    (del.managementConfidence || 0) > (keep.managementConfidence || 0)) {
    updates.managementCompany = del.managementCompany;
    updates.managementCompanyDomain = del.managementCompanyDomain;
    updates.managementConfidence = del.managementConfidence;
    updates.managementType = del.managementType;
    fieldsUpdated.push('managementCompany');
  }

  // Simple fill-in for remaining fields
  const fillFields = [
    'commonName', 'regridOwner', 'regridOwner2',
    'city', 'state', 'zip', 'county',
  ] as const;
  for (const field of fillFields) {
    if (!keep[field] && del[field]) {
      (updates as any)[field] = del[field];
      fieldsUpdated.push(field);
    }
  }

  (updates as any)._fieldsUpdated = fieldsUpdated;
  return updates;
}

/**
 * Merge duplicate contacts
 * Updates all foreign key references, applies smart field merge, and deletes duplicates
 */
export async function mergeContacts(duplicates: DuplicateGroup<typeof contacts.$inferSelect>[]): Promise<{ merged: number; errors: string[] }> {
  let merged = 0;
  const errors: string[] = [];

  for (const group of duplicates) {
    try {
      console.log(`[Dedup] Merging ${group.deleteIds.length} duplicate contacts into ${group.keepId} (key: ${group.key})`);

      await db.transaction(async (tx) => {
        const [keepContact] = await tx.select().from(contacts).where(eq(contacts.id, group.keepId));
        const keepLinks = await tx.select().from(propertyContacts).where(eq(propertyContacts.contactId, group.keepId));
        const keepPropertyIds = new Set(keepLinks.map(l => l.propertyId));

        for (const deleteId of group.deleteIds) {
          const [deleteContact] = await tx.select().from(contacts).where(eq(contacts.id, deleteId));

          // Smart field merge
          if (keepContact && deleteContact) {
            const mergeUpdates = smartMergeContactFields(keepContact, deleteContact);
            const fieldsUpdated = (mergeUpdates as any)._fieldsUpdated as string[];
            delete (mergeUpdates as any)._fieldsUpdated;
            if (Object.keys(mergeUpdates).length > 0) {
              await tx.update(contacts).set(mergeUpdates).where(eq(contacts.id, group.keepId));
            }

            // Audit log
            try {
              await tx.insert(adminAuditLog).values({
                action: 'merge_contact',
                targetTable: 'contacts',
                metadata: { keepId: group.keepId, deleteId, fieldsUpdated },
              });
            } catch {}
          }

          const dupeLinks = await tx.select().from(propertyContacts).where(eq(propertyContacts.contactId, deleteId));
          for (const link of dupeLinks) {
            if (keepPropertyIds.has(link.propertyId)) {
              await tx.delete(propertyContacts).where(eq(propertyContacts.id, link.id));
            } else {
              await tx.update(propertyContacts)
                .set({ contactId: group.keepId })
                .where(eq(propertyContacts.id, link.id));
              keepPropertyIds.add(link.propertyId);
            }
          }

          const dupeOrgLinks = await tx.select().from(contactOrganizations).where(eq(contactOrganizations.contactId, deleteId));
          const keepOrgLinks = await tx.select().from(contactOrganizations).where(eq(contactOrganizations.contactId, group.keepId));
          const keepOrgIds = new Set(keepOrgLinks.map(l => l.orgId));
          for (const link of dupeOrgLinks) {
            if (keepOrgIds.has(link.orgId)) {
              await tx.delete(contactOrganizations).where(eq(contactOrganizations.id, link.id));
            } else {
              await tx.update(contactOrganizations)
                .set({ contactId: group.keepId })
                .where(eq(contactOrganizations.id, link.id));
            }
          }

          await tx.update(listItems)
            .set({ itemId: group.keepId })
            .where(eq(listItems.itemId, deleteId));

          await tx.update(contactLinkedinFlags)
            .set({ contactId: group.keepId })
            .where(eq(contactLinkedinFlags.contactId, deleteId));

          await tx.update(dataIssues)
            .set({ contactId: group.keepId })
            .where(eq(dataIssues.contactId, deleteId));

          await tx.delete(contacts).where(eq(contacts.id, deleteId));
        }
      });

      merged += group.deleteIds.length;
    } catch (error) {
      const errMsg = `Failed to merge contact ${group.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[Dedup] ${errMsg}`);
      errors.push(errMsg);
    }
  }

  return { merged, errors };
}

/**
 * Run full deduplication on all organizations and contacts.
 * Auto-merges email/LinkedIn matches. Flags name/domain matches for admin review.
 */
export async function runDeduplication(): Promise<DeduplicationResult & { potentialDuplicatesFlagged: number }> {
  console.log('[Dedup] Starting deduplication...');
  
  const orgDuplicates = await findDuplicateOrganizations();
  console.log(`[Dedup] Found ${orgDuplicates.length} organization duplicate groups`);
  const orgResult = await mergeOrganizations(orgDuplicates);
  
  const { autoMerge, potentialDuplicates } = await findDuplicateContacts();
  console.log(`[Dedup] Found ${autoMerge.length} contact auto-merge groups, ${potentialDuplicates.length} potential duplicates to flag`);
  const contactResult = await mergeContacts(autoMerge);

  let flagged = 0;
  for (const pd of potentialDuplicates) {
    try {
      const existing = await db.select().from(potentialDuplicatesTable).where(
        and(
          or(
            and(eq(potentialDuplicatesTable.contactIdA, pd.contactIdA), eq(potentialDuplicatesTable.contactIdB, pd.contactIdB)),
            and(eq(potentialDuplicatesTable.contactIdA, pd.contactIdB), eq(potentialDuplicatesTable.contactIdB, pd.contactIdA))
          ),
          eq(potentialDuplicatesTable.status, 'pending')
        )
      );
      if (existing.length === 0) {
        await db.insert(potentialDuplicatesTable).values({
          contactIdA: pd.contactIdA,
          contactIdB: pd.contactIdB,
          matchType: pd.matchType,
          matchKey: pd.matchKey,
        });
        flagged++;
      }
    } catch (err) {
      console.error(`[Dedup] Failed to flag potential duplicate: ${err}`);
    }
  }
  
  console.log(`[Dedup] Complete: ${orgResult.merged} orgs merged, ${contactResult.merged} contacts merged, ${flagged} potential duplicates flagged`);
  
  return {
    organizationsMerged: orgResult.merged,
    contactsMerged: contactResult.merged,
    potentialDuplicatesFlagged: flagged,
    errors: [...orgResult.errors, ...contactResult.errors],
  };
}

/**
 * Find existing organization by normalized domain.
 * Uses SQL WHERE clause instead of loading all orgs.
 */
async function findExistingOrganization(domain: string): Promise<(typeof organizations.$inferSelect) | null> {
  const normalizedDomain = normalizeDomainForDedup(domain);
  if (!normalizedDomain) return null;

  // Use SQL LOWER + REPLACE to match normalized domains in the DB
  const results = await db
    .select()
    .from(organizations)
    .where(
      sql`LOWER(REPLACE(REPLACE(${organizations.domain}, 'www.', ''), '-', '')) = ${normalizedDomain}`
    )
    .limit(1);

  return results[0] || null;
}

/**
 * Find existing contact by name + domain.
 * Uses SQL WHERE clause instead of loading all contacts.
 */
async function findExistingContact(
  fullName: string,
  companyDomain: string | null
): Promise<(typeof contacts.$inferSelect) | null> {
  const normalizedName = normalizeName(fullName);
  if (!normalizedName) return null;

  const conditions = [eq(contacts.normalizedName, normalizedName)];

  if (companyDomain) {
    const normalizedDomain = normalizeDomainForDedup(companyDomain);
    conditions.push(
      sql`LOWER(REPLACE(REPLACE(${contacts.companyDomain}, 'www.', ''), '-', '')) = ${normalizedDomain}`
    );
  } else {
    conditions.push(isNull(contacts.companyDomain));
  }

  const results = await db
    .select()
    .from(contacts)
    .where(and(...conditions))
    .limit(1);

  return results[0] || null;
}

function normalizeLinkedinSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/in\/([^/?#]+)/);
  return match ? match[1].toLowerCase() : null;
}

interface ContactIdentifiers {
  email?: string | null;
  linkedinUrl?: string | null;
  name?: string | null;
  companyDomain?: string | null;
  employerName?: string | null;
  crustdataPersonId?: number | null;
}

interface FindContactOptions {
  autoMergeNameMatches?: boolean;
}

export async function findExistingContactByIdentifiers(
  identifiers: ContactIdentifiers,
  options?: FindContactOptions
): Promise<(typeof contacts.$inferSelect) | null> {
  const normalizedEmail = identifiers.email?.toLowerCase().trim() || null;
  const linkedinSlug = normalizeLinkedinSlug(identifiers.linkedinUrl);
  const normalizedName = normalizeName(identifiers.name);
  const normalizedDomain = normalizeDomainForDedup(identifiers.companyDomain);

  if (!normalizedEmail && !linkedinSlug && !normalizedName) return null;

  if (normalizedEmail) {
    const byEmail = await db.query.contacts.findFirst({
      where: eq(contacts.normalizedEmail, normalizedEmail),
    });
    if (byEmail) {
      console.log(`[Dedup] Matched existing contact by email: ${normalizedEmail} -> ${byEmail.fullName} (${byEmail.id})`);
      return byEmail;
    }
  }

  if (linkedinSlug) {
    const allContacts = await db.select().from(contacts).where(
      or(
        isNotNull(contacts.linkedinUrl),
        isNotNull(contacts.pdlLinkedinUrl),
        isNotNull(contacts.crustdataLinkedinUrl)
      )
    );
    for (const c of allContacts) {
      const slugs = [
        normalizeLinkedinSlug(c.linkedinUrl),
        normalizeLinkedinSlug(c.pdlLinkedinUrl),
        normalizeLinkedinSlug(c.crustdataLinkedinUrl),
      ];
      if (slugs.includes(linkedinSlug)) {
        console.log(`[Dedup] Matched existing contact by LinkedIn: ${linkedinSlug} -> ${c.fullName} (${c.id})`);
        return c;
      }
    }
  }

  if (identifiers.crustdataPersonId) {
    const byCrustId = await db.query.contacts.findFirst({
      where: eq(contacts.crustdataPersonId, identifiers.crustdataPersonId),
    });
    if (byCrustId) {
      console.log(`[Dedup] Matched existing contact by Crustdata person ID: ${identifiers.crustdataPersonId} -> ${byCrustId.fullName} (${byCrustId.id})`);
      return byCrustId;
    }
  }

  if (normalizedName && normalizedDomain) {
    const candidates = await db.select().from(contacts).where(eq(contacts.normalizedName, normalizedName));
    for (const c of candidates) {
      if (normalizeDomainForDedup(c.companyDomain) === normalizedDomain) {
        if (options?.autoMergeNameMatches) {
          console.log(`[Dedup] Name+domain match — auto-merging for enrichment: ${normalizedName}@${normalizedDomain} -> ${c.fullName} (${c.id})`);
          return c;
        }
        console.log(`[Dedup] Name+domain match found but NOT auto-merging (flagging): ${normalizedName}@${normalizedDomain} -> ${c.fullName} (${c.id})`);
        await flagPotentialDuplicate(c.id, null, 'name_domain', `${normalizedName}::${normalizedDomain}`, identifiers);
        return null;
      }
    }
  }

  if (normalizedName && identifiers.employerName) {
    const employerLower = identifiers.employerName.toLowerCase().trim();
    const candidates = await db.select().from(contacts).where(eq(contacts.normalizedName, normalizedName));
    for (const c of candidates) {
      if (c.employerName && c.employerName.toLowerCase().trim() === employerLower) {
        if (options?.autoMergeNameMatches) {
          console.log(`[Dedup] Name+employer match — auto-merging for enrichment: ${normalizedName}@${employerLower} -> ${c.fullName} (${c.id})`);
          return c;
        }
        console.log(`[Dedup] Name+employer match found but NOT auto-merging (flagging): ${normalizedName}@${employerLower} -> ${c.fullName} (${c.id})`);
        await flagPotentialDuplicate(c.id, null, 'name_employer', `${normalizedName}::${employerLower}`, identifiers);
        return null;
      }
    }
  }

  return null;
}

export async function flagPotentialDuplicateById(
  existingContactId: string,
  newContactId: string,
  matchType: string,
  matchKey: string,
) {
  try {
    const existing = await db.select().from(potentialDuplicatesTable).where(
      and(
        or(
          and(eq(potentialDuplicatesTable.contactIdA, existingContactId), eq(potentialDuplicatesTable.contactIdB, newContactId)),
          and(eq(potentialDuplicatesTable.contactIdA, newContactId), eq(potentialDuplicatesTable.contactIdB, existingContactId))
        ),
        eq(potentialDuplicatesTable.status, 'pending')
      )
    );
    if (existing.length === 0) {
      await db.insert(potentialDuplicatesTable).values({
        contactIdA: existingContactId,
        contactIdB: newContactId,
        matchType,
        matchKey,
      });
      console.log(`[Dedup] Created potential duplicate flag: ${matchType} / ${matchKey} (${existingContactId} vs ${newContactId})`);
    }
  } catch (err) {
    console.error(`[Dedup] Error flagging potential duplicate by ID: ${err}`);
  }
}

async function flagPotentialDuplicate(
  existingContactId: string,
  newContactId: string | null,
  matchType: string,
  matchKey: string,
  identifiers: ContactIdentifiers,
) {
  try {
    if (!newContactId) {
      console.log(`[Dedup] Flagging potential duplicate for admin review: ${matchType} / ${matchKey} (existing: ${existingContactId}, new contact not yet created)`);
      return;
    }
    const existing = await db.select().from(potentialDuplicatesTable).where(
      and(
        or(
          and(eq(potentialDuplicatesTable.contactIdA, existingContactId), eq(potentialDuplicatesTable.contactIdB, newContactId)),
          and(eq(potentialDuplicatesTable.contactIdA, newContactId), eq(potentialDuplicatesTable.contactIdB, existingContactId))
        ),
        eq(potentialDuplicatesTable.status, 'pending')
      )
    );
    if (existing.length === 0) {
      await db.insert(potentialDuplicatesTable).values({
        contactIdA: existingContactId,
        contactIdB: newContactId,
        matchType,
        matchKey,
      });
      console.log(`[Dedup] Created potential duplicate flag: ${matchType} / ${matchKey}`);
    }
  } catch (err) {
    console.error(`[Dedup] Error flagging potential duplicate: ${err}`);
  }
}

/**
 * Merge two properties — re-links all junction table rows from mergeId to keepId,
 * then soft-deletes the merged-away property by setting enrichmentStatus = 'merged'.
 */
export async function mergeProperties(keepId: string, mergeId: string): Promise<void> {
  console.log(`[Dedup] Merging property ${mergeId} into ${keepId}`);

  // Smart field merge
  const [keepProp] = await db.select().from(properties).where(eq(properties.id, keepId));
  const [mergeProp] = await db.select().from(properties).where(eq(properties.id, mergeId));
  let fieldsUpdated: string[] = [];

  if (keepProp && mergeProp) {
    const mergeUpdates = smartMergePropertyFields(keepProp, mergeProp);
    fieldsUpdated = (mergeUpdates as any)._fieldsUpdated || [];
    delete (mergeUpdates as any)._fieldsUpdated;
    if (Object.keys(mergeUpdates).length > 0) {
      await db.update(properties).set(mergeUpdates).where(eq(properties.id, keepId));
    }
  }

  const moveRows = async (table: any) => {
    const rows = await db.select().from(table).where(eq(table.propertyId, mergeId));
    for (const row of rows) {
      try {
        await db.update(table).set({ propertyId: keepId }).where(eq(table.id, (row as any).id));
      } catch {
        await db.delete(table).where(eq(table.id, (row as any).id));
      }
    }
  };

  const movePropertyContacts = async () => {
    const keepLinks = await db.select({ contactId: propertyContacts.contactId }).from(propertyContacts).where(eq(propertyContacts.propertyId, keepId));
    const keepContactIds = new Set(keepLinks.map(l => l.contactId));
    const mergeLinks = await db.select().from(propertyContacts).where(eq(propertyContacts.propertyId, mergeId));
    for (const link of mergeLinks) {
      if (keepContactIds.has(link.contactId)) {
        await db.delete(propertyContacts).where(eq(propertyContacts.id, link.id));
      } else {
        await db.update(propertyContacts).set({ propertyId: keepId }).where(eq(propertyContacts.id, link.id));
        keepContactIds.add(link.contactId);
      }
    }
  };

  const movePropertyOrganizations = async () => {
    const keepLinks = await db.select({ orgId: propertyOrganizations.orgId }).from(propertyOrganizations).where(eq(propertyOrganizations.propertyId, keepId));
    const keepOrgIds = new Set(keepLinks.map(l => l.orgId));
    const mergeLinks = await db.select().from(propertyOrganizations).where(eq(propertyOrganizations.propertyId, mergeId));
    for (const link of mergeLinks) {
      if (keepOrgIds.has(link.orgId)) {
        await db.delete(propertyOrganizations).where(eq(propertyOrganizations.id, link.id));
      } else {
        await db.update(propertyOrganizations).set({ propertyId: keepId }).where(eq(propertyOrganizations.id, link.id));
        keepOrgIds.add(link.orgId);
      }
    }
  };

  await movePropertyContacts();
  await movePropertyOrganizations();
  await moveRows(propertyFlags);
  await moveRows(propertyPipeline);
  await moveRows(propertyNotes);
  await moveRows(propertyActivity);
  await moveRows(propertyActions);
  await moveRows(propertyViews);

  await db.update(properties)
    .set({ enrichmentStatus: 'merged' })
    .where(eq(properties.id, mergeId));

  try {
    await db.insert(adminAuditLog).values({
      action: 'merge_property',
      targetTable: 'properties',
      metadata: { keepId, mergeId, fieldsUpdated },
    });
  } catch {
  }

  console.log(`[Dedup] Property merge complete: ${mergeId} → ${keepId}`);
}
