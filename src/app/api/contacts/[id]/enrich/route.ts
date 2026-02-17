import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichContactCascade } from '@/lib/cascade-enrichment';
import { requireSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    
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

    if (!contact.fullName) {
      return NextResponse.json({ error: 'Contact has no name to enrich' }, { status: 400 });
    }

    const location = contact.location || 'Dallas, TX';
    
    console.log(`[EnrichContact] Starting cascade enrichment for contact: ${contact.fullName} (${id})`);
    console.log(`[EnrichContact] Using location: ${location}, title: ${contact.title}, domain: ${contact.companyDomain}`);

    const result = await enrichContactCascade({
      fullName: contact.fullName,
      email: contact.email,
      companyDomain: contact.companyDomain,
      companyName: contact.employerName,
      title: contact.title,
      location,
      linkedinUrl: contact.linkedinUrl,
    });

    if (!result.found) {
      console.error(`[EnrichContact] Enrichment found nothing for ${contact.fullName} (${result.confidenceFlag})`);
      return NextResponse.json(
        { 
          error: 'Enrichment found no data', 
          details: result.confidenceFlag,
          contact: {
            id: contact.id,
            fullName: contact.fullName,
          }
        },
        { status: 422 }
      );
    }

    console.log(`[EnrichContact] Enrichment successful for ${contact.fullName}:`, {
      linkedinUrl: result.linkedinUrl,
      email: result.email,
      phone: result.phone,
      confidenceFlag: result.confidenceFlag,
    });

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
      confidenceFlag: result.confidenceFlag,
      enrichmentSource: result.enrichmentSource,
    };

    if (result.linkedinUrl) {
      updateData.linkedinUrl = result.linkedinUrl;
      updateData.linkedinConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
      updateData.linkedinStatus = result.confidenceFlag === 'verified' ? 'verified' : 'enriched';
    }

    if (result.email) {
      updateData.email = result.email;
      updateData.normalizedEmail = result.email.toLowerCase();
      updateData.emailConfidence = result.emailVerified ? 0.95 : 0.70;
      updateData.emailSource = result.emailSource;
      updateData.emailValidationStatus = result.emailStatus;
    }

    if (result.phone) {
      updateData.phone = result.phone;
      updateData.phoneConfidence = result.confidenceFlag === 'pdl_matched' ? 0.85 : 0.70;
      updateData.phoneSource = 'pdl';
    }

    if (result.title && !contact.title) {
      updateData.title = result.title;
      updateData.titleConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
    }

    if (result.company && !contact.employerName) {
      updateData.employerName = result.company;
    }

    if (result.companyDomain && !contact.companyDomain) {
      updateData.companyDomain = result.companyDomain;
    }

    if (result.photoUrl) {
      updateData.photoUrl = result.photoUrl;
    }

    if (result.location && !contact.location) {
      updateData.location = result.location;
    }

    updateData.findymailVerified = result.findymailVerified;
    updateData.findymailVerifyStatus = result.findymailVerifyStatus;

    updateData.pdlRawResponse = result.pdlRaw;
    updateData.crustdataRawResponse = result.crustdataRaw;

    updateData.pdlFullName = result.pdlFullName;
    updateData.pdlWorkEmail = result.pdlWorkEmail;
    updateData.pdlEmailsJson = result.pdlEmailsJson;
    updateData.pdlPersonalEmails = result.pdlPersonalEmails;
    updateData.pdlPhonesJson = result.pdlPhonesJson;
    updateData.pdlMobilePhone = result.pdlMobilePhone;
    updateData.pdlLinkedinUrl = result.pdlLinkedinUrl;
    updateData.pdlTitle = result.pdlTitle;
    updateData.pdlCompany = result.pdlCompany;
    updateData.pdlCompanyDomain = result.pdlCompanyDomain;
    updateData.pdlTitleRole = result.pdlTitleRole;
    updateData.pdlTitleLevels = result.pdlTitleLevels;
    updateData.pdlTitleClass = result.pdlTitleClass;
    updateData.pdlTitleSubRole = result.pdlTitleSubRole;
    updateData.pdlLocation = result.pdlLocation;
    updateData.pdlCity = result.pdlCity;
    updateData.pdlState = result.pdlState;
    updateData.pdlAddressesJson = result.pdlAddressesJson;
    updateData.pdlIndustry = result.pdlIndustry;
    updateData.pdlGender = result.pdlGender;
    updateData.pdlDatasetVersion = result.pdlDatasetVersion;

    updateData.crustdataTitle = result.crustdataTitle;
    updateData.crustdataCompany = result.crustdataCompany;
    updateData.crustdataCompanyDomain = result.crustdataCompanyDomain;
    updateData.crustdataWorkEmail = result.crustdataWorkEmail;
    updateData.crustdataLinkedinUrl = result.crustdataLinkedinUrl;
    updateData.crustdataLocation = result.crustdataLocation;
    updateData.crustdataEnriched = result.crustdataEnriched;
    if (result.crustdataEnriched) {
      updateData.crustdataEnrichedAt = new Date();
    }

    updateData.providerId = result.providerId;

    const cleanUpdate = Object.fromEntries(
      Object.entries(updateData).filter(([_, v]) => v !== undefined)
    );

    const [updatedContact] = await db
      .update(contacts)
      .set(cleanUpdate)
      .where(eq(contacts.id, id))
      .returning();

    return NextResponse.json({
      success: true,
      contact: {
        id: updatedContact.id,
        fullName: updatedContact.fullName,
        email: updatedContact.email,
        emailConfidence: updatedContact.emailConfidence,
        phone: updatedContact.phone,
        phoneConfidence: updatedContact.phoneConfidence,
        linkedinUrl: updatedContact.linkedinUrl,
        linkedinConfidence: updatedContact.linkedinConfidence,
        title: updatedContact.title,
        employerName: updatedContact.employerName,
        photoUrl: updatedContact.photoUrl,
        confidenceFlag: updatedContact.confidenceFlag,
      },
      enrichmentResult: {
        linkedinUrl: result.linkedinUrl,
        email: result.email,
        phone: result.phone,
        title: result.title,
        company: result.company,
        photoUrl: result.photoUrl,
        confidenceFlag: result.confidenceFlag,
        emailSource: result.emailSource,
        enrichmentSource: result.enrichmentSource,
      },
    });
  } catch (error) {
    console.error('[EnrichContact] API error:', error);
    
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    return NextResponse.json(
      { error: 'Failed to enrich contact' },
      { status: 500 }
    );
  }
}
