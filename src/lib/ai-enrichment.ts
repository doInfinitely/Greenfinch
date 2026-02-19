import { GoogleGenAI } from "@google/genai";
import type { CommercialProperty, DCADBuilding } from "./snowflake";
import { ASSET_CATEGORIES, GEMINI_MODEL } from "./constants";
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { rateLimiters } from './rate-limiter';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GENAI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
}

interface GroundedSource {
  url: string;
  title: string;
}

interface StageResult<T> {
  data: T;
  summary: string;
  sources: GroundedSource[];
}

export interface PropertyPhysicalData {
  lotAcres: number | null;
  lotAcresConfidence: number | null;
  netSqft: number | null;
  netSqftConfidence: number | null;
}

export interface PropertyClassification {
  propertyName: string;
  canonicalAddress: string;
  category: string;
  subcategory: string;
  confidence: number;
  propertyClass: string | null;
  propertyClassConfidence: number | null;
}

export interface PropertyDataAndClassification {
  physical: PropertyPhysicalData;
  classification: PropertyClassification;
}

export interface OwnershipInfo {
  beneficialOwner: {
    name: string | null;
    type: "REIT" | "Private Equity" | "Family Office" | "Individual" | "Corporation" | "Institutional" | "Syndicator" | null;
    confidence: number;
  };
  managementCompany: {
    name: string | null;
    domain: string | null;
    confidence: number;
  };
  propertyWebsite: string | null;
  propertyPhone: string | null;
}

export interface DiscoveredContact {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  email: string | null;
  emailSource: 'ai_discovered' | 'hunter' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  location: string | null; // City, State format (e.g., "Dallas, TX")
  role: string;
  roleConfidence: number;
  priorityRank: number;
  contactType: 'individual' | 'general'; // individual = named person, general = office/main line
}

