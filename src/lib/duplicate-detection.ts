/**
 * Duplicate Detection Service
 *
 * Fuzzy matching for contacts, organizations, and properties using
 * pg_trgm similarity() and GIN trigram indexes.
 */

import { db } from './db';
import {
  contacts,
  organizations,
  properties,
  potentialDuplicates,
} from './schema';
import { eq, sql, and, or, ne, isNotNull } from 'drizzle-orm';
import { normalizeDomainForDedup } from './deduplication';

export type EntityType = 'contact' | 'organization' | 'property';

// Strip common business suffixes for fuzzy name comparison
const STRIP_SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|l\.p|llp|l\.l\.p|group|holdings|partners|ventures|enterprises|management|mgmt|properties|realty|real estate|investments|capital|trust|fund|advisors|associates|development|developers|services|solutions|consulting)\b/gi;
const STRIP_PARENS = /\([^)]*\)/g;
const STRIP_PUNCTUATION = /[.,'"!?;:&\-\/\\#@]+/g;

export function normalizeForFuzzy(name: string): string {
  return name
    .toLowerCase()
    .replace(STRIP_PARENS, ' ')
    .replace(STRIP_SUFFIXES, ' ')
    .replace(STRIP_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DuplicateCandidate {
  entityType: EntityType;
  entityIdA: string;
  entityIdB: string;
  matchType: string;
  matchKey: string;
  confidence: number;
}

interface DetectionResult {
  found: number;
  totalPending: number;
}

/**
 * Detect duplicate contacts using fuzzy matching.
 *
 * Tier 2: fuzzy name (similarity > 0.6) + same normalized domain → conf 0.85-0.95
 * Tier 3: fuzzy name (similarity > 0.6) + fuzzy employer (similarity > 0.7) → conf 0.6-0.8
 * Tier 4: same normalized phone → conf 0.5
 *
 * (Tier 1 exact email/LinkedIn auto-merge is already handled in deduplication.ts)
 */
export async function detectContactDuplicates(): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];

  // Tier 2: Fuzzy name + same normalized domain
  const tier2 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      similarity(a.normalized_name, b.normalized_name) AS name_sim,
      a.normalized_name AS name_a,
      b.normalized_name AS name_b
    FROM contacts a
    JOIN contacts b ON a.id < b.id
    WHERE a.normalized_name IS NOT NULL
      AND b.normalized_name IS NOT NULL
      AND a.company_domain IS NOT NULL
      AND b.company_domain IS NOT NULL
      AND similarity(a.normalized_name, b.normalized_name) > 0.6
      AND LOWER(REPLACE(REPLACE(a.company_domain, 'www.', ''), '-', ''))
        = LOWER(REPLACE(REPLACE(b.company_domain, 'www.', ''), '-', ''))
    LIMIT 500
  `);

  for (const row of tier2.rows as any[]) {
    const nameSim = parseFloat(row.name_sim);
    candidates.push({
      entityType: 'contact',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'fuzzy_name_domain',
      matchKey: `${row.name_a}::${row.name_b}`,
      confidence: 0.85 + (nameSim - 0.6) * 0.25, // 0.85 at sim=0.6, ~0.95 at sim=1.0
    });
  }

  // Tier 3: Fuzzy name + fuzzy employer name
  const tier3 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      similarity(a.normalized_name, b.normalized_name) AS name_sim,
      similarity(LOWER(a.employer_name), LOWER(b.employer_name)) AS emp_sim,
      a.normalized_name AS name_a,
      b.normalized_name AS name_b
    FROM contacts a
    JOIN contacts b ON a.id < b.id
    WHERE a.normalized_name IS NOT NULL
      AND b.normalized_name IS NOT NULL
      AND a.employer_name IS NOT NULL
      AND b.employer_name IS NOT NULL
      AND similarity(a.normalized_name, b.normalized_name) > 0.6
      AND similarity(LOWER(a.employer_name), LOWER(b.employer_name)) > 0.7
      AND (a.company_domain IS NULL OR b.company_domain IS NULL
           OR LOWER(REPLACE(REPLACE(a.company_domain, 'www.', ''), '-', ''))
              != LOWER(REPLACE(REPLACE(b.company_domain, 'www.', ''), '-', '')))
    LIMIT 500
  `);

  for (const row of tier3.rows as any[]) {
    const nameSim = parseFloat(row.name_sim);
    const empSim = parseFloat(row.emp_sim);
    const avgSim = (nameSim + empSim) / 2;
    candidates.push({
      entityType: 'contact',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'fuzzy_name_employer',
      matchKey: `${row.name_a}::${row.name_b}`,
      confidence: 0.6 + avgSim * 0.2, // 0.6-0.8
    });
  }

  // Tier 4: Same normalized phone number
  const tier4 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      a.phone AS phone
    FROM contacts a
    JOIN contacts b ON a.id < b.id
    WHERE a.phone IS NOT NULL
      AND b.phone IS NOT NULL
      AND REGEXP_REPLACE(a.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(b.phone, '[^0-9]', '', 'g')
      AND LENGTH(REGEXP_REPLACE(a.phone, '[^0-9]', '', 'g')) >= 10
    LIMIT 500
  `);

  for (const row of tier4.rows as any[]) {
    candidates.push({
      entityType: 'contact',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'same_phone',
      matchKey: row.phone,
      confidence: 0.5,
    });
  }

  return candidates;
}

/**
 * Detect duplicate organizations using fuzzy name matching.
 *
 * Tier 2: fuzzy name (similarity > 0.6) + boosts for same city/state, same LinkedIn
 * Tier 3: domain alias overlap
 *
 * (Tier 1 exact domain auto-merge is already handled in deduplication.ts)
 */
export async function detectOrgDuplicates(): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];

  // Tier 2: Fuzzy name matching with boosts
  const tier2 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      a.name AS name_a,
      b.name AS name_b,
      similarity(LOWER(a.name), LOWER(b.name)) AS name_sim,
      CASE WHEN a.city IS NOT NULL AND a.city = b.city AND a.state IS NOT NULL AND a.state = b.state THEN true ELSE false END AS same_location,
      CASE WHEN a.linkedin_handle IS NOT NULL AND a.linkedin_handle = b.linkedin_handle THEN true ELSE false END AS same_linkedin
    FROM organizations a
    JOIN organizations b ON a.id < b.id
    WHERE a.name IS NOT NULL
      AND b.name IS NOT NULL
      AND similarity(LOWER(a.name), LOWER(b.name)) > 0.6
      AND (a.domain IS NULL OR b.domain IS NULL
           OR LOWER(REPLACE(REPLACE(a.domain, 'www.', ''), '-', ''))
              != LOWER(REPLACE(REPLACE(b.domain, 'www.', ''), '-', '')))
    LIMIT 500
  `);

  for (const row of tier2.rows as any[]) {
    const nameSim = parseFloat(row.name_sim);
    let confidence = 0.5 + nameSim * 0.3; // base: 0.5-0.8
    if (row.same_location) confidence += 0.1;
    if (row.same_linkedin) confidence += 0.15;
    confidence = Math.min(confidence, 0.95);

    candidates.push({
      entityType: 'organization',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'fuzzy_name',
      matchKey: `${row.name_a}::${row.name_b}`,
      confidence,
    });
  }

  return candidates;
}

