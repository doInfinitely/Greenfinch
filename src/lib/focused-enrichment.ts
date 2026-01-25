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

export async function verifyPhysicalData(property: CommercialProperty): Promise<StageResult<PropertyPhysicalData>> {
  const client = getGeminiClient();
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
  const currentLotSqft = property.lotSqft || (property.lotAcres ? property.lotAcres * 43560 : null);
  const currentBldgSqft = property.totalGrossBldgArea || null;
  
  const prompt = `Verify property physical characteristics. Return ONLY valid JSON.

PROPERTY: ${property.address}, ${property.city}, TX ${property.zip}
COORDINATES: ${property.lat}, ${property.lon}
OWNER: ${primaryOwner}
CURRENT DATA: Lot ${currentLotSqft?.toLocaleString() || 'Unknown'} sqft, Building ${currentBldgSqft?.toLocaleString() || 'Unknown'} gross sqft

TASK: Research and verify:
1. Lot size in ACRES (1 acre = 43,560 sqft)
2. Net leasable/rentable sqft (excludes parking, mechanical, common areas)

Use county records, property listings, commercial databases. Confidence 0.0-1.0.

Return JSON:
{"lot_acres":number|null,"lot_acres_confidence":0.0-1.0,"net_sqft":number|null,"net_sqft_confidence":0.0-1.0,"rationale":"1-3 sentences on data sources and findings"}`;

  console.log('[FocusedEnrichment] Stage 1: Physical verification...');
  
  const response = await client.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
  const sources = extractGroundedSources(response);
  const parsed = parseJsonResponse(text);
  
  console.log(`[FocusedEnrichment] Physical verification complete with ${sources.length} grounded sources`);
  
  return {
    data: {
      lotAcres: parsed.lot_acres ?? null,
      lotAcresConfidence: parsed.lot_acres_confidence ?? null,
      netSqft: parsed.net_sqft ?? null,
      netSqftConfidence: parsed.net_sqft_confidence ?? null,
    },
    rationale: parsed.rationale || '',
    sources,
  };
}

export async function classifyProperty(property: CommercialProperty): Promise<StageResult<PropertyClassification>> {
  const client = getGeminiClient();
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
  
  const prompt = `Classify this commercial property. Return ONLY valid JSON.

BUILDINGS ON PARCEL:
${formatBuildings(property.buildings)}

SUMMARY: ${property.buildingCount || 0} buildings, ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft total
ADDRESS: ${property.address}, ${property.city}, TX ${property.zip}
ZONING/USE: ${property.usedesc || 'Unknown'}
DEED OWNER: ${primaryOwner}
VALUE: $${property.dcadTotalVal?.toLocaleString() || 0}

CATEGORIES: ${formatCategorySchema()}

BUILDING CLASS: A (premium/new), B (good), C (older/value-add), D (distressed)

Return JSON:
{"propertyName":"Descriptive name","canonicalAddress":"Full address","category":"Category","subcategory":"Subcategory","confidence":0.0-1.0,"property_class":"A/B/C/D","property_class_confidence":0.0-1.0,"rationale":"1-3 sentences on classification reasoning"}`;

  console.log('[FocusedEnrichment] Stage 2: Classification...');
  
  const response = await client.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
  const sources = extractGroundedSources(response);
  const parsed = parseJsonResponse(text);
  
  console.log(`[FocusedEnrichment] Classification complete with ${sources.length} grounded sources`);
  
  return {
    data: {
      propertyName: parsed.propertyName || '',
      canonicalAddress: parsed.canonicalAddress || '',
      category: parsed.category || '',
      subcategory: parsed.subcategory || '',
      confidence: parsed.confidence ?? 0,
      propertyClass: parsed.property_class ?? null,
      propertyClassConfidence: parsed.property_class_confidence ?? null,
    },
    rationale: parsed.rationale || '',
    sources,
  };
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
  
  const response = await client.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
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
  
  const response = await client.models.generateContent({
    model: "gemini-3.0-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
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
  
  const startPhysical = Date.now();
  const physical = await verifyPhysicalData(property);
  const physicalMs = Date.now() - startPhysical;
  
  const startClassification = Date.now();
  const classification = await classifyProperty(property);
  const classificationMs = Date.now() - startClassification;
  
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
      physicalMs,
      classificationMs,
      ownershipMs,
      contactsMs,
      totalMs
    }
  };
}
