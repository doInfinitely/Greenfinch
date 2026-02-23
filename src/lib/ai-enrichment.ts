import { GoogleGenAI } from "@google/genai";
import type { CommercialProperty, DCADBuilding } from "./snowflake";
import { ASSET_CATEGORIES, GEMINI_MODEL } from "./constants";
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { rateLimiters } from './rate-limiter';
import { validatePropertyWebsite, validateAndCleanDomain } from './domain-validator';
import * as fs from 'fs';
import * as path from 'path';
let vertexCredentialsReady = false;

function ensureVertexCredentials(): { project: string; location: string } {
  const credsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credsJson) {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS is not set");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(credsJson);
  } catch {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS contains invalid JSON");
  }

  const project = parsed.project_id;
  if (!project) {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS missing project_id");
  }

  if (!vertexCredentialsReady) {
    const credFilePath = path.join('/tmp', 'gcp-service-account.json');
    fs.writeFileSync(credFilePath, credsJson, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credFilePath;
    vertexCredentialsReady = true;
    console.log(`[VertexAI] Credentials written to ${credFilePath}, project=${project}`);
  }

  return { project, location: 'global' };
}

function getGeminiClient(): GoogleGenAI {
  const { project, location } = ensureVertexCredentials();
  return new GoogleGenAI({ vertexai: true, project, location });
}

interface StreamedGeminiResponse {
  text: string;
  candidates?: any[];
}

async function streamGeminiResponse(
  client: GoogleGenAI,
  prompt: string,
  options: { tools?: any[]; temperature?: number; latLng?: { latitude: number; longitude: number } } = {}
): Promise<StreamedGeminiResponse> {
  const config: any = {
    temperature: options.temperature ?? 0.0,
    httpOptions: { timeout: GEMINI_HTTP_TIMEOUT_MS },
  };
  if (options.tools) {
    config.tools = options.tools;
  }
  if (options.latLng) {
    config.toolConfig = {
      retrievalConfig: {
        latLng: options.latLng,
      },
    };
  }

  const stream = await client.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: prompt,
    config,
  });

  let fullText = '';
  let lastCandidate: any = null;

  for await (const chunk of stream) {
    if (chunk.text) {
      fullText += chunk.text;
    }
    if (chunk.candidates && chunk.candidates.length > 0) {
      lastCandidate = chunk.candidates[0];
    }
  }

  const response: StreamedGeminiResponse = {
    text: fullText,
  };

  if (lastCandidate) {
    response.candidates = [lastCandidate];
  }

  return response;
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

// Vertex AI p95 latency ~374s; use 400s to avoid losing results on slow responses
const GEMINI_HTTP_TIMEOUT_MS = 400000; // 400 seconds

const AI_GENERATED_DOMAINS = [
  'generativelanguage.googleapis.com',
  'ai.google.dev',
  'bard.google.com',
];

function isAIGeneratedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return AI_GENERATED_DOMAINS.some(domain => hostname.includes(domain));
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
      const hasSearchQueries = groundingMetadata.webSearchQueries?.length > 0;
      const hasSearchEntryPoint = !!groundingMetadata.searchEntryPoint;
      const hasSupports = groundingMetadata.groundingSupports?.length > 0;

      if (hasSearchQueries && !hasSupports) {
        console.warn(`[GroundedSources] GROUNDING GAP: Gemini searched (${groundingMetadata.webSearchQueries.length} queries) but response is NOT grounded in any source — higher hallucination risk`);
        console.log(`[GroundedSources] Queries: ${JSON.stringify(groundingMetadata.webSearchQueries)}`);
      } else {
        console.log(`[GroundedSources] No grounding chunks. Metadata keys: ${metadataKeys.join(', ')}, hasSearchQueries=${hasSearchQueries}, hasSupports=${hasSupports}`);
      }

      if (hasSupports) {
        console.log(`[GroundedSources] Has ${groundingMetadata.groundingSupports.length} groundingSupports but no chunks — extracting from supports`);
        const supportSources: GroundedSource[] = [];
        const seen = new Set<string>();
        for (const support of groundingMetadata.groundingSupports) {
          const indices = support.groundingChunkIndices || [];
          for (const idx of indices) {
            const chunk = groundingMetadata.groundingChunks?.[idx];
            if (chunk?.web?.uri && !seen.has(chunk.web.uri)) {
              seen.add(chunk.web.uri);
              supportSources.push({ url: chunk.web.uri, title: chunk.web.title || 'Source' });
            }
          }
        }
        if (supportSources.length > 0) {
          console.log(`[GroundedSources] Recovered ${supportSources.length} sources from groundingSupports`);
          return supportSources;
        }
      }
      return [];
    }
    
    console.log(`[GroundedSources] Found ${groundingChunks.length} grounding chunks, first chunk keys: ${Object.keys(groundingChunks[0] || {}).join(', ')}`);
    
    const seen = new Set<string>();
    const sources: GroundedSource[] = [];
    for (const chunk of groundingChunks) {
      const uri = chunk.web?.uri;
      if (!uri) continue;
      if (isAIGeneratedSource(uri)) continue;
      const displayUrl = chunk.web.domain ? `https://${chunk.web.domain}` : uri;
      const dedupeKey = chunk.web.domain || uri;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      sources.push({
        url: uri,
        title: chunk.web.title || chunk.web.domain || 'Source',
      });
      if (sources.length >= 10) break;
    }
    
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

class SchemaValidationError extends Error {
  constructor(stage: string, details: string) {
    super(`[${stage}] Schema validation failed: ${details}`);
    this.name = 'SchemaValidationError';
  }
}

function validateStage1Schema(parsed: any): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SchemaValidationError('Stage 1', `Expected object, got ${typeof parsed}`);
  }
  const name = parsed.name ?? parsed.propertyName;
  if (typeof name !== 'string' || name.length === 0) {
    throw new SchemaValidationError('Stage 1', `Missing or empty property name`);
  }
  const cat = parsed.cat ?? parsed.category;
  if (typeof cat !== 'string' || cat.length === 0) {
    throw new SchemaValidationError('Stage 1', `Missing or empty category`);
  }
}

function validateStage2Schema(parsed: any): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SchemaValidationError('Stage 2', `Expected object, got ${typeof parsed}`);
  }
  if (!parsed.mgmt || typeof parsed.mgmt !== 'object') {
    throw new SchemaValidationError('Stage 2', `Missing or invalid "mgmt" object`);
  }
  if (!parsed.owner || typeof parsed.owner !== 'object') {
    throw new SchemaValidationError('Stage 2', `Missing or invalid "owner" object`);
  }
}

function validateStage3aSchema(parsed: any): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SchemaValidationError('Stage 3a', `Expected object, got ${typeof parsed}`);
  }
  if (!Array.isArray(parsed.contacts)) {
    throw new SchemaValidationError('Stage 3a', `"contacts" is ${typeof parsed.contacts}, expected array`);
  }
  for (const c of parsed.contacts) {
    if (typeof c !== 'object' || !c.name || typeof c.name !== 'string') {
      throw new SchemaValidationError('Stage 3a', `Contact missing required "name" field`);
    }
  }
}

function propertyLatLng(property: CommercialProperty): { latitude: number; longitude: number } | undefined {
  return property.lat && property.lon ? { latitude: property.lat, longitude: property.lon } : undefined;
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

    try {
      response = await rateLimiters.gemini.execute(() => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], latLng: propertyLatLng(property) }));

      text = response.text?.trim() || '';
      console.log('[FocusedEnrichment] Stage 1 response length:', text.length, 'chars');

      if (text) {
        break;
      }

      console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 1 (attempt ${attempt})`);
      if (response.candidates) {
        console.warn('[FocusedEnrichment] Candidates:', JSON.stringify(response.candidates, null, 2).substring(0, 500));
      }
    } catch (apiError) {
      const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
      const { retryable, isDeadline, isStreamDisconnect } = isRetryableGeminiError(errMsg);

      console.warn(`[FocusedEnrichment] Stage 1 attempt ${attempt} error (retryable=${retryable}, deadline=${isDeadline}, streamDisconnect=${isStreamDisconnect}): ${errMsg.substring(0, 200)}`);

      if (!retryable || attempt >= maxRetries) {
        throw apiError;
      }
    }

    if (attempt < maxRetries) {
      const isDeadline = text === '' || (response === undefined);
      const baseMs = isDeadline ? 5000 : 1000;
      const backoffMs = Math.min(baseMs * Math.pow(2, attempt - 1), 15000);
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

  try {
    validateStage1Schema(parsed);
  } catch (schemaErr) {
    console.warn(`[FocusedEnrichment] Stage 1 schema validation failed: ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
    console.warn(`[FocusedEnrichment] Stage 1 raw response: ${text.substring(0, 300)}`);
  }

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

