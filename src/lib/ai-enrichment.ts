import { GoogleGenAI } from "@google/genai";
import pLimit from "p-limit";
import type { CommercialProperty, DCADBuilding } from "./snowflake";
import { ASSET_CATEGORIES, CONCURRENCY, GEMINI_MODEL } from "./constants";
import { trackCostFireAndForget } from '@/lib/cost-tracker';

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
    const candidates = response.candidates || response.response?.candidates || [];
    if (candidates.length === 0) return [];
    
    const candidate = candidates[0];
    const groundingMetadata = candidate.groundingMetadata || candidate.grounding_metadata;
    if (!groundingMetadata) return [];
    
    const groundingChunks = groundingMetadata.groundingChunks || groundingMetadata.grounding_chunks || [];
    
    return groundingChunks
      .filter((chunk: any) => chunk.web?.uri && !isAIGeneratedSource(chunk.web.uri))
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
  "property_class":"A+/A/B/C/D",
  "property_class_confidence":0.0-1.0,
  "lot_acres":number|null,
  "lot_acres_confidence":0.0-1.0,
  "net_sqft":number|null,
  "net_sqft_confidence":0.0-1.0,
  "summary":"2-3 sentences describing the property type, building class, key physical features (size, year built, condition), tenant mix, and any notable renovations or upgrades found during research."
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
        temperature: 0.0,
        // googleSearch: {} always grounds - no dynamic threshold supported in JS SDK
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
3. The property-specific website (NOT the management company website) - e.g., building website, apartment community site, shopping center site
4. The property's main phone number

Use the owner information above as a starting point for your research. The bizName and ownerName fields may contain LLCs, trusts, or holding companies - search to find the actual beneficial owner behind them.

