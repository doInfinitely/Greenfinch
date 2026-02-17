tact.linkedinUrl,
          linkedinConfidence: contact.linkedinConfidence,
          contactType: contact.contactType,
          source: contact.source,
          contactRationale: contact.contactRationale,
          needsReview: contact.needsReview,
          reviewReason: contact.reviewReason,
          providerId: contact.providerId || existingContact.providerId,
          enrichmentSource: contact.enrichmentSource || existingContact.enrichmentSource,
          photoUrl: contact.photoUrl || existingContact.photoUrl,
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
          emailValidationStatus: contact.emailValidationStatus,
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
          providerId: contact.providerId,
          enrichmentSource: contact.enrichmentSource,
          photoUrl: contact.photoUrl,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      contactId = inserted?.id || contact.id;
      
      // Only fetch LinkedIn profile photo if we don't have one from Apollo
      if (contact.linkedinUrl && contactId && !contact.photoUrl) {
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
