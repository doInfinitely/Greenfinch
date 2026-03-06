// ============================================================================
// Enrichment Pipeline Comparison
//
// Logs field-level diffs between V1 (legacy) and V2 (new) cascade results
// for quality analysis during the A/B transition period.
// ============================================================================

import type { ContactEnrichmentResult, OrganizationEnrichmentResult } from './cascade-enrichment';

export interface FieldDiff {
  field: string;
  v1Value: any;
  v2Value: any;
  match: boolean;
}

export interface ComparisonResult {
  entityType: 'contact' | 'organization';
  entityId: string;
  timestamp: string;
  diffs: FieldDiff[];
  summary: {
    totalFields: number;
    matchingFields: number;
    diffingFields: number;
    matchRate: number;
  };
  v1Found: boolean;
  v2Found: boolean;
}

/**
 * Compare V1 and V2 contact enrichment results field-by-field.
 */
export function compareContactResults(
  entityId: string,
  v1: ContactEnrichmentResult,
  v2: ContactEnrichmentResult
): ComparisonResult {
  const comparisonFields: (keyof ContactEnrichmentResult)[] = [
    'found', 'confidenceFlag', 'email', 'emailVerified',
    'phone', 'title', 'company', 'companyDomain',
    'linkedinUrl', 'location', 'seniority',
    'employerLeftDetected',
  ];

  const diffs: FieldDiff[] = comparisonFields.map(field => ({
    field,
    v1Value: v1[field],
    v2Value: v2[field],
    match: normalizeForComparison(v1[field]) === normalizeForComparison(v2[field]),
  }));

  const matchingFields = diffs.filter(d => d.match).length;

  const result: ComparisonResult = {
    entityType: 'contact',
    entityId,
    timestamp: new Date().toISOString(),
    diffs,
    summary: {
      totalFields: diffs.length,
      matchingFields,
      diffingFields: diffs.length - matchingFields,
      matchRate: diffs.length > 0 ? matchingFields / diffs.length : 0,
    },
    v1Found: v1.found,
    v2Found: v2.found,
  };

  logComparison(result);
  return result;
}

/**
 * Compare V1 and V2 organization enrichment results field-by-field.
 */
export function compareOrganizationResults(
  entityId: string,
  v1: OrganizationEnrichmentResult,
  v2: OrganizationEnrichmentResult
): ComparisonResult {
  const comparisonFields: (keyof OrganizationEnrichmentResult)[] = [
    'found', 'name', 'industry', 'employeeCount', 'employeesRange',
    'foundedYear', 'website', 'linkedinUrl', 'phone',
    'city', 'state',
  ];

  const diffs: FieldDiff[] = comparisonFields.map(field => ({
    field,
    v1Value: v1[field],
    v2Value: v2[field],
    match: normalizeForComparison(v1[field]) === normalizeForComparison(v2[field]),
  }));

  const matchingFields = diffs.filter(d => d.match).length;

  const result: ComparisonResult = {
    entityType: 'organization',
    entityId,
    timestamp: new Date().toISOString(),
    diffs,
    summary: {
      totalFields: diffs.length,
      matchingFields,
      diffingFields: diffs.length - matchingFields,
      matchRate: diffs.length > 0 ? matchingFields / diffs.length : 0,
    },
    v1Found: v1.found,
    v2Found: v2.found,
  };

  logComparison(result);
  return result;
}

function normalizeForComparison(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.toLowerCase().trim();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function logComparison(result: ComparisonResult): void {
  const diffFields = result.diffs.filter(d => !d.match);
  if (diffFields.length === 0) {
    console.log(`[EnrichmentCompare] ${result.entityType} ${result.entityId}: MATCH (${result.summary.totalFields} fields)`);
  } else {
    console.log(`[EnrichmentCompare] ${result.entityType} ${result.entityId}: ${diffFields.length} DIFFS (match rate: ${(result.summary.matchRate * 100).toFixed(0)}%)`);
    for (const diff of diffFields) {
      console.log(`  - ${diff.field}: V1="${diff.v1Value}" vs V2="${diff.v2Value}"`);
    }
  }
}