Return JSON:
{
  "beneficialOwner":{"name":"Entity name or null","type":"REIT|Private Equity|Family Office|Individual|Corporation|null","confidence":0.0-1.0},
  "managementCompany":{"name":"Company or null","domain":"website.com or null","confidence":0.0-1.0},
  "propertyWebsite":"https://propertyname.com or null - property-specific website, NOT management company site",
  "propertyPhone":"+1-XXX-XXX-XXXX or null - main leasing/property phone",
  "summary":"2-3 sentences describing the beneficial owner (entity type and when acquired), the management company and their specialty/portfolio size if known, and any notable changes in ownership or management in recent years."
}`;

  console.log('[FocusedEnrichment] Stage 2: Ownership identification...');
  console.log(`[FocusedEnrichment] Stage 2 input - Property: ${classification.propertyName}, Owner: ${primaryOwner}`);
  
  try {
    const response = await callGeminiWithTimeout(
      () => client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { 
          temperature: 0.0,
          // googleSearch: {} always grounds - no dynamic threshold supported in JS SDK
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

    console.log(`[FocusedEnrichment] Stage 2 complete with ${sources.length} grounded sources`);
    console.log(`[FocusedEnrichment] Stage 2 extracted - website: ${parsed.propertyWebsite || 'none'}, phone: ${parsed.propertyPhone || 'none'}`);
    
    // Log parsed keys when website/phone missing to help diagnose
    if (!parsed.propertyWebsite || !parsed.propertyPhone) {
      const keys = Object.keys(parsed || {});
      console.log(`[FocusedEnrichment] Stage 2 parsed keys: ${keys.join(', ')}`);
    }
    
    return {
      data: {
        beneficialOwner: parsed.beneficialOwner || { name: null, type: null, confidence: 0 },
        managementCompany: parsed.managementCompany || { name: null, domain: null, confidence: 0 },
        propertyWebsite: parsed.propertyWebsite || null,
        propertyPhone: parsed.propertyPhone || null,
      },
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

TASK: Search the web to find 3-5 contacts who make property decisions for THIS SPECIFIC PROPERTY at THIS ADDRESS:
- Property managers responsible for THIS specific location in ${property.city || 'Dallas'}, Texas
- Facilities managers/directors, maintenance supervisors, and property operations staff for THIS specific location in ${property.city || 'Dallas'}, Texas
- Include leasig or owner contacts ONLY if directly connected to this property 

CRITICAL: Only include organizations and contacts that are DIRECTLY involved with THIS property at THIS address. Prioritize high-value property management and facilities management contacts.
DO NOT include: organizations from other states/cities, condo unit owners, HOA board members, residential tenants, or companies with similar names but different locations.

CONTACT INFORMATION TO CAPTURE:
- Email: Include ONLY if found from credible source (company website, LinkedIn, press release). Do NOT guess.
- Phone: Include if found. Priority: direct work line > property office line > company main line. Label appropriately.
  - "direct_work": Person's direct work phone number
  - "office": Property or company office line
  - "personal": Personal/cell phone (only if publicly listed for business purposes)
- Location: City and state where the contact works (e.g., "Dallas, TX"). Must support that the person is directly associated with THIS property.

VALIDATION REQUIREMENTS:
- Confirm the name field contains a proper first and last name (not a company name or title)
- Confirm the title field is a job title, not a name or company
- Confirm the location supports that this person works at or near THIS property
- Only include contacts with a title AND location that demonstrate direct association with the property

Return JSON:
{
  "contacts":[{"name":"Full Name","title":"Job Title","company":"Employer","company_domain":"domain.com","email":"found@email.com or null","phone":"+1-555-123-4567 or null","phone_label":"direct_work|office|personal|null","phone_confidence":0.0-1.0,"location":"City, ST or null","role":"property_manager|facilities_manager|owner|leasing|other","role_confidence":0.0-1.0,"priority_rank":1-8,"contact_type":"individual|general"}],
  "organizations":[{"name":"Org name","domain":"domain.com","org_type":"owner|management|tenant|developer","roles":["property_manager","owner"]}],
  "summary":"2-3 sentences describing the key decision-makers (property manager, facilities director, owner contact if available), their organization, specific roles and responsibilities at this property, and any notable decision-making authority or specializations they bring."
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
          temperature: 0.0,
          // googleSearch: {} always grounds - no dynamic threshold supported in JS SDK
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
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'discover-contacts',
        entityType: 'property',
        success: false,
        errorMessage: 'Empty response from Gemini',
      });
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
      location: c.location && c.location !== 'null' ? c.location : null,
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
    
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'discover-contacts',
      entityType: 'property',
      success: true,
      metadata: { contactsCount: contacts.length, orgsCount: organizations.length, sourcesCount: sources.length },
    });

    return {
      data: { contacts, organizations },
      summary: parsed.summary || '',
      sources,
    };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'discover-contacts',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
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

/**
 * Clean up AI research summary by:
 * 1. Removing internal system references (e.g., "gemini timed out after 90000ms")
 * 2. Editing for style and clarity
 * 3. Removing citation numbers like [1], [2], etc.
 * 4. Producing a polished, user-facing summary
 */
export async function cleanupAISummary(rawSummary: string): Promise<string> {
  if (!rawSummary || rawSummary.trim().length === 0) {
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
${rawSummary}`;

  try {
    const response = await geminiLimit(() => 
      callGeminiWithTimeout(
        () => client.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: { temperature: 0.1 }
        }),
        30000,
        1
      )
    );
    
    const cleaned = response.text?.trim() || rawSummary;
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
    console.warn('[FocusedEnrichment] Summary cleanup failed, using raw summary:', error);
    // Fall back to basic cleanup - remove obvious system messages and citations
    return rawSummary
      .replace(/\[[\d,\s]+\]/g, '') // Remove citation numbers
      .replace(/gemini.*?timed out.*?ms/gi, '') // Remove timeout messages
      .replace(/error:.*?$/gim, '') // Remove error lines
      .replace(/\n{3,}/g, '\n\n') // Normalize whitespace
      .trim();
  }
}
