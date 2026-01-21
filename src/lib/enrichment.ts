import { GoogleGenAI } from "@google/genai";
import { v5 as uuidv5 } from "uuid";
import { db } from "./db";
import { properties, contacts, organizations, propertyContacts, propertyOrganizations } from "./schema";
import { eq } from "drizzle-orm";
import type { AggregatedProperty } from "./snowflake";
import { findEmail, validateEmail } from "./leadmagic";
import { findContainingPlace } from "./google-places";
import pLimit from "p-limit";
// @ts-ignore - name-match has no type declarations
import { isMatch as nameLibMatch, NameNormalizer } from "name-match";

// Google Custom Search API for LinkedIn lookups
interface GoogleSearchResult {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
  }>;
}

interface LinkedInSearchParams {
  name: string;
  title: string | null;
  company: string | null;
  city: string | null;
}

interface LinkedInMatch {
  url: string;
  confidence: number;
  matchDetails: {
    nameMatch: boolean;
    companyMatch: boolean;
    titleMatch: boolean;
    locationMatch: boolean;
  };
}

async function serpApiSearch(query: string): Promise<GoogleSearchResult | null> {
  const apiKey = process.env.SERP_API_KEY;
  
  if (!apiKey) {
    console.error('[Search] Missing SERP_API_KEY');
    return null;
  }

  const url = `https://serpapi.com/search.json?api_key=${apiKey}&engine=google&q=${encodeURIComponent(query)}&num=5`;
  
  // Log request details (mask API key for security)
  console.log(`[Search] SERP API Request: query="${query}"`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Search] SERP API error: ${response.status} - ${errorText}`);
      return null;
    }
    const data = await response.json();
    
    // Transform SERP API response to match our expected format
    const organicResults = data.organic_results || [];
    return {
      items: organicResults.map((result: { title: string; link: string; snippet: string }) => ({
        title: result.title || '',
        link: result.link || '',
        snippet: result.snippet || '',
      })),
    };
  } catch (error) {
    console.error('[Search] SERP API failed:', error);
    return null;
  }
}

// Normalize a name for comparison (lowercase, remove special chars except hyphens)
function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get all name variations using name-match library
function getNameVariations(name: string): string[] {
  try {
    const variations = NameNormalizer.getNameVariations(name);
    return variations && variations.length > 0 ? variations : [name.toLowerCase().trim()];
  } catch {
    return [name.toLowerCase().trim()];
  }
}

// Check if two names are similar enough to be the same person
function namesMatch(searchName: string, resultText: string): boolean {
  const normalizedSearch = normalizeName(searchName);
  const normalizedResult = normalizeName(resultText);
  
  // Try name-match library first (handles nicknames like Robert/Bob, William/Bill)
  try {
    if (nameLibMatch(normalizedSearch, normalizedResult)) {
      return true;
    }
  } catch {
    // Fall through to manual check
  }
  
  // Fallback: manual check for partial matches in LinkedIn titles
  const searchParts = normalizedSearch.split(' ').filter(p => p.length > 1);
  if (searchParts.length === 0) return false;
  
  const firstName = searchParts[0];
  const lastName = searchParts[searchParts.length - 1];
  
  // Get all variations of the first name (including nicknames)
  const firstNameVariations = getNameVariations(firstName);
  
  // Handle hyphenated last names: "nott-ramirez" -> ["nott", "ramirez", "nott-ramirez"]
  const lastNameParts = lastName.split('-').filter(p => p.length > 1);
  const lastNameVariations = [lastName, ...lastNameParts];
  
  // Split result text into parts, also handling hyphens
  const resultParts = normalizedResult
    .split(/[\s-]+/)
    .filter(p => p.length > 1);
  
  // Check if any first name variation appears in result
  const hasFirstName = firstNameVariations.some(variation =>
    resultParts.some(p => p.includes(variation) || variation.includes(p))
  );
  
  // Check if any last name variation appears in result
  const hasLastName = lastNameVariations.some(variation =>
    resultParts.some(p => p.includes(variation) || variation.includes(p))
  );
  
  return hasFirstName && hasLastName;
}

// Check if company name appears in text
function companyMatches(company: string | null, text: string): boolean {
  if (!company) return false;
  const normalizedCompany = company.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const normalizedText = text.toLowerCase();
  
  // Check for full company name first (exact or partial)
  if (normalizedText.includes(normalizedCompany)) return true;
  
  // Check for significant parts (at least 2 chars to handle acronyms like JLL, IBM, etc.)
  const companyParts = normalizedCompany.split(' ').filter(p => p.length >= 2);
  return companyParts.some(part => normalizedText.includes(part));
}

// Check if title appears in text
function titleMatches(title: string | null, text: string): boolean {
  if (!title) return false;
  const normalizedTitle = title.toLowerCase();
  const normalizedText = text.toLowerCase();
  
  // Common title variations
  const titleKeywords = normalizedTitle.split(' ').filter(p => p.length >= 3);
  return titleKeywords.some(keyword => normalizedText.includes(keyword));
}

// Check if location/city appears in text (including metro area variations)
function locationMatches(city: string | null, text: string): boolean {
  if (!city) return false;
  const normalizedCity = city.toLowerCase().trim();
  const normalizedText = text.toLowerCase();
  
  // Direct city match
  if (normalizedText.includes(normalizedCity)) return true;
  
  // Common metro area mappings
  const metroAreas: Record<string, string[]> = {
    'dallas': ['dallas', 'dfw', 'fort worth', 'plano', 'irving', 'arlington', 'frisco', 'mckinney'],
    'houston': ['houston', 'the woodlands', 'sugar land', 'katy', 'pearland'],
    'austin': ['austin', 'round rock', 'cedar park', 'georgetown'],
    'san antonio': ['san antonio', 'new braunfels'],
    'los angeles': ['los angeles', 'la', 'santa monica', 'pasadena', 'long beach'],
    'new york': ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens'],
    'chicago': ['chicago', 'evanston', 'naperville'],
    'phoenix': ['phoenix', 'scottsdale', 'tempe', 'mesa', 'chandler'],
  };
  
  // Check if city is in a known metro area
  for (const [metro, cities] of Object.entries(metroAreas)) {
    if (cities.includes(normalizedCity)) {
      // Check if any city in the metro area appears in text
      return cities.some(c => normalizedText.includes(c));
    }
  }
  
  return false;
}

// Validate and score a LinkedIn search result
function validateLinkedInResult(
  item: { title: string; link: string; snippet: string },
  params: LinkedInSearchParams
): LinkedInMatch | null {
  // Check if this is a LinkedIn profile URL (not company, job, etc.)
  const linkedinMatch = item.link.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/i);
  if (!linkedinMatch) return null;
  
  // Normalize URL
  let url = linkedinMatch[0];
  if (!url.endsWith('/')) url = url + '/';
  if (!url.startsWith('https://www.')) {
    url = url.replace(/https?:\/\/linkedin\.com/i, 'https://www.linkedin.com');
  }
  
  // Combined text for matching (title + snippet)
  const combinedText = `${item.title} ${item.snippet}`;
  
  // Check name match (required)
  const nameMatch = namesMatch(params.name, combinedText);
  if (!nameMatch) {
    console.log(`[Enrichment] Skipping result - name mismatch: "${item.title.substring(0, 60)}"`);
    return null;
  }
  
  // Check optional matches
  const companyMatch = companyMatches(params.company, combinedText);
  const titleMatch = titleMatches(params.title, combinedText);
  const locationMatch = locationMatches(params.city, combinedText);
  
  // Calculate confidence based on matches
  let confidence = 0.50; // Base confidence for name match only
  
  if (companyMatch) confidence += 0.20;
  if (titleMatch) confidence += 0.15;
  if (locationMatch) confidence += 0.10;
  
  // If we have no additional context to validate, flag as low confidence
  if (!params.company && !params.title && !params.city) {
    confidence = 0.40; // Very low - only name, no context
  } else if (!companyMatch && !titleMatch && !locationMatch) {
    confidence = 0.50; // Low - name matches but nothing else validates
  }
  
  // Cap at 0.95
  confidence = Math.min(confidence, 0.95);
  
  return {
    url,
    confidence,
    matchDetails: {
      nameMatch,
      companyMatch,
      titleMatch,
      locationMatch
    }
  };
}

// UUID namespace for Greenfinch
const GREENFINCH_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Confidence threshold constants (from Technical Architecture Section 4)
export const CONFIDENCE = {
  HIGH: 0.90,
  MEDIUM: 0.75,
  LOW: 0.50,
  EMAIL_THRESHOLD: 0.80,
  PHONE_THRESHOLD: 0.80,
  LINKEDIN_THRESHOLD: 0.75,
  ADDRESS_THRESHOLD: 0.80,
  GEOCODE_THRESHOLD: 0.90,
  CATEGORY_THRESHOLD: 0.75,
  COMMON_NAME_THRESHOLD: 0.70,
  BENEFICIAL_OWNER_THRESHOLD: 0.50,
  MANAGEMENT_THRESHOLD: 0.75
};

// Asset categorization schema (from Technical Architecture Section 4)
export const ASSET_CATEGORIES: Record<string, string[]> = {
  "Single-Family Residential": ["Single Family Home", "Townhouse", "Condominium", "Mobile Home", "Other Residential"],
  "Multifamily": ["Apartment Complex", "Duplex/Triplex/Quadplex", "Mobile Home Park", "Senior Living", "Other Multifamily"],
  "Office": ["Office Building", "Medical Office", "Business Park", "Flex Office", "Other Office"],
  "Retail": ["Shopping Center", "Restaurant/Food Service", "Convenience/Gas Station", "Standalone Retail", "Other Retail"],
  "Industrial": ["Warehouse/Distribution", "Manufacturing", "Flex/Light Industrial", "Self-Storage", "Other Industrial"],
  "Hospitality": ["Hotel", "Motel", "Resort", "Extended Stay", "Other Hospitality"],
  "Healthcare": ["Hospital", "Medical Center", "Assisted Living", "Outpatient Clinic", "Other Healthcare"],
  "Public & Institutional": ["Government", "School/University", "Religious", "Recreation/Parks", "Other Institutional"],
  "Mixed Use": ["Retail/Residential", "Office/Retail", "Office/Residential", "Commercial/Industrial", "Other Mixed Use"],
  "Vacant Land": ["Commercial Land", "Industrial Land", "Residential Land", "Agricultural Land", "Other Vacant Land"],
  "Agricultural": ["Farm/Ranch", "Vineyard/Orchard", "Greenhouse/Nursery", "Livestock", "Other Agricultural"],
  "Special Purpose": ["Parking", "Sports/Fitness", "Entertainment", "Auto Service", "Other Special Purpose"]
};

// Interfaces for enrichment results
export interface EnrichedContact {
  id: string;
  fullName: string;
  normalizedName: string;
  nameConfidence: number;
  email: string | null;
  normalizedEmail: string | null;
  emailConfidence: number | null;
  phone: string | null;
  normalizedPhone: string | null;
  phoneConfidence: number | null;
  title: string | null;
  titleConfidence: number | null;
  companyDomain: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinConfidence: number | null;
  role: string;
  roleConfidence: number;
  contactRationale: string | null;
  source: string;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface EnrichedOrganization {
  id: string;
  name: string;
  domain: string | null;
  orgType: string;
  roles: string[];
}

export interface EnrichedProperty {
  validatedAddress: string | null;
  validatedAddressConfidence: number | null;
  geocodeConfidence: number | null;
  assetCategory: string | null;
  assetSubcategory: string | null;
  categoryConfidence: number | null;
  categoryRationale: string | null;
  propertyClass: string | null;
  propertyClassRationale: string | null;
  commonName: string | null;
  commonNameConfidence: number | null;
  containingPlace: string | null;
  containingPlaceType: string | null;
  beneficialOwner: string | null;
  beneficialOwnerConfidence: number | null;
  beneficialOwnerType: string | null;
  managementType: string | null;
  managementCompany: string | null;
  managementCompanyDomain: string | null;
  managementConfidence: number | null;
  propertyWebsite: string | null;
  propertyManagerWebsite: string | null;
  aiRationale: string | null;
  buildingSqft: number | null;
  buildingSqftConfidence: number | null;
  buildingSqftSource: string | null;
  lotSqft: number | null;
  lotSqftConfidence: number | null;
  lotSqftSource: string | null;
}

export interface EnrichmentResult {
  success: boolean;
  propertyKey: string;
  property: EnrichedProperty;
  contacts: EnrichedContact[];
  organizations: EnrichedOrganization[];
  rawResponse: any;
  error?: string;
}

// UUID generation functions
function generateContactId(contact: { email?: string | null; name: string; domain?: string | null; phone?: string | null }): string {
  if (contact.email) {
    return uuidv5(contact.email.toLowerCase(), GREENFINCH_NAMESPACE);
  }
  if (contact.domain) {
    const normalized = normalizeName(contact.name);
    return uuidv5(`${normalized}|${contact.domain.toLowerCase()}`, GREENFINCH_NAMESPACE);
  }
  if (contact.phone) {
    const normalized = normalizeName(contact.name);
    const normalizedPhone = normalizePhone(contact.phone);
    return uuidv5(`${normalized}|${normalizedPhone}`, GREENFINCH_NAMESPACE);
  }
  return uuidv5(`contact:${normalizeName(contact.name)}`, GREENFINCH_NAMESPACE);
}

function generateOrgId(org: { domain?: string | null; name: string }): string {
  // Use domain only for UUID - this consolidates related companies with same domain
  if (org.domain) {
    return uuidv5(`org:${org.domain.toLowerCase()}`, GREENFINCH_NAMESPACE);
  }
  // Fallback to normalized name if no domain
  const normalizedName = normalizeName(org.name);
  return uuidv5(`org:${normalizedName}`, GREENFINCH_NAMESPACE);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// Get Gemini client - prefer direct API key over Replit AI Integrations (which has issues)
function getGeminiClient(): GoogleGenAI {
  // Prefer direct Google API key if available (more reliable)
  if (process.env.GOOGLE_GENAI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });
  }
  
  // Fallback to Replit AI Integrations
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!apiKey) {
    throw new Error("No Gemini API key found. Set GOOGLE_GENAI_API_KEY or ensure Replit AI Integrations is configured.");
  }
  
  if (baseUrl) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl,
      },
    });
  }
  
  return new GoogleGenAI({ apiKey });
}

// Build the enrichment prompt
function buildEnrichmentPrompt(property: AggregatedProperty): string {
  const categoryList = Object.entries(ASSET_CATEGORIES)
    .map(([cat, subs]) => `${cat}: ${subs.join(', ')}`)
    .join('\n');

  return `You are a commercial real estate data analyst helping sales representatives identify decision-makers for commercial properties. Analyze this property and provide enrichment data with detailed rationale.

## Property Data
Address: ${property.address}, ${property.city}, ${property.state} ${property.zip}
County: ${property.county}
Coordinates: ${property.lat}, ${property.lon}

## Physical Characteristics
- Lot Size: ${property.lotSqft?.toLocaleString() || 'Unknown'} sq ft
- Building Size: ${property.buildingSqft?.toLocaleString() || 'Unknown'} sq ft
- Year Built: ${property.yearBuilt || 'Unknown'}
- Floors: ${property.numFloors || 'Unknown'}

## Ownership
- Primary Owner: ${property.primaryOwner || 'Unknown'}
- All Owners: ${property.allOwners?.join(', ') || 'Unknown'}

## Land Use
- Use Descriptions: ${property.usedesc?.join(', ') || 'Unknown'}
- Use Codes: ${property.usecode?.join(', ') || 'Unknown'}

## Valuation
- Total Parcel Value: $${property.totalParval?.toLocaleString() || 0}
- Total Improvement Value: $${property.totalImprovval?.toLocaleString() || 0}
- Land Value: $${property.landval?.toLocaleString() || 0}

## Raw Parcel Data
${JSON.stringify(property.rawParcelsJson?.slice(0, 5) || [], null, 2)}

## Asset Categories (use these exact values)
${categoryList}

## UNDERSTANDING BUILDING CLASS VS CATEGORY

**Asset Category/Subcategory** = WHAT the property IS (its use type)
- Describes the property's PRIMARY USE: Office, Retail, Industrial, Multifamily, etc.
- Determined by: zoning, tenant mix, building design, and actual use
- Example: A shopping center is "Retail > Shopping Center"

**Building Class (A, B, C, D)** = QUALITY GRADE within that category
- Describes the property's QUALITY relative to other properties of the same type
- Class A: Premium, newest, best location, highest rents, institutional quality
- Class B: Good quality, well-maintained, competitive rents, solid tenants
- Class C: Older, functional, lower rents, may need updates, value-add opportunity
- Class D: Distressed, significant deferred maintenance, highest risk

**Example**: Two office buildings can both be "Office > Office Building" (same category) but one is Class A (new, downtown, trophy asset) and one is Class C (1970s suburban, needs renovation).

## Instructions
Analyze this property and return a JSON object with the following structure:

{
  "property": {
    "validated_address": "Full validated address or null",
    "validated_address_confidence": 0.0-1.0,
    "asset_category": "One of the main categories above",
    "asset_subcategory": "One of the subcategories for that category",
    "category_confidence": 0.0-1.0,
    "category_rationale": "Explain WHY this category/subcategory. What evidence (zoning, use codes, building characteristics, tenants) supports this classification?",
    "property_class": "A, B, C, or D",
    "property_class_rationale": "Explain WHY this class grade. Consider: age, location quality, building condition, rent levels, tenant quality, amenities. What makes it an A vs B vs C?",
    "common_name": "Building/property name if known, else null",
    "common_name_confidence": 0.0-1.0,
    "beneficial_owner": "True beneficial owner if different from registered owner",
    "beneficial_owner_confidence": 0.0-1.0,
    "beneficial_owner_type": "individual, corporation, llc, trust, government, other",
    "management_type": "self_managed, third_party, owner_operator",
    "management_company": "Name of management company if applicable",
    "management_company_domain": "Website domain if known",
    "management_confidence": 0.0-1.0,
    "property_website": "Property website URL if known (e.g., building website, leasing site)",
    "property_manager_website": "Property management company website URL if known",
    "classification_rationale": "Overall summary combining category and class rationale",
    "building_sqft": "Total building square footage (number or null if unknown)",
    "building_sqft_confidence": 0.0-1.0,
    "building_sqft_source": "Where this data came from (e.g., 'county records', 'property listing', 'estimated from floors and footprint')",
    "lot_sqft": "Total lot/land square footage (number or null if unknown)",
    "lot_sqft_confidence": 0.0-1.0,
    "lot_sqft_source": "Where this data came from (e.g., 'county records', 'parcel data', 'estimated')"
  },
  "contacts": [
    {
      "full_name": "Contact name",
      "name_confidence": 0.0-1.0,
      "email": null,
      "email_confidence": null,
      "phone": null,
      "phone_confidence": null,
      "title": "Job title at their company",
      "title_confidence": 0.0-1.0,
      "company_domain": "company.com",
      "employer_name": "Company Name",
      "linkedin_url": null,
      "linkedin_confidence": null,
      "role": "RELATIONSHIP TO THIS PROPERTY - MUST be one of: property_manager, facilities_manager, owner, leasing, other",
      "role_confidence": 0.0-1.0,
      "contact_rationale": "WHY include this contact? What is their connection to this property? How did you find them?"
    }
  ],
  "organizations": [
    {
      "name": "Organization name",
      "domain": "organization.com or null",
      "org_type": "owner, management, tenant, developer, other",
      "roles": ["Array of relationships to THIS PROPERTY - each MUST be one of: property_manager, facilities_manager, owner, leasing, other"]
    }
  ]
}

## Contact Discovery Instructions

PURPOSE: Help sales reps identify WHO to contact about this property. Each contact should be someone who can make or influence decisions about the property.

For contacts, search for and prioritize:
1. PRIORITY 1 - Site-level operations (property manager, facilities manager/director for this specific property)
2. PRIORITY 2 - Management company contacts (if third-party managed)
3. PRIORITY 3 - Asset managers overseeing this property
4. PRIORITY 4 - Owners and principals (current, active individuals only)
5. PRIORITY 5 - Leasing agents and brokers
6. PRIORITY 6 - Other stakeholders

Target 5-10 contacts. For EACH contact, you MUST provide:
- **full_name**: Their complete name
- **title**: Their job title AT THEIR COMPANY (e.g., "Property Manager", "Director of Facilities", "Principal")
- **role**: Their RELATIONSHIP to THIS SPECIFIC PROPERTY (not their job title):
  * property_manager = manages day-to-day operations of this building
  * facilities_manager = oversees maintenance/facilities for this property
  * owner = has ownership stake in this property
  * leasing = handles tenant leasing for this property
  * other = other relevant relationship
- **contact_rationale**: Explain:
  * How you found this person (ownership records, management company website, property listing, etc.)
  * Why they're relevant to this property (they manage this building, their company owns it, etc.)
  * What evidence connects them to this specific property

**TITLE vs ROLE distinction**:
- TITLE = their job at their employer (e.g., "Senior Property Manager at ABC Realty")
- ROLE = their relationship to THIS property (e.g., "property_manager" because ABC Realty manages this building)

CRITICAL REQUIREMENTS:
1. Only include CURRENT, ACTIVE contacts - no deceased individuals, no historical/former employees
2. Verify contacts are still active in their roles (check for recent activity)
3. Each contact MUST have a clear, documented connection to THIS property
4. Provide contact_rationale explaining HOW you know they're connected
5. If you cannot find a verified email, leave email as null
6. If you cannot find a verified phone, leave phone as null
7. Leave LinkedIn as null - this will be discovered separately

Focus on finding real, currently active people associated with this property through the ownership structure, management company, or known business relationships.

Be conservative with confidence scores:
- HIGH (>0.90): Only when you're very certain based on clear evidence
- MEDIUM (0.75-0.90): Reasonable inference with some supporting evidence
- LOW (0.50-0.75): Educated guess based on limited information
- Below 0.50: Do not include

Return ONLY valid JSON, no markdown formatting.`;
}

// Parse Gemini response
function parseGeminiResponse(text: string): any {
  // Remove markdown code blocks if present
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse Gemini response:", e);
    console.error("Raw response:", text);
    throw new Error("Failed to parse Gemini response as JSON");
  }
}

// Process the raw response into EnrichmentResult
function processEnrichmentResponse(
  propertyKey: string,
  rawResponse: any
): { property: EnrichedProperty; contacts: EnrichedContact[]; organizations: EnrichedOrganization[] } {
  const prop = rawResponse.property || {};
  
  // Build combined rationale from individual rationales if available
  let combinedRationale = prop.classification_rationale || '';
  if (prop.category_rationale && !combinedRationale.includes(prop.category_rationale)) {
    combinedRationale = `Category: ${prop.category_rationale}`;
  }
  if (prop.property_class_rationale) {
    combinedRationale = combinedRationale 
      ? `${combinedRationale} | Class: ${prop.property_class_rationale}`
      : `Class: ${prop.property_class_rationale}`;
  }

  const property: EnrichedProperty = {
    validatedAddress: prop.validated_address || null,
    validatedAddressConfidence: prop.validated_address_confidence || null,
    geocodeConfidence: prop.geocode_confidence || null,
    assetCategory: prop.asset_category || null,
    assetSubcategory: prop.asset_subcategory || null,
    categoryConfidence: prop.category_confidence || null,
    categoryRationale: prop.category_rationale || null,
    propertyClass: prop.property_class || null,
    propertyClassRationale: prop.property_class_rationale || null,
    commonName: prop.common_name || null,
    commonNameConfidence: prop.common_name_confidence || null,
    containingPlace: null,
    containingPlaceType: null,
    beneficialOwner: prop.beneficial_owner || null,
    beneficialOwnerConfidence: prop.beneficial_owner_confidence || null,
    beneficialOwnerType: prop.beneficial_owner_type || null,
    managementType: prop.management_type || null,
    managementCompany: prop.management_company || null,
    managementCompanyDomain: prop.management_company_domain || null,
    managementConfidence: prop.management_confidence || null,
    propertyWebsite: prop.property_website || null,
    propertyManagerWebsite: prop.property_manager_website || null,
    aiRationale: combinedRationale || null,
    buildingSqft: prop.building_sqft || null,
    buildingSqftConfidence: prop.building_sqft_confidence || null,
    buildingSqftSource: prop.building_sqft_source || null,
    lotSqft: prop.lot_sqft || null,
    lotSqftConfidence: prop.lot_sqft_confidence || null,
    lotSqftSource: prop.lot_sqft_source || null,
  };

  const contacts: EnrichedContact[] = (rawResponse.contacts || [])
    .filter((c: any) => c.name_confidence >= CONFIDENCE.LOW)
    .map((c: any) => {
      const needsReview = 
        (c.email_confidence && c.email_confidence < CONFIDENCE.MEDIUM) ||
        (c.phone_confidence && c.phone_confidence < CONFIDENCE.MEDIUM);
      
      const contact: EnrichedContact = {
        id: generateContactId({
          email: c.email,
          name: c.full_name,
          domain: c.company_domain,
          phone: c.phone,
        }),
        fullName: c.full_name,
        normalizedName: normalizeName(c.full_name),
        nameConfidence: c.name_confidence,
        email: c.email || null,
        normalizedEmail: c.email ? normalizeEmail(c.email) : null,
        emailConfidence: c.email_confidence || null,
        phone: c.phone || null,
        normalizedPhone: c.phone ? normalizePhone(c.phone) : null,
        phoneConfidence: c.phone_confidence || null,
        title: c.title || null,
        titleConfidence: c.title_confidence || null,
        companyDomain: c.company_domain || null,
        employerName: c.employer_name || null,
        linkedinUrl: c.linkedin_url || null,
        linkedinConfidence: c.linkedin_confidence || null,
        role: c.role || 'other',
        roleConfidence: c.role_confidence || 0.5,
        contactRationale: c.contact_rationale || null,
        source: 'ai',
        needsReview,
        reviewReason: needsReview ? 'Low confidence contact information' : null,
      };
      return contact;
    });

  const orgs: EnrichedOrganization[] = (rawResponse.organizations || []).map((o: any) => {
    // Handle both old 'role' string and new 'roles' array format
    let roles: string[] = [];
    if (Array.isArray(o.roles)) {
      roles = o.roles;
    } else if (o.role) {
      roles = [o.role];
    }
    return {
      id: generateOrgId({ domain: o.domain, name: o.name }),
      name: o.name,
      domain: o.domain || null,
      orgType: o.org_type || 'other',
      roles,
    };
  });

  return { property, contacts, organizations: orgs };
}

// Parse name into first and last name
function parseNameParts(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

// Enrich contacts with emails using LeadMagic
export async function enrichContactsWithEmail(contacts: EnrichedContact[]): Promise<EnrichedContact[]> {
  console.log(`[Enrichment] Enriching ${contacts.length} contacts with email discovery...`);
  
  const enrichedContacts: EnrichedContact[] = [];
  
  for (const contact of contacts) {
    if (contact.email) {
      enrichedContacts.push(contact);
      continue;
    }
    
    if (!contact.companyDomain) {
      console.log(`[Enrichment] Skipping ${contact.fullName} - no company domain`);
      enrichedContacts.push(contact);
      continue;
    }
    
    try {
      const { firstName, lastName } = parseNameParts(contact.fullName);
      
      if (!firstName || !lastName) {
        console.log(`[Enrichment] Skipping ${contact.fullName} - could not parse name`);
        enrichedContacts.push(contact);
        continue;
      }
      
      console.log(`[Enrichment] Finding email for ${firstName} ${lastName} at ${contact.companyDomain}...`);
      
      const findResult = await findEmail(firstName, lastName, contact.companyDomain);
      
      if (findResult.email && findResult.confidence > 80) {
        console.log(`[Enrichment] Found email ${findResult.email} with confidence ${findResult.confidence}`);
        
        const validationResult = await validateEmail(findResult.email);
        
        if (validationResult.isValid) {
          console.log(`[Enrichment] Email validated as ${validationResult.status}`);
          enrichedContacts.push({
            ...contact,
            email: findResult.email,
            normalizedEmail: findResult.email.toLowerCase().trim(),
            emailConfidence: findResult.confidence / 100,
          });
        } else {
          console.log(`[Enrichment] Email validation failed: ${validationResult.status}`);
          enrichedContacts.push(contact);
        }
      } else {
        console.log(`[Enrichment] No high-confidence email found for ${contact.fullName}`);
        enrichedContacts.push(contact);
      }
    } catch (error) {
      console.error(`[Enrichment] Error enriching email for ${contact.fullName}:`, error);
      enrichedContacts.push(contact);
    }
  }
  
  const emailsFound = enrichedContacts.filter(c => c.email).length;
  console.log(`[Enrichment] Email enrichment complete: ${emailsFound}/${contacts.length} contacts have emails`);
  
  return enrichedContacts;
}

// Promise timeout helper
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), ms)
    ),
  ]);
}

// Find LinkedIn URL using Google Custom Search API with validation
export async function findLinkedInUrl(
  name: string,
  title: string | null,
  company: string | null,
  domain: string | null,
  city: string | null = null
): Promise<{ linkedinUrl: string | null; confidence: number }> {
  try {
    const startTime = Date.now();
    
    // Build search query: name + company + city + LinkedIn
    const searchQuery = [name, company, city, "LinkedIn"].filter(Boolean).join(" ");
    console.log(`[Enrichment] LinkedIn search: "${searchQuery}" (validating with: title=${title || 'none'})`);
    
    
    const results = await serpApiSearch(searchQuery);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (!results || !results.items || results.items.length === 0) {
      console.log(`[Enrichment] SERP API returned no results (${elapsed}s)`);
      return { linkedinUrl: null, confidence: 0 };
    }
    
    // Log search results for debugging
    console.log(`[Enrichment] Found ${results.items.length} results (${elapsed}s):`);
    results.items.slice(0, 3).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.link} - "${item.title.substring(0, 50)}"`);
    });
    
    // Validate each result and find the best match
    const searchParams: LinkedInSearchParams = { name, title, company, city };
    let bestMatch: LinkedInMatch | null = null;
    
    for (const item of results.items) {
      const match = validateLinkedInResult(item, searchParams);
      if (match && (!bestMatch || match.confidence > bestMatch.confidence)) {
        bestMatch = match;
      }
    }
    
    if (bestMatch) {
      const { nameMatch, companyMatch, titleMatch, locationMatch } = bestMatch.matchDetails;
      const matchInfo = [
        nameMatch ? 'name' : null,
        companyMatch ? 'company' : null,
        titleMatch ? 'title' : null,
        locationMatch ? 'location' : null
      ].filter(Boolean).join('+');
      
      const confidenceLabel = bestMatch.confidence >= 0.75 ? 'high' : 
                              bestMatch.confidence >= 0.50 ? 'medium' : 'low';
      
      console.log(`[Enrichment] Found LinkedIn for ${name}: ${bestMatch.url} (${confidenceLabel} confidence: ${(bestMatch.confidence * 100).toFixed(0)}%, matched: ${matchInfo}, ${elapsed}s)`);
      return { linkedinUrl: bestMatch.url, confidence: bestMatch.confidence };
    }
    
    console.log(`[Enrichment] No validated LinkedIn match for ${name} (${elapsed}s)`);
    return { linkedinUrl: null, confidence: 0 };
  } catch (error) {
    console.error(`[Enrichment] Error finding LinkedIn for ${name}:`, error);
    return { linkedinUrl: null, confidence: 0 };
  }
}

