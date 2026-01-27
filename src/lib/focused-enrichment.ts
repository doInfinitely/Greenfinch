import { GoogleGenAI } from "@google/genai";
import pLimit from "p-limit";
import type { CommercialProperty, DCADBuilding } from "./snowflake";
import { ASSET_CATEGORIES, CONCURRENCY, GEMINI_MODEL } from "./constants";

// Global rate limiter for Gemini API calls across all concurrent property enrichments
const geminiLimit = pLimit(CONCURRENCY.GEMINI);

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
  email: string | null;
  emailSource: 'ai_discovered' | 'hunter' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  role: string;
  roleConfidence: number;
  priorityRank: number;
  contactType: 'individual' | 'general'; // individual = named person, general = office/main line
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
  
  // Format SPTD code for context (F10=Commercial, F20=Industrial, B11=Apartments)
  const sptdDescription = property.sptdCode === 'F10' ? 'Commercial' :
                          property.sptdCode === 'F20' ? 'Industrial' :
                          property.sptdCode === 'B11' ? 'Apartments/Multifamily' :
                          property.sptdCode || 'Unknown';
  
  const prompt = `Search the web to verify and classify this commercial property. Return ONLY valid JSON.

PROPERTY DATA:
Address: ${property.address}, ${property.city}, TX ${property.zip}
DCAD Property Type: ${sptdDescription} (SPTD Code: ${property.sptdCode || 'Unknown'})
Buildings: ${property.buildingCount || 0} buildings, ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft total
Zoning/Use: ${property.usedesc || 'Unknown'}
Deed Owner: ${primaryOwner}
Value: $${property.dcadTotalVal?.toLocaleString() || 0}
Lot Size: ${currentLotSqft?.toLocaleString() || 'Unknown'} sqft
DCAD Quality Grade: ${dcadQualityGrade || 'Unknown'}

BUILDING DETAILS:
${formatBuildings(property.buildings)}

CATEGORIES: ${formatCategorySchema()}

BUILDING CLASS (use DCAD quality grade as primary indicator):
- A (premium/new) = Excellent, Superior
- B (good) = Good, Average+
- C (older/value-add) = Average, Fair
- D (distressed) = Poor, Unsound

TASK: Search the web to find current information about this property. Look for anchor tenants, year built, renovations, and property details.

Return JSON:
{
  "propertyName":"Descriptive name (e.g., 'Preston Center Plaza')",
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
  "summary":"One sentence: '[Name] is a Class [X] [category] [anchored by X / featuring Y], built in [year] [and renovated in year if applicable].'"
}`;

  console.log('[FocusedEnrichment] Stage 1: Classification and physical verification...');
  
  // Use retry wrapper with empty response detection
  let response: any;
  let text = '';
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[FocusedEnrichment] Stage 1 API call attempt ${attempt}/${maxRetries}...`);
    
    response = await geminiLimit(() => client.models.generateContent({
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
      break; // Got a valid response
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
  
  console.log(`[FocusedEnrichment] Stage 1 complete with ${sources.length} grounded sources`);
  
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
    summary: parsed.summary || '',
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
      // Use global gemini rate limiter to control concurrent API calls
      const result = await Promise.race([geminiLimit(fn), timeoutPromise]);
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
  
  // Build owner info JSON for AI context
  const ownerInfo = {
    bizName: property.bizName || null,
    ownerName1: property.ownerName1 || null,
    ownerName2: property.ownerName2 || null,
    ownerAddress: property.ownerAddressLine1 || null,
    ownerCity: property.ownerCity || null,
    ownerState: property.ownerState || null,
    ownerZip: property.ownerZipcode || null,
    ownerPhone: property.ownerPhone || null,
    deedTransferDate: property.deedTxfrDate || null,
  };
  
  // Combine legal description fields
  const legalDescription = [
    property.legal1,
    property.legal2,
    property.legal3,
    property.legal4
  ].filter(Boolean).join(' ') || null;
  
  const prompt = `Search the web to identify the ownership and management of this commercial property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName}
ADDRESS: ${classification.canonicalAddress}
TYPE: ${classification.category} - ${classification.subcategory}
SIZE: ${property.totalGrossBldgArea?.toLocaleString() || 'unknown'} sqft
VALUE: $${property.dcadTotalVal?.toLocaleString() || 0}

DCAD OWNER RECORDS (from Dallas County Appraisal District):
${JSON.stringify(ownerInfo, null, 2)}

${legalDescription ? `LEGAL DESCRIPTION: ${legalDescription}` : ''}

TASK: Search the web to find:
1. The beneficial owner (true owner behind any LLC/trust) and when they acquired the property
2. The property management company (if third-party managed) and their specialty

Use the owner information above as a starting point for your research. The bizName and ownerName fields may contain LLCs, trusts, or holding companies - search to find the actual beneficial owner behind them.

