/**
 * Backfill org hierarchy: extract parent data from rawEnrichmentJson / pdlRawResponse,
 * write to parentDomain/ultimateParentDomain, and resolve to parentOrgId/ultimateParentOrgId.
 *
 * Usage: npx tsx scripts/backfill-org-hierarchy.ts [--dry-run]
 */
import { db } from '../src/lib/db';
import { organizations } from '../src/lib/schema';
import { isNotNull, or } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { resolveParentHierarchy } from '../src/lib/organization-enrichment';
import { normalizeDomain } from '../src/lib/normalization';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

function extractParentDomain(raw: any): { parentDomain: string | null; ultimateParentDomain: string | null } {
  if (!raw) return { parentDomain: null, ultimateParentDomain: null };

  // EnrichLayer / Hunter format: raw.pdl.parent.domain or raw.parent
  let parentDomain: string | null = null;
  let ultimateParentDomain: string | null = null;

  // Try nested PDL format (rawEnrichmentJson stores { pdl: { ... } })
  const pdlData = raw.pdl || raw;

  // PDL company response may have affiliated_companies or parent_company
  if (pdlData.parent?.domain) {
    parentDomain = pdlData.parent.domain;
  }
  if (pdlData.ultimate_parent?.domain) {
    ultimateParentDomain = pdlData.ultimate_parent.domain;
  }

  // EnrichLayer format
  if (pdlData.parentDomain) {
    parentDomain = pdlData.parentDomain;
  }
  if (pdlData.ultimateParentDomain) {
    ultimateParentDomain = pdlData.ultimateParentDomain;
  }

  // Normalize
  if (parentDomain) parentDomain = normalizeDomain(parentDomain);
  if (ultimateParentDomain) ultimateParentDomain = normalizeDomain(ultimateParentDomain);

  return { parentDomain, ultimateParentDomain };
}

async function main() {
  console.log(`[Backfill] Starting org hierarchy backfill${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // Find all orgs with raw enrichment data that don't yet have parentOrgId set
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    const batch = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        domain: organizations.domain,
        parentOrgId: organizations.parentOrgId,
        parentDomain: organizations.parentDomain,
        rawEnrichmentJson: organizations.rawEnrichmentJson,
        pdlRawResponse: organizations.pdlRawResponse,
      })
      .from(organizations)
      .where(
        or(
          isNotNull(organizations.rawEnrichmentJson),
          isNotNull(organizations.pdlRawResponse)
        )
      )
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;
    offset += batch.length;

    for (const org of batch) {
      totalProcessed++;

      // Skip if already has parent hierarchy set
      if (org.parentOrgId) continue;

      // Try rawEnrichmentJson first, then pdlRawResponse
      const fromRaw = extractParentDomain(org.rawEnrichmentJson);
      const fromPdl = extractParentDomain(org.pdlRawResponse);

      const parentDomain = fromRaw.parentDomain || fromPdl.parentDomain;
      const ultimateParentDomain = fromRaw.ultimateParentDomain || fromPdl.ultimateParentDomain;

      if (!parentDomain && !ultimateParentDomain) continue;

      // Skip if parentDomain is the same as the org's own domain
      if (parentDomain && org.domain && normalizeDomain(parentDomain) === normalizeDomain(org.domain)) continue;

      console.log(`[Backfill] ${org.name || org.domain} (${org.id}): parentDomain=${parentDomain}, ultimateParentDomain=${ultimateParentDomain}`);

      if (DRY_RUN) {
        totalUpdated++;
        continue;
      }

      try {
        // Write parentDomain / ultimateParentDomain
        const updateData: Record<string, any> = { updatedAt: new Date() };
        if (parentDomain) updateData.parentDomain = parentDomain;
        if (ultimateParentDomain) updateData.ultimateParentDomain = ultimateParentDomain;

        await db.update(organizations)
          .set(updateData)
          .where(eq(organizations.id, org.id));

        // Resolve to parentOrgId / ultimateParentOrgId
        if (parentDomain) {
          await resolveParentHierarchy(org.id, parentDomain);
        }

        totalUpdated++;
      } catch (err) {
        console.error(`[Backfill] Error processing ${org.id}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[Backfill] Processed ${totalProcessed} orgs so far, updated ${totalUpdated}`);
  }

  console.log(`[Backfill] Done. Processed ${totalProcessed} orgs, updated ${totalUpdated}${DRY_RUN ? ' (dry run)' : ''}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