function formatBuildingsSummary(buildings: DCADBuilding[] | null, totalSqft: number | null): string {
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

function formatCompactCategories(): string {
  return Object.entries(ASSET_CATEGORIES)
    .map(([cat, subs]) => `${cat} (${subs.join(', ')})`)
    .join(' | ');
}

function mapQualityGradeToClass(grade: string | null): { propertyClass: string | null; confidence: number } {
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

// AI-generated source domains to filter out from grounding results
const AI_SOURCE_DOMAINS = [
  'vertexaisearch.cloud.google.com',
  'vertexaisearch.googleapis.com',
  'generativelanguage.googleapis.com',
  'ai.google.dev',
  'bard.google.com',
];

function isAIGeneratedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return AI_SOURCE_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

function extractGroundedSources(response: any): GroundedSource[] {
  try {
    const candidates = response?.candidates || response?.response?.candidates || response?.data?.candidates;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      try {
        const snippet = JSON.stringify(response, null, 2)?.substring(0, 500);
        console.log(`[GroundedSources] No candidates array. Response type: ${response?.constructor?.name}. Snippet: ${snippet}`);
      } catch {
        console.log(`[GroundedSources] No candidates array. Response type: ${typeof response}, constructor: ${response?.constructor?.name}`);
      }
      return [];
    }
    
    const candidate = candidates[0];
    const groundingMetadata = candidate.groundingMetadata || candidate.grounding_metadata;
    if (!groundingMetadata) {
      try {
        const candidateSnippet = JSON.stringify(candidate, null, 2)?.substring(0, 500);
        console.log(`[GroundedSources] No groundingMetadata. Candidate snippet: ${candidateSnippet}`);
      } catch {
        const candidateKeys = Object.keys(candidate || {});
        console.log(`[GroundedSources] No groundingMetadata. Candidate keys: ${candidateKeys.join(', ')}`);
      }
      return [];
    }
    
    const groundingChunks = groundingMetadata.groundingChunks || groundingMetadata.grounding_chunks || [];
    
    if (!groundingChunks || groundingChunks.length === 0) {
      const metadataKeys = Object.keys(groundingMetadata);
      console.log(`[GroundedSources] No grounding chunks found. Metadata keys: ${metadataKeys.join(', ')}`);
      
      if (groundingMetadata.groundingSupports?.length > 0) {
        console.log(`[GroundedSources] Has ${groundingMetadata.groundingSupports.length} groundingSupports but no chunks`);
      }
      if (groundingMetadata.webSearchQueries?.length > 0) {
        console.log(`[GroundedSources] webSearchQueries: ${JSON.stringify(groundingMetadata.webSearchQueries)}`);
      }
      return [];
    }
    
    console.log(`[GroundedSources] Found ${groundingChunks.length} grounding chunks, first chunk keys: ${Object.keys(groundingChunks[0] || {}).join(', ')}`);
    
    const sources = groundingChunks
      .filter((chunk: any) => {
        const uri = chunk.web?.uri;
        if (!uri) return false;
        if (isAIGeneratedSource(uri)) return false;
        return true;
      })
      .map((chunk: any) => ({
        url: chunk.web.uri,
        title: chunk.web.title || chunk.web.domain || 'Source',
      }))
      .slice(0, 10);
    
    console.log(`[GroundedSources] Extracted ${sources.length} sources from ${groundingChunks.length} chunks`);
    return sources;
  } catch (error) {
    console.warn('[GroundedSources] Error extracting grounding sources:', error);
    return [];
  }
}

export interface ScoredSource extends GroundedSource {
  trustTier: 'high' | 'medium' | 'low';
}

function scoreSource(source: GroundedSource, knownDomains: string[]): ScoredSource {
  let hostname: string;
  try {
    hostname = new URL(source.url).hostname.toLowerCase();
  } catch {
    return { ...source, trustTier: 'low' };
  }

  if (knownDomains.some(d => hostname.includes(d)) || hostname.includes('linkedin.com')) {
    return { ...source, trustTier: 'high' };
  }
  const mediumDomains = ['loopnet.com', 'costar.com', 'commercialcafe.com', 'crexi.com',
    'bizjournals.com', 'dallasnews.com', 'dmagazine.com', 'prnewswire.com', 'globenewswire.com'];
  if (mediumDomains.some(d => hostname.includes(d))) {
    return { ...source, trustTier: 'medium' };
  }
  return { ...source, trustTier: 'low' };
}

export function scoreSources(sources: GroundedSource[], ownership: OwnershipInfo): ScoredSource[] {
  const knownDomains: string[] = [];
  if (ownership.managementCompany?.domain) {
    knownDomains.push(ownership.managementCompany.domain.toLowerCase());
  }
  if (ownership.propertyWebsite) {
    try {
      knownDomains.push(new URL(ownership.propertyWebsite).hostname.toLowerCase());
    } catch { /* skip */ }
  }
  return sources.map(s => scoreSource(s, knownDomains));
}

function parseJsonResponse(text: string): any {
  let cleanedText = text.trim();
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in response: ${text.substring(0, 200)}`);
  }
  return JSON.parse(jsonMatch[0]);
}

export async function classifyAndVerifyProperty(property: CommercialProperty): Promise<StageResult<PropertyDataAndClassification>> {
  const client = getGeminiClient();
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
  const totalSqft = property.totalGrossBldgArea || null;
  const lotAcres = property.lotAcres || (property.lotSqft ? property.lotSqft / 43560 : null);
  const lotAcresStr = lotAcres ? `${lotAcres.toFixed(1)} acres` : 'unknown';
  const valStr = property.dcadTotalVal ? `$${(property.dcadTotalVal / 1000000).toFixed(1)}M` : '$0';

  const parentBuilding = property.buildings?.[0];
  const dcadQualityGrade = parentBuilding?.qualityGrade || null;
  const classEstimate = mapQualityGradeToClass(dcadQualityGrade);

  const sptdDescription = property.sptdCode === 'F10' ? 'Commercial' :
                          property.sptdCode === 'F20' ? 'Industrial' :
                          property.sptdCode === 'B11' ? 'Apartments/Multifamily' :
                          property.sptdCode || 'Unknown';

  const buildingInfo = formatBuildingsSummary(property.buildings, totalSqft);
  const classLine = classEstimate.propertyClass
    ? `\nDCAD CLASS ESTIMATE: ${classEstimate.propertyClass} (from quality grade "${dcadQualityGrade}"). Override only if research shows renovations or condition changes.`
    : '';
  const prompt = `Search the web to verify and classify this commercial property. Return ONLY valid JSON.

ADDRESS: ${property.address}, ${property.city}, TX ${property.zip}
DCAD: ${property.sptdCode || '?'} ${sptdDescription} | ${property.buildingCount || 0} bldgs, ${totalSqft?.toLocaleString() || 'unknown'} sqft | ${valStr} | ${lotAcresStr} | Quality: ${dcadQualityGrade || 'Unknown'}
OWNER: ${primaryOwner} | ZONING: ${property.usedesc || 'Unknown'}
Note: DCAD may show one parcel of a multi-parcel property. Confirm or correct with canonical totals.${buildingInfo}${classLine}

CATEGORIES: ${formatCompactCategories()}

TASK: Search the web to find current information about this property. Look for anchor tenants, year built, renovations, and property details.

Return JSON:
{"name":"...","addr":"...","cat":"...","sub":"...","c":0.0,"class":"B","cc":0.0,"acres":0,"ac":0.0,"sqft":0,"sc":0.0,"summary":"2 sentences max."}`;

  console.log('[FocusedEnrichment] Stage 1: Classification and physical verification...');

  let response: any;
  let text = '';
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[FocusedEnrichment] Stage 1 API call attempt ${attempt}/${maxRetries}...`);

    response = await rateLimiters.gemini.execute(() => client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        tools: [{ googleSearch: {} }]
      }
    }));

    text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 1 response length:', text.length, 'chars');

    if (text) {
      break;
    }

    console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 1 (attempt ${attempt})`);
    if (response.candidates) {
      console.warn('[FocusedEnrichment] Candidates:', JSON.stringify(response.candidates, null, 2).substring(0, 500));
    }

    if (attempt < maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`[FocusedEnrichment] Retrying Stage 1 in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  if (!text) {
    console.error('[FocusedEnrichment] Stage 1 failed after all retries - returning empty result');
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'classify-property',
      entityType: 'property',
      success: false,
      errorMessage: 'Empty response after all retries',
    });
    return {
      data: {
        physical: {
          lotAcres: null,
          lotAcresConfidence: null,
          netSqft: null,
          netSqftConfidence: null,
        },
        classification: {
          propertyName: '',
          canonicalAddress: property.address || '',
          category: '',
          subcategory: '',
          confidence: 0,
          propertyClass: null,
          propertyClassConfidence: null,
        },
      },
      summary: '',
      sources: [],
    };
  }

  const sources = extractGroundedSources(response);
  const parsed = parseJsonResponse(text);

  trackCostFireAndForget({
    provider: 'gemini',
    endpoint: 'classify-property',
    entityType: 'property',
    success: true,
    metadata: { sourcesCount: sources.length },
  });

  console.log(`[FocusedEnrichment] Stage 1 complete with ${sources.length} grounded sources`);

  const aiClass = parsed.class ?? parsed.property_class ?? null;
  const aiClassConfidence = parsed.cc ?? parsed.property_class_confidence ?? null;
  const finalClass = aiClass || classEstimate.propertyClass;
  const finalClassConfidence = aiClass ? (aiClassConfidence ?? 0.7) : classEstimate.confidence;

  return {
    data: {
      physical: {
        lotAcres: parsed.acres ?? parsed.lot_acres ?? null,
        lotAcresConfidence: parsed.ac ?? parsed.lot_acres_confidence ?? null,
        netSqft: parsed.sqft ?? parsed.net_sqft ?? null,
        netSqftConfidence: parsed.sc ?? parsed.net_sqft_confidence ?? null,
      },
      classification: {
        propertyName: parsed.name ?? parsed.propertyName ?? '',
        canonicalAddress: parsed.addr ?? parsed.canonicalAddress ?? '',
        category: parsed.cat ?? parsed.category ?? '',
        subcategory: parsed.sub ?? parsed.subcategory ?? '',
        confidence: parsed.c ?? parsed.confidence ?? 0,
        propertyClass: finalClass,
        propertyClassConfidence: finalClassConfidence,
      },
    },
    summary: parsed.summary || '',
    sources,
  };
}

