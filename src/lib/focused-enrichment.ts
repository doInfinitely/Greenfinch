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

export interface PropertyClassification {
  propertyName: string;
  canonicalAddress: string;
  category: string;
  subcategory: string;
  confidence: number;
  rationale: string;
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
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: string;
  confidence: number;
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

export async function classifyProperty(property: CommercialProperty): Promise<PropertyClassification> {
  const client = getGeminiClient();
  
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
  
  const prompt = `Classify this commercial property based on the building data.

BUILDINGS ON PARCEL:
${formatBuildings(property.buildings)}

SUMMARY: ${property.buildingCount || 0} buildings, ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft total

ADDRESS: ${property.address}, ${property.city}, TX ${property.zip}

ZONING/USE: ${property.usedesc || 'Unknown'}

DEED OWNER: ${primaryOwner}

CATEGORY SCHEMA:
${formatCategorySchema()}

Return ONLY valid JSON (no markdown):
{"propertyName":"Descriptive name for entire property","canonicalAddress":"Single formatted address","category":"Category from schema","subcategory":"Subcategory from schema","confidence":0.0-1.0,"rationale":"Brief 1-sentence explanation"}`;

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse classification response: ${text}`);
  }
  
  return JSON.parse(jsonMatch[0]) as PropertyClassification;
}

export async function identifyOwnership(
  property: CommercialProperty,
  classification: PropertyClassification
): Promise<OwnershipInfo> {
  const client = getGeminiClient();
  
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
  const allOwners = [property.ownerName1, property.ownerName2].filter(Boolean).join(', ') || 'Unknown';
  
  const prompt = `Identify the beneficial owner and property management company for this property.

PROPERTY: ${classification.propertyName}
ADDRESS: ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}
SIZE: ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft
DEED OWNER: ${primaryOwner}
ALL OWNERS: ${allOwners}

Return ONLY valid JSON (no markdown):
{"beneficialOwner":{"name":"Entity name or null","type":"REIT|Private Equity|Family Office|Individual|Corporation|null","confidence":0.0-1.0},"managementCompany":{"name":"Company name or null","domain":"website.com or null","confidence":0.0-1.0}}`;

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse ownership response: ${text}`);
  }
  
  return JSON.parse(jsonMatch[0]) as OwnershipInfo;
}

export async function discoverContacts(
  property: CommercialProperty,
  classification: PropertyClassification,
  ownership: OwnershipInfo
): Promise<DiscoveredContact[]> {
  const client = getGeminiClient();
  
  const managementInfo = ownership.managementCompany?.name 
    ? `${ownership.managementCompany.name} (${ownership.managementCompany.domain || 'no website'})`
    : 'Unknown';
  
  const ownerInfo = ownership.beneficialOwner?.name || property.bizName || property.ownerName1 || 'Unknown';
  
  const prompt = `Find decision-maker contacts for property services at this commercial property.

PROPERTY: ${classification.propertyName}
TYPE: ${classification.category} - ${classification.subcategory}
ADDRESS: ${classification.canonicalAddress}
MANAGEMENT COMPANY: ${managementInfo}
OWNER: ${ownerInfo}

Target roles: Property Manager, Facilities Manager, Operations Director, Leasing Agent, Asset Manager

Return ONLY valid JSON array (no markdown):
[{"name":"Full Name","title":"Job Title","company":"Employer","email":"email@domain.com or null","phone":"phone or null","linkedinUrl":"url or null","source":"Where found","confidence":0.0-1.0}]

Only include contacts verifiably connected to this property. Return empty array [] if none found with confidence > 0.5.`;

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: { 
      temperature: 0.1,
      tools: [{ googleSearch: {} }]
    }
  });

  const text = response.text?.trim() || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.log('[discoverContacts] No JSON array found, returning empty');
    return [];
  }
  
  return JSON.parse(jsonMatch[0]) as DiscoveredContact[];
}

export interface FocusedEnrichmentResult {
  propertyKey: string;
  classification: PropertyClassification;
  ownership: OwnershipInfo;
  contacts: DiscoveredContact[];
  timing: {
    classificationMs: number;
    ownershipMs: number;
    contactsMs: number;
    totalMs: number;
  };
  tokenEstimate: {
    classification: number;
    ownership: number;
    contacts: number;
    total: number;
  };
}

export async function runFocusedEnrichment(property: CommercialProperty): Promise<FocusedEnrichmentResult> {
  const startTotal = Date.now();
  
  const startClassification = Date.now();
  const classification = await classifyProperty(property);
  const classificationMs = Date.now() - startClassification;
  
  const startOwnership = Date.now();
  const ownership = await identifyOwnership(property, classification);
  const ownershipMs = Date.now() - startOwnership;
  
  const startContacts = Date.now();
  const contacts = await discoverContacts(property, classification, ownership);
  const contactsMs = Date.now() - startContacts;
  
  const totalMs = Date.now() - startTotal;

  const classificationTokens = 400;
  const ownershipTokens = 250;
  const contactsTokens = 350;
  
  return {
    propertyKey: property.parcelId,
    classification,
    ownership,
    contacts,
    timing: {
      classificationMs,
      ownershipMs,
      contactsMs,
      totalMs
    },
    tokenEstimate: {
      classification: classificationTokens,
      ownership: ownershipTokens,
      contacts: contactsTokens,
      total: classificationTokens + ownershipTokens + contactsTokens
    }
  };
}
