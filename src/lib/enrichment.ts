import { GoogleGenAI } from "@google/genai";
import { v5 as uuidv5 } from "uuid";
import { db } from "./db";
import { properties, contacts, organizations, propertyContacts, propertyOrganizations, contactOrganizations } from "./schema";
import { eq, and } from "drizzle-orm";
import type { AggregatedProperty } from "./snowflake";
import { findEmail } from "./hunter";
import { validateEmail as validateEmailNeverbounce } from "./neverbounce";
import { validateEmail as validateEmailZeroBounce } from "./zerobounce";
import { findContainingPlace } from "./google-places";
import { getProfilePicture } from "./enrichlayer";
import { enrichOrganizationByDomain } from "./organization-enrichment";
import { enrichPersonPDL, enrichCompanyPDL } from "./pdl";
import { enrichPersonApollo } from "./apollo";
import { lookupPerson as lookupPersonEnrichLayer } from "./enrichlayer";
import { enrichContactCascade, ContactEnrichmentInput } from "./cascade-enrichment";
import pLimit from "p-limit";
import { CONCURRENCY, GEMINI_MODEL } from "./constants";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// @ts-ignore - name-match has no type declarations  
const nameMatch = require("name-match");
const { isMatch: nameLibMatch, NameNormalizer } = nameMatch;

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
  parsedName: string;
  parsedTitle: string;
  parsedCompany: string;
  matchDetails: {
    nameMatch: boolean;
    companyMatch: boolean;
    titleMatch: boolean;
    locationMatch: boolean;
  };
}

export interface LinkedInSearchResult {
  name: string;
  title: string;
  url: string;
  company?: string;
  location?: string;
  confidence: number;
}

export interface LinkedInSearchResponse {
  linkedinUrl: string | null;
  confidence: number;
  allResults: LinkedInSearchResult[];
}

// Common personal email providers - emails from these domains should trigger further enrichment
const PERSONAL_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ca',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'mail.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'gmx.net',
  'tutanota.com',
  'fastmail.com',
  'hey.com',
]);

/**
 * Check if an email is from a personal email provider (gmail, yahoo, outlook, etc.)
 * These emails are valid but don't tell us about the company, so we should still try to enrich
 */
export function isPersonalEmailProvider(email: string): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1];
  return domain ? PERSONAL_EMAIL_PROVIDERS.has(domain) : false;
}