async function callGeminiWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 600000,
  retries: number = 2
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const overallStart = Date.now();
      console.log(`[FocusedEnrichment] API call attempt ${attempt}/${retries}, timeout=${timeoutMs}ms...`);

      const wrappedFn = async () => {
        const queueWait = Date.now() - overallStart;
        if (queueWait > 1000) {
          console.log(`[FocusedEnrichment] Rate limiter queue wait: ${queueWait}ms`);
        }
        const apiStart = Date.now();

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs}ms (attempt ${attempt})`)), timeoutMs);
        });

        try {
          const result = await Promise.race([fn(), timeoutPromise]);
          console.log(`[FocusedEnrichment] Gemini API responded in ${Date.now() - apiStart}ms (total with queue: ${Date.now() - overallStart}ms)`);
          return result;
        } catch (apiErr) {
          console.warn(`[FocusedEnrichment] Gemini API error after ${Date.now() - apiStart}ms: ${apiErr instanceof Error ? apiErr.message : apiErr}`);
          throw apiErr;
        }
      };

      const result = await rateLimiters.gemini.execute(wrappedFn);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[FocusedEnrichment] API call attempt ${attempt} failed: ${lastError.message}`);
      
      if (attempt < retries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[FocusedEnrichment] Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  
  throw lastError || new Error('All retry attempts failed');
}