// Enrich contacts with LinkedIn URLs (limited to top 2 high-priority contacts, run sequentially to avoid rate limits)
export async function enrichContactsWithLinkedIn(contacts: EnrichedContact[]): Promise<EnrichedContact[]> {
  const MAX_LINKEDIN_LOOKUPS = 2;
  const highPriorityRoles = ['property_manager', 'facilities_manager', 'owner'];
  
  const sortedContacts = [...contacts].sort((a, b) => {
    const aHighPriority = highPriorityRoles.includes(a.role);
    const bHighPriority = highPriorityRoles.includes(b.role);
    if (aHighPriority && !bHighPriority) return -1;
    if (!aHighPriority && bHighPriority) return 1;
    return 0;
  });

  const contactsNeedingLinkedIn = sortedContacts.filter(c => !c.linkedinUrl).slice(0, MAX_LINKEDIN_LOOKUPS);
  const contactsToSkip = sortedContacts.filter(c => c.linkedinUrl || !contactsNeedingLinkedIn.includes(c));
  
  console.log(`[Enrichment] LinkedIn discovery for ${contactsNeedingLinkedIn.length} contacts (max ${MAX_LINKEDIN_LOOKUPS})...`);
  
  const limit = pLimit(2);
  
  const linkedInResults = await Promise.all(
    contactsNeedingLinkedIn.map(contact => 
      limit(async () => {
        try {
          console.log(`[Enrichment] Finding LinkedIn for ${contact.fullName}...`);
          
          const result = await findLinkedInUrl(
            contact.fullName,
            contact.title,
            contact.employerName,
            contact.companyDomain
          );
          
          if (result.linkedinUrl && result.confidence >= CONFIDENCE.LINKEDIN_THRESHOLD) {
            console.log(`[Enrichment] Found LinkedIn for ${contact.fullName}: ${result.linkedinUrl}`);
            return {
              ...contact,
              linkedinUrl: result.linkedinUrl,
              linkedinConfidence: result.confidence,
            };
          }
          return contact;
        } catch (error) {
          console.error(`[Enrichment] Error enriching LinkedIn for ${contact.fullName}:`, error);
          const isHighPriority = highPriorityRoles.includes(contact.role);
          if (isHighPriority) {
            return {
              ...contact,
              needsReview: true,
              reviewReason: `LinkedIn discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
          }
          return contact;
        }
      })
    )
  );
  
  const enrichedContacts = [...linkedInResults, ...contactsToSkip];
  const linkedinFound = enrichedContacts.filter(c => c.linkedinUrl).length;
  console.log(`[Enrichment] LinkedIn enrichment complete: ${linkedinFound}/${contacts.length} contacts have LinkedIn`);
  
  return enrichedContacts;
}

// Auto-validation flow for high-priority contacts
export async function validateHighPriorityContacts(contacts: EnrichedContact[]): Promise<EnrichedContact[]> {
  const highPriorityRoles = ['property_manager', 'facilities', 'asset_manager'];
  
  console.log(`[Enrichment] Validating high-priority contacts...`);
  
  const enrichedContacts: EnrichedContact[] = [];
  
  for (const contact of contacts) {
    if (!highPriorityRoles.includes(contact.role)) {
      enrichedContacts.push(contact);
      continue;
    }
    
    console.log(`[Enrichment] Validating high-priority contact: ${contact.fullName} (${contact.role})`);
    
    let updatedContact = { ...contact };
    
    try {
      if (!updatedContact.email && updatedContact.companyDomain) {
        console.log(`[Enrichment] Attempting to find email for ${updatedContact.fullName}...`);
        const { firstName, lastName } = parseNameParts(updatedContact.fullName);
        
        if (firstName && lastName) {
          const findResult = await findEmail(firstName, lastName, updatedContact.companyDomain);
          
          if (findResult.email && findResult.confidence > 80) {
            console.log(`[Enrichment] Found email ${findResult.email} for high-priority contact`);
            updatedContact.email = findResult.email;
            updatedContact.normalizedEmail = findResult.email.toLowerCase().trim();
            updatedContact.emailConfidence = findResult.confidence / 100;
          }
        } else {
          console.log(`[Enrichment] Cannot find email for ${updatedContact.fullName} - incomplete name (first: ${firstName}, last: ${lastName})`);
          if (!updatedContact.needsReview) {
            updatedContact.needsReview = true;
            updatedContact.reviewReason = 'High-priority contact with incomplete name - cannot search email';
          }
        }
      }
      
      if (updatedContact.email) {
        console.log(`[Enrichment] Validating email for ${updatedContact.fullName}...`);
        const validationResult = await validateEmail(updatedContact.email);
        
        if (!validationResult.isValid && validationResult.status === 'invalid') {
          console.log(`[Enrichment] Email ${updatedContact.email} is invalid, clearing...`);
          updatedContact.email = null;
          updatedContact.normalizedEmail = null;
          updatedContact.emailConfidence = null;
        } else {
          updatedContact.emailConfidence = validationResult.confidence;
        }
      }
      
      const hasValidContact = updatedContact.email || updatedContact.phone || updatedContact.linkedinUrl;
      if (!hasValidContact) {
        updatedContact.needsReview = true;
        updatedContact.reviewReason = 'High-priority contact missing all contact information';
      }
      
      enrichedContacts.push(updatedContact);
    } catch (error) {
      console.error(`[Enrichment] Error validating high-priority contact ${contact.fullName}:`, error);
      enrichedContacts.push({
        ...contact,
        needsReview: true,
        reviewReason: `High-priority contact validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
  
  const highPriorityCount = enrichedContacts.filter(c => highPriorityRoles.includes(c.role)).length;
  const withContact = enrichedContacts.filter(c => 
    highPriorityRoles.includes(c.role) && (c.email || c.phone || c.linkedinUrl)
  ).length;
  console.log(`[Enrichment] High-priority validation complete: ${withContact}/${highPriorityCount} have contact info`);
  
  return enrichedContacts;
}

// Main enrichment function
export async function enrichProperty(aggregatedProperty: AggregatedProperty): Promise<EnrichmentResult> {
  console.log(`[Enrichment] Starting enrichment for property: ${aggregatedProperty.propertyKey}`);
  
  try {
    const client = getGeminiClient();
    const prompt = buildEnrichmentPrompt(aggregatedProperty);
    
    console.log(`[Enrichment] Calling Gemini 3 Flash Preview with search grounding...`);
    
    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    console.log(`[Enrichment] Received response, parsing...`);
    
    const rawResponse = parseGeminiResponse(text);
    const { property, contacts: enrichedContacts, organizations: enrichedOrgs } = processEnrichmentResponse(
      aggregatedProperty.propertyKey,
      rawResponse
    );

    console.log(`[Enrichment] Parsed ${enrichedContacts.length} contacts and ${enrichedOrgs.length} organizations`);

    if (aggregatedProperty.lat && aggregatedProperty.lon) {
      console.log(`[Enrichment] Looking up containing place via Google Places...`);
      try {
        const containingResult = await findContainingPlace(aggregatedProperty.lat, aggregatedProperty.lon);
        if (containingResult.containingPlace) {
          console.log(`[Enrichment] Found containing place: ${containingResult.containingPlace}`);
          property.containingPlace = containingResult.containingPlace;
          property.containingPlaceType = containingResult.containingPlaceType;
          
          if (!property.commonName && containingResult.confidence >= 0.8) {
            property.commonName = containingResult.containingPlace;
            property.commonNameConfidence = containingResult.confidence;
          }
        }
      } catch (error) {
        console.warn(`[Enrichment] Error looking up containing place:`, error);
      }
    }

    const contactsWithEmails = await enrichContactsWithEmail(enrichedContacts);
    const contactsWithLinkedIn = await enrichContactsWithLinkedIn(contactsWithEmails);
    const validatedContacts = await validateHighPriorityContacts(contactsWithLinkedIn);

    return {
      success: true,
      propertyKey: aggregatedProperty.propertyKey,
      property,
      contacts: validatedContacts,
      organizations: enrichedOrgs,
      rawResponse,
    };
  } catch (error) {
    console.error(`[Enrichment] Error enriching property ${aggregatedProperty.propertyKey}:`, error);
    return {
      success: false,
      propertyKey: aggregatedProperty.propertyKey,
      property: {
        validatedAddress: null,
        validatedAddressConfidence: null,
        geocodeConfidence: null,
        assetCategory: null,
        assetSubcategory: null,
        categoryConfidence: null,
        categoryRationale: null,
        propertyClass: null,
        propertyClassRationale: null,
        commonName: null,
        commonNameConfidence: null,
        containingPlace: null,
        containingPlaceType: null,
        beneficialOwner: null,
        beneficialOwnerConfidence: null,
        beneficialOwnerType: null,
        managementType: null,
        managementCompany: null,
        managementCompanyDomain: null,
        managementConfidence: null,
        propertyWebsite: null,
        propertyManagerWebsite: null,
        aiRationale: null,
        buildingSqft: null,
        buildingSqftConfidence: null,
        buildingSqftSource: null,
        lotSqft: null,
        lotSqftConfidence: null,
        lotSqftSource: null,
      },
      contacts: [],
      organizations: [],
      rawResponse: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Store enrichment results in database
export async function storeEnrichmentResults(
  aggregatedProperty: AggregatedProperty,
  result: EnrichmentResult
): Promise<{ propertyId: string; contactIds: string[]; orgIds: string[] }> {
  console.log(`[Enrichment] Storing results for property: ${aggregatedProperty.propertyKey}`);
  
  // Upsert property
  const existingProperty = await db.query.properties.findFirst({
    where: eq(properties.propertyKey, aggregatedProperty.propertyKey),
  });

  let propertyId: string;

  const propertyData = {
    propertyKey: aggregatedProperty.propertyKey,
    sourceLlUuid: aggregatedProperty.sourceLlUuid,
    llStackUuid: aggregatedProperty.llStackUuid,
    regridAddress: aggregatedProperty.address,
    validatedAddress: result.property.validatedAddress,
    validatedAddressConfidence: result.property.validatedAddressConfidence,
    city: aggregatedProperty.city,
    state: aggregatedProperty.state,
    zip: aggregatedProperty.zip,
    county: aggregatedProperty.county,
    lat: aggregatedProperty.lat,
    lon: aggregatedProperty.lon,
    geocodeConfidence: result.property.geocodeConfidence,
    // Prefer AI-returned values over Regrid when available with reasonable confidence
    lotSqft: (result.property.lotSqft && result.property.lotSqftConfidence && result.property.lotSqftConfidence >= CONFIDENCE.MEDIUM) 
      ? result.property.lotSqft 
      : aggregatedProperty.lotSqft,
    lotSqftConfidence: result.property.lotSqftConfidence || null,
    lotSqftSource: (result.property.lotSqft && result.property.lotSqftConfidence && result.property.lotSqftConfidence >= CONFIDENCE.MEDIUM) 
      ? result.property.lotSqftSource 
      : 'regrid',
    buildingSqft: (result.property.buildingSqft && result.property.buildingSqftConfidence && result.property.buildingSqftConfidence >= CONFIDENCE.MEDIUM) 
      ? result.property.buildingSqft 
      : aggregatedProperty.buildingSqft,
    buildingSqftConfidence: result.property.buildingSqftConfidence || null,
    buildingSqftSource: (result.property.buildingSqft && result.property.buildingSqftConfidence && result.property.buildingSqftConfidence >= CONFIDENCE.MEDIUM) 
      ? result.property.buildingSqftSource 
      : 'regrid',
    yearBuilt: aggregatedProperty.yearBuilt,
    numFloors: aggregatedProperty.numFloors,
    assetCategory: result.property.assetCategory,
    assetSubcategory: result.property.assetSubcategory,
    categoryConfidence: result.property.categoryConfidence,
    categoryRationale: result.property.categoryRationale,
    propertyClass: result.property.propertyClass,
    propertyClassRationale: result.property.propertyClassRationale,
    commonName: result.property.commonName,
    commonNameConfidence: result.property.commonNameConfidence,
    containingPlace: result.property.containingPlace,
    containingPlaceType: result.property.containingPlaceType,
    regridOwner: aggregatedProperty.primaryOwner,
    beneficialOwner: result.property.beneficialOwner,
    beneficialOwnerConfidence: result.property.beneficialOwnerConfidence,
    beneficialOwnerType: result.property.beneficialOwnerType,
    managementType: result.property.managementType,
    managementCompany: result.property.managementCompany,
    managementCompanyDomain: result.property.managementCompanyDomain,
    managementConfidence: result.property.managementConfidence,
    propertyWebsite: result.property.propertyWebsite,
    propertyManagerWebsite: result.property.propertyManagerWebsite,
    aiRationale: result.property.aiRationale,
    rawParcelsJson: aggregatedProperty.rawParcelsJson,
    enrichmentJson: result.rawResponse,
    lastEnrichedAt: new Date(),
    enrichmentStatus: result.success ? 'completed' : 'failed',
    updatedAt: new Date(),
  };

  if (existingProperty) {
    await db.update(properties)
      .set(propertyData)
      .where(eq(properties.id, existingProperty.id));
    propertyId = existingProperty.id;
  } else {
    const [inserted] = await db.insert(properties)
      .values(propertyData)
      .returning({ id: properties.id });
    propertyId = inserted.id;
  }

  console.log(`[Enrichment] Stored property with ID: ${propertyId}`);

  // Store organizations
  const orgIds: string[] = [];
  for (const org of result.organizations) {
    const existingOrg = org.domain
      ? await db.query.organizations.findFirst({
          where: eq(organizations.domain, org.domain),
        })
      : null;

    let orgId: string;
    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      const [inserted] = await db.insert(organizations)
        .values({
          id: org.id,
          name: org.name,
          domain: org.domain,
          orgType: org.orgType,
        })
        .onConflictDoNothing()
        .returning({ id: organizations.id });
      orgId = inserted?.id || org.id;
    }
    orgIds.push(orgId);

    // Link to property (store roles as comma-separated string)
    await db.insert(propertyOrganizations)
      .values({
        propertyId,
        orgId,
        role: org.roles.join(', '),
      })
      .onConflictDoNothing();
  }

  console.log(`[Enrichment] Stored ${orgIds.length} organizations`);

  // Store contacts
  const contactIds: string[] = [];
  for (const contact of result.contacts) {
    const existingContact = contact.normalizedEmail
      ? await db.query.contacts.findFirst({
          where: eq(contacts.normalizedEmail, contact.normalizedEmail),
        })
      : null;

    let contactId: string;
    if (existingContact) {
      contactId = existingContact.id;
      // Update existing contact if we have better data
      await db.update(contacts)
        .set({
          fullName: contact.fullName,
          normalizedName: contact.normalizedName,
          nameConfidence: contact.nameConfidence,
          email: contact.email,
          normalizedEmail: contact.normalizedEmail,
          emailConfidence: contact.emailConfidence,
          phone: contact.phone,
          normalizedPhone: contact.normalizedPhone,
          phoneConfidence: contact.phoneConfidence,
          title: contact.title,
          titleConfidence: contact.titleConfidence,
          companyDomain: contact.companyDomain,
          employerName: contact.employerName,
          linkedinUrl: contact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          source: contact.source,
          contactRationale: contact.contactRationale,
          needsReview: contact.needsReview,
          reviewReason: contact.reviewReason,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, existingContact.id));
    } else {
      const [inserted] = await db.insert(contacts)
        .values({
          id: contact.id,
          fullName: contact.fullName,
          normalizedName: contact.normalizedName,
          nameConfidence: contact.nameConfidence,
          email: contact.email,
          normalizedEmail: contact.normalizedEmail,
          emailConfidence: contact.emailConfidence,
          phone: contact.phone,
          normalizedPhone: contact.normalizedPhone,
          phoneConfidence: contact.phoneConfidence,
          title: contact.title,
          titleConfidence: contact.titleConfidence,
          companyDomain: contact.companyDomain,
          employerName: contact.employerName,
          linkedinUrl: contact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          source: contact.source,
          contactRationale: contact.contactRationale,
          needsReview: contact.needsReview,
          reviewReason: contact.reviewReason,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      contactId = inserted?.id || contact.id;
    }
    contactIds.push(contactId);

    // Link to property
    await db.insert(propertyContacts)
      .values({
        propertyId,
        contactId,
        role: contact.role,
        confidenceScore: contact.roleConfidence,
        discoveredAt: new Date(),
      })
      .onConflictDoNothing();
  }

  console.log(`[Enrichment] Stored ${contactIds.length} contacts`);
  console.log(`[Enrichment] Enrichment complete for property: ${aggregatedProperty.propertyKey}`);

  return { propertyId, contactIds, orgIds };
}

// Combined function to enrich and store
export async function enrichAndStoreProperty(
  aggregatedProperty: AggregatedProperty
): Promise<{ result: EnrichmentResult; stored: { propertyId: string; contactIds: string[]; orgIds: string[] } | null }> {
  const result = await enrichProperty(aggregatedProperty);
  
  if (!result.success) {
    return { result, stored: null };
  }

  const stored = await storeEnrichmentResults(aggregatedProperty, result);
  return { result, stored };
}
