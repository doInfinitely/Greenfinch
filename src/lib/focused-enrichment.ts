import { GoogleGenAI } from "@google/genai";
import type { CommercialProperty, DCADBuilding } from "./snowflake";

const ASSET_CATEGORIES: Record<string, string[]> = {
  "Multifamily": ["Apartment Complex", "Duplex/Triplex/Quadplex", "Senior Living", "Student Housing", "Other Multifamily"],
  "Office": ["Office Building", "Medical Office", "Business Park", "Flex Office", "Other Office"],
  "Retail": ["Shopping Center", "Restaurant/Food Service", "Convenience/Gas Station", "Standalone Retail", "Other Retail"],
  "Industrial": ["Warehouse/Distribution", "Manufacturing", "Flex/Light Industrial", "Self-Storage", "Other Industrial"],
  "Hospitality": ["Hotel", "Motel", "Resort", "Extended Stay", "Other Hospitality"],
  "Healthcare": ["Hospital", "Medical Center", "Assisted Living", "Outpatient Clinic", "Other Healthcare"],
  "Mixed Use": ["Retail/Residential", "Office/Retail", "Office/Residential", "Commercial/Industrial", "Other Mixed Use"],
  "Special Purpose": ["Parking", "Sports/Fitness", "Entertainment", "Auto Service", "Religious", "Education", "Other Special Purpose"]
};

function getGeminiClient(): GoogleGenAI {
  if (process.env.GOOGLE_GENAI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });
  }
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("No Gemini API key found");
  }
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (baseUrl) {
    return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  }
  return new GoogleGenAI({ apiKey });
}

interface GroundedSource {
  url: string;
  title: string;
}

interface StageResult<T> {
  data: T;
  rationale: string;
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
    type: "REIT" | "Private Equity" | "Family Office" | "Individual" | "Corporation" | null;
    confidence: number;
  };
  managementCompany: {
    name: string | null;
    domain: string | null;
    confidence: number;
  };
}

export interface DiscoveredContact {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  role: string;
  roleConfidence: number;
  priorityRank: number;
}

export interface DiscoveredOrganization {
  name: string;
  domain: string | null;
  orgType: string;
  roles: string[];
}

function formatBuildings(buildings: DCADBuilding[] | null): string {
  if (!buildings || buildings.length === 0) return "No building data available";
  
  return buildings.map((b, i) => {
    const parts = [];
    if (b.propertyName) parts.push(b.propertyName);
    if (b.bldgClassDesc) parts.push(b.bldgClassDesc);
    if (b.grossBldgArea) parts.push(`${b.grossBldgArea.toLocaleString()} sqft`);
    if (b.yearBuilt) parts.push(`built ${b.yearBuilt}`);
    if (b.numStories) parts.push(`${b.numStories} stories`);
    if (b.numUnits) parts.push(`${b.numUnits} units`);
    return `${i + 1}. ${parts.join(', ')}`;
  }).join('\n');
}

function formatCategorySchema(): string {
  return Object.entries(ASSET_CATEGORIES)
    .map(([cat, subs]) => `${cat}: ${subs.join(', ')}`)
    .join('\n');
}