function extractUsefulLegalInfo(property: CommercialProperty): string | null {
  const legal = [property.legal1, property.legal2, property.legal3, property.legal4]
    .filter(Boolean).join(' ');
  if (!legal) return null;
  const usefulPatterns = /plaza|center|tower|park|square|village|crossing|place|point|commons|mall|industrial|business/i;
  return usefulPatterns.test(legal) ? legal : null;
}

function crossValidateOwnership(ownership: OwnershipInfo): OwnershipInfo {
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

const OWNER_TYPE_MAP: Record<string, OwnershipInfo['beneficialOwner']['type']> = {
  'REIT': 'REIT',
  'PE': 'Private Equity',
  'Private Equity': 'Private Equity',
  'Family Office': 'Family Office',
  'Individual': 'Individual',
  'Corporation': 'Corporation',
  'Institutional': 'Institutional',
  'Syndicator': 'Syndicator',
};

export async function identifyOwnership(
  property: CommercialProperty,
  classification: PropertyClassification
): Promise<StageResult<OwnershipInfo>> {
  const client = getGeminiClient();
  const deedOwner = property.bizName || property.ownerName1 || 'Unknown';
  const secondaryOwner = property.ownerName2 || null;
  const deedDate = property.deedTxfrDate || 'date unknown';
  const legalInfo = extractUsefulLegalInfo(property);
  const sqft = property.totalGrossBldgArea?.toLocaleString() || 'unknown';

  const prompt = `Find the ownership and management of this commercial property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName} at ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}, ${sqft} sqft
DCAD DEED OWNER: ${deedOwner} (transferred ${deedDate})
${secondaryOwner ? `DCAD SECONDARY: ${secondaryOwner}` : ''}
${legalInfo ? `LEGAL: ${legalInfo}` : ''}

SEARCH SEQUENCE:
1. Search "${classification.propertyName} ${property.city || 'Dallas'}" to find the property website and management company
2. Search the management company website for this property listing to confirm and find leasing phone
3. Search "${deedOwner} Texas" on OpenCorporates or TX Secretary of State to find the entity behind the LLC/trust
4. Search for news about acquisitions or sales of ${classification.propertyName} around ${deedDate} to identify the beneficial owner

Return JSON:
{"mgmt":{"name":"Co|null","domain":"co.com|null","c":0.0-1.0},"owner":{"name":"Entity|null","type":"REIT|PE|Family Office|Individual|Corporation|Institutional|Syndicator|null","c":0.0-1.0},"site":"https://property-site.com|null","phone":"+1XXXXXXXXXX|null","summary":"2 sentences max: who owns it, who manages it."}`;

  console.log('[FocusedEnrichment] Stage 2: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 2 input - Property: ${classification.propertyName}, Deed Owner: ${deedOwner}`);

  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          tools: [{ googleSearch: {} }]
        }
      }),
      600000,
      2
    );

    const text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 2 response length:', text.length, 'chars');

    if (!text) {
      console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 2, returning defaults');
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-ownership',
        entityType: 'property',
        success: false,
        errorMessage: 'Empty response from Gemini',
      });
      return {
        data: {
          beneficialOwner: { name: null, type: null, confidence: 0 },
          managementCompany: { name: null, domain: null, confidence: 0 },
          propertyWebsite: null,
          propertyPhone: null,
        },
        summary: '',
        sources: [],
      };
    }

    const sources = extractGroundedSources(response);
    const parsed = parseJsonResponse(text);

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'identify-ownership',
      entityType: 'property',
      success: true,
      metadata: { sourcesCount: sources.length },
    });

    const ownerType = parsed.owner?.type ? (OWNER_TYPE_MAP[parsed.owner.type] || null) : null;

    const ownershipData: OwnershipInfo = {
      beneficialOwner: {
        name: parsed.owner?.name ?? null,
        type: ownerType,
        confidence: parsed.owner?.c ?? 0,
      },
      managementCompany: {
        name: parsed.mgmt?.name ?? null,
        domain: parsed.mgmt?.domain ?? null,
        confidence: parsed.mgmt?.c ?? 0,
      },
      propertyWebsite: parsed.site ?? null,
      propertyPhone: parsed.phone ?? null,
    };

    const validated = crossValidateOwnership(ownershipData);

    console.log(`[FocusedEnrichment] Stage 2 complete with ${sources.length} grounded sources`);
    console.log(`[FocusedEnrichment] Stage 2 extracted - website: ${validated.propertyWebsite || 'none'}, phone: ${validated.propertyPhone || 'none'}, mgmt: ${validated.managementCompany.name || 'none'}`);

    return {
      data: validated,
      summary: parsed.summary || '',
      sources,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'identify-ownership',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error(`[FocusedEnrichment] Stage 2 failed after retries: ${error instanceof Error ? error.message : error}`);
    return {
      data: {
        beneficialOwner: { name: null, type: null, confidence: 0 },
        managementCompany: { name: null, domain: null, confidence: 0 },
        propertyWebsite: null,
        propertyPhone: null,
      },
      summary: '',
      sources: [],
    };
  }
}

