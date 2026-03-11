// ============================================================================
// Enrichment Accuracy Scoring
//
// Automated completeness and quality scoring per property enrichment result.
// Used to compare V2 vs V3 pipeline outputs and track quality over time.
// ============================================================================

import type { FocusedEnrichmentResult, DiscoveredContact } from '../ai/types';

export interface PropertyScore {
  propertyKey: string;
  totalScore: number; // 0-100
  breakdown: {
    classification: number; // 0-15
    ownership: number; // 0-25
    contacts: number; // 0-40
    domains: number; // 0-10
    sources: number; // 0-10
  };
  fieldFillRates: Record<string, boolean>;
  contactScores: ContactScore[];
}

export interface ContactScore {
  name: string;
  score: number; // 0-100
  hasEmail: boolean;
  emailVerified: boolean;
  hasPhone: boolean;
  hasLinkedIn: boolean;
  hasTitle: boolean;
  hasCompany: boolean;
  hasDomain: boolean;
}

/**
 * Score a property enrichment result for completeness and quality.
 * Returns a 0-100 score with detailed breakdown.
 */
export function scoreEnrichmentResult(result: FocusedEnrichmentResult): PropertyScore {
  const breakdown = {
    classification: scoreClassification(result),
    ownership: scoreOwnership(result),
    contacts: scoreContacts(result),
    domains: scoreDomains(result),
    sources: scoreSources(result),
  };

  const totalScore = breakdown.classification + breakdown.ownership + breakdown.contacts + breakdown.domains + breakdown.sources;

  const fieldFillRates: Record<string, boolean> = {
    propertyName: !!result.classification.data.propertyName,
    category: !!result.classification.data.category,
    subcategory: !!result.classification.data.subcategory,
    propertyClass: !!result.classification.data.propertyClass,
    beneficialOwner: !!result.ownership.data.beneficialOwner.name,
    ownerDomain: !!result.ownership.data.beneficialOwner.domain,
    managementCompany: !!result.ownership.data.managementCompany.name,
    mgmtDomain: !!result.ownership.data.managementCompany.domain,
    propertyWebsite: !!result.ownership.data.propertyWebsite,
    hasContacts: result.contacts.data.contacts.length > 0,
    hasVerifiedEmail: result.contacts.data.contacts.some(c => c.email),
  };

  const contactScores = result.contacts.data.contacts.map(scoreContact);

  return {
    propertyKey: result.propertyKey,
    totalScore: Math.round(totalScore),
    breakdown,
    fieldFillRates,
    contactScores,
  };
}

function scoreClassification(result: FocusedEnrichmentResult): number {
  let score = 0;
  const cls = result.classification.data;
  if (cls.propertyName) score += 3;
  if (cls.canonicalAddress) score += 3;
  if (cls.category) score += 3;
  if (cls.subcategory) score += 2;
  if (cls.propertyClass) score += 2;
  if (cls.confidence >= 0.7) score += 2;
  return Math.min(score, 15);
}

function scoreOwnership(result: FocusedEnrichmentResult): number {
  let score = 0;
  const own = result.ownership.data;

  // Beneficial owner
  if (own.beneficialOwner.name) score += 5;
  if (own.beneficialOwner.domain) score += 3;
  if (own.beneficialOwner.type) score += 2;
  if (own.beneficialOwner.confidence >= 0.7) score += 2;

  // Management company
  if (own.managementCompany.name) score += 5;
  if (own.managementCompany.domain) score += 3;
  if (own.managementCompany.confidence >= 0.5) score += 2;

  // Property web presence
  if (own.propertyWebsite) score += 2;
  if (own.propertyPhone) score += 1;

  return Math.min(score, 25);
}

function scoreContacts(result: FocusedEnrichmentResult): number {
  const contactList = result.contacts.data.contacts;
  if (contactList.length === 0) return 0;

  let score = 0;
  // Having contacts at all
  score += Math.min(contactList.length * 5, 15);

  // Quality of contacts
  for (const c of contactList.slice(0, 3)) {
    const cs = scoreContact(c);
    score += cs.score * 0.25; // Each contact contributes up to 25% of max
  }

  return Math.min(Math.round(score), 40);
}

function scoreContact(contact: DiscoveredContact): ContactScore {
  let score = 0;
  const hasEmail = !!contact.email;
  const hasTitle = !!contact.title;
  const hasCompany = !!contact.company;
  const hasDomain = !!contact.companyDomain;
  const hasLinkedIn = false; // DiscoveredContact doesn't have LinkedIn at this stage
  const hasPhone = !!contact.phone;

  if (contact.name) score += 20;
  if (hasEmail) score += 25;
  if (hasTitle) score += 15;
  if (hasCompany) score += 15;
  if (hasDomain) score += 10;
  if (hasPhone) score += 10;
  if (contact.roleConfidence >= 0.7) score += 5;

  return {
    name: contact.name,
    score: Math.min(score, 100),
    hasEmail,
    emailVerified: hasEmail && contact.emailSource === 'hunter',
    hasPhone,
    hasLinkedIn,
    hasTitle,
    hasCompany,
    hasDomain,
  };
}

function scoreDomains(result: FocusedEnrichmentResult): number {
  let score = 0;
  const own = result.ownership.data;
  if (own.beneficialOwner.domain) score += 3;
  if (own.managementCompany.domain) score += 3;
  // Contacts with domains
  const contactsWithDomain = result.contacts.data.contacts.filter(c => c.companyDomain).length;
  score += Math.min(contactsWithDomain * 2, 4);
  return Math.min(score, 10);
}

function scoreSources(result: FocusedEnrichmentResult): number {
  let score = 0;
  if (result.classification.sources.length > 0) score += 2;
  if (result.ownership.sources.length > 0) score += 3;
  if (result.contacts.sources.length > 0) score += 3;
  // Bonus for contacts with source URLs
  const contactsWithSource = result.contacts.data.contacts.filter(c => c.sourceUrl).length;
  score += Math.min(contactsWithSource, 2);
  return Math.min(score, 10);
}

/**
 * Compare two enrichment results (e.g. V2 vs V3) and log the delta.
 */
export function compareScores(
  propertyKey: string,
  scoreA: PropertyScore,
  scoreB: PropertyScore,
  labelA = 'V2',
  labelB = 'V3'
): void {
  const delta = scoreB.totalScore - scoreA.totalScore;
  const sign = delta >= 0 ? '+' : '';
  console.log(`[AccuracyScore] ${propertyKey}: ${labelA}=${scoreA.totalScore} ${labelB}=${scoreB.totalScore} (${sign}${delta})`);

  for (const key of Object.keys(scoreA.breakdown) as (keyof PropertyScore['breakdown'])[]) {
    const d = scoreB.breakdown[key] - scoreA.breakdown[key];
    if (d !== 0) {
      const s = d >= 0 ? '+' : '';
      console.log(`  ${key}: ${scoreA.breakdown[key]} → ${scoreB.breakdown[key]} (${s}${d})`);
    }
  }
}