Return JSON:
{
  "beneficialOwner":{"name":"Entity name or null","type":"REIT|Private Equity|Family Office|Individual|Corporation|null","confidence":0.0-1.0},
  "managementCompany":{"name":"Company or null","domain":"website.com or null","confidence":0.0-1.0},
  "summary":"One sentence: 'The property was [acquired/developed] by [Owner] in [year] and is [self-managed / managed by Company], [a firm specializing in X].'"
}`;

  console.log('[FocusedEnrichment] Stage 2: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 2 input - Property: ${classification.propertyName}, Owner: ${primaryOwner}`);
  
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
      90000,
      2
    );

    const text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 2 response length:', text.length, 'chars');
    
    if (!text) {
      console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 2, returning defaults');
      return {
        data: {
          beneficialOwner: { name: null, type: null, confidence: 0 },
          managementCompany: { name: null, domain: null, confidence: 0 },
        },
        summary: '',
        sources: [],
      };
    }
    
    const sources = extractGroundedSources(response);
    const parsed = parseJsonResponse(text);
    
    console.log(`[FocusedEnrichment] Stage 2 complete with ${sources.length} grounded sources`);
    
    return {
      data: {
        beneficialOwner: parsed.beneficialOwner || { name: null, type: null, confidence: 0 },
        managementCompany: parsed.managementCompany || { name: null, domain: null, confidence: 0 },
      },
      summary: parsed.summary || '',
      sources,
    };
  } catch (error) {
    console.error(`[FocusedEnrichment] Stage 2 failed after retries: ${error instanceof Error ? error.message : error}`);
    return {
      data: {
        beneficialOwner: { name: null, type: null, confidence: 0 },
        managementCompany: { name: null, domain: null, confidence: 0 },
      },
      summary: `Failed to identify ownership: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
  
  const prompt = `Search the web to find decision-maker contacts for this commercial property. Return ONLY valid JSON.

PROPERTY: ${classification.propertyName}
TYPE: ${classification.category} - ${classification.subcategory}
ADDRESS: ${classification.canonicalAddress}
MANAGEMENT COMPANY: ${managementInfo}
OWNER: ${ownerInfo}

TASK: Search the web to find 3-8 contacts who make property decisions:
- Property/Facilities managers at THIS specific location
- Management company contacts responsible for this property
- Owners/principals
- Leasing agents

DO NOT include: condo unit owners, HOA board members, residential tenants

CONTACT INFORMATION TO CAPTURE:
- Email: Include ONLY if found from credible source (company website, LinkedIn, press release). Do NOT guess.
- Phone: Include if found. Priority: direct work line > property office line > company main line. Label appropriately.
  - "direct_work": Person's direct work phone number
  - "office": Property or company office line
  - "personal": Personal/cell phone (only if publicly listed for business purposes)
  - "mobile": Mobile phone

Return JSON:
{
  "contacts":[{"name":"Full Name","title":"Job Title","company":"Employer","company_domain":"domain.com","email":"found@email.com or null","phone":"+1-555-123-4567 or null","phone_label":"direct_work|office|personal|mobile|null","phone_confidence":0.0-1.0,"role":"property_manager|facilities_manager|owner|leasing|other","role_confidence":0.0-1.0,"priority_rank":1-8,"contact_type":"individual|general"}],
  "organizations":[{"name":"Org name","domain":"domain.com","org_type":"owner|management|tenant|developer","roles":["property_manager","owner"]}],
  "summary":"2-3 sentences citing evidence: 'Based on [source], the primary contact is [Name], listed on [website] as [role]. [Secondary contact] at [company] handles [responsibility].'"
}

contact_type values:
- "individual": A named person with a real first and last name (e.g., "John Smith", "Sarah Johnson")
- "general": A generic/office contact, main line, or placeholder name (e.g., "Property Management Office", "Leasing Office", "Main Line", company name used as contact name)`;

  console.log('[FocusedEnrichment] Stage 3: Contact discovery...');
  console.log(`[FocusedEnrichment] Stage 3 input - Property: ${classification.propertyName}, Mgmt: ${managementInfo}`);
  
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
      90000,
      2
    );

    const text = response.text?.trim() || '';
    console.log('[FocusedEnrichment] Stage 3 response length:', text.length, 'chars');
    
    if (!text) {
      console.warn('[FocusedEnrichment] Empty response from Gemini in Stage 3, returning empty contacts');
      return {
        data: { contacts: [], organizations: [] },
        summary: '',
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
      email: c.email && c.email !== 'null' ? c.email : null,
      emailSource: c.email && c.email !== 'null' ? 'ai_discovered' as const : null,
      phone: c.phone && c.phone !== 'null' ? c.phone : null,
      phoneLabel: c.phone_label && c.phone_label !== 'null' ? c.phone_label : null,
      phoneConfidence: c.phone_confidence ?? null,
      role: c.role || 'other',
      roleConfidence: c.role_confidence ?? 0.5,
      priorityRank: c.priority_rank ?? 10,
      contactType: c.contact_type === 'general' ? 'general' : 'individual',
    }));
    
    const organizations: DiscoveredOrganization[] = (parsed.organizations || []).map((o: any) => ({
      name: o.name || '',
      domain: o.domain ?? null,
      orgType: o.org_type || 'other',
      roles: o.roles || [],
    }));
    
    console.log(`[FocusedEnrichment] Stage 3 complete: ${contacts.length} contacts, ${organizations.length} orgs, ${sources.length} grounded sources`);
    
    return {
      data: { contacts, organizations },
      summary: parsed.summary || '',
      sources,
    };
  } catch (error) {
    console.error(`[FocusedEnrichment] Stage 3 failed after retries: ${error instanceof Error ? error.message : error}`);
    return {
      data: { contacts: [], organizations: [] },
      summary: `Failed to discover contacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    summary: stage1Result.summary,
    sources: stage1Result.sources,
  };
  
  const classification: StageResult<PropertyClassification> = {
    data: stage1Result.data.classification,
    summary: stage1Result.summary,
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