export interface IdentifiedDecisionMaker {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  role: string;
  roleConfidence: number;
  connectionEvidence: string;
  contactType: 'individual' | 'general';
}

interface ContactEnrichmentResult {
  email: string | null;
  emailSource: 'ai_discovered' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  location: string | null;
  enrichmentSources: GroundedSource[];
}

async function identifyDecisionMakers(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: IdentifiedDecisionMaker[] }>> {
  const client = getGeminiClient();

  const mgmtName = ownership.managementCompany?.name || null;
  const mgmtDomain = ownership.managementCompany?.domain || null;
  const mgmtInfo = mgmtName ? `${mgmtName} (${mgmtDomain || 'no website'})` : 'Unknown';
  const ownerName = ownership.beneficialOwner?.name || property.bizName || property.ownerName1 || 'Unknown';
  const propertySite = ownership.propertyWebsite || 'none';
  const city = property.city || 'Dallas';

  const prompt = `Find 3 people directly involved in managing THIS specific property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName} at ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}
MGMT CO: ${mgmtInfo}
OWNER: ${ownerName}
PROPERTY SITE: ${propertySite}

SEARCH STRATEGY (in priority order):
1. ${mgmtDomain ? `Search ${mgmtDomain} for staff assigned to this property or the ${city} market` : `Search for the management company staff for this property`}
2. Search "${classification.propertyName} property manager" and "${classification.propertyName} leasing"
3. Search LinkedIn for property managers, leasing agents, or regional managers at ${mgmtName || 'the management company'} in ${city}

PRIORITY ROLES (return these first; listed in priority order):
- On-site property manager or community manager for this specific property
- Facilities/maintenance director for this specific property
- Regional/district property manager overseeing this property's area
- Leasing agent or leasing manager for this property or portfolio
- Asset manager or owner with direct responsibility for this property

DO NOT RETURN:
- C-suite executives (CEO, CFO, COO, CTO, CMO) unless they are the direct property owner and higher-priority contacts were not identified
- Corporate HR, marketing, or IT staff
- People at corporate headquarters with no direct tie to this property or market
- National-level VPs unless they specifically oversee the ${city} region

Only return people verifiably connected to THIS property at THIS address or its local market as of 2025-2026.

Return JSON:
{"contacts":[{"name":"Full Name","title":"Title","company":"Company Name","domain":"company.com","role":"property_manager|facilities_manager|owner|leasing|other","rc":0.0-1.0,"evidence":"1 sentence linking them to this property","type":"individual|general"}],"summary":"2 sentences max."}`;

  console.log('[FocusedEnrichment] Stage 3a: Identifying decision-makers...');
  console.log(`[FocusedEnrichment] Stage 3a input - Property: ${classification.propertyName}, Mgmt: ${mgmtInfo}`);

  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          tools: [{ googleSearch: {} }]
        }
      }),
      600000,
      2
    );

    const text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 3a response length:', text.length, 'chars');

    if (!text) {
      console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 3a');
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-decision-makers',
        entityType: 'property',
        success: false,
        errorMessage: 'Empty response from Gemini',
      });
      return { data: { contacts: [] }, summary: '', sources: [] };
    }

    const sources = extractGroundedSources(response);
    const parsed = parseJsonResponse(text);

    const contacts: IdentifiedDecisionMaker[] = (parsed.contacts || []).map((c: any) => ({
      name: c.name || '',
      title: c.title ?? null,
      company: c.company ?? null,
      companyDomain: c.domain ?? null,
      role: c.role || 'other',
      roleConfidence: c.rc ?? 0.5,
      connectionEvidence: c.evidence || '',
      contactType: c.type === 'general' ? 'general' : 'individual',
    }));

    console.log(`[FocusedEnrichment] Stage 3a complete: ${contacts.length} contacts identified, ${sources.length} sources`);

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'identify-decision-makers',
      entityType: 'property',
      success: true,
      metadata: { contactsCount: contacts.length, sourcesCount: sources.length },
    });

    return {
      data: { contacts },
      summary: parsed.summary || '',
      sources,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'identify-decision-makers',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error(`[FocusedEnrichment] Stage 3a failed: ${error instanceof Error ? error.message : error}`);
    return {
      data: { contacts: [] },
      summary: '',
      sources: [],
    };
  }
}