function isRetryableGeminiError(errMsg: string): { retryable: boolean; isDeadline: boolean; isStreamDisconnect: boolean } {
  const isDeadline = errMsg.includes('DEADLINE_EXCEEDED') || errMsg.includes('504') || errMsg.includes('Deadline expired');
  const isStreamDisconnect = errMsg === 'terminated' || errMsg.includes('ECONNRESET') || errMsg.includes('socket hang up') || errMsg.includes('network error');
  const isServerError = errMsg.includes('500') || errMsg.includes('503') || errMsg.includes('INTERNAL');
  const retryable = isDeadline || isStreamDisconnect || isServerError || errMsg.includes('429');
  return { retryable, isDeadline, isStreamDisconnect };
}

async function callGeminiOnce<T>(
  fn: () => Promise<T>
): Promise<T> {
  const overallStart = Date.now();

  const wrappedFn = async () => {
    const queueWait = Date.now() - overallStart;
    if (queueWait > 1000) {
      console.log(`[FocusedEnrichment] Rate limiter queue wait: ${queueWait}ms`);
    }
    const apiStart = Date.now();

    try {
      const result = await fn();
      console.log(`[FocusedEnrichment] Gemini API responded in ${Date.now() - apiStart}ms (total with queue: ${Date.now() - overallStart}ms)`);
      return result;
    } catch (apiErr) {
      console.warn(`[FocusedEnrichment] Gemini API error after ${Date.now() - apiStart}ms: ${apiErr instanceof Error ? apiErr.message : apiErr}`);
      throw apiErr;
    }
  };

  return rateLimiters.gemini.execute(wrappedFn);
}

