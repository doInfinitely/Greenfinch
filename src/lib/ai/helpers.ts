// ============================================================================
// AI Enrichment — Utility Helpers
// Formatting helpers, property data extractors, name normalization, email
// pattern detection, and contact deduplication.
// ============================================================================

import type { CommercialProperty, DCADBuilding } from "../snowflake";
import type { DiscoveredContact, OwnershipInfo } from './types';
import { ASSET_CATEGORIES } from "../constants";

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

export function formatCompactCategories(): string {
  return Object.entries(ASSET_CATEGORIES)
    .map(([cat, subs]) => `${cat} (${subs.join(', ')})`)
    .join(' | ');
}

export function mapQualityGradeToClass(grade: string | null): { propertyClass: string | null; confidence: number } {
  if (!grade) return { propertyClass: null, confidence: 0 };
  const gradeNorm = grade.trim().toLowerCase();
  const mapping: Record<string, { propertyClass: string; confidence: number }> = {
    'excellent': { propertyClass: 'A', confidence: 0.8 },
    'superior': { propertyClass: 'A+', confidence: 0.8 },
    'good': { propertyClass: 'B', confidence: 0.7 },
    'average': { propertyClass: 'C', confidence: 0.6 },
    'fair': { propertyClass: 'C', confidence: 0.6 },
    'poor': { propertyClass: 'D', confidence: 0.7 },
    'unsound': { propertyClass: 'D', confidence: 0.7 },
  };
  return mapping[gradeNorm] || { propertyClass: null, confidence: 0 };
}

export function propertyLatLng(property: CommercialProperty): { latitude: number; longitude: number } | undefined {
  return property.lat && property.lon ? { latitude: property.lat, longitude: property.lon } : undefined;
}

export function extractUsefulLegalInfo(property: CommercialProperty): string | null {
  const legal = [property.legal1, property.legal2, property.legal3, property.legal4]
    .filter(Boolean).join(' ');
  if (!legal) return null;
  const usefulPatterns = /plaza|center|tower|park|square|village|crossing|place|point|commons|mall|industrial|business/i;
  return usefulPatterns.test(legal) ? legal : null;
}

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

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

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

export const OWNER_TYPE_MAP: Record<string, OwnershipInfo['beneficialOwner']['type']> = {
  'REIT': 'REIT',
  'PE': 'Private Equity',
  'Private Equity': 'Private Equity',
  'Family Office': 'Family Office',
  'Individual': 'Individual',
  'Corporation': 'Corporation',
  'Institutional': 'Institutional',
  'Syndicator': 'Syndicator',
};

export function crossValidateOwnership(ownership: OwnershipInfo): OwnershipInfo {
  if (ownership.managementCompany.domain && ownership.propertyWebsite) {
    try {
      const siteHost = new URL(ownership.propertyWebsite).hostname.toLowerCase();
      const mgmtDomain = ownership.managementCompany.domain.toLowerCase();
      if (!siteHost.includes(mgmtDomain) && !mgmtDomain.includes(siteHost)) {
        if (ownership.managementCompany.confidence < 0.5) {
          console.warn('[FocusedEnrichment] Low-confidence mgmt co with separate property website — verify');
        }
      }
    } catch { /* invalid URL, skip */ }
  }
  return ownership;
}
