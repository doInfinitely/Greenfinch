import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichContact } from '@/lib/enrichlayer';
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

    // Default to Dallas, TX if no location available (since MVP is focused on Dallas ZIP 75225)
    const location = contact.location || 'Dallas, TX';
    
    console.log(`[EnrichContact] Starting enrichment for contact: ${contact.fullName} (${id})`);
    console.log(`[EnrichContact] Using location: ${location}, title: ${contact.title}, domain: ${contact.companyDomain}`);

    const result = await enrichContact({
      fullName: contact.fullName,
      companyDomain: contact.companyDomain,
      linkedinUrl: contact.linkedinUrl,
      location,
      title: contact.title,
    });

    if (!result.success) {
      console.error(`[EnrichContact] Enrichment failed for ${contact.fullName}:`, result.error);
      return NextResponse.json(
        { 
          error: 'Enrichment failed', 
          details: result.error,
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
      email: result.email || result.personalEmail,
      phone: result.phone,
    });

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (result.linkedinUrl) {
      updateData.linkedinUrl = result.linkedinUrl;
      updateData.linkedinConfidence = 0.95;
      updateData.linkedinStatus = 'verified';
    }

    const email = result.email || result.personalEmail;
    if (email) {
      updateData.email = email;
      updateData.normalizedEmail = email.toLowerCase();
      updateData.emailConfidence = 0.90;
      updateData.emailSource = 'enrichlayer';
      updateData.emailValidationStatus = 'verified';
    }

    if (result.phone) {
      updateData.phone = result.phone;
      updateData.phoneConfidence = 0.90;
    }

    if (result.title && !contact.title) {
      updateData.title = result.title;
      updateData.titleConfidence = 0.85;
    }

    if (result.company && !contact.employerName) {
      updateData.employerName = result.company;
    }

    const [updatedContact] = await db
      .update(contacts)
      .set(updateData)
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
        linkedinStatus: updatedContact.linkedinStatus,
        title: updatedContact.title,
        employerName: updatedContact.employerName,
      },
      enrichmentResult: {
        linkedinUrl: result.linkedinUrl,
        email: email,
        phone: result.phone,
        title: result.title,
        company: result.company,
        creditsUsed: result.creditsUsed,
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