function extractGroundedSources(response: any): GroundedSource[] {
  try {
    const candidates = response.candidates || response.response?.candidates || [];
    if (candidates.length === 0) return [];
    
    const candidate = candidates[0];
    const groundingMetadata = candidate.groundingMetadata || candidate.grounding_metadata;
    if (!groundingMetadata) return [];
    
    const groundingChunks = groundingMetadata.groundingChunks || groundingMetadata.grounding_chunks || [];
    
    return groundingChunks
      .filter((chunk: any) => chunk.web?.uri)
      .map((chunk: any) => ({
        url: chunk.web.uri,
        title: chunk.web.title || 'Source',
      }))
      .slice(0, 5);
  } catch (error) {
    console.warn('[FocusedEnrichment] Error extracting grounding sources:', error);
    return [];
  }
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
  const currentLotSqft = property.lotSqft || (property.lotAcres ? property.lotAcres * 43560 : null);
  const currentBldgSqft = property.totalGrossBldgArea || null;
  
  const parentBuilding = property.buildings?.[0];
  const dcadQualityGrade = parentBuilding?.qualityGrade || null;
  
  const prompt = `Classify this commercial property and verify physical data. Return ONLY valid JSON.

BUILDINGS ON PARCEL:
${formatBuildings(property.buildings)}

SUMMARY: ${property.buildingCount || 0} buildings, ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft total
ADDRESS: ${property.address}, ${property.city}, TX ${property.zip}
ZONING/USE: ${property.usedesc || 'Unknown'}
DEED OWNER: ${primaryOwner}
VALUE: $${property.dcadTotalVal?.toLocaleString() || 0}
CURRENT LOT DATA: ${currentLotSqft?.toLocaleString() || 'Unknown'} sqft
DCAD QUALITY GRADE: ${dcadQualityGrade || 'Unknown'}

CATEGORIES: ${formatCategorySchema()}

BUILDING CLASS (use DCAD quality grade as primary indicator):
- A (premium/new) = DCAD grades like "Excellent", "Superior"  
- B (good) = DCAD grades like "Good", "Average+"
- C (older/value-add) = DCAD grades like "Average", "Fair"
- D (distressed) = DCAD grades like "Poor", "Unsound"

Return JSON:
{
  "propertyName":"Descriptive name",
  "canonicalAddress":"Full address",
  "category":"Category",
  "subcategory":"Subcategory",
  "confidence":0.0-1.0,
  "property_class":"A/B/C/D",
  "property_class_confidence":0.0-1.0,
  "lot_acres":number|null,
  "lot_acres_confidence":0.0-1.0,
  "net_sqft":number|null,
  "net_sqft_confidence":0.0-1.0,
  "rationale":"Brief explanation of classification and data sources"
}`;

  console.log('[FocusedEnrichment] Stage 1: Classification and physical verification...');
  
  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
  console.log('[FocusedEnrichment] Stage 1 response length:', text.length, 'chars');
  
  if (!text) {
    console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 1');
    if (response.candidates) {
      console.warn('[FocusedEnrichment] Candidates:', JSON.stringify(response.candidates, null, 2).substring(0, 500));
    }
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
      rationale: 'No response from AI model',
      sources: [],
    };
  }
  
  const sources = extractGroundedSources(response);
  const parsed = parseJsonResponse(text);
  
  console.log(`[FocusedEnrichment] Classification and verification complete with ${sources.length} grounded sources`);
  
  return {
    data: {
      physical: {
        lotAcres: parsed.lot_acres ?? null,
        lotAcresConfidence: parsed.lot_acres_confidence ?? null,
        netSqft: parsed.net_sqft ?? null,
        netSqftConfidence: parsed.net_sqft_confidence ?? null,
      },
      classification: {
        propertyName: parsed.propertyName || '',
        canonicalAddress: parsed.canonicalAddress || '',
        category: parsed.category || '',
        subcategory: parsed.subcategory || '',
        confidence: parsed.confidence ?? 0,
        propertyClass: parsed.property_class ?? null,
        propertyClassConfidence: parsed.property_class_confidence ?? null,
      },
    },
    rationale: parsed.rationale || '',
    sources,
  };
}

async function callGeminiWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 60000,
  retries: number = 2
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs}ms`)), timeoutMs);
      });
      
      console.log(`[FocusedEnrichment] API call attempt ${attempt}/${retries}...`);
      const result = await Promise.race([fn(), timeoutPromise]);
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

export async function identifyOwnership(
  property: CommercialProperty,
  classification: PropertyClassification
): Promise<StageResult<OwnershipInfo>> {
  const client = getGeminiClient();
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
  const allOwners = [property.ownerName1, property.ownerName2].filter(Boolean).join(', ') || 'Unknown';
  
  const prompt = `Identify property ownership and management. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName}
ADDRESS: ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}
SIZE: ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft
DEED OWNER: ${primaryOwner}
ALL OWNERS: ${allOwners}
VALUE: $${property.dcadTotalVal?.toLocaleString() || 0}

Find beneficial owner (true owner behind LLC/trust) and management company if third-party managed.

Return JSON:
{"beneficialOwner":{"name":"Entity name or null","type":"REIT|Private Equity|Family Office|Individual|Corporation|null","confidence":0.0-1.0},"managementCompany":{"name":"Company or null","domain":"website.com or null","confidence":0.0-1.0},"rationale":"1-3 sentences on ownership findings"}`;

  console.log('[FocusedEnrichment] Stage 3: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 3 input - Property: ${classification.propertyName}, Owner: ${primaryOwner}`);
  
  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { 
          temperature: 0.1,
          tools: [{ googleSearch: {} }]
        }
      }),
      90000,
      2
    );

    const text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 3 response length:', text.length, 'chars');
    
    if (!text) {
      console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 3, returning defaults');
      return {
        data: {
          beneficialOwner: { name: null, type: null, confidence: 0 },
          managementCompany: { name: null, domain: null, confidence: 0 },
        },
        rationale: 'No response from AI model',
        sources: [],
      };
    }
    
    const sources = extractGroundedSources(response);
    const parsed = parseJsonResponse(text);
    
    console.log(`[FocusedEnrichment] Ownership identification complete with ${sources.length} grounded sources`);
    
    return {
      data: {
        beneficialOwner: parsed.beneficialOwner || { name: null, type: null, confidence: 0 },
        managementCompany: parsed.managementCompany || { name: null, domain: null, confidence: 0 },
      },
      rationale: parsed.rationale || '',
      sources,
    };
  } catch (error) {
    console.error(`[FocusedEnrichment] Stage 3 failed after retries: ${error instanceof Error ? error.message : error}`);
    return {
      data: {
        beneficialOwner: { name: null, type: null, confidence: 0 },
        managementCompany: { name: null, domain: null, confidence: 0 },
      },
      rationale: `Failed to identify ownership: ${error instanceof Error ? error.message : 'Unknown error'}`,
      sources: [],
    };
  }
}

