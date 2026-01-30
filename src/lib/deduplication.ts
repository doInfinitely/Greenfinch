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
  listItems 
} from './schema';
import { eq, sql, and, or, isNotNull } from 'drizzle-orm';

/**
 * Normalize domain for comparison
 * Strips hyphens, converts to lowercase, trims whitespace
 */
export function normalizeDomain(domain: string | null | undefined): string {
  if (!domain) return '';
  return domain.toLowerCase().trim().replace(/-/g, '');
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
 * Find duplicate organizations by normalized domain
 */
export async function findDuplicateOrganizations(): Promise<DuplicateGroup<typeof organizations.$inferSelect>[]> {
  const allOrgs = await db.select().from(organizations).where(isNotNull(organizations.domain));
  
  const domainMap = new Map<string, (typeof organizations.$inferSelect)[]>();
  
  for (const org of allOrgs) {
    const normalizedDomain = normalizeDomain(org.domain);
    if (!normalizedDomain) continue;
    
    if (!domainMap.has(normalizedDomain)) {
      domainMap.set(normalizedDomain, []);
    }
    domainMap.get(normalizedDomain)!.push(org);
  }
  
  const duplicates: DuplicateGroup<typeof organizations.$inferSelect>[] = [];
  
  for (const [domain, orgs] of domainMap) {
    if (orgs.length > 1) {
      // Sort by: has provider_id first, then by last_enriched_at desc
      orgs.sort((a, b) => {
        // Prefer records with Apollo providerId
        if (a.providerId && !b.providerId) return -1;
        if (!a.providerId && b.providerId) return 1;
        // Then by most recent enrichment
        const aDate = a.lastEnrichedAt?.getTime() || 0;
        const bDate = b.lastEnrichedAt?.getTime() || 0;
        return bDate - aDate;
      });
      
      duplicates.push({
        key: domain,
        items: orgs,
        keepId: orgs[0].id,
        deleteIds: orgs.slice(1).map(o => o.id),
      });
    }
  }
  
  return duplicates;
}

/**
 * Find duplicate contacts by same name + similar domain
 */
export async function findDuplicateContacts(): Promise<DuplicateGroup<typeof contacts.$inferSelect>[]> {
  const allContacts = await db.select().from(contacts);
  
  // Group by normalized name + normalized domain
  const contactMap = new Map<string, (typeof contacts.$inferSelect)[]>();
  
  for (const contact of allContacts) {
    const normalizedName = normalizeName(contact.fullName);
    const normalizedDomain = normalizeDomain(contact.companyDomain);
    
    if (!normalizedName) continue;
    
    // Key is name + domain (domain can be empty)
    const key = `${normalizedName}::${normalizedDomain}`;
    
    if (!contactMap.has(key)) {
      contactMap.set(key, []);
    }
    contactMap.get(key)!.push(contact);
  }
  
  const duplicates: DuplicateGroup<typeof contacts.$inferSelect>[] = [];
  
  for (const [key, contactList] of contactMap) {
    if (contactList.length > 1) {
      // Sort by: has valid email first, has provider_id, then by enriched_at desc
      contactList.sort((a, b) => {
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
      });
      
      duplicates.push({
        key,
        items: contactList,
        keepId: contactList[0].id,
        deleteIds: contactList.slice(1).map(c => c.id),
      });
    }
  }
  
  return duplicates;
}

/**
 * Merge duplicate organizations
 * Updates all foreign key references and deletes duplicates
 */
export async function mergeOrganizations(duplicates: DuplicateGroup<typeof organizations.$inferSelect>[]): Promise<{ merged: number; errors: string[] }> {
  let merged = 0;
  const errors: string[] = [];
  
  for (const group of duplicates) {
    try {
      console.log(`[Dedup] Merging ${group.deleteIds.length} duplicate orgs into ${group.keepId} (domain: ${group.key})`);
      
      for (const deleteId of group.deleteIds) {
        // Update property_organizations references
        await db.update(propertyOrganizations)
          .set({ orgId: group.keepId })
          .where(eq(propertyOrganizations.orgId, deleteId));
        
        // Update contact_organizations references
        await db.update(contactOrganizations)
          .set({ orgId: group.keepId })
          .where(eq(contactOrganizations.orgId, deleteId));
        
        // Update parent_org_id references in other organizations
        await db.update(organizations)
          .set({ parentOrgId: group.keepId })
          .where(eq(organizations.parentOrgId, deleteId));
        
        // Update ultimate_parent_org_id references
        await db.update(organizations)
          .set({ ultimateParentOrgId: group.keepId })
          .where(eq(organizations.ultimateParentOrgId, deleteId));
        
        // Delete the duplicate org
        await db.delete(organizations).where(eq(organizations.id, deleteId));
        
        merged++;
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
 * Merge duplicate contacts
 * Updates all foreign key references and deletes duplicates
 */
export async function mergeContacts(duplicates: DuplicateGroup<typeof contacts.$inferSelect>[]): Promise<{ merged: number; errors: string[] }> {
  let merged = 0;
  const errors: string[] = [];
  
  for (const group of duplicates) {
    try {
      console.log(`[Dedup] Merging ${group.deleteIds.length} duplicate contacts into ${group.keepId} (key: ${group.key})`);
      
      for (const deleteId of group.deleteIds) {
        // Update property_contacts references
        await db.update(propertyContacts)
          .set({ contactId: group.keepId })
          .where(eq(propertyContacts.contactId, deleteId));
        
        // Update contact_organizations references
        await db.update(contactOrganizations)
          .set({ contactId: group.keepId })
          .where(eq(contactOrganizations.contactId, deleteId));
        
        // Update list_items references
        await db.update(listItems)
          .set({ itemId: group.keepId })
          .where(eq(listItems.itemId, deleteId));
        
        // Delete the duplicate contact
        await db.delete(contacts).where(eq(contacts.id, deleteId));
        
        merged++;
      }
    } catch (error) {
      const errMsg = `Failed to merge contact ${group.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[Dedup] ${errMsg}`);
      errors.push(errMsg);
    }
  }
  
  return { merged, errors };
}

/**
 * Run full deduplication on all organizations and contacts
 */
export async function runDeduplication(): Promise<DeduplicationResult> {
  console.log('[Dedup] Starting deduplication...');
  
  // Find and merge duplicate organizations
  const orgDuplicates = await findDuplicateOrganizations();
  console.log(`[Dedup] Found ${orgDuplicates.length} organization duplicate groups`);
  const orgResult = await mergeOrganizations(orgDuplicates);
  
  // Find and merge duplicate contacts
  const contactDuplicates = await findDuplicateContacts();
  console.log(`[Dedup] Found ${contactDuplicates.length} contact duplicate groups`);
  const contactResult = await mergeContacts(contactDuplicates);
  
  console.log(`[Dedup] Complete: ${orgResult.merged} orgs merged, ${contactResult.merged} contacts merged`);
  
  return {
    organizationsMerged: orgResult.merged,
    contactsMerged: contactResult.merged,
    errors: [...orgResult.errors, ...contactResult.errors],
  };
}

/**
 * Find existing organization by normalized domain
 */
export async function findExistingOrganization(domain: string): Promise<(typeof organizations.$inferSelect) | null> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;
  
  const allOrgs = await db.select().from(organizations).where(isNotNull(organizations.domain));
  
  for (const org of allOrgs) {
    if (normalizeDomain(org.domain) === normalizedDomain) {
      return org;
    }
  }
  
  return null;
}

/**
 * Find existing contact by name + domain
 */
export async function findExistingContact(
  fullName: string, 
  companyDomain: string | null
): Promise<(typeof contacts.$inferSelect) | null> {
  const normalizedName = normalizeName(fullName);
  const normalizedDomain = normalizeDomain(companyDomain);
  
  if (!normalizedName) return null;
  
  const allContacts = await db.select().from(contacts);
  
  for (const contact of allContacts) {
    const contactNormalizedName = normalizeName(contact.fullName);
    const contactNormalizedDomain = normalizeDomain(contact.companyDomain);
    
    if (contactNormalizedName === normalizedName && contactNormalizedDomain === normalizedDomain) {
      return contact;
    }
  }
  
  return null;
}
