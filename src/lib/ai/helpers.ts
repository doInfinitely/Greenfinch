// ============================================================================
// AI Enrichment — Utility Helpers
//
// Pure functions that format data for prompts, normalize names, detect
// hallucinated emails, deduplicate contacts, and cross-validate ownership.
// None of these call external APIs — they operate entirely on in-memory data.
// ============================================================================

import type { CommercialProperty, DCADBuilding } from "../snowflake";
import type { DiscoveredContact, OwnershipInfo } from './types';
import { ASSET_CATEGORIES } from "../constants";
import { QUALITY_GRADE_MAP, OWNER_TYPE_MAP } from './config';

// Re-export so existing imports from helpers still work
export { OWNER_TYPE_MAP } from './config';

/**
 * Summarize building records from DCAD into a compact string for the prompt.
 * Single building → one-line summary; multiple → numbered list.
 */
export function formatBuildingsSummary(buildings: DCADBuilding[] | null, totalSqft: number | null): string {
  if (!buildings || buildings.length === 0) return '';
  if (buildings.length === 1) {
    const b = buildings[0];
    const parts = [];
    if (b.yearBuilt) parts.push(`built ${b.yearBuilt}`);
    if (b.numStories) parts.push(`${b.numStories} stories`);
    if (b.numUnits) parts.push(`${b.numUnits} units`);
    return parts.length > 0 ? `\nBLDG: ${parts.join(', ')}` : '';
  }
  return '\nBLDGS:\n' + buildings.map((b, i) => {
    const parts = [];
    if (b.grossBldgArea) parts.push(`${b.grossBldgArea.toLocaleString()} sqft`);
    if (b.yearBuilt) parts.push(`built ${b.yearBuilt}`);
    if (b.numStories) parts.push(`${b.numStories} stories`);
    if (b.numUnits) parts.push(`${b.numUnits} units`);
    return `${i + 1}. ${parts.join(', ')}`;
  }).join('\n');
}

/** Flatten ASSET_CATEGORIES into a single-line string for the Stage 1 prompt. */
export function formatCompactCategories(): string {
  return Object.entries(ASSET_CATEGORIES)
    .map(([cat, subs]) => `${cat} (${subs.join(', ')})`)
    .join(' | ');
}

/**
 * Convert a DCAD quality grade (e.g. "Excellent") into a CRE property class
 * (e.g. "A") using the static mapping in config.  Returns null if unrecognized.
 */
export function mapQualityGradeToClass(grade: string | null): { propertyClass: string | null; confidence: number } {
  if (!grade) return { propertyClass: null, confidence: 0 };
  const gradeNorm = grade.trim().toLowerCase();
  return QUALITY_GRADE_MAP[gradeNorm] || { propertyClass: null, confidence: 0 };
}

/** Extract lat/lon from a property record, if available. */
export function propertyLatLng(property: CommercialProperty): { latitude: number; longitude: number } | undefined {
  return property.lat && property.lon ? { latitude: property.lat, longitude: property.lon } : undefined;
}

/**
 * Pull useful legal description text from DCAD records.
 * Only returns text containing recognizable property names (plaza, center, etc.)
 * — generic lot/block descriptions are ignored.
 */
export function extractUsefulLegalInfo(property: CommercialProperty): string | null {
  const legal = [property.legal1, property.legal2, property.legal3, property.legal4]
    .filter(Boolean).join(' ');
  if (!legal) return null;
  const usefulPatterns = /plaza|center|tower|park|square|village|crossing|place|point|commons|mall|industrial|business/i;
  return usefulPatterns.test(legal) ? legal : null;
}

/**
 * Remove internal debug messages, error traces, and citation numbers
 * from a raw enrichment summary before showing it to users.
 */
export function stripInternalMessages(text: string): string {
  return text
    .replace(/\[[\d,\s]+\]/g, '')
    .replace(/Failed to identify[\w\s-]*?:.*?(?=\.|$)/gim, '')
    .replace(/Gemini\s*API\s*timeout\s*after\s*\d+ms.*?(?=\.|$)/gi, '')
    .replace(/gemini.*?timed?\s*out.*?\d+ms/gi, '')
    .replace(/Error:.*?$/gim, '')
    .replace(/\(attempt\s*\d+\)/gi, '')
    .replace(/TypeError:.*?$/gim, '')
    .replace(/fetch failed.*?$/gim, '')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Normalize a name to lowercase alpha-only for deduplication. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Detect whether an email looks like it was constructed from a person's name
 * (e.g. "jsmith@co.com" for "John Smith") rather than found on a real page.
 *
 * When Gemini hallucinates emails it almost always follows one of these
 * patterns.  If the email matches AND there are no grounding sources, it's
 * very likely fake.
 */
export function isLikelyConstructedEmail(email: string, fullName: string): boolean {
  if (!email || !fullName) return false;
  const parts = fullName.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  if (parts.length < 2) return false;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const localPart = email.split('@')[0]?.toLowerCase() || '';

  const constructedPatterns = [
    `${firstName}.${lastName}`,
    `${firstName}${lastName}`,
    `${firstName[0]}${lastName}`,
    `${firstName}_${lastName}`,
    `${firstName[0]}.${lastName}`,
    `${firstName}${lastName[0]}`,
    `${lastName}.${firstName}`,
    `${lastName}${firstName[0]}`,
  ];

  return constructedPatterns.includes(localPart);
}

/**
 * Merge duplicate contacts (by normalized name) into a single record.
 * When two records share a name, the one with more data wins for each field;
 * the higher roleConfidence is kept.
 */
export function deduplicateContacts(contacts: DiscoveredContact[]): DiscoveredContact[] {
  const seen = new Map<string, number>();
  const result: DiscoveredContact[] = [];

  for (const contact of contacts) {
    const key = normalizeName(contact.name);
    if (!key) continue;

    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      const existing = result[existingIdx];
      if (!existing.email && contact.email) existing.email = contact.email;
      if (!existing.phone && contact.phone) existing.phone = contact.phone;
      if (!existing.title && contact.title) existing.title = contact.title;
      if (!existing.company && contact.company) existing.company = contact.company;
      if (contact.roleConfidence > existing.roleConfidence) {
        existing.role = contact.role;
        existing.roleConfidence = contact.roleConfidence;
      }
      console.log(`[FocusedEnrichment] Deduplicated contact: "${contact.name}" merged into "${existing.name}"`);
    } else {
      seen.set(key, result.length);
      result.push({ ...contact });
    }
  }

  return result;
}

/**
 * Cross-validate ownership data after Stage 2 parsing.
 * Checks whether any management company domain and the property website
 * domain are consistent — logs a warning if they all disagree and
 * the primary management company confidence is low.
 */
export function crossValidateOwnership(ownership: OwnershipInfo): OwnershipInfo {
  if (ownership.propertyWebsite) {
    try {
      const siteHost = new URL(ownership.propertyWebsite).hostname.toLowerCase();
      const allMgmtDomains = [
        ownership.managementCompany.domain,
        ...(ownership.additionalManagementCompanies || []).map(m => m.domain),
      ].filter(Boolean).map(d => d!.toLowerCase());

      const anyMatch = allMgmtDomains.some(d => siteHost.includes(d) || d.includes(siteHost));
      if (!anyMatch && allMgmtDomains.length > 0 && ownership.managementCompany.confidence < 0.5) {
        console.warn('[FocusedEnrichment] Low-confidence mgmt co(s) with separate property website — verify');
      }
    } catch { /* invalid URL, skip */ }
  }
  return ownership;
}