// Email validation using ZeroBounce (preferred) or NeverBounce fallback
// Treats catch-all as invalid per requirements
async function validateEmail(email: string): Promise<{
  isValid: boolean;
  confidence: number;
  status: 'valid' | 'invalid' | 'disposable' | 'catchall' | 'unknown';
  details?: any;
}> {
  // Try ZeroBounce first if configured
  if (process.env.ZEROBOUNCE_API_KEY) {
    try {
      const result = await validateEmailZeroBounce(email);
      // Treat catch-all as INVALID per requirements
      const isValid = result.status === 'valid';
      const statusMap: Record<string, 'valid' | 'invalid' | 'catchall' | 'unknown'> = {
        'valid': 'valid',
        'invalid': 'invalid',
        'catch-all': 'catchall', // Treat as invalid
        'unknown': 'unknown',
      };
      const normalizedStatus = statusMap[result.status] || 'unknown';
      
      console.log(`[EmailValidation] ZeroBounce: ${email} -> ${result.status} (valid=${isValid})`);
      return {
        isValid,
        confidence: isValid ? 0.95 : 0,
        status: normalizedStatus,
        details: result.raw,
      };
    } catch (error) {
      console.warn('[EmailValidation] ZeroBounce failed, trying NeverBounce fallback:', error);
    }
  }
  
  // Fallback to NeverBounce
  if (process.env.NEVERBOUNCE_API_KEY) {
    try {
      const result = await validateEmailNeverbounce(email);
      // Also treat catch-all as invalid for NeverBounce
      const isValid = result.status === 'valid';
      
      console.log(`[EmailValidation] NeverBounce: ${email} -> ${result.status} (valid=${isValid})`);
      return {
        isValid,
        confidence: result.confidence,
        status: result.status,
        details: result.details,
      };
    } catch (error) {
      console.warn('[EmailValidation] NeverBounce failed:', error);
    }
  }
  
  // No validation service available
  console.warn('[EmailValidation] No validation service configured');
  return {
    isValid: false,
    confidence: 0,
    status: 'unknown',
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
  
  // Parse name from LinkedIn title (format: "Name - Title - Company | LinkedIn")
  let parsedName = '';
  let parsedTitle = '';
  let parsedCompany = '';
  
  // LinkedIn title format: "FirstName LastName - Title at Company | LinkedIn"
  const titleParts = item.title.replace(' | LinkedIn', '').split(' - ');
  if (titleParts.length >= 1) {
    parsedName = titleParts[0].trim();
  }
  if (titleParts.length >= 2) {
    // Could be "Title at Company" or just "Title"
    const titleAtCompany = titleParts.slice(1).join(' - ');
    const atMatch = titleAtCompany.match(/(.+?)\s+at\s+(.+)/i);
    if (atMatch) {
      parsedTitle = atMatch[1].trim();
      parsedCompany = atMatch[2].trim();
    } else {
      parsedTitle = titleAtCompany.trim();
    }
  }
  
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
    parsedName: parsedName || params.name,
    parsedTitle,
    parsedCompany,
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

import { ASSET_CATEGORIES, CONFIDENCE } from "./constants";
export { ASSET_CATEGORIES, CONFIDENCE };

// Interfaces for enrichment results
export interface EnrichedContact {
  id: string;
  fullName: string;
  normalizedName: string;
  nameConfidence: number;
  email: string | null;
  normalizedEmail: string | null;
  emailConfidence: number | null;
  emailSource: 'ai_discovered' | 'hunter' | null;
  emailValidated: boolean;
  phone: string | null;
  normalizedPhone: string | null;
  phoneConfidence: number | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneSource: 'ai' | 'enrichment' | null;
  aiPhone: string | null;
  aiPhoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  aiPhoneConfidence: number | null;
  enrichmentPhoneWork: string | null;
  enrichmentPhonePersonal: string | null;
  title: string | null;
  titleConfidence: number | null;
  companyDomain: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinConfidence: number | null;
  location: string | null;
  role: string;
  roleConfidence: number;
  contactType: 'individual' | 'general';
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
  description?: string;
  linkedinHandle?: string;
  industry?: string;
  employees?: number;
  employeesRange?: string;
  city?: string;
  state?: string;
  pdlEnriched?: boolean;
}

export interface EnrichmentSource {
  id: number;
  title: string;
  url: string;
  type: string;
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
  enrichmentSources: EnrichmentSource[] | null;
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

  return `You are a commercial real estate data analyst helping sales representatives identify decision-makers for commercial properties. Your PRIMARY goal is ACCURACY over completeness - it is better to return fewer high-confidence results than many uncertain ones.

## CRITICAL: Anti-Hallucination Rules

Before you begin, internalize these rules:

1. NEVER include information you cannot trace to a specific, dated source
2. NEVER conflate this property with similarly-named or nearby properties
3. NEVER include contacts from sources older than 2 years (before January 2024) unless explicitly noting staleness
4. PREFER "null" or empty arrays over plausible guesses
5. When uncertain, lower confidence scores significantly (below 0.5 means "do not include")
6. For every contact, ask: "Can I prove this person is connected to THIS property TODAY?"

---

## Input: Property Data

**Location**
- Address: ${property.address}, ${property.city}, ${property.state} ${property.zip}
- County: ${property.county}
- Coordinates: ${property.lat}, ${property.lon}

**Physical Characteristics**
- Lot Size: ${property.lotSqft?.toLocaleString() || 'Unknown'} sq ft
- Leasable Area: ${property.buildingSqft?.toLocaleString() || 'Unknown'} sq ft (excludes parking)
- Year Built: ${property.yearBuilt || 'Unknown'}
- Floors: ${property.numFloors || 'Unknown'}

**Ownership**
- Primary Owner: ${property.primaryOwner || 'Unknown'}
- All Owners: ${property.allOwners?.join(', ') || 'Unknown'}

**Land Use**
- Use Descriptions: ${property.usedesc?.join(', ') || 'Unknown'}
- Use Codes: ${property.usecode?.join(', ') || 'Unknown'}

**Valuation**
- Total Parcel Value: $${property.totalParval?.toLocaleString() || 0}
- Total Improvement Value: $${property.totalImprovval?.toLocaleString() || 0}
- Land Value: $${property.landval?.toLocaleString() || 0}

**Raw Parcel Data**
${JSON.stringify(property.rawParcelsJson?.slice(0, 5) || [], null, 2)}

---

## Step 1: Property Verification (REQUIRED FIRST)

Before any analysis, you MUST verify you have identified the correct property:

1. **Address Confirmation**: Verify the exact address exists and matches the coordinates
2. **Cross-Reference**: Find at least 2 independent sources confirming this property
3. **Disambiguation**: If similar properties exist (same name elsewhere, nearby addresses), explicitly note them and confirm you are analyzing the CORRECT one
4. **Red Flags**: If sources conflict or you cannot confidently verify, set \`property_verified: false\`

DO NOT proceed with contact discovery if you cannot verify the property.

---

## Step 2: Property Classification

**Asset Categories** (use these exact values):
${categoryList}

**Understanding Building Class vs Category**

| Concept | Meaning | Determined By |
|---------|---------|---------------|
| Asset Category/Subcategory | WHAT the property IS (use type) | Zoning, tenant mix, building design, actual use |
| Building Class (A/B/C/D) | QUALITY GRADE within that category | Age, location, condition, rents, amenities |

**Building Class Definitions**:
- **Class A**: Premium, newest, best location, highest rents, institutional quality
- **Class B**: Good quality, well-maintained, competitive rents, solid tenants  
- **Class C**: Older, functional, lower rents, may need updates, value-add opportunity
- **Class D**: Distressed, significant deferred maintenance, highest risk

---

## Step 3: Contact Discovery

**Purpose**: Identify WHO to contact about this property for sales outreach.

**Priority Order**:
1. Site-level operations (property manager, facilities manager for THIS property)
2. Management company contacts (if third-party managed)
3. Asset managers overseeing this property
4. Owners and principals (current, active individuals only)
5. Leasing agents and brokers
6. Other stakeholders

**Target**: 5-10 contacts maximum. Quality over quantity.

### Contact Detail Rules

**ALWAYS set these fields to null** - they will be enriched later via a dedicated data service:
- \`email\`: ALWAYS null (do not guess or infer email addresses)
- \`linkedin_url\`: ALWAYS null (do not guess or construct LinkedIn URLs)
- \`email_confidence\`, \`linkedin_confidence\`: ALWAYS null

**Phone Numbers - CAPTURE when found in reliable sources**:
- \`phone\`: Capture phone numbers ONLY if found in official/reliable sources (company websites, property listings, business directories)
- \`phone_label\`: Classify as one of: "direct_work" (direct line), "office" (general office/company line), "personal", "mobile"
- \`phone_confidence\`: 0.0-1.0 based on source reliability

**Phone Number Priority (highest to lowest)**:
1. Direct work line for this person at this property
2. Direct work line for this person at their company
3. Property office/leasing office line
4. General company office line
5. Personal/mobile (least preferred for business context)

**DO NOT include phone numbers that are**:
- Clearly outdated (>2 years old)
- Personal cell phones without business context
- Main corporate switchboard numbers for large companies

**DO capture these fields** from your research:
- \`full_name\`: The person's full name
- \`title\`: Their job title at their company
- \`employer_name\`: The company they work for
- \`company_domain\`: The company's website domain (e.g., "lincolnproperty.com")
- \`role\`: Their relationship to THIS property
- \`contact_rationale\`: Why they are relevant to this property

Email and LinkedIn will be populated by a separate enrichment service. Your job is to identify the RIGHT people with accurate names, titles, company affiliations, and phone numbers when available.

### Source Freshness Requirements

| Source Age | Action |
|------------|--------|
| < 6 months | Use normally, mark as "current" |
| 6 months - 2 years | Use with caution, note the date |
| > 2 years | DO NOT USE for contacts unless no alternative exists; if used, set confidence < 0.5 |
| Unknown date | Treat as potentially stale, confidence < 0.6 |

For EACH contact, you must be able to answer: **"What dated source confirms this person is in this role TODAY?"**

### Negative Verification (Required)

Before including any contact, verify they have NOT:
- Left the company (check for departure announcements, LinkedIn changes)
- Changed roles significantly
- Passed away
- Been removed due to litigation/scandal

Note in rationale: "No departure found as of [date checked]" or flag if uncertain.

### Title vs Role Distinction

| Field | Meaning | Example |
|-------|---------|---------|
| \`title\` | Their job at their employer | "Senior Property Manager at ABC Realty" |
| \`role\` | Their relationship to THIS property | "property_manager" (because ABC Realty manages this building) |

**Valid role values**: \`property_manager\`, \`facilities_manager\`, \`owner\`, \`leasing\`, \`other\`

---

## Step 4: Exclusion Rules

### DO NOT Include:

**Condo Owners / HOA Members**:
- Individual condo unit owners (even if in ownership records)
- HOA board members (unless commercial/mixed-use HOA)
- Individual apartment tenants
- Residential homeowners owning units in larger commercial property

**Indicators of Condo/HOA Structure**:
- Owner names like "UNIT 101", "APT 5B"
- Multiple individual owners with small percentages
- Property type "Condominium" with individual unit owners

**Instead, Find**:
- HOA management company (for commercial decisions)
- Building developer or institutional owner
- Property management company for entire building
- Master association contacts

### DO NOT Include Contacts Where:

- Only source is > 2 years old
- Cannot verify current employment
- Connection to THIS property is unclear
- Confidence would be below 0.5

---

## Output Schema

Return ONLY valid JSON matching this structure:
{
  "verification": {
    "property_verified": true,
    "verification_method": "Matched address to county records [1] and property listing [2]",
    "address_exact_match": true,
    "potential_conflicts": ["Similar property at 123 Main St in different city - confirmed this is the Dallas location"],
    "verification_sources": [1, 2]
  },
  
  "property": {
    "validated_address": "Full validated address or null",
    "validated_address_confidence": 0.0-1.0,
    
    "asset_category": "One of the main categories",
    "asset_subcategory": "Subcategory for that category", 
    "category_confidence": 0.0-1.0,
    "category_rationale": "Evidence-based explanation with source citations [1]",
    
    "property_class": "A, B, C, or D",
    "property_class_rationale": "Evidence-based explanation with source citations [1]",
    
    "common_name": "Building name if known, else null",
    "common_name_confidence": 0.0-1.0,
    
    "beneficial_owner": "True beneficial owner if different from registered",
    "beneficial_owner_confidence": 0.0-1.0,
    "beneficial_owner_type": "individual | corporation | llc | trust | government | other",
    
    "management_type": "self_managed | third_party | owner_operator",
    "management_company": "Name if applicable",
    "management_company_domain": "domain.com if known",
    "management_confidence": 0.0-1.0,
    
    "property_website": "URL if known",
    "property_manager_website": "URL if known",
    
    "building_sqft": null,
    "building_sqft_confidence": 0.0-1.0,
    "building_sqft_source": "county records | property listing | estimated",
    
    "lot_sqft": null,
    "lot_sqft_confidence": 0.0-1.0,
    "lot_sqft_source": "county records | parcel data | estimated"
  },
  
  "contacts": [
    {
      "full_name": "Contact name",
      "name_confidence": 0.0-1.0,
      
      "email": null,
      "email_confidence": null,
      "phone": "+1-555-123-4567 or null if not found",
      "phone_label": "direct_work | office | personal | mobile | null",
      "phone_confidence": 0.0-1.0,
      "linkedin_url": null,
      "linkedin_confidence": null,
      
      "title": "Job title at their company",
      "title_confidence": 0.0-1.0,
      "employer_name": "Company Name",
      "company_domain": "company.com",
      
      "location": "City, State (e.g., Dallas, TX) - REQUIRED: Use property location if contact location unknown",
      
      "role": "property_manager | facilities_manager | owner | leasing | other",
      "role_confidence": 0.0-1.0,
      "priority_rank": 1,
      
      "source_date": "2024-06",
      "freshness": "current | recent | stale | unknown",
      
      "contact_rationale": "REQUIRED: 2-4 sentences with [source citations]. Must include: (1) WHERE you found them, (2) WHY they're relevant to THIS property, (3) verification of current status, (4) why this priority rank.",
      "negative_verification": "No departure or role change found as of [date] | Could not verify current status | [specific concern]"
    }
  ],
  
  "organizations": [
    {
      "name": "Organization name",
      "domain": "organization.com or null",
      "org_type": "owner | management | tenant | developer | other",
      "roles": ["property_manager", "owner"],
      "relationship_verified": true,
      "verification_source": 1
    }
  ],
  
  "sources": [
    {
      "id": 1,
      "title": "Source title",
      "url": "https://actual-url.com",
      "type": "county_records | company_website | property_listing | linkedin | news | sec_filing | other",
      "access_date": "2025-01-22",
      "source_date": "2024-06 | null if unknown",
      "freshness": "current | recent | stale | unknown"
    }
  ],
  
  "summary": "300-500 words with [source citations] throughout. Include: (1) Property overview and verification, (2) Ownership structure, (3) Management situation, (4) Contact prioritization rationale, (5) Data quality notes and any limitations.",
  
  "data_quality": {
    "overall_confidence": "high | medium | low",
    "limitations": ["List any data gaps or concerns"],
    "stale_data_warnings": ["Any contacts or facts from older sources"],
    "recommendation": "Suggested next steps if data quality is low"
  }
}

---

## Confidence Score Guidelines

| Score | Meaning | When to Use |
|-------|---------|-------------|
| 0.90-1.0 | Very certain | Clear, recent, primary source evidence |
| 0.70-0.89 | Reasonably confident | Good evidence with minor uncertainty |
| 0.50-0.69 | Uncertain | Limited or older evidence |
| Below 0.50 | Do not include | Insufficient evidence - omit this data |

**When in doubt, round DOWN on confidence.**

---

## Final Checklist (Self-Verify Before Returning)

Before returning your response, confirm:

- [ ] Property is verified with 2+ sources
- [ ] No contacts from sources older than 2 years (unless flagged)
- [ ] Every contact has a dated source citation
- [ ] No condo owners or HOA members included
- [ ] All confidence scores are justified
- [ ] Title vs Role distinction is correct for each contact
- [ ] Negative verification completed for each contact
- [ ] Summary includes source citations throughout
- [ ] Data quality section notes any limitations honestly

Return ONLY valid JSON. No markdown formatting, no code blocks.`;
}

// Extract grounding sources from Gemini response metadata
// These are verified URLs from Google Search, not AI-generated URLs which can be hallucinated
function extractGroundingSources(response: any): Array<{ id: number; title: string; url: string; type: string }> {
  try {
    // Access grounding metadata from the response
    // The structure varies slightly between SDK versions - try multiple paths
    const candidates = response.candidates || response.response?.candidates || [];
    if (candidates.length === 0) {
      console.log('[Enrichment] No candidates in response, keys available:', Object.keys(response || {}));
      return [];
    }
    
    const candidate = candidates[0];
    const groundingMetadata = candidate.groundingMetadata || candidate.grounding_metadata;
    
    if (!groundingMetadata) {
      console.log('[Enrichment] No grounding metadata in candidate, keys available:', Object.keys(candidate || {}));
      return [];
    }
    
    // Extract grounding chunks (the actual source URLs)
    const groundingChunks = groundingMetadata.groundingChunks || groundingMetadata.grounding_chunks || [];
    
    if (groundingChunks.length === 0) {
      console.log('[Enrichment] No grounding chunks in metadata, keys available:', Object.keys(groundingMetadata || {}));
      return [];
    }
    
    // Convert to our source format - process each chunk independently to handle errors
    const sources: Array<{ id: number; title: string; url: string; type: string }> = [];
    let currentId = 1;
    
    for (const chunk of groundingChunks) {
      try {
        const web = chunk.web || chunk;
        const uri = web.uri || web.url || '';
        const title = web.title || '';
        
        // Skip chunks without valid URLs
        if (!uri || typeof uri !== 'string' || !uri.startsWith('http')) {
          console.log(`[Enrichment] Skipping invalid grounding chunk:`, chunk);
          continue;
        }
        
        // Determine source type from URL
        let type = 'other';
        if (uri.includes('linkedin.com')) type = 'linkedin';
        else if (uri.includes('loopnet.com') || uri.includes('crexi.com') || uri.includes('costar.com')) type = 'property_listing';
        else if (uri.includes('appraisal') || uri.includes('cad.org') || uri.includes('county')) type = 'county_records';
        else if (uri.includes('sec.gov')) type = 'sec_filing';
        else if (uri.includes('news') || uri.includes('dallasnews') || uri.includes('bizjournals')) type = 'news';
        else if (uri.includes('.com') || uri.includes('.org')) type = 'company_website';
        
        // Extract hostname safely for title fallback
        let displayTitle = title;
        if (!displayTitle) {
          try {
            displayTitle = new URL(uri).hostname.replace('www.', '');
          } catch {
            displayTitle = uri.slice(0, 50);
          }
        }
        
        sources.push({
          id: currentId++,
          title: displayTitle,
          url: uri,
          type,
        });
      } catch (chunkError) {
        console.warn('[Enrichment] Error processing grounding chunk:', chunkError);
        // Continue to next chunk instead of failing entirely
      }
    }
    
    if (sources.length > 0) {
      console.log(`[Enrichment] Extracted ${sources.length} grounding sources:`, sources.map(s => s.url));
    } else {
      console.log('[Enrichment] No valid grounding sources extracted from', groundingChunks.length, 'chunks');
    }
    
    return sources;
  } catch (error) {
    console.warn('[Enrichment] Error extracting grounding sources:', error);
    return [];
  }
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
  
  // Use the comprehensive summary if available, otherwise build from individual rationales
  let aiRationale = rawResponse.summary || '';
  if (!aiRationale) {
    // Fallback to building combined rationale from individual fields
    aiRationale = prop.classification_rationale || '';
    if (prop.category_rationale && !aiRationale.includes(prop.category_rationale)) {
      aiRationale = `Category: ${prop.category_rationale}`;
    }
    if (prop.property_class_rationale) {
      aiRationale = aiRationale 
        ? `${aiRationale} | Class: ${prop.property_class_rationale}`
        : `Class: ${prop.property_class_rationale}`;
    }
  }

  // Parse sources from the response
  const enrichmentSources: EnrichmentSource[] | null = rawResponse.sources 
    ? rawResponse.sources.map((s: any) => ({
        id: s.id,
        title: s.title || '',
        url: s.url || '',
        type: s.type || 'other',
      }))
    : null;

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
    aiRationale: aiRationale || null,
    enrichmentSources,
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
      
      const aiPhone = c.phone || null;
      const aiPhoneLabel = c.phone_label || null;
      const aiPhoneConfidence = c.phone_confidence || null;
      
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
        email: c.email ? normalizeEmail(c.email) : null,
        normalizedEmail: c.email ? normalizeEmail(c.email) : null,
        emailConfidence: c.email_confidence || null,
        emailSource: c.email ? 'ai_discovered' : null,
        emailValidated: false,
        phone: aiPhone,
        normalizedPhone: aiPhone ? normalizePhone(aiPhone) : null,
        phoneConfidence: aiPhoneConfidence,
        phoneLabel: aiPhoneLabel,
        phoneSource: aiPhone ? 'ai' : null,
        aiPhone,
        aiPhoneLabel,
        aiPhoneConfidence,
        enrichmentPhoneWork: null,
        enrichmentPhonePersonal: null,
        title: c.title || null,
        titleConfidence: c.title_confidence || null,
        companyDomain: c.company_domain || null,
        employerName: c.employer_name || null,
        linkedinUrl: c.linkedin_url || null,
        linkedinConfidence: c.linkedin_confidence || null,
        location: c.location || null,
        role: c.role || 'other',
        roleConfidence: c.role_confidence || 0.5,
        contactType: c.contact_type === 'general' ? 'general' as const : 'individual' as const,
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

// Enrich contacts with emails using Hunter.io (email finder) + NeverBounce (validation)
// Also validates AI-discovered emails with NeverBounce
export async function enrichContactsWithEmail(contacts: EnrichedContact[]): Promise<EnrichedContact[]> {
  console.log(`[Enrichment] Enriching ${contacts.length} contacts with email discovery...`);
  
  const enrichedContacts: EnrichedContact[] = [];
  
  for (let contact of contacts) {
    // If AI already discovered an email, validate it with NeverBounce
    if (contact.email && contact.emailSource === 'ai_discovered' && !contact.emailValidated) {
      console.log(`[Enrichment] Validating AI-discovered email for ${contact.fullName}: ${contact.email}`);
      try {
        const validationResult = await validateEmail(contact.email);
        
        if (validationResult.isValid) {
          console.log(`[Enrichment] AI email validated as ${validationResult.status}`);
          enrichedContacts.push({
            ...contact,
            emailConfidence: validationResult.confidence,
            emailValidated: true,
          });
          continue;
        } else {
          console.log(`[Enrichment] AI email validation failed: ${validationResult.status}, will try Hunter.io`);
          // Clear invalid email, fall through to Hunter.io discovery
          contact = {
            ...contact,
            email: null,
            normalizedEmail: null,
            emailConfidence: null,
            emailSource: null,
            emailValidated: false,
          };
          // Don't continue - fall through to Hunter.io lookup below
        }
      } catch (error) {
        console.error(`[Enrichment] Error validating AI email for ${contact.fullName}:`, error);
        // Fall through to try Hunter.io
        contact = {
          ...contact,
          email: null,
          normalizedEmail: null,
          emailConfidence: null,
          emailSource: null,
          emailValidated: false,
        };
      }
    }
    
    // If contact already has a validated email, skip
    if (contact.email && contact.emailValidated) {
      enrichedContacts.push(contact);
      continue;
    }
    
    // No email - try Hunter.io if we have a company domain
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
      
      if (findResult.email && findResult.confidence > 0.5) {
        console.log(`[Enrichment] Found email ${findResult.email} with confidence ${findResult.confidence}`);
        
        const validationResult = await validateEmail(findResult.email);
        
        if (validationResult.isValid) {
          console.log(`[Enrichment] Email validated as ${validationResult.status}`);
          enrichedContacts.push({
            ...contact,
            email: findResult.email.toLowerCase().trim(),
            normalizedEmail: findResult.email.toLowerCase().trim(),
            emailConfidence: validationResult.confidence,
            emailSource: 'hunter',
            emailValidated: true,
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
  
  const emailsFound = enrichedContacts.filter(c => c.email && c.emailValidated).length;
  console.log(`[Enrichment] Email enrichment complete: ${emailsFound}/${contacts.length} contacts have validated emails`);
  
  return enrichedContacts;
}

// New PDL-based enrichment flow:
// 1. Check if contact already exists (by email + name)
// 2. Validate email with NeverBounce
// 3. If valid → use SERP for LinkedIn → stop
// 4. If invalid → use PDL for person enrichment with strict matching
// 5. Compare employer domain from PDL vs AI and flag if mismatch
export async function enrichContactWithPDL(
  contact: EnrichedContact,
  aiDomain: string | null,
  propertyCity: string
): Promise<{ contact: EnrichedContact; relationshipConfidence: string; relationshipNote: string | null }> {
  console.log(`[Contact Enrichment] Processing contact: ${contact.fullName} (email: ${contact.email || 'none'})`);
  
  let relationshipConfidence = 'high';
  let relationshipNote: string | null = null;
  
  // Step 1: Check if contact already exists in database
  if (contact.email) {
    const normalizedEmail = contact.email.toLowerCase().trim();
    const [existingContact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.normalizedEmail, normalizedEmail))
      .limit(1);
    
    if (existingContact) {
      console.log(`[Contact Enrichment] Contact already exists in database: ${existingContact.fullName}`);
      return {
        contact: {
          ...contact,
          id: existingContact.id,
          linkedinUrl: existingContact.linkedinUrl || contact.linkedinUrl,
          linkedinConfidence: existingContact.linkedinConfidence || contact.linkedinConfidence,
          title: existingContact.title || contact.title,
          employerName: existingContact.employerName || contact.employerName,
          companyDomain: existingContact.companyDomain || contact.companyDomain,
          emailValidated: true,
        },
        relationshipConfidence: 'high',
        relationshipNote: null,
      };
    }
  }
  
  // Step 2: Validate email with ZeroBounce/NeverBounce if present
  let hasPersonalEmail = false;
  if (contact.email && !contact.emailValidated) {
    console.log(`[Contact Enrichment] Validating email: ${contact.email}`);
    hasPersonalEmail = isPersonalEmailProvider(contact.email);
    
    try {
      const validationResult = await validateEmail(contact.email);
      
      if (validationResult.isValid) {
        // Check if it's a personal email provider - if so, we still want to enrich
        if (hasPersonalEmail) {
          console.log(`[Contact Enrichment] Email valid but personal provider (${contact.email.split('@')[1]}), will continue enrichment for company data`);
          // Keep the email but continue to cascade enrichment
          contact = {
            ...contact,
            emailConfidence: validationResult.confidence,
            emailValidated: true,
          };
          // Don't return - continue to cascade enrichment to find company email/info
        } else {
          console.log(`[Contact Enrichment] Email valid (${validationResult.status}), using SERP for LinkedIn`);
          
          // Step 3: Email is valid business email - use SERP for LinkedIn and stop
          // LinkedIn lookup will happen in enrichContactsWithLinkedIn
          return {
            contact: {
              ...contact,
              emailConfidence: validationResult.confidence,
              emailValidated: true,
            },
            relationshipConfidence: 'high',
            relationshipNote: null,
          };
        }
      } else {
        console.log(`[Contact Enrichment] Email invalid (${validationResult.status}), falling back to cascade`);
        // Clear invalid email
        contact = {
          ...contact,
          email: null,
          normalizedEmail: null,
          emailConfidence: null,
          emailValidated: false,
        };
      }
    } catch (error) {
      console.error(`[Contact Enrichment] Email validation error:`, error);
      // Continue to cascade fallback
    }
  }
  
  // Step 4: Email invalid or missing - use cascade: Apollo → EnrichLayer → PDL
  const domainForEnrichment = contact.companyDomain || aiDomain;
  const { firstName, lastName } = parseNameParts(contact.fullName);
  
  if (firstName && lastName && domainForEnrichment) {
    console.log(`[Cascade Enrichment] Searching for ${firstName} ${lastName} at ${domainForEnrichment}`);
    
    // Try Apollo first
    try {
      console.log(`[Cascade Enrichment] Trying Apollo.io...`);
      const apolloResult = await enrichPersonApollo(firstName, lastName, domainForEnrichment, {
        revealEmails: true,
        revealPhone: true,
      });
      
      if (apolloResult.found && (apolloResult.linkedinUrl || apolloResult.email || apolloResult.title)) {
        console.log(`[Cascade Enrichment] Apollo found: ${apolloResult.fullName}`);
        
        // Validate Apollo email
        let apolloEmailValid = false;
        if (apolloResult.email) {
          const validation = await validateEmail(apolloResult.email);
          apolloEmailValid = validation.isValid;
        }
        
        return {
          contact: {
            ...contact,
            email: apolloEmailValid ? apolloResult.email : contact.email,
            normalizedEmail: apolloEmailValid && apolloResult.email ? apolloResult.email.toLowerCase().trim() : contact.normalizedEmail,
            emailConfidence: apolloEmailValid ? 0.9 : contact.emailConfidence,
            emailSource: apolloEmailValid ? 'apollo' : contact.emailSource,
            emailValidated: apolloEmailValid,
            linkedinUrl: apolloResult.linkedinUrl || contact.linkedinUrl,
            linkedinConfidence: apolloResult.linkedinUrl ? 0.95 : contact.linkedinConfidence,
            title: apolloResult.title || contact.title,
            employerName: apolloResult.company || contact.employerName,
            companyDomain: apolloResult.companyDomain || contact.companyDomain,
            enrichmentSource: 'apollo',
            providerId: apolloResult.raw?.person?.id || null,
          } as EnrichedContact & { enrichmentSource?: string; providerId?: string },
          relationshipConfidence: 'high',
          relationshipNote: null,
        };
      }
    } catch (error) {
      console.warn(`[Cascade Enrichment] Apollo failed:`, error);
    }
    
    // Try EnrichLayer second
    try {
      console.log(`[Cascade Enrichment] Trying EnrichLayer...`);
      const elResult = await lookupPersonEnrichLayer({
        firstName,
        lastName,
        companyDomain: domainForEnrichment,
        title: contact.title || undefined,
        location: propertyCity || undefined,
      });
      
      if (elResult.success && (elResult.linkedinUrl || elResult.email)) {
        console.log(`[Cascade Enrichment] EnrichLayer found: ${elResult.fullName || contact.fullName}`);
        
        // Validate EnrichLayer email
        let elEmailValid = false;
        if (elResult.email) {
          const validation = await validateEmail(elResult.email);
          elEmailValid = validation.isValid;
        }
        
        return {
          contact: {
            ...contact,
            email: elEmailValid ? elResult.email : contact.email,
            normalizedEmail: elEmailValid && elResult.email ? elResult.email.toLowerCase().trim() : contact.normalizedEmail,
            emailConfidence: elEmailValid ? 0.85 : contact.emailConfidence,
            emailSource: elEmailValid ? 'enrichlayer' : contact.emailSource,
            emailValidated: elEmailValid,
            linkedinUrl: elResult.linkedinUrl || contact.linkedinUrl,
            linkedinConfidence: elResult.linkedinUrl ? 0.9 : contact.linkedinConfidence,
            title: elResult.title || contact.title,
            employerName: elResult.company || contact.employerName,
            enrichmentSource: 'enrichlayer',
            providerId: elResult.linkedinUrl || null,
          } as EnrichedContact & { enrichmentSource?: string; providerId?: string },
          relationshipConfidence: 'high',
          relationshipNote: null,
        };
      }
    } catch (error) {
      console.warn(`[Cascade Enrichment] EnrichLayer failed:`, error);
    }
    
    // Try PDL last
    console.log(`[Cascade Enrichment] Trying PDL...`);
    const pdlResult = await enrichPersonPDL(firstName, lastName, domainForEnrichment, {
      location: propertyCity,
    });
    
    if (pdlResult.found) {
      console.log(`[Cascade Enrichment] PDL found person: ${pdlResult.fullName} (confidence: ${pdlResult.confidence})`);
      
      // Compare employer domain from PDL vs AI
      const pdlDomain = pdlResult.companyDomain;
      const expectedDomain = aiDomain || contact.companyDomain;
      
      let employerMismatch = false;
      if (pdlDomain && expectedDomain) {
        const normPdlDomain = pdlDomain.toLowerCase().replace(/^www\./, '');
        const normExpectedDomain = expectedDomain.toLowerCase().replace(/^www\./, '');
        employerMismatch = normPdlDomain !== normExpectedDomain;
      }
      
      if (employerMismatch) {
        console.log(`[Cascade Enrichment] Employer mismatch: PDL says ${pdlDomain}, AI says ${expectedDomain}`);
        relationshipConfidence = 'low';
        relationshipNote = `PDL employer (${pdlResult.companyName || pdlDomain}) differs from AI-discovered employer (${contact.employerName || expectedDomain})`;
      }
      
      // Only use PDL data if strict match (first name + last name + domain match)
      if (pdlResult.domainMatch) {
        return {
          contact: {
            ...contact,
            email: pdlResult.email || contact.email,
            normalizedEmail: pdlResult.email ? pdlResult.email.toLowerCase().trim() : contact.normalizedEmail,
            emailConfidence: pdlResult.email ? 0.85 : contact.emailConfidence,
            emailSource: pdlResult.email ? 'pdl' : contact.emailSource,
            emailValidated: !!pdlResult.email,
            linkedinUrl: pdlResult.linkedinUrl || contact.linkedinUrl,
            linkedinConfidence: pdlResult.linkedinUrl ? 0.9 : contact.linkedinConfidence,
            title: pdlResult.title || contact.title,
            employerName: employerMismatch ? contact.employerName : (pdlResult.companyName || contact.employerName),
            companyDomain: employerMismatch ? contact.companyDomain : (pdlResult.companyDomain || contact.companyDomain),
            pdlEnriched: true,
            pdlEmployerMismatch: employerMismatch,
            pdlEmployerName: pdlResult.companyName,
            pdlEmployerDomain: pdlResult.companyDomain,
            enrichmentSource: 'pdl',
            providerId: pdlResult.raw?.id || null,
          } as EnrichedContact & { pdlEnriched?: boolean; pdlEmployerMismatch?: boolean; pdlEmployerName?: string; pdlEmployerDomain?: string; enrichmentSource?: string; providerId?: string },
          relationshipConfidence,
          relationshipNote,
        };
      } else {
        console.log(`[Cascade Enrichment] PDL result does not pass strict matching (name+domain), skipping`);
      }
    } else {
      console.log(`[Cascade Enrichment] PDL did not find person`);
    }
  }
  
  return { contact, relationshipConfidence, relationshipNote };
}

// Enrich organization with PDL company data
export async function enrichOrganizationWithPDL(
  domain: string
): Promise<{
  name: string | null;
  displayName: string | null;
  description: string | null;
  website: string | null;
  linkedinHandle: string | null;
  industry: string | null;
  employees: number | null;
  employeesRange: string | null;
  city: string | null;
  state: string | null;
  pdlEnriched: boolean;
}> {
  console.log(`[PDL Enrichment] Enriching company: ${domain}`);
  
  const pdlResult = await enrichCompanyPDL(domain);
  
  if (!pdlResult.found) {
    console.log(`[PDL Enrichment] PDL did not find company: ${domain}`);
    return {
      name: null,
      displayName: null,
      description: null,
      website: null,
      linkedinHandle: null,
      industry: null,
      employees: null,
      employeesRange: null,
      city: null,
      state: null,
      pdlEnriched: false,
    };
  }
  
  console.log(`[PDL Enrichment] PDL found company: ${pdlResult.displayName || pdlResult.name}`);
  
  // Extract LinkedIn handle from URL if it's a full URL
  let linkedinHandle = pdlResult.linkedinUrl;
  if (linkedinHandle && linkedinHandle.includes('linkedin.com/company/')) {
    linkedinHandle = linkedinHandle.split('linkedin.com/company/')[1]?.replace(/\/$/, '') || linkedinHandle;
  }
  
  return {
    name: pdlResult.name,
    displayName: pdlResult.displayName,
    description: pdlResult.description,
    website: pdlResult.website,
    linkedinHandle,
    industry: pdlResult.industry,
    employees: pdlResult.employeeCount,
    employeesRange: pdlResult.employeeRange,
    city: pdlResult.city,
    state: pdlResult.state,
    pdlEnriched: true,
  };
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
// Returns best match and top 4 alternatives for user selection
export async function findLinkedInUrl(
  name: string,
  title: string | null,
  company: string | null,
  domain: string | null,
  city: string | null = null
): Promise<LinkedInSearchResponse> {
  try {
    const startTime = Date.now();
    
    // Build search query: name + company + city with site restriction to linkedin.com/in profiles only
    const searchTerms = [name, company, city].filter(Boolean).join(" ");
    const searchQuery = `site:linkedin.com/in ${searchTerms}`;
    console.log(`[Enrichment] LinkedIn search: "${searchQuery}" (validating with: title=${title || 'none'})`);
    
    const results = await serpApiSearch(searchQuery);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (!results || !results.items || results.items.length === 0) {
      console.log(`[Enrichment] SERP API returned no results (${elapsed}s)`);
      return { linkedinUrl: null, confidence: 0, allResults: [] };
    }
    
    // Log search results for debugging
    console.log(`[Enrichment] Found ${results.items.length} results (${elapsed}s):`);
    results.items.slice(0, 3).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.link} - "${item.title.substring(0, 50)}"`);
    });
    
    // Validate each result and collect all matches
    const searchParams: LinkedInSearchParams = { name, title, company, city };
    const allMatches: LinkedInMatch[] = [];
    
    for (const item of results.items) {
      const match = validateLinkedInResult(item, searchParams);
      if (match) {
        allMatches.push(match);
      }
    }
    
    // Sort by confidence and take top 4
    allMatches.sort((a, b) => b.confidence - a.confidence);
    const top4Matches = allMatches.slice(0, 4);
    
    // Convert to search result format for storage
    const allResults: LinkedInSearchResult[] = top4Matches.map(match => ({
      name: match.parsedName,
      title: match.parsedTitle || '',
      url: match.url,
      company: match.parsedCompany || undefined,
      location: match.matchDetails.locationMatch ? (city || undefined) : undefined,
      confidence: match.confidence,
    }));
    
    const bestMatch = top4Matches[0] || null;
    
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
      console.log(`[Enrichment] Returning ${allResults.length} total LinkedIn results for alternatives`);
      return { linkedinUrl: bestMatch.url, confidence: bestMatch.confidence, allResults };
    }
    
    console.log(`[Enrichment] No validated LinkedIn match for ${name} (${elapsed}s)`);
    return { linkedinUrl: null, confidence: 0, allResults };
  } catch (error) {
    console.error(`[Enrichment] Error finding LinkedIn for ${name}:`, error);
    return { linkedinUrl: null, confidence: 0, allResults: [] };
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
  
  const limit = pLimit(CONCURRENCY.SERP);
  
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

// Auto-validation flow for ALL contacts - runs enrichment on all contacts in parallel
export async function validateAllContacts(contacts: EnrichedContact[]): Promise<EnrichedContact[]> {
  console.log(`[Enrichment] Validating all ${contacts.length} contacts in parallel...`);
  
  if (contacts.length === 0) {
    return contacts;
  }
  
  const hunterLimit = pLimit(CONCURRENCY.HUNTER);
  const neverBounceLimit = pLimit(CONCURRENCY.NEVERBOUNCE);
  
  const validatedContacts = await Promise.all(
    contacts.map(contact =>
      hunterLimit(async () => {
        console.log(`[Enrichment] Validating contact: ${contact.fullName} (${contact.role})`);
        let updatedContact = { ...contact };
        
        try {
          // Try to find email via Hunter if missing and we have a domain
          if (!updatedContact.email && updatedContact.companyDomain) {
            const { firstName, lastName } = parseNameParts(updatedContact.fullName);
            
            if (firstName && lastName) {
              const findResult = await findEmail(firstName, lastName, updatedContact.companyDomain);
              
              if (findResult.email && findResult.confidence > 80) {
                console.log(`[Enrichment] Found email ${findResult.email} for contact ${contact.fullName}`);
                updatedContact.email = findResult.email.toLowerCase().trim();
                updatedContact.normalizedEmail = findResult.email.toLowerCase().trim();
                updatedContact.emailConfidence = findResult.confidence / 100;
              }
            } else {
              if (!updatedContact.needsReview) {
                updatedContact.needsReview = true;
                updatedContact.reviewReason = 'Contact with incomplete name - cannot search email';
              }
            }
          }
          
          // Validate email if present
          if (updatedContact.email) {
            const validationResult = await neverBounceLimit(() => validateEmail(updatedContact.email!));
            
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
            updatedContact.reviewReason = 'Contact missing all contact information';
          }
          
          return updatedContact;
        } catch (error) {
          console.error(`[Enrichment] Error validating contact ${contact.fullName}:`, error);
          return {
            ...contact,
            needsReview: true,
            reviewReason: `Contact validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      })
    )
  );
  
  const withContact = validatedContacts.filter(c => c.email || c.phone || c.linkedinUrl).length;
  console.log(`[Enrichment] Contact validation complete: ${withContact}/${contacts.length} have contact info`);
  
  return validatedContacts;
}

// Main enrichment function - uses focused multi-stage enrichment
export async function enrichProperty(aggregatedProperty: AggregatedProperty): Promise<EnrichmentResult> {
  console.log(`[Enrichment] Starting focused multi-stage enrichment for: ${aggregatedProperty.propertyKey}`);
  
  try {
    // Import focused enrichment dynamically to avoid circular dependencies
    const { runFocusedEnrichment } = await import('./ai-enrichment');
    
    // Convert AggregatedProperty to CommercialProperty format for focused enrichment
    const commercialProperty = {
      parcelId: aggregatedProperty.propertyKey,
      accountNum: (aggregatedProperty as any).dcad?.accountNum || aggregatedProperty.propertyKey,
      gisParcelId: (aggregatedProperty as any).dcad?.gisParcelId || null,
      sptdCode: (aggregatedProperty as any).dcad?.sptdCode || null,
      address: aggregatedProperty.address,
      city: aggregatedProperty.city,
      zip: aggregatedProperty.zip,
      lat: aggregatedProperty.lat,
      lon: aggregatedProperty.lon,
      usedesc: Array.isArray(aggregatedProperty.usedesc) ? aggregatedProperty.usedesc[0] : aggregatedProperty.usedesc,
      lotSqft: aggregatedProperty.lotSqft,
      lotAcres: aggregatedProperty.lotSqft ? aggregatedProperty.lotSqft / 43560 : null,
      bizName: (aggregatedProperty as any).dcad?.bizName || aggregatedProperty.primaryOwner,
      ownerName1: (aggregatedProperty as any).dcad?.ownerName1 || aggregatedProperty.primaryOwner,
      ownerName2: (aggregatedProperty as any).dcad?.ownerName2 || null,
      dcadTotalVal: aggregatedProperty.totalParval,
      totalGrossBldgArea: aggregatedProperty.buildingSqft,
      buildingCount: (aggregatedProperty as any).dcad?.buildingCount || 1,
      buildings: (aggregatedProperty as any).dcad?.buildings || [],
    };
    
    const focusedResult = await runFocusedEnrichment(commercialProperty as any);
    
    // Map focused enrichment results to legacy EnrichmentResult format
    const classification = focusedResult.classification?.data;
    const ownership = focusedResult.ownership?.data;
    const physical = focusedResult.physical?.data;
    const contactsData = focusedResult.contacts?.data;
    
    // Collect all sources from all stages and create a unified source list
    // First, build a deduplicated list with a mapping from (stage, local_index) -> global_index
    const allSources: Array<{ url: string; title: string }> = [];
    const urlToGlobalIndex = new Map<string, number>();
    
    // Stages in order: classification, ownership, contacts
    const stageSourceArrays = [
      focusedResult.classification?.sources || [],
      focusedResult.ownership?.sources || [],
      focusedResult.contacts?.sources || [],
    ];
    const stageSummaries = [
      focusedResult.classification?.summary || '',
      focusedResult.ownership?.summary || '',
      focusedResult.contacts?.summary || '',
    ];
    
    // Build mapping from (stageIndex, localSourceIndex) -> globalIndex
    // Sources are 1-indexed in summaries
    const stageLocalToGlobal: Map<string, number>[] = stageSourceArrays.map(() => new Map());
    
    for (let stageIdx = 0; stageIdx < stageSourceArrays.length; stageIdx++) {
      const sources = stageSourceArrays[stageIdx];
      for (let localIdx = 0; localIdx < sources.length; localIdx++) {
        const source = sources[localIdx];
        if (!source.url) continue;
        
        let globalIdx: number;
        if (urlToGlobalIndex.has(source.url)) {
          globalIdx = urlToGlobalIndex.get(source.url)!;
        } else {
          globalIdx = allSources.length + 1; // 1-indexed
          allSources.push(source);
          urlToGlobalIndex.set(source.url, globalIdx);
        }
        // Map local 1-indexed source to global 1-indexed
        stageLocalToGlobal[stageIdx].set(String(localIdx + 1), globalIdx);
      }
    }
    
    // Renumber citations in summaries using the stage-specific mapping
    const renumberCitations = (summary: string, mapping: Map<string, number>): string => {
      if (!summary) return '';
      // Match [1], [2], [9, 11], etc.
      return summary.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (match, nums) => {
        const ids = nums.split(/,\s*/).map((n: string) => n.trim());
        const renumbered = ids.map((id: string) => mapping.get(id) || id);
        return `[${renumbered.join(', ')}]`;
      });
    };
    
    // Build combined summary with renumbered citations
    const combinedSummary = stageSummaries
      .map((summary, idx) => renumberCitations(summary, stageLocalToGlobal[idx]))
      .filter(Boolean)
      .join('\n\n');
    
    const property = {
      validatedAddress: classification?.canonicalAddress || null,
      validatedAddressConfidence: classification?.confidence || null,
      geocodeConfidence: null,
      assetCategory: classification?.category || null,
      assetSubcategory: classification?.subcategory || null,
      categoryConfidence: classification?.confidence || null,
      categoryRationale: focusedResult.classification?.summary || null,
      propertyClass: classification?.propertyClass || null,
      propertyClassRationale: null,
      commonName: classification?.propertyName || null,
      commonNameConfidence: classification?.confidence || null,
      containingPlace: null,
      containingPlaceType: null,
      beneficialOwner: ownership?.beneficialOwner?.name || null,
      beneficialOwnerConfidence: ownership?.beneficialOwner?.confidence || null,
      beneficialOwnerType: ownership?.beneficialOwner?.type || null,
      managementType: ownership?.managementCompany?.name ? 'third_party' : 'self_managed',
      managementCompany: ownership?.managementCompany?.name || null,
      managementCompanyDomain: ownership?.managementCompany?.domain || null,
      managementConfidence: ownership?.managementCompany?.confidence || null,
      propertyWebsite: null,
      propertyManagerWebsite: ownership?.managementCompany?.domain ? `https://${ownership.managementCompany.domain}` : null,
      aiRationale: combinedSummary,
      enrichmentSources: allSources.map((s, i) => ({ id: i + 1, title: s.title, url: s.url, type: 'grounded' })),
      buildingSqft: null,
      buildingSqftConfidence: null,
      buildingSqftSource: null,
      lotSqft: null,
      lotSqftConfidence: null,
      lotSqftSource: null,
      // New AI physical data fields
      aiLotAcres: physical?.lotAcres || null,
      aiLotAcresConfidence: physical?.lotAcresConfidence || null,
      aiLotAcresRationale: focusedResult.physical?.summary || null,
      aiNetSqft: physical?.netSqft || null,
      aiNetSqftConfidence: physical?.netSqftConfidence || null,
      aiNetSqftRationale: focusedResult.physical?.summary || null,
    };
    
    // Map contacts to legacy format with required properties
    // Pass through AI-discovered emails for validation
    const enrichedContacts: EnrichedContact[] = (contactsData?.contacts || []).map((c, i) => {
      const aiPhone = (c as any).phone || null;
      const aiPhoneLabel = (c as any).phoneLabel || (c as any).phone_label || null;
      const aiPhoneConfidence = (c as any).phoneConfidence || (c as any).phone_confidence || null;
      return {
        id: uuidv5(`${aggregatedProperty.propertyKey}-contact-${c.name}-${i}`, '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
        fullName: c.name,
        normalizedName: c.name.toLowerCase().replace(/[^a-z\s]/g, '').trim(),
        nameConfidence: c.roleConfidence,
        email: c.email ? c.email.toLowerCase().trim() : null,
        normalizedEmail: c.email ? c.email.toLowerCase().trim() : null,
        emailConfidence: c.email ? 0.7 : null,
        emailSource: c.emailSource || null,
        emailValidated: false,
        phone: aiPhone,
        normalizedPhone: aiPhone ? aiPhone.replace(/[^0-9]/g, '') : null,
        phoneConfidence: aiPhoneConfidence,
        phoneLabel: aiPhoneLabel,
        phoneSource: aiPhone ? 'ai' : null,
        aiPhone,
        aiPhoneLabel,
        aiPhoneConfidence,
        enrichmentPhoneWork: null,
        enrichmentPhonePersonal: null,
        linkedinUrl: null,
        linkedinConfidence: null,
        title: c.title,
        titleConfidence: c.roleConfidence,
        employerName: c.company,
        companyDomain: c.companyDomain,
        location: `${aggregatedProperty.city}, ${aggregatedProperty.state || 'TX'}`,
        role: c.role || 'other',
        roleConfidence: c.roleConfidence,
        contactType: c.contactType || 'individual',
        contactRationale: focusedResult.contacts?.summary || null,
        source: 'focused_enrichment',
        needsReview: false,
        reviewReason: null,
      };
    });
    
    // Map organizations with required properties
    const enrichedOrgs: EnrichedOrganization[] = (contactsData?.organizations || []).map((o, i) => ({
      id: uuidv5(`${aggregatedProperty.propertyKey}-org-${o.name}-${i}`, '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
      name: o.name,
      domain: o.domain,
      orgType: o.orgType || 'other',
      roles: o.roles || [],
      relationshipVerified: true,
      verificationSource: 1,
    }));

    // Enrich contacts with new PDL-based flow
    // 1. Check if contact exists, 2. Validate with NeverBounce, 3. If valid use SERP, 4. If invalid use PDL
    const propertyCity = aggregatedProperty.city || 'Dallas';
    const aiDomain = ownership?.managementCompany?.domain || null;
    
    const contactsWithPDL: EnrichedContact[] = [];
    const relationshipData: Map<string, { confidence: string; note: string | null }> = new Map();
    
    for (const contact of enrichedContacts) {
      const result = await enrichContactWithPDL(contact, aiDomain, propertyCity);
      contactsWithPDL.push(result.contact);
      relationshipData.set(result.contact.id, { 
        confidence: result.relationshipConfidence, 
        note: result.relationshipNote 
      });
    }
    
    // Continue with LinkedIn enrichment for contacts that need it
    const contactsWithLinkedIn = await enrichContactsWithLinkedIn(contactsWithPDL);
    const validatedContacts = await validateAllContacts(contactsWithLinkedIn);
    
    // Enrich organizations with cascade: Apollo → EnrichLayer → PDL
    const enrichedOrgsWithCascade: EnrichedOrganization[] = [];
    for (const org of enrichedOrgs) {
      if (org.domain) {
        console.log(`[Enrichment] Enriching organization with cascade: ${org.name || org.domain}`);
        const cascadeData = await enrichOrganizationByDomain(org.domain);
        if (cascadeData.success && cascadeData.enrichedData) {
          const enriched = cascadeData.enrichedData;
          enrichedOrgsWithCascade.push({
            ...org,
            name: enriched.name || org.name,
            description: enriched.description || org.description,
            linkedinHandle: enriched.linkedinUrl?.replace('https://www.linkedin.com/company/', '').replace('/', '') || org.linkedinHandle,
            industry: enriched.industry || org.industry,
            employees: enriched.employeeCount || org.employees,
            city: enriched.city || org.city,
            state: enriched.state || org.state,
            providerId: enriched.providerId || undefined,
            enrichmentSource: enriched.enrichmentSource || undefined,
          } as EnrichedOrganization);
        } else {
          enrichedOrgsWithCascade.push(org);
        }
      } else {
        enrichedOrgsWithCascade.push(org);
      }
    }

    console.log(`[Enrichment] Focused enrichment complete: ${validatedContacts.length} contacts, ${enrichedOrgsWithCascade.length} orgs`);

    return {
      success: true,
      propertyKey: aggregatedProperty.propertyKey,
      property,
      contacts: validatedContacts,
      organizations: enrichedOrgsWithCascade,
      rawResponse: {
        verification: { property_verified: true },
        property: classification,
        contacts: contactsData?.contacts || [],
        organizations: contactsData?.organizations || [],
        sources: allSources,
        timing: focusedResult.timing,
      },
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
        enrichmentSources: null,
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
    // Prefer AI-returned values when available with 70%+ confidence
    // Priority: AI-validated > DCAD > Regrid
    lotSqft: (() => {
      const aiLotAcres = (result.property as any).aiLotAcres;
      const aiConf = (result.property as any).aiLotAcresConfidence;
      if (aiLotAcres && aiConf && aiConf >= 0.70) {
        return Math.round(aiLotAcres * 43560); // Convert acres to sqft
      }
      return aggregatedProperty.lotSqft;
    })(),
    lotSqftConfidence: (result.property as any).aiLotAcresConfidence || null,
    lotSqftSource: (() => {
      const aiLotAcres = (result.property as any).aiLotAcres;
      const aiConf = (result.property as any).aiLotAcresConfidence;
      if (aiLotAcres && aiConf && aiConf >= 0.70) {
        return 'ai_validated';
      }
      return aggregatedProperty.computedLotSqftSource || 'dcad_land';
    })(),
    buildingSqft: (() => {
      const aiNetSqft = (result.property as any).aiNetSqft;
      const aiConf = (result.property as any).aiNetSqftConfidence;
      if (aiNetSqft && aiConf && aiConf >= 0.70) {
        return aiNetSqft;
      }
      return aggregatedProperty.buildingSqft;
    })(),
    buildingSqftConfidence: (result.property as any).aiNetSqftConfidence || null,
    buildingSqftSource: (() => {
      const aiNetSqft = (result.property as any).aiNetSqft;
      const aiConf = (result.property as any).aiNetSqftConfidence;
      if (aiNetSqft && aiConf && aiConf >= 0.70) {
        return 'ai_validated';
      }
      return aggregatedProperty.computedBuildingSqftSource || 'dcad_com_detail';
    })(),
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
    enrichmentSources: result.property.enrichmentSources,
    // AI-enriched physical data with rationales
    aiLotAcres: (result.property as any).aiLotAcres || null,
    aiLotAcresConfidence: (result.property as any).aiLotAcresConfidence || null,
    aiLotAcresRationale: (result.property as any).aiLotAcresRationale || null,
    aiNetSqft: (result.property as any).aiNetSqft || null,
    aiNetSqftConfidence: (result.property as any).aiNetSqftConfidence || null,
    aiNetSqftRationale: (result.property as any).aiNetSqftRationale || null,
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
  const orgsToEnrich: string[] = [];
  
  for (const org of result.organizations) {
    const existingOrg = org.domain
      ? await db.query.organizations.findFirst({
          where: eq(organizations.domain, org.domain),
        })
      : null;

    let orgId: string;
    let needsEnrichment = false;
    
    if (existingOrg) {
      orgId = existingOrg.id;
      needsEnrichment = existingOrg.enrichmentStatus !== 'complete' && !!existingOrg.domain;
      
      // Update with PDL data if available
      if (org.pdlEnriched) {
        await db.update(organizations)
          .set({
            description: org.description || existingOrg.description || undefined,
            industry: org.industry || existingOrg.industry || undefined,
            employees: org.employees || existingOrg.employees || undefined,
            employeesRange: org.employeesRange || existingOrg.employeesRange || undefined,
            linkedinHandle: org.linkedinHandle || existingOrg.linkedinHandle || undefined,
            city: org.city || existingOrg.city || undefined,
            state: org.state || existingOrg.state || undefined,
            pdlEnriched: true,
            pdlEnrichedAt: new Date(),
          })
          .where(eq(organizations.id, orgId));
        needsEnrichment = false; // Already enriched with PDL
      }
    } else {
      const [inserted] = await db.insert(organizations)
        .values({
          id: org.id,
          name: org.name,
          domain: org.domain,
          orgType: org.orgType,
          description: org.description || undefined,
          industry: org.industry || undefined,
          employees: org.employees || undefined,
          employeesRange: org.employeesRange || undefined,
          linkedinHandle: org.linkedinHandle || undefined,
          city: org.city || undefined,
          state: org.state || undefined,
          pdlEnriched: org.pdlEnriched || false,
          pdlEnrichedAt: org.pdlEnriched ? new Date() : undefined,
          enrichmentStatus: org.pdlEnriched ? 'complete' : (org.domain ? 'pending' : undefined),
        })
        .onConflictDoNothing()
        .returning({ id: organizations.id });
      orgId = inserted?.id || org.id;
      needsEnrichment = !org.pdlEnriched && !!org.domain;
    }
    orgIds.push(orgId);
    
    if (needsEnrichment && org.domain) {
      orgsToEnrich.push(org.domain);
    }

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
  
  // Note: Legacy Hunter.io/EnrichLayer org enrichment has been replaced by PDL enrichment
  // which runs inline during the enrichProperty flow. orgsToEnrich will only contain
  // orgs that weren't enriched by PDL (e.g., orgs without domains or PDL failures)
  if (orgsToEnrich.length > 0) {
    console.log(`[Enrichment] ${orgsToEnrich.length} organizations need fallback enrichment (PDL skipped/failed)`);
    // For now, skip legacy Hunter.io enrichment as PDL is the primary source
    // If PDL fails, orgs will remain with enrichmentStatus='pending' for manual review
  }

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
          phoneLabel: contact.phoneLabel,
          phoneSource: contact.phoneSource,
          aiPhone: contact.aiPhone,
          aiPhoneLabel: contact.aiPhoneLabel,
          aiPhoneConfidence: contact.aiPhoneConfidence,
          enrichmentPhoneWork: contact.enrichmentPhoneWork,
          enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
          title: contact.title,
          titleConfidence: contact.titleConfidence,
          companyDomain: contact.companyDomain,
          employerName: contact.employerName,
          linkedinUrl: contact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          contactType: contact.contactType,
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
          phoneLabel: contact.phoneLabel,
          phoneSource: contact.phoneSource,
          aiPhone: contact.aiPhone,
          aiPhoneLabel: contact.aiPhoneLabel,
          aiPhoneConfidence: contact.aiPhoneConfidence,
          enrichmentPhoneWork: contact.enrichmentPhoneWork,
          enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
          title: contact.title,
          titleConfidence: contact.titleConfidence,
          companyDomain: contact.companyDomain,
          employerName: contact.employerName,
          linkedinUrl: contact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          location: contact.location,
          contactType: contact.contactType,
          source: contact.source,
          contactRationale: contact.contactRationale,
          needsReview: contact.needsReview,
          reviewReason: contact.reviewReason,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      contactId = inserted?.id || contact.id;
      
      // Auto-fetch LinkedIn profile photo if we have a LinkedIn URL
      if (contact.linkedinUrl && contactId) {
        // Fetch photo in background (don't block enrichment flow)
        getProfilePicture(contact.linkedinUrl).then(async (photoResult) => {
          if (photoResult.success && photoResult.url) {
            try {
              await db.update(contacts)
                .set({ 
                  photoUrl: photoResult.url,
                  updatedAt: new Date()
                })
                .where(eq(contacts.id, contactId));
              console.log(`[Enrichment] Auto-fetched profile photo for ${contact.fullName}`);
            } catch (err) {
              console.error(`[Enrichment] Failed to save profile photo for ${contact.fullName}:`, err);
            }
          } else {
            console.log(`[Enrichment] No profile photo found for ${contact.fullName} (${photoResult.error || 'unknown'})`);
          }
        }).catch(err => {
          console.error(`[Enrichment] Error fetching profile photo for ${contact.fullName}:`, err);
        });
      }
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
    
    // Link contact to organization by matching domain
    if (contact.companyDomain) {
      const matchingOrg = await db.query.organizations.findFirst({
        where: eq(organizations.domain, contact.companyDomain),
      });
      
      if (matchingOrg) {
        await db.insert(contactOrganizations)
          .values({
            contactId,
            orgId: matchingOrg.id,
            title: contact.title,
            isCurrent: true,
          })
          .onConflictDoNothing();
        console.log(`[Enrichment] Linked contact ${contact.fullName} to org ${matchingOrg.name}`);
      }
    }
  }

  console.log(`[Enrichment] Stored ${contactIds.length} contacts`);
  console.log(`[Enrichment] Enrichment complete for property: ${aggregatedProperty.propertyKey}`);

  return { propertyId, contactIds, orgIds };
}

// Service Provider enrichment types
export interface ServiceProviderEnrichmentResult {
  success: boolean;
  companyLinkedInUrl?: string;
  companyName?: string;
  servicesOffered?: string[];
  description?: string;
  confidence?: number;
  error?: string;
}

// Service provider enrichment prompt
const SERVICE_PROVIDER_PROMPT = `You are a commercial property services expert. Analyze the given company name and domain to determine what facility services they provide.

CONTEXT:
You are helping a commercial property prospecting tool identify and classify service providers that work with commercial properties. These are companies that provide facility management and maintenance services.

SERVICE CATEGORIES (choose all that apply):
1. landscaping - Landscaping, lawn care, grounds maintenance, irrigation, tree services
2. janitorial - Cleaning services, janitorial, custodial, sanitation
3. hvac - HVAC, heating, ventilation, air conditioning, climate control
4. security - Security services, guards, surveillance, access control
5. waste_management - Waste removal, recycling, dumpster services
6. elevator - Elevator, escalator maintenance and repair
7. roofing - Commercial roofing, roof repair, waterproofing
8. plumbing - Commercial plumbing, pipe repair, water systems
9. electrical - Electrical services, wiring, lighting
10. fire_protection - Fire alarm systems, sprinklers, fire safety
11. parking_pavement - Parking lot maintenance, striping, asphalt repair
12. pest_control - Pest control, extermination, pest management
13. window_cleaning - Window washing, high-rise window cleaning
14. snow_ice_removal - Snow removal, ice management, de-icing
15. pool_water_features - Pool maintenance, fountain care, water features

INPUT:
- Company Name: {companyName}
- Domain: {domain}
- Website Description (if available): {websiteDescription}

OUTPUT: Respond with ONLY valid JSON in this exact format:
{
  "servicesOffered": ["category1", "category2"],
  "primaryService": "main_category",
  "description": "Brief description of the company and its services",
  "confidence": 0.0-1.0
}

RULES:
1. Only include service categories from the list above
2. If you cannot determine services, return empty array for servicesOffered
3. confidence should reflect how certain you are (0.9+ for clear service companies, 0.5-0.8 for partial info, <0.5 for uncertain)
4. Be conservative - only include services you're confident they provide`;

// Enrich a service provider with AI classification
export async function enrichServiceProvider(
  companyName: string,
  domain: string,
  websiteDescription?: string
): Promise<ServiceProviderEnrichmentResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GOOGLE_GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('[ServiceProvider Enrichment] No Gemini API key found');
    return { success: false, error: 'No API key available' };
  }

  try {
    const genai = new GoogleGenAI({ apiKey });
    
    const prompt = SERVICE_PROVIDER_PROMPT
      .replace('{companyName}', companyName)
      .replace('{domain}', domain || 'Not available')
      .replace('{websiteDescription}', websiteDescription || 'Not available');

    console.log(`[ServiceProvider Enrichment] Enriching: ${companyName} (${domain})`);

    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const responseText = response.text || '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ServiceProvider Enrichment] No valid JSON in response');
      return { success: false, error: 'Invalid response format' };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Search for company LinkedIn page
    let companyLinkedInUrl: string | undefined;
    try {
      const linkedinQuery = `site:linkedin.com/company "${companyName}"`;
      const searchResults = await serpApiSearch(linkedinQuery);
      
      if (searchResults?.items && searchResults.items.length > 0) {
        const linkedinResult = searchResults.items.find(item => 
          item.link.includes('linkedin.com/company/')
        );
        if (linkedinResult) {
          companyLinkedInUrl = linkedinResult.link;
          console.log(`[ServiceProvider Enrichment] Found LinkedIn: ${companyLinkedInUrl}`);
        }
      }
    } catch (err) {
      console.error('[ServiceProvider Enrichment] LinkedIn search failed:', err);
    }

    return {
      success: true,
      companyName,
      companyLinkedInUrl,
      servicesOffered: parsed.servicesOffered || [],
      description: parsed.description,
      confidence: parsed.confidence || 0.5,
    };
  } catch (error) {
    console.error('[ServiceProvider Enrichment] Error:', error);
    return { success: false, error: String(error) };
  }
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