async function enrichContactDetails(
  contact: IdentifiedDecisionMaker,
  city: string
): Promise<ContactEnrichmentResult> {
  const client = getGeminiClient();

  const companyInfo = contact.company
    ? `${contact.company}${contact.companyDomain ? ` (${contact.companyDomain})` : ''}`
    : 'unknown company';

  const prompt = `Find contact info for ${contact.name}, ${contact.title || 'unknown title'} at ${companyInfo} in ${city}, TX. Return ONLY valid JSON.

{"email":"found@email.com|null","phone":"+1XXXXXXXXXX|null","pl":"direct_work|office|personal|null","pc":0.0-1.0,"loc":"City, ST|null"}`;

  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          tools: [{ googleSearch: {} }]
        }
      }),
      600000,
      2
    );

    const text = response.text?.trim() || '';
    if (!text) {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'enrich-contact-details',
        entityType: 'contact',
        success: false,
        errorMessage: 'Empty response',
      });
      return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
    }

    const sources = extractGroundedSources(response);
    const parsed = parseJsonResponse(text);

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'enrich-contact-details',
      entityType: 'contact',
      success: true,
      metadata: { sourcesCount: sources.length },
    });

    const email = parsed.email && parsed.email !== 'null' ? parsed.email : null;

    return {
      email,
      emailSource: email ? 'ai_discovered' : null,
      phone: parsed.phone && parsed.phone !== 'null' ? parsed.phone : null,
      phoneLabel: parsed.pl && parsed.pl !== 'null' ? parsed.pl : null,
      phoneConfidence: parsed.pc ?? null,
      location: parsed.loc && parsed.loc !== 'null' ? parsed.loc : null,
      enrichmentSources: sources,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'enrich-contact-details',
      entityType: 'contact',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn(`[FocusedEnrichment] Stage 3b enrichment failed for ${contact.name}: ${error instanceof Error ? error.message : error}`);
    return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function deduplicateContacts(contacts: DiscoveredContact[]): DiscoveredContact[] {
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

export async function discoverContacts(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: DiscoveredContact[] }> & { contactIdentificationMs: number; contactEnrichmentMs: number }> {
  const city = property.city || 'Dallas';

  const startIdentify = Date.now();
  const identifyResult = await identifyDecisionMakers(property, classification, ownership);
  const contactIdentificationMs = Date.now() - startIdentify;

  const identifiedContacts = identifyResult.data.contacts;
  console.log(`[FocusedEnrichment] Stage 3a took ${contactIdentificationMs}ms, identified ${identifiedContacts.length} contacts`);

  const startEnrich = Date.now();
  const enrichmentResults = await Promise.all(
    identifiedContacts.map(contact => enrichContactDetails(contact, city))
  );
  const contactEnrichmentMs = Date.now() - startEnrich;

  console.log(`[FocusedEnrichment] Stage 3b took ${contactEnrichmentMs}ms for ${identifiedContacts.length} contacts`);

  const allSources = [...identifyResult.sources];
  const rawContacts: DiscoveredContact[] = identifiedContacts.map((dm, idx) => {
    const enrichment = enrichmentResults[idx];
    allSources.push(...enrichment.enrichmentSources);

    return {
      name: dm.name,
      title: dm.title,
      company: dm.company,
      companyDomain: dm.companyDomain,
      email: enrichment.email,
      emailSource: enrichment.emailSource,
      phone: enrichment.phone,
      phoneLabel: enrichment.phoneLabel,
      phoneConfidence: enrichment.phoneConfidence,
      location: enrichment.location,
      role: dm.role,
      roleConfidence: dm.roleConfidence,
      priorityRank: idx + 1,
      contactType: dm.contactType,
    };
  });

  const contacts = deduplicateContacts(rawContacts);
  contacts.forEach((c, i) => { c.priorityRank = i + 1; });

  if (contacts.length < rawContacts.length) {
    console.log(`[FocusedEnrichment] Deduplicated ${rawContacts.length} → ${contacts.length} contacts`);
  }

  const uniqueSources = allSources.filter((s, i, arr) =>
    arr.findIndex(x => x.url === s.url) === i
  ).slice(0, 10);

  return {
    data: { contacts },
    summary: identifyResult.summary,
    sources: uniqueSources,
    contactIdentificationMs,
    contactEnrichmentMs,
  };
}

export interface FocusedEnrichmentResult {
  propertyKey: string;
  physical: StageResult<PropertyPhysicalData>;
  classification: StageResult<PropertyClassification>;
  ownership: StageResult<OwnershipInfo>;
  contacts: StageResult<{ contacts: DiscoveredContact[] }>;
  timing: {
    physicalMs: number;
    classificationMs: number;
    ownershipMs: number;
    contactsMs: number;
    contactIdentificationMs: number;
    contactEnrichmentMs: number;
    totalMs: number;
  };
}

export type EnrichmentStage = 'classification' | 'ownership' | 'contacts' | 'cascade_orgs' | 'cascade_contacts' | 'complete';

export interface EnrichmentStageCheckpoint {
  lastCompletedStage: EnrichmentStage | null;
  classification?: StageResult<PropertyClassification>;
  physical?: StageResult<PropertyPhysicalData>;
  ownership?: StageResult<OwnershipInfo>;
  contacts?: StageResult<{ contacts: DiscoveredContact[] }>;
  timing: Record<string, number>;
  failedStage?: string;
  failureError?: string;
  failureCount?: number;
}

export class EnrichmentStageError extends Error {
  checkpoint: EnrichmentStageCheckpoint;
  stage: EnrichmentStage;
  
  constructor(message: string, stage: EnrichmentStage, checkpoint: EnrichmentStageCheckpoint) {
    super(message);
    this.name = 'EnrichmentStageError';
    this.stage = stage;
    this.checkpoint = checkpoint;
  }
}

export async function runFocusedEnrichment(
  property: CommercialProperty,
  checkpoint?: EnrichmentStageCheckpoint | null
): Promise<FocusedEnrichmentResult & { checkpoint: EnrichmentStageCheckpoint }> {
  const startTotal = Date.now();
  const timing: Record<string, number> = { ...(checkpoint?.timing || {}) };
  let physical: StageResult<PropertyPhysicalData>;
  let classification: StageResult<PropertyClassification>;
  let ownership: StageResult<OwnershipInfo>;
  let contacts: StageResult<{ contacts: DiscoveredContact[] }>;
  let contactIdentificationMs = 0;
  let contactEnrichmentMs = 0;

  if (checkpoint?.classification && checkpoint?.physical) {
    classification = checkpoint.classification;
    physical = checkpoint.physical;
    console.log('[FocusedEnrichment] Resuming from checkpoint - skipping Stage 1 (classification)');
  } else {
    try {
      const startStage1 = Date.now();
      const stage1Result = await classifyAndVerifyProperty(property);
      const stage1Ms = Date.now() - startStage1;
      timing.physicalMs = stage1Ms;
      timing.classificationMs = 0;

      physical = {
        data: stage1Result.data.physical,
        summary: stage1Result.summary,
        sources: stage1Result.sources,
      };

      classification = {
        data: stage1Result.data.classification,
        summary: stage1Result.summary,
        sources: stage1Result.sources,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new EnrichmentStageError(errMsg, 'classification', {
        lastCompletedStage: null,
        timing,
        failedStage: 'classification',
        failureError: errMsg,
      });
    }
  }

  if (checkpoint?.ownership) {
    ownership = checkpoint.ownership;
    console.log('[FocusedEnrichment] Resuming from checkpoint - skipping Stage 2 (ownership)');
  } else {
    try {
      const startOwnership = Date.now();
      ownership = await identifyOwnership(property, classification.data);
      const ownershipMs = Date.now() - startOwnership;
      timing.ownershipMs = ownershipMs;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new EnrichmentStageError(errMsg, 'ownership', {
        lastCompletedStage: 'classification',
        classification,
        physical,
        timing,
        failedStage: 'ownership',
        failureError: errMsg,
      });
    }
  }

  if (checkpoint?.contacts) {
    contacts = checkpoint.contacts;
    console.log('[FocusedEnrichment] Resuming from checkpoint - skipping Stage 3 (contacts)');
  } else {
    try {
      const startContacts = Date.now();
      const contactsResult = await discoverContacts(property, classification.data, ownership.data);
      const contactsMs = Date.now() - startContacts;
      timing.contactsMs = contactsMs;
      timing.contactIdentificationMs = contactsResult.contactIdentificationMs;
      timing.contactEnrichmentMs = contactsResult.contactEnrichmentMs;
      contactIdentificationMs = contactsResult.contactIdentificationMs;
      contactEnrichmentMs = contactsResult.contactEnrichmentMs;

      contacts = {
        data: contactsResult.data,
        summary: contactsResult.summary,
        sources: contactsResult.sources,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new EnrichmentStageError(errMsg, 'contacts', {
        lastCompletedStage: 'ownership',
        classification,
        physical,
        ownership,
        timing,
        failedStage: 'contacts',
        failureError: errMsg,
      });
    }
  }

  const totalMs = Date.now() - startTotal;
  timing.totalMs = totalMs;

  console.log(`[FocusedEnrichment] All stages complete in ${totalMs}ms (3a: ${contactIdentificationMs}ms, 3b: ${contactEnrichmentMs}ms)`);

  return {
    propertyKey: property.parcelId || property.accountNum,
    physical,
    classification,
    ownership,
    contacts,
    timing: {
      physicalMs: (timing.physicalMs as number) || 0,
      classificationMs: 0,
      ownershipMs: (timing.ownershipMs as number) || 0,
      contactsMs: (timing.contactsMs as number) || 0,
      contactIdentificationMs,
      contactEnrichmentMs,
      totalMs,
    },
    checkpoint: {
      lastCompletedStage: 'contacts',
      classification,
      physical,
      ownership,
      contacts,
      timing,
    },
  };
}

function stripInternalMessages(text: string): string {
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

export async function cleanupAISummary(rawSummary: string): Promise<string> {
  if (!rawSummary || rawSummary.trim().length === 0) {
    return '';
  }
  
  const preCleaned = stripInternalMessages(rawSummary);
  if (!preCleaned || preCleaned.length < 10) {
    return '';
  }
  
  const client = getGeminiClient();
  
  const prompt = `You are an editor polishing a research summary for greenfinch.ai, a commercial real estate prospecting tool.

Edit the following research summary into a flowing, natural paragraph:
1. Combine information into 3-4 sentences that read naturally as a cohesive paragraph
2. Remove citation numbers like [1], [2], etc. - just integrate the information smoothly
3. Remove any system references, error messages, or technical debug info
4. Focus on key facts: property type, ownership, management, and notable features
5. Write in professional but conversational tone - avoid bullet points or fragmented phrases
6. Do NOT truncate or cut off mid-sentence - complete each thought naturally

IMPORTANT: Return ONLY the polished paragraph. No explanations, no markdown, no quotes.

Raw summary to polish:
${preCleaned}`;

  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { temperature: 0.1 }
      }),
      600000,
      1
    );
    
    const cleaned = response.text?.trim() || preCleaned;
    console.log(`[FocusedEnrichment] Summary cleaned: ${rawSummary.length} chars -> ${cleaned.length} chars`);
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'cleanup-summary',
      entityType: 'property',
      success: true,
    });
    return cleaned;
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'cleanup-summary',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn('[FocusedEnrichment] Summary cleanup failed, using regex fallback:', error instanceof Error ? error.message : error);
    return stripInternalMessages(rawSummary);
  }
}