export async function discoverContacts(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<StageResult<{ contacts: DiscoveredContact[]; organizations: DiscoveredOrganization[] }>> {
  const client = getGeminiClient();
  
  const managementInfo = ownership.managementCompany?.name 
    ? `${ownership.managementCompany.name} (${ownership.managementCompany.domain || 'no website'})`
    : 'Unknown';
  
  const ownerInfo = ownership.beneficialOwner?.name || property.bizName || property.ownerName1 || 'Unknown';
  
  const prompt = `Find decision-maker contacts for this commercial property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName}
TYPE: ${classification.category} - ${classification.subcategory}
ADDRESS: ${classification.canonicalAddress}
MANAGEMENT COMPANY: ${managementInfo}
OWNER: ${ownerInfo}

Find 3-8 contacts who make property decisions:
- Property/Facilities managers at THIS location
- Management company contacts
- Owners/principals
- Leasing agents

DO NOT include: condo unit owners, HOA board members, residential tenants

DO NOT guess email/phone/LinkedIn - leave null (will be enriched separately).

Return JSON:
{"contacts":[{"name":"Full Name","title":"Job Title","company":"Employer","company_domain":"domain.com","role":"property_manager|facilities_manager|owner|leasing|other","role_confidence":0.0-1.0,"priority_rank":1-8}],"organizations":[{"name":"Org name","domain":"domain.com","org_type":"owner|management|tenant|developer","roles":["property_manager","owner"]}],"rationale":"1-3 sentences on contact discovery approach"}`;

  console.log('[FocusedEnrichment] Stage 4: Contact discovery...');
  console.log(`[FocusedEnrichment] Stage 4 input - Property: ${classification.propertyName}, Mgmt: ${managementInfo}`);
  
  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { 
          temperature: 0.1,
          tools: [{ googleSearch: {} }]
        }
      }),
      90000,
      2
    );

    const text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 4 response length:', text.length, 'chars');
    
    if (!text) {
      console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 4, returning empty contacts');
      return {
        data: { contacts: [], organizations: [] },
        rationale: 'No response from AI model',
        sources: [],
      };
    }
    
    const sources = extractGroundedSources(response);
    const parsed = parseJsonResponse(text);
  
    const contacts: DiscoveredContact[] = (parsed.contacts || []).map((c: any) => ({
      name: c.name || '',
      title: c.title ?? null,
      company: c.company ?? null,
      companyDomain: c.company_domain ?? null,
      role: c.role || 'other',
      roleConfidence: c.role_confidence ?? 0.5,
      priorityRank: c.priority_rank ?? 10,
    }));
    
    const organizations: DiscoveredOrganization[] = (parsed.organizations || []).map((o: any) => ({
      name: o.name || '',
      domain: o.domain ?? null,
      orgType: o.org_type || 'other',
      roles: o.roles || [],
    }));
    
    console.log(`[FocusedEnrichment] Contact discovery complete: ${contacts.length} contacts, ${organizations.length} orgs, ${sources.length} grounded sources`);
    
    return {
      data: { contacts, organizations },
      rationale: parsed.rationale || '',
      sources,
    };
  } catch (error) {
    console.error(`[FocusedEnrichment] Stage 4 failed after retries: ${error instanceof Error ? error.message : error}`);
    return {
      data: { contacts: [], organizations: [] },
      rationale: `Failed to discover contacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      sources: [],
    };
  }
}

export interface FocusedEnrichmentResult {
  propertyKey: string;
  physical: StageResult<PropertyPhysicalData>;
  classification: StageResult<PropertyClassification>;
  ownership: StageResult<OwnershipInfo>;
  contacts: StageResult<{ contacts: DiscoveredContact[]; organizations: DiscoveredOrganization[] }>;
  timing: {
    physicalMs: number;
    classificationMs: number;
    ownershipMs: number;
    contactsMs: number;
    totalMs: number;
  };
}

export async function runFocusedEnrichment(property: CommercialProperty): Promise<FocusedEnrichmentResult> {
  const startTotal = Date.now();
  
  const startStage1 = Date.now();
  const stage1Result = await classifyAndVerifyProperty(property);
  const stage1Ms = Date.now() - startStage1;
  
  const physical: StageResult<PropertyPhysicalData> = {
    data: stage1Result.data.physical,
    rationale: stage1Result.rationale,
    sources: stage1Result.sources,
  };
  
  const classification: StageResult<PropertyClassification> = {
    data: stage1Result.data.classification,
    rationale: stage1Result.rationale,
    sources: stage1Result.sources,
  };
  
  const startOwnership = Date.now();
  const ownership = await identifyOwnership(property, classification.data);
  const ownershipMs = Date.now() - startOwnership;
  
  const startContacts = Date.now();
  const contacts = await discoverContacts(property, classification.data, ownership.data);
  const contactsMs = Date.now() - startContacts;
  
  const totalMs = Date.now() - startTotal;

  console.log(`[FocusedEnrichment] All stages complete in ${totalMs}ms`);
  
  return {
    propertyKey: property.parcelId || property.accountNum,
    physical,
    classification,
    ownership,
    contacts,
    timing: {
      physicalMs: stage1Ms,
      classificationMs: 0,
      ownershipMs,
      contactsMs,
      totalMs
    }
  };
}