async function callGeminiWithTimeout<T>(
  fn: () => Promise<T>,
  _retries: number = 1
): Promise<T> {
  return callGeminiOnce(fn);
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
2. Search the management company website for this property listing to confirm management and find a direct property management phone number
3. Search "${deedOwner} Texas" on OpenCorporates or TX Secretary of State to find the entity behind the LLC/trust
4. Search for news about acquisitions or sales of ${classification.propertyName} around ${deedDate} to identify the beneficial owner

DOMAIN ACCURACY: For "domain" and "site" fields, copy the exact domain from a URL you found in search results. If no search result contained the company's website, return null. Return the "domainSource" field with the full URL where you found it.

Return JSON:
{"mgmt":{"name":"Co|null","domain":"co.com|null","domainSource":"full URL where domain was found|null","c":0.0-1.0},"owner":{"name":"Entity|null","type":"REIT|PE|Family Office|Individual|Corporation|Institutional|Syndicator|null","c":0.0-1.0},"site":"https://property-site.com|null","siteSource":"full URL where property site was found|null","phone":"+1XXXXXXXXXX|null","summary":"2 sentences max: who owns it, who manages it."}`;

  console.log('[FocusedEnrichment] Stage 2: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 2 input - Property: ${classification.propertyName}, Deed Owner: ${deedOwner}`);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 2 attempt ${attempt}/${maxAttempts}...`);
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], latLng: propertyLatLng(property) }),
        2
      );

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 2 attempt ${attempt} response length: ${text.length} chars`);

      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 2 (attempt ${attempt}/${maxAttempts})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'identify-ownership',
          entityType: 'property',
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 2 retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 2: all attempts returned empty, returning defaults');
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

      try {
        validateStage2Schema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 2 schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 2 retrying after schema error in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-ownership',
        entityType: 'property',
        success: true,
        metadata: { sourcesCount: sources.length, attempt },
      });

      const ownerType = parsed.owner?.type ? (OWNER_TYPE_MAP[parsed.owner.type] || null) : null;

      let mgmtDomain = parsed.mgmt?.domain ?? null;
      const mgmtDomainSource = parsed.mgmt?.domainSource ?? null;
      if (mgmtDomain && !mgmtDomainSource) {
        console.warn(`[FocusedEnrichment] Stage 2: Mgmt domain "${mgmtDomain}" has no source citation — likely hallucinated, clearing`);
        mgmtDomain = null;
      }

      let propertySite = parsed.site ?? null;
      const siteSource = parsed.siteSource ?? null;
      if (propertySite && !siteSource) {
        console.warn(`[FocusedEnrichment] Stage 2: Property site "${propertySite}" has no source citation — likely hallucinated, clearing`);
        propertySite = null;
      }

      const ownershipData: OwnershipInfo = {
        beneficialOwner: {
          name: parsed.owner?.name ?? null,
          type: ownerType,
          confidence: parsed.owner?.c ?? 0,
        },
        managementCompany: {
          name: parsed.mgmt?.name ?? null,
          domain: mgmtDomain,
          confidence: parsed.mgmt?.c ?? 0,
        },
        propertyWebsite: propertySite,
        propertyPhone: parsed.phone ?? null,
      };

      const validated = crossValidateOwnership(ownershipData);

      const mgmtName = validated.managementCompany.name || undefined;
      const ownerName = validated.beneficialOwner.name || property.bizName || property.ownerName1 || null;
      const propCity = property.city || 'Dallas';

      if (validated.propertyWebsite) {
        const websiteResult = await validatePropertyWebsite(
          validated.propertyWebsite,
          classification.propertyName,
          mgmtName
        );
        if (!websiteResult.validatedUrl) {
          console.warn(`[FocusedEnrichment] Stage 2: Property website "${validated.propertyWebsite}" failed validation, clearing`);
          validated.propertyWebsite = null;
        } else {
          validated.propertyWebsite = websiteResult.validatedUrl;
          if (websiteResult.extractedDomain && validated.managementCompany.domain) {
            const aiDomain = validated.managementCompany.domain.toLowerCase();
            const siteDomain = websiteResult.extractedDomain.toLowerCase();
            if (aiDomain !== siteDomain && !aiDomain.includes(siteDomain) && !siteDomain.includes(aiDomain)) {
              console.log(`[FocusedEnrichment] Stage 2: Mgmt domain "${aiDomain}" differs from validated website domain "${siteDomain}" — using website domain`);
              validated.managementCompany.domain = websiteResult.extractedDomain;
            }
          }
        }
      }

      if (!validated.propertyWebsite) {
        console.log(`[FocusedEnrichment] Stage 2: No valid property website — running domain retry...`);
        const retryResult = await retryFindPropertyWebsite(
          classification.propertyName,
          classification.canonicalAddress,
          mgmtName || null,
          ownerName,
          propCity,
          propertyLatLng(property)
        );
        if (retryResult.url) {
          validated.propertyWebsite = retryResult.url;
          if (retryResult.domain && !validated.managementCompany.domain) {
            validated.managementCompany.domain = retryResult.domain;
            console.log(`[FocusedEnrichment] Stage 2: Domain retry also provided mgmt domain: ${retryResult.domain}`);
          }
        }
      }

      if (validated.managementCompany.domain) {
        const validatedMgmtDomain = await validateAndCleanDomain(
          validated.managementCompany.domain,
          mgmtName,
          'mgmt company domain'
        );
        if (!validatedMgmtDomain) {
          console.warn(`[FocusedEnrichment] Stage 2: Mgmt domain "${validated.managementCompany.domain}" failed validation, clearing`);
          validated.managementCompany.domain = null;
        } else {
          validated.managementCompany.domain = validatedMgmtDomain;
        }
      }

      if (!validated.managementCompany.domain && validated.managementCompany.name) {
        console.log(`[FocusedEnrichment] Stage 2: No valid mgmt domain — running company domain retry...`);
        const retryDomain = await retryFindCompanyDomain(
          validated.managementCompany.name,
          propCity,
          propertyLatLng(property)
        );
        if (retryDomain) {
          validated.managementCompany.domain = retryDomain;
        }
      }

      console.log(`[FocusedEnrichment] Stage 2 complete with ${sources.length} grounded sources`);
      console.log(`[FocusedEnrichment] Stage 2 extracted - website: ${validated.propertyWebsite || 'none'}, phone: ${validated.propertyPhone || 'none'}, mgmt: ${validated.managementCompany.name || 'none'} (${validated.managementCompany.domain || 'no domain'})`);

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
      console.error(`[FocusedEnrichment] Stage 2 attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt < maxAttempts) {
        const delayMs = attempt * 3000;
        console.log(`[FocusedEnrichment] Stage 2 retrying after error in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
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

async function retryFindPropertyWebsite(
  propertyName: string,
  address: string,
  mgmtCompany: string | null,
  ownerName: string | null,
  city: string,
  latLng?: { latitude: number; longitude: number }
): Promise<{ url: string | null; domain: string | null }> {
  const client = getGeminiClient();
  const context = [
    mgmtCompany ? `Management company: ${mgmtCompany}` : '',
    ownerName ? `Owner: ${ownerName}` : '',
  ].filter(Boolean).join('. ');

  const prompt = `Find the official website for this property. Return ONLY valid JSON.

PROPERTY: ${propertyName} at ${address}, ${city}, TX
${context}

Search for "${propertyName} ${city}" and "${propertyName} apartments" or "${propertyName} office" as a consumer would. Look for the property's own marketing website (e.g. "live${propertyName.toLowerCase().replace(/\s+/g, '')}.com" or similar), a listing on the management company's site, or a dedicated property page. Copy the exact URL from search results.

Return JSON: {"url":"https://full-url-to-property-page|null","domain":"domain-of-the-site|null"}`;

  try {
    console.log(`[FocusedEnrichment] Domain retry: searching for property website for "${propertyName}"...`);
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], latLng }),
      1
    );
    const text = response.text?.trim() || '';
    if (!text) return { url: null, domain: null };

    const parsed = parseJsonResponse(text);
    const url = parsed.url && parsed.url !== 'null' ? parsed.url : null;
    const domain = parsed.domain && parsed.domain !== 'null' ? parsed.domain : null;

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-property-website',
      entityType: 'property',
      success: true,
    });

    if (url) {
      const websiteResult = await validatePropertyWebsite(url, propertyName, mgmtCompany || undefined);
      if (websiteResult.validatedUrl) {
        console.log(`[FocusedEnrichment] Domain retry: found valid property website: ${websiteResult.validatedUrl}`);
        return { url: websiteResult.validatedUrl, domain: websiteResult.extractedDomain };
      }
      console.warn(`[FocusedEnrichment] Domain retry: property website "${url}" failed validation`);
    }
    return { url: null, domain: null };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-property-website',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn(`[FocusedEnrichment] Domain retry for property website failed: ${error instanceof Error ? error.message : error}`);
    return { url: null, domain: null };
  }
}

