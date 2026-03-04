import { NextRequest } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { organizations, propertyOrganizations, contactOrganizations } from '@/lib/schema';
import { eq, count } from 'drizzle-orm';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/api-response';

const STRIP_SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|l\.p|llp|l\.l\.p|group|holdings|partners|ventures|enterprises|management|mgmt|properties|realty|real estate|investments|capital|trust|fund|advisors|associates|development|developers|services|solutions|consulting)\b/gi;
const STRIP_PARENS = /\([^)]*\)/g;
const STRIP_PUNCTUATION = /[.,'"!?;:&\-\/\\#@]+/g;

function normalizeForFuzzy(name: string): string {
  return name
    .toLowerCase()
    .replace(STRIP_PARENS, ' ')
    .replace(STRIP_SUFFIXES, ' ')
    .replace(STRIP_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(t => t.length >= 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface OrgSummary {
  id: string;
  name: string | null;
  domain: string | null;
  logoUrl: string | null;
  employees: number | null;
  city: string | null;
  state: string | null;
  propertyCount: number;
  contactCount: number;
}

interface MergeSuggestion {
  orgA: OrgSummary;
  orgB: OrgSummary;
  similarity: number;
  reason: string;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminAccess();
  } catch {
    return apiUnauthorized();
  }

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '30');
    const threshold = parseFloat(req.nextUrl.searchParams.get('threshold') || '0.5');

    const allOrgs = await db.select({
      id: organizations.id,
      name: organizations.name,
      domain: organizations.domain,
      logoUrl: organizations.logoUrl,
      employees: organizations.employees,
      city: organizations.city,
      state: organizations.state,
    }).from(organizations);

    const propCounts = await db
      .select({ orgId: propertyOrganizations.orgId, cnt: count() })
      .from(propertyOrganizations)
      .groupBy(propertyOrganizations.orgId);
    const propCountMap = new Map(propCounts.map(r => [r.orgId, Number(r.cnt)]));

    const contactCounts = await db
      .select({ orgId: contactOrganizations.orgId, cnt: count() })
      .from(contactOrganizations)
      .groupBy(contactOrganizations.orgId);
    const contactCountMap = new Map(contactCounts.map(r => [r.orgId, Number(r.cnt)]));

    const orgsWithStats: OrgSummary[] = allOrgs.map(org => ({
      ...org,
      propertyCount: propCountMap.get(org.id) || 0,
      contactCount: contactCountMap.get(org.id) || 0,
    }));

    const normalized = orgsWithStats.map(org => ({
      org,
      fuzzyName: normalizeForFuzzy(org.name || ''),
      tokens: tokenize(normalizeForFuzzy(org.name || '')),
    }));

    const suggestions: MergeSuggestion[] = [];

    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i].tokens.size === 0) continue;
      for (let j = i + 1; j < normalized.length; j++) {
        if (normalized[j].tokens.size === 0) continue;
        if (normalized[i].org.id === normalized[j].org.id) continue;

        const sim = jaccardSimilarity(normalized[i].tokens, normalized[j].tokens);
        if (sim >= threshold) {
          const domA = normalized[i].org.domain;
          const domB = normalized[j].org.domain;
          const reason = domA && domB && domA === domB
            ? 'Same domain, similar names'
            : !domA || !domB
              ? 'Similar names, one missing domain'
              : 'Similar names, different domains';

          suggestions.push({
            orgA: normalized[i].org,
            orgB: normalized[j].org,
            similarity: Math.round(sim * 100) / 100,
            reason,
          });
        }
      }
    }

    suggestions.sort((a, b) => b.similarity - a.similarity);

    return apiSuccess(suggestions.slice(0, limit));
  } catch (error) {
    console.error('[Admin] merge-orgs suggestions error:', error);
    return apiError('Failed to compute merge suggestions', { status: 500 });
  }
}
