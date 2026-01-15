import { GoogleGenAI } from "@google/genai";
import { v5 as uuidv5 } from "uuid";
import { db } from "./db";
import { properties, contacts, organizations, propertyContacts, propertyOrganizations } from "./schema";
import { eq } from "drizzle-orm";
import type { AggregatedProperty } from "./snowflake";
import { findEmail, validateEmail } from "./leadmagic";
import { findContainingPlace } from "./google-places";
import pLimit from "p-limit";

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
  source: string;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface EnrichedOrganization {
  id: string;
  name: string;
  domain: string | null;
  orgType: string;
  role: string;
}

export interface EnrichedProperty {
  validatedAddress: string | null;
  validatedAddressConfidence: number | null;
  geocodeConfidence: number | null;
  assetCategory: string | null;
  assetSubcategory: string | null;
  categoryConfidence: number | null;
  propertyClass: string | null;
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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  return `You are a commercial real estate data analyst. Analyze this property and provide enrichment data.

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

## Instructions
Analyze this property and return a JSON object with the following structure:

{
  "property": {
    "validated_address": "Full validated address or null",
    "validated_address_confidence": 0.0-1.0,
    "asset_category": "One of the main categories above",
    "asset_subcategory": "One of the subcategories for that category",
    "category_confidence": 0.0-1.0,
    "property_class": "A, B, C, or D",
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
    "classification_rationale": "Brief explanation of why you classified this property as this category/subcategory"
  },
  "contacts": [
    {
      "full_name": "Contact name",
      "name_confidence": 0.0-1.0,
      "email": null,
      "email_confidence": null,
      "phone": null,
      "phone_confidence": null,
      "title": "Job title",
      "title_confidence": 0.0-1.0,
      "company_domain": "company.com",
      "employer_name": "Company Name",
      "linkedin_url": null,
      "linkedin_confidence": null,
      "role": "property_manager, facilities, asset_manager, owner, leasing, other",
      "role_confidence": 0.0-1.0
    }
  ],
  "organizations": [
    {
      "name": "Organization name",
      "domain": "organization.com or null",
      "org_type": "owner, management, tenant, developer, other",
      "role": "Description of relationship to property"
    }
  ]
}

## Contact Discovery Instructions
For contacts, search for and prioritize:
1. PRIORITY 1 - Site-level operations (property manager, facilities manager/director for this specific property)
2. PRIORITY 2 - Management company contacts (if third-party managed)
3. PRIORITY 3 - Asset managers overseeing this property
4. PRIORITY 4 - Owners and principals (current, active individuals only)
5. PRIORITY 5 - Leasing agents and brokers
6. PRIORITY 6 - Other stakeholders

Target 5-10 contacts. For each contact, provide ALL available information:
- Their full name
- Their email address (business email preferred, format: name@company.com)
- Their phone number (business phone preferred)
- Their company/employer and company website domain
- Their job title
- Their role at this property (property_manager, facilities, asset_manager, owner, leasing, other)

CRITICAL REQUIREMENTS:
1. Only include CURRENT, ACTIVE contacts - no deceased individuals, no historical/former employees
2. Verify contacts are still active in their roles (check for recent activity)
3. For each contact, try to find their business email and phone number
4. If you cannot find a verified email, leave email as null
5. If you cannot find a verified phone, leave phone as null
6. Leave LinkedIn as null - this will be discovered separately

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
  
  const property: EnrichedProperty = {
    validatedAddress: prop.validated_address || null,
    validatedAddressConfidence: prop.validated_address_confidence || null,
    geocodeConfidence: prop.geocode_confidence || null,
    assetCategory: prop.asset_category || null,
    assetSubcategory: prop.asset_subcategory || null,
    categoryConfidence: prop.category_confidence || null,
    propertyClass: prop.property_class || null,
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
    aiRationale: prop.classification_rationale || null,
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
        source: 'ai',
        needsReview,
        reviewReason: needsReview ? 'Low confidence contact information' : null,
      };
      return contact;
    });

  const orgs: EnrichedOrganization[] = (rawResponse.organizations || []).map((o: any) => ({
    id: generateOrgId({ domain: o.domain, name: o.name }),
    name: o.name,
    domain: o.domain || null,
    orgType: o.org_type || 'other',
    role: o.role || '',
  }));

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

// Find LinkedIn URL using Gemini with web grounding (with 15s timeout)
export async function findLinkedInUrl(
  name: string,
  title: string | null,
  company: string | null,
  domain: string | null
): Promise<{ linkedinUrl: string | null; confidence: number }> {
  const prompt = `Find the LinkedIn profile URL for ${name}${title ? `, who works as ${title}` : ''}${company ? ` at ${company}` : ''}${domain ? ` (${domain})` : ''}.

Return ONLY the LinkedIn URL in this exact format:
https://www.linkedin.com/in/username

If you cannot find a matching profile with high confidence, return 'NOT_FOUND'.

Important: Return only the URL or NOT_FOUND, no other text.`;

  try {
    const client = getGeminiClient();
    
    const response = await withTimeout(
      client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      }),
      15000,
      'LinkedIn lookup timed out'
    );

    const text = response.text?.trim();
    
    if (!text || text === 'NOT_FOUND' || !text.includes('linkedin.com/in/')) {
      return { linkedinUrl: null, confidence: 0 };
    }

    const linkedinMatch = text.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/);
    
    if (linkedinMatch) {
      let url = linkedinMatch[0];
      if (!url.endsWith('/')) {
        url = url + '/';
      }
      if (!url.startsWith('https://www.')) {
        url = url.replace('https://linkedin.com', 'https://www.linkedin.com')
                 .replace('http://linkedin.com', 'https://www.linkedin.com')
                 .replace('http://www.linkedin.com', 'https://www.linkedin.com');
      }
      return { linkedinUrl: url, confidence: 0.85 };
    }

    return { linkedinUrl: null, confidence: 0 };
  } catch (error) {
    console.error(`[Enrichment] Error finding LinkedIn for ${name}:`, error);
    return { linkedinUrl: null, confidence: 0 };
  }
}

// Enrich contacts with LinkedIn URLs (limited to top 3 high-priority contacts, run in parallel)
export async function enrichContactsWithLinkedIn(contacts: EnrichedContact[]): Promise<EnrichedContact[]> {
  const MAX_LINKEDIN_LOOKUPS = 3;
  const highPriorityRoles = ['property_manager', 'facilities', 'asset_manager'];
  
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
    const validatedContacts = await validateHighPriorityContacts(contactsWithEmails);

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
        propertyClass: null,
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
    lotSqft: aggregatedProperty.lotSqft,
    buildingSqft: aggregatedProperty.buildingSqft,
    yearBuilt: aggregatedProperty.yearBuilt,
    numFloors: aggregatedProperty.numFloors,
    assetCategory: result.property.assetCategory,
    assetSubcategory: result.property.assetSubcategory,
    categoryConfidence: result.property.categoryConfidence,
    propertyClass: result.property.propertyClass,
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

    // Link to property
    await db.insert(propertyOrganizations)
      .values({
        propertyId,
        orgId,
        role: org.role,
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