async function retryFindCompanyDomain(
  companyName: string,
  city: string,
  latLng?: { latitude: number; longitude: number }
): Promise<string | null> {
  const client = getGeminiClient();

  const prompt = `Find the official website for this company. Return ONLY valid JSON.

COMPANY: ${companyName}
LOCATION: ${city}, TX

Search for the company's official website. Copy the exact domain from the URL you find in search results.

Return JSON: {"domain":"company-domain.com|null","source":"full URL where you found it|null"}`;

  try {
    console.log(`[FocusedEnrichment] Domain retry: searching for company domain for "${companyName}"...`);
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], latLng }),
      1
    );
    const text = response.text?.trim() || '';
    if (!text) return null;

    const parsed = parseJsonResponse(text);
    const domain = parsed.domain && parsed.domain !== 'null' ? parsed.domain : null;

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-company-domain',
      entityType: 'organization',
      success: true,
    });

    if (domain) {
      const validated = await validateAndCleanDomain(domain, companyName, 'retry company domain');
      if (validated) {
        console.log(`[FocusedEnrichment] Domain retry: found valid company domain: ${validated}`);
        return validated;
      }
      console.warn(`[FocusedEnrichment] Domain retry: company domain "${domain}" failed validation`);
    }
    return null;
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'retry-company-domain',
      entityType: 'organization',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn(`[FocusedEnrichment] Domain retry for company domain failed: ${error instanceof Error ? error.message : error}`);
    return null;
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
  sourceUrl: string | null;
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