export async function searchForReplacementContact(
  roleDesc: string,
  company: string,
  propertyAddress?: string
): Promise<{ name: string | null; title: string | null; email: string | null; company: string } | null> {
  const client = getGeminiClient();

  const addressContext = propertyAddress ? ` at ${propertyAddress}` : '';
  const prompt = `Search the web to find the current ${roleDesc}${addressContext} for ${company}. The previous person in this role has left. I need the name and title of their replacement. Return ONLY valid JSON.

{"name":"Full Name|null","title":"Job Title|null","email":"email@domain.com|null","company":"${company}"}

If you cannot find a replacement, return {"name":null}`;

  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          tools: [{ googleSearch: {} }]
        }
      }),
      600000,
      1
    );

    const text = response.text?.trim() || '';
    if (!text) {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'replacement-search',
        entityType: 'contact',
        success: false,
        errorMessage: 'Empty response',
      });
      return null;
    }

    let parsed: any;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'replacement-search',
        entityType: 'contact',
        success: false,
        errorMessage: 'Parse error',
      });
      return null;
    }

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'replacement-search',
      entityType: 'contact',
      success: true,
      metadata: { found: !!parsed?.name, role: roleDesc, company },
    });

    if (!parsed?.name) return null;
    return { name: parsed.name, title: parsed.title || null, email: parsed.email || null, company: parsed.company || company };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'replacement-search',
      entityType: 'contact',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error(`[ReplacementSearch] Gemini error: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
