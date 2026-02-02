import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, propertyContacts, contactOrganizations, properties, organizations } from '@/lib/schema';
import { eq } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Disable caching for contact data to ensure enrichment updates are reflected immediately
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid contact ID format' },
        { status: 400 }
      );
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const propertyRelations = await db
      .select({
        propertyId: propertyContacts.propertyId,
        role: propertyContacts.role,
        confidenceScore: propertyContacts.confidenceScore,
        propertyKey: properties.propertyKey,
        address: properties.regridAddress,
        validatedAddress: properties.validatedAddress,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        commonName: properties.commonName,
        assetCategory: properties.assetCategory,
      })
      .from(propertyContacts)
      .leftJoin(properties, eq(propertyContacts.propertyId, properties.id))
      .where(eq(propertyContacts.contactId, id));

    const orgRelations = await db
      .select({
        orgId: contactOrganizations.orgId,
        title: contactOrganizations.title,
        isCurrent: contactOrganizations.isCurrent,
        orgName: organizations.name,
        orgDomain: organizations.domain,
        orgType: organizations.orgType,
      })
      .from(contactOrganizations)
      .leftJoin(organizations, eq(contactOrganizations.orgId, organizations.id))
      .where(eq(contactOrganizations.contactId, id));

    return NextResponse.json({
      contact: {
        id: contact.id,
        fullName: contact.fullName,
        normalizedName: contact.normalizedName,
        nameConfidence: contact.nameConfidence,
        email: contact.email,
        normalizedEmail: contact.normalizedEmail,
        emailConfidence: contact.emailConfidence,
        emailStatus: contact.emailStatus,
        emailValidationStatus: contact.emailValidationStatus,
        phone: contact.phone,
        normalizedPhone: contact.normalizedPhone,
        phoneConfidence: contact.phoneConfidence,
        phoneLabel: contact.phoneLabel,
        title: contact.title,
        titleConfidence: contact.titleConfidence,
        companyDomain: contact.companyDomain,
        employerName: contact.employerName,
        linkedinUrl: contact.linkedinUrl,
        linkedinConfidence: contact.linkedinConfidence,
        linkedinStatus: contact.linkedinStatus,
        linkedinSearchResults: contact.linkedinSearchResults,
        linkedinFlagged: contact.linkedinFlagged,
        contactType: contact.contactType,
        source: contact.source,
        needsReview: contact.needsReview,
        reviewReason: contact.reviewReason,
        photoUrl: contact.photoUrl,
        location: contact.location,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
        enrichedAt: contact.enrichedAt,
        enrichmentSource: contact.enrichmentSource,
        providerId: contact.providerId,
        phoneSource: contact.phoneSource,
        enrichmentPhoneWork: contact.enrichmentPhoneWork,
        enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
        aiPhone: contact.aiPhone,
        aiPhoneLabel: contact.aiPhoneLabel,
        aiPhoneConfidence: contact.aiPhoneConfidence,
      },
      properties: propertyRelations.map(prop => ({
        id: prop.propertyId,
        propertyKey: prop.propertyKey,
        address: prop.address || prop.validatedAddress,
        city: prop.city,
        state: prop.state,
        zip: prop.zip,
        commonName: prop.commonName,
        assetCategory: prop.assetCategory,
        role: prop.role,
        confidenceScore: prop.confidenceScore,
      })),
      // Deduplicate organizations by orgId, keeping the one with isCurrent=true or the first one
      organizations: Object.values(
        orgRelations.reduce((acc: Record<string, { id: string | null; name: string | null; domain: string | null; orgType: string | null; title: string | null; isCurrent: boolean | null }>, org) => {
          const key = org.orgId || '';
          // Keep existing if it's current and new one isn't
          if (acc[key]) {
            if (!acc[key].isCurrent && org.isCurrent) {
              acc[key] = {
                id: org.orgId,
                name: org.orgName,
                domain: org.orgDomain,
                orgType: org.orgType,
                title: org.title,
                isCurrent: org.isCurrent,
              };
            }
          } else {
            acc[key] = {
              id: org.orgId,
              name: org.orgName,
              domain: org.orgDomain,
              orgType: org.orgType,
              title: org.title,
              isCurrent: org.isCurrent,
            };
          }
          return acc;
        }, {})
      ),
    });
  } catch (error) {
    console.error('Contact detail API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contact' },
      { status: 500 }
    );
  }
}