TASK: Search the web to find people who directly manage, operate, or maintain this specific property on a day-to-day basis. Focus on the property management company staff in the ${city} area, not corporate headquarters executives.

PRIORITY ROLES (return these first; listed in priority order):
- On-site property manager or community manager for this specific property
- Facilities/maintenance director or chief engineer for this specific property
- Regional/district property manager overseeing this property's area
- Asset manager or owner with direct responsibility for this property

DO NOT RETURN:
- C-suite executives (CEO, CFO, COO, CTO, CMO) unless they are the direct property owner and higher-priority contacts were not identified
- Corporate HR, marketing, or IT staff
- People at corporate headquarters with no direct tie to this property or market
- National-level VPs unless they specifically oversee the ${city} region

Only return people verifiably connected to THIS property at THIS address or its local market as of 2025-2026.

IMPORTANT: If after searching you cannot find any verifiable contacts for this property, do NOT keep searching. Immediately return an empty contacts array with a summary explaining why no contacts were found. A fast "none found" response is far better than an exhaustive search that finds nothing.

SOURCE REQUIREMENT: For each contact, provide the "src" field with the URL where you found them (LinkedIn profile, company team page, property listing, etc.). Do NOT return contacts you cannot cite a source for — if you cannot provide a source URL, omit that contact entirely.

Return JSON:
{"contacts":[{"name":"Full Name","title":"Title","company":"Company Name","domain":"company.com","role":"property_manager|facilities_manager|owner|other","rc":0.0-1.0,"evidence":"1 sentence linking them to this property","src":"https://source-url-where-found","type":"individual|general"}],"summary":"2 sentences max. If no contacts found, explain why (e.g. small owner-operated business, no public staff listings, etc.)."}`;

  console.log('[FocusedEnrichment] Stage 3a: Identifying decision-makers...');
  console.log(`[FocusedEnrichment] Stage 3a input - Property: ${classification.propertyName}, Mgmt: ${mgmtInfo}`);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3a attempt ${attempt}/${maxAttempts}...`);
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], latLng: propertyLatLng(property) }),
        2
      );

      const text = response.text?.trim() || '';
      console.log(`[FocusedEnrichment] Stage 3a attempt ${attempt} response length: ${text.length} chars`);

      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 3a (attempt ${attempt}/${maxAttempts})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'identify-decision-makers',
          entityType: 'property',
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 3a retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        console.warn('[FocusedEnrichment] Stage 3a: all attempts returned empty, giving up');
        return { data: { contacts: [] }, summary: '', sources: [] };
      }

      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      try {
        validateStage3aSchema(parsed);
      } catch (schemaErr) {
        console.warn(`[FocusedEnrichment] Stage 3a schema validation failed (attempt ${attempt}): ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
        if (attempt < maxAttempts) {
          const delayMs = attempt * 3000;
          console.log(`[FocusedEnrichment] Stage 3a retrying after schema error in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return { data: { contacts: [] }, summary: parsed.summary || '', sources: [] };
      }

      const rawContactsParsed: IdentifiedDecisionMaker[] = (parsed.contacts || []).map((c: any) => ({
        name: c.name || '',
        title: c.title ?? null,
        company: c.company ?? null,
        companyDomain: c.domain ?? null,
        role: c.role || 'other',
        roleConfidence: c.rc ?? 0.5,
        connectionEvidence: c.evidence || '',
        sourceUrl: c.src && c.src !== 'null' ? c.src : null,
        contactType: c.type === 'general' ? 'general' : 'individual',
      }));

      const contacts: IdentifiedDecisionMaker[] = [];
      for (const contact of rawContactsParsed) {
        if (!contact.name) continue;

        if (!contact.sourceUrl) {
          console.warn(`[FocusedEnrichment] Stage 3a: Contact "${contact.name}" has no source URL — downgrading confidence`);
          contact.roleConfidence = Math.min(contact.roleConfidence, 0.4);
        }

        if (contact.companyDomain) {
          const validatedDomain = await validateAndCleanDomain(contact.companyDomain, contact.company || undefined, `Stage 3a domain for ${contact.name}`);
          if (!validatedDomain) {
            console.warn(`[FocusedEnrichment] Stage 3a: Domain "${contact.companyDomain}" for ${contact.name} failed validation — clearing`);
            contact.companyDomain = null;
          } else {
            contact.companyDomain = validatedDomain;
          }
        }
        contacts.push(contact);
      }

      if (contacts.length === 0) {
        console.log(`[FocusedEnrichment] Stage 3a: No contacts found. Reason: ${parsed.summary || 'no reason given'}`);
      } else {
        console.log(`[FocusedEnrichment] Stage 3a complete: ${contacts.length} contacts identified, ${sources.length} sources`);
      }

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'identify-decision-makers',
        entityType: 'property',
        success: true,
        metadata: { contactsCount: contacts.length, sourcesCount: sources.length, attempt },
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
      console.error(`[FocusedEnrichment] Stage 3a attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt < maxAttempts) {
        const delayMs = attempt * 3000;
        console.log(`[FocusedEnrichment] Stage 3a retrying after error in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return {
        data: { contacts: [] },
        summary: '',
        sources: [],
      };
    }
  }

  return { data: { contacts: [] }, summary: '', sources: [] };
}