/**
 * Detect duplicate properties.
 *
 * Tier 1: fuzzy address match (similarity > 0.8) in same city → conf 0.85-0.95
 * Tier 2: same lat/lon within ~50m + same owner name → conf 0.7-0.9
 * Tier 3: fuzzy owner name + fuzzy address in same city → conf 0.5-0.65
 */
export async function detectPropertyDuplicates(): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];

  // Tier 1: Fuzzy address match in same city
  const tier1 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      COALESCE(
        similarity(a.validated_address, b.validated_address),
        similarity(a.regrid_address, b.regrid_address),
        0
      ) AS addr_sim,
      COALESCE(a.validated_address, a.regrid_address) AS addr_a,
      COALESCE(b.validated_address, b.regrid_address) AS addr_b
    FROM properties a
    JOIN properties b ON a.id < b.id
    WHERE (a.enrichment_status IS NULL OR a.enrichment_status != 'merged')
      AND (b.enrichment_status IS NULL OR b.enrichment_status != 'merged')
      AND (a.is_active IS NULL OR a.is_active = true)
      AND (b.is_active IS NULL OR b.is_active = true)
      AND a.city IS NOT NULL AND b.city IS NOT NULL
      AND LOWER(a.city) = LOWER(b.city)
      AND (
        (a.validated_address IS NOT NULL AND b.validated_address IS NOT NULL
         AND similarity(a.validated_address, b.validated_address) > 0.8)
        OR
        (a.regrid_address IS NOT NULL AND b.regrid_address IS NOT NULL
         AND similarity(a.regrid_address, b.regrid_address) > 0.8)
      )
    LIMIT 500
  `);

  for (const row of tier1.rows as any[]) {
    const addrSim = parseFloat(row.addr_sim);
    candidates.push({
      entityType: 'property',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'fuzzy_address',
      matchKey: `${row.addr_a}::${row.addr_b}`,
      confidence: 0.85 + (addrSim - 0.8) * 0.5, // 0.85 at sim=0.8, ~0.95 at sim=1.0
    });
  }

  // Tier 2: Geo-proximity (~50m = ~0.00045 degrees) + same owner
  const tier2 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      a.dcad_owner_name1 AS owner_a,
      b.dcad_owner_name1 AS owner_b,
      CASE WHEN a.dcad_owner_name1 IS NOT NULL AND b.dcad_owner_name1 IS NOT NULL
           AND similarity(LOWER(a.dcad_owner_name1), LOWER(b.dcad_owner_name1)) > 0.7
           THEN true ELSE false END AS same_owner
    FROM properties a
    JOIN properties b ON a.id < b.id
    WHERE (a.enrichment_status IS NULL OR a.enrichment_status != 'merged')
      AND (b.enrichment_status IS NULL OR b.enrichment_status != 'merged')
      AND (a.is_active IS NULL OR a.is_active = true)
      AND (b.is_active IS NULL OR b.is_active = true)
      AND a.lat IS NOT NULL AND b.lat IS NOT NULL
      AND a.lon IS NOT NULL AND b.lon IS NOT NULL
      AND ABS(a.lat - b.lat) < 0.00045
      AND ABS(a.lon - b.lon) < 0.00045
      AND a.id NOT IN (SELECT entity_id_a FROM potential_duplicates WHERE entity_type = 'property' AND status = 'pending' AND entity_id_a IS NOT NULL)
    LIMIT 500
  `);

  for (const row of tier2.rows as any[]) {
    let confidence = 0.7;
    if (row.same_owner) confidence = 0.85;
    candidates.push({
      entityType: 'property',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'geo_proximity',
      matchKey: `geo::${row.id_a}::${row.id_b}`,
      confidence,
    });
  }

  // Tier 3: Fuzzy owner name + fuzzy address in same city
  const tier3 = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      a.dcad_owner_name1 AS owner_a,
      b.dcad_owner_name1 AS owner_b,
      COALESCE(a.validated_address, a.regrid_address) AS addr_a,
      COALESCE(b.validated_address, b.regrid_address) AS addr_b
    FROM properties a
    JOIN properties b ON a.id < b.id
    WHERE (a.enrichment_status IS NULL OR a.enrichment_status != 'merged')
      AND (b.enrichment_status IS NULL OR b.enrichment_status != 'merged')
      AND (a.is_active IS NULL OR a.is_active = true)
      AND (b.is_active IS NULL OR b.is_active = true)
      AND a.dcad_owner_name1 IS NOT NULL AND b.dcad_owner_name1 IS NOT NULL
      AND a.city IS NOT NULL AND b.city IS NOT NULL
      AND LOWER(a.city) = LOWER(b.city)
      AND similarity(LOWER(a.dcad_owner_name1), LOWER(b.dcad_owner_name1)) > 0.7
      AND (
        (a.validated_address IS NOT NULL AND b.validated_address IS NOT NULL
         AND similarity(a.validated_address, b.validated_address) > 0.5)
        OR
        (a.regrid_address IS NOT NULL AND b.regrid_address IS NOT NULL
         AND similarity(a.regrid_address, b.regrid_address) > 0.5)
      )
    LIMIT 500
  `);

  for (const row of tier3.rows as any[]) {
    candidates.push({
      entityType: 'property',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'fuzzy_owner_address',
      matchKey: `${row.owner_a}::${row.addr_a}`,
      confidence: 0.55,
    });
  }

  return candidates;
}

/**
 * Upsert duplicate candidates into potentialDuplicates table,
 * skipping pairs that already have a pending or dismissed flag.
 */
async function upsertCandidates(candidates: DuplicateCandidate[]): Promise<number> {
  let inserted = 0;

  for (const c of candidates) {
    // Check for existing flag (bidirectional)
    const existing = await db
      .select({ id: potentialDuplicates.id })
      .from(potentialDuplicates)
      .where(
        and(
          eq(potentialDuplicates.entityType, c.entityType),
          or(
            and(
              eq(potentialDuplicates.entityIdA, c.entityIdA),
              eq(potentialDuplicates.entityIdB, c.entityIdB)
            ),
            and(
              eq(potentialDuplicates.entityIdA, c.entityIdB),
              eq(potentialDuplicates.entityIdB, c.entityIdA)
            )
          )
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(potentialDuplicates).values({
      entityType: c.entityType,
      entityIdA: c.entityIdA,
      entityIdB: c.entityIdB,
      contactIdA: c.entityType === 'contact' ? c.entityIdA : null,
      contactIdB: c.entityType === 'contact' ? c.entityIdB : null,
      matchType: c.matchType,
      matchKey: c.matchKey,
      confidence: c.confidence,
    });
    inserted++;
  }

  return inserted;
}

/**
 * Tier 0: Cross-county duplicate detection.
 * Finds properties with very similar addresses across different CAD counties.
 */
export async function detectCrossCountyDuplicates(): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];

  const crossCounty = await db.execute(sql`
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      COALESCE(
        similarity(a.validated_address, b.validated_address),
        similarity(a.regrid_address, b.regrid_address),
        0
      ) AS addr_sim,
      COALESCE(a.validated_address, a.regrid_address) AS addr_a,
      COALESCE(b.validated_address, b.regrid_address) AS addr_b,
      a.cad_county_code AS county_a,
      b.cad_county_code AS county_b
    FROM properties a
    JOIN properties b ON a.id < b.id
    WHERE (a.enrichment_status IS NULL OR a.enrichment_status != 'merged')
      AND (b.enrichment_status IS NULL OR b.enrichment_status != 'merged')
      AND (a.is_active IS NULL OR a.is_active = true)
      AND (b.is_active IS NULL OR b.is_active = true)
      AND a.cad_county_code IS NOT NULL
      AND b.cad_county_code IS NOT NULL
      AND a.cad_county_code != b.cad_county_code
      AND (
        (a.validated_address IS NOT NULL AND b.validated_address IS NOT NULL
         AND similarity(a.validated_address, b.validated_address) > 0.85)
        OR
        (a.regrid_address IS NOT NULL AND b.regrid_address IS NOT NULL
         AND similarity(a.regrid_address, b.regrid_address) > 0.85)
      )
    LIMIT 500
  `);

  for (const row of crossCounty.rows as any[]) {
    const addrSim = parseFloat(row.addr_sim);
    candidates.push({
      entityType: 'property',
      entityIdA: row.id_a,
      entityIdB: row.id_b,
      matchType: 'cross_county_address',
      matchKey: `${row.county_a}:${row.addr_a}::${row.county_b}:${row.addr_b}`,
      confidence: 0.90 + (addrSim - 0.85) * 0.67, // 0.90 at sim=0.85, ~0.95+ at sim=1.0
    });
  }

  return candidates;
}

/**
 * Run duplicate detection for specified entity type(s).
 * Upserts results into potentialDuplicates table.
 */
export async function runDuplicateDetection(
  entityType?: EntityType | 'all'
): Promise<Record<EntityType, DetectionResult>> {
  const results: Record<EntityType, DetectionResult> = {
    contact: { found: 0, totalPending: 0 },
    organization: { found: 0, totalPending: 0 },
    property: { found: 0, totalPending: 0 },
  };

  const types: EntityType[] =
    !entityType || entityType === 'all'
      ? ['contact', 'organization', 'property']
      : [entityType];

  for (const type of types) {
    console.log(`[DuplicateDetection] Running ${type} detection...`);

    let candidates: DuplicateCandidate[];
    switch (type) {
      case 'contact':
        candidates = await detectContactDuplicates();
        break;
      case 'organization':
        candidates = await detectOrgDuplicates();
        break;
      case 'property': {
        const [standard, crossCounty] = await Promise.all([
          detectPropertyDuplicates(),
          detectCrossCountyDuplicates(),
        ]);
        candidates = [...standard, ...crossCounty];
        break;
      }
    }

    console.log(`[DuplicateDetection] Found ${candidates.length} ${type} candidates`);
    const inserted = await upsertCandidates(candidates);
    console.log(`[DuplicateDetection] Inserted ${inserted} new ${type} flags`);

    // Count total pending
    const [pending] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(potentialDuplicates)
      .where(
        and(
          eq(potentialDuplicates.entityType, type),
          eq(potentialDuplicates.status, 'pending')
        )
      );

    results[type] = {
      found: inserted,
      totalPending: Number(pending?.count || 0),
    };
  }

  return results;
}