async function enrichContactDetails(
  contact: IdentifiedDecisionMaker,
  city: string,
  latLng?: { latitude: number; longitude: number }
): Promise<ContactEnrichmentResult> {
  const client = getGeminiClient();

  const companyInfo = contact.company
    ? `${contact.company}${contact.companyDomain ? ` (${contact.companyDomain})` : ''}`
    : 'unknown company';

  const prompt = `Find contact info for ${contact.name}, ${contact.title || 'unknown title'} at ${companyInfo} in ${city}, TX. Return ONLY valid JSON.

RULES:
- Only return an email address that you found in an actual web page or search result. Copy it exactly as it appeared.
- DO NOT construct emails from name patterns. Examples of HALLUCINATED emails you must NOT return: firstname@company.com, flastname@company.com, first.last@company.com. If no email appeared in search results, return null.
- For phone: return a number you found on the company or property website. Return null if not found.
- If you cannot find verified contact details after searching, return null — a null is far more valuable than a guess.

{"email":"found@email.com|null","phone":"+1XXXXXXXXXX|null","pl":"direct_work|office|personal|null","pc":0.0-1.0,"loc":"City, ST|null"}`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[FocusedEnrichment] Stage 3b attempt ${attempt}/${maxAttempts} for ${contact.name}...`);
      const response = await callGeminiWithTimeout(
        () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], latLng }),
        2
      );

      const text = response.text?.trim() || '';
      if (!text) {
        console.warn(`[FocusedEnrichment] Empty response in Stage 3b for ${contact.name} (attempt ${attempt}/${maxAttempts})`);
        trackCostFireAndForget({
          provider: 'gemini',
          endpoint: 'enrich-contact-details',
          entityType: 'contact',
          success: false,
          errorMessage: `Empty response attempt ${attempt}`,
        });
        if (attempt < maxAttempts) {
          const delayMs = attempt * 2000;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
      }

      const sources = extractGroundedSources(response);
      const parsed = parseJsonResponse(text);

      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'enrich-contact-details',
        entityType: 'contact',
        success: true,
        metadata: { sourcesCount: sources.length, attempt },
      });

      let email = parsed.email && parsed.email !== 'null' ? parsed.email : null;

      if (email) {
        if (isLikelyConstructedEmail(email, contact.name)) {
          const hasGrounding = sources.length > 0;
          if (!hasGrounding) {
            console.warn(`[FocusedEnrichment] Stage 3b: Email "${email}" matches name-pattern construction for ${contact.name} with no grounding sources — likely hallucinated, clearing`);
            email = null;
          } else {
            console.log(`[FocusedEnrichment] Stage 3b: Email "${email}" matches name-pattern but has ${sources.length} grounding sources — keeping`);
          }
        }
      }

      if (email) {
        const emailDomain = email.split('@')[1];
        if (emailDomain) {
          const domainResult = await validateAndCleanDomain(emailDomain, undefined, `email domain for ${contact.name}`);
          if (!domainResult) {
            console.warn(`[FocusedEnrichment] Stage 3b: Email "${email}" has invalid domain, clearing`);
            email = null;
          }
        }
      }

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
      console.warn(`[FocusedEnrichment] Stage 3b attempt ${attempt} failed for ${contact.name}: ${error instanceof Error ? error.message : error}`);
      if (attempt < maxAttempts) {
        const delayMs = attempt * 2000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
    }
  }

  return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
}

function isLikelyConstructedEmail(email: string, fullName: string): boolean {
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
  const latLng = propertyLatLng(property);
  const settledResults = await Promise.allSettled(
    identifiedContacts.map(contact => enrichContactDetails(contact, city, latLng))
  );
  const contactEnrichmentMs = Date.now() - startEnrich;

  const enrichmentResults: ContactEnrichmentResult[] = settledResults.map((result, idx) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`[FocusedEnrichment] Stage 3b failed for ${identifiedContacts[idx].name}: ${result.reason}`);
    return { email: null, emailSource: null, phone: null, phoneLabel: null, phoneConfidence: null, location: null, enrichmentSources: [] };
  });

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

  const knownCompanies = [
    ownership.managementCompany?.name,
    ownership.beneficialOwner?.name,
    property.bizName,
    property.ownerName1,
  ].filter(Boolean).map(n => n!.toLowerCase().replace(/[^a-z0-9]/g, ''));

  if (knownCompanies.length > 0) {
    for (const c of contacts) {
      if (c.company) {
        const contactCompanyNorm = c.company.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchesKnown = knownCompanies.some(known =>
          contactCompanyNorm.includes(known) || known.includes(contactCompanyNorm)
        );
        if (!matchesKnown && contactCompanyNorm.length > 3) {
          console.warn(`[FocusedEnrichment] Cross-stage validation: ${c.name}'s company "${c.company}" doesn't match known companies [${knownCompanies.join(', ')}] — downgrading roleConfidence`);
          c.roleConfidence = Math.min(c.roleConfidence, 0.5);
        }
      }
    }
  }

  const propertyPhone = ownership.propertyPhone?.replace(/\D/g, '') || null;
  if (propertyPhone) {
    for (const c of contacts) {
      if (c.phone && c.phone.replace(/\D/g, '') === propertyPhone) {
        console.warn(`[FocusedEnrichment] Phone cross-validation: ${c.name}'s phone matches propertyPhone — labeling as office`);
        c.phoneLabel = 'office';
        c.phoneConfidence = Math.min(c.phoneConfidence ?? 0.5, 0.4);
      }
    }
  }

  const phoneCountMap = new Map<string, string[]>();
  for (const c of contacts) {
    if (c.phone) {
      const normalized = c.phone.replace(/\D/g, '');
      if (!phoneCountMap.has(normalized)) phoneCountMap.set(normalized, []);
      phoneCountMap.get(normalized)!.push(c.name);
    }
  }
  for (const [phone, names] of phoneCountMap) {
    if (names.length > 1) {
      console.warn(`[FocusedEnrichment] Phone cross-validation: ${names.length} contacts share phone +${phone} (${names.join(', ')}) — likely generic office number, downgrading to office label`);
      for (const c of contacts) {
        if (c.phone?.replace(/\D/g, '') === phone) {
          c.phoneLabel = 'office';
          c.phoneConfidence = Math.min(c.phoneConfidence ?? 0.5, 0.5);
        }
      }
    }
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
      () => streamGeminiResponse(client, prompt, { temperature: 0.1 }),
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
      () => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }] }),
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
