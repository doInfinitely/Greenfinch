import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichPersonPDL } from '@/lib/pdl';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { apiSuccess, apiError, apiNotFound, apiBadRequest, apiUnauthorized } from '@/lib/api-response';

const checkRateLimit = rateLimitMiddleware(20, 60);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseNameParts(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateResponse = await checkRateLimit(request);
    if (rateResponse) return rateResponse;

    await requireSession();
    await requireAdminAccess();
    
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return apiBadRequest('Invalid contact ID format');
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return apiNotFound('Contact not found');
    }

    if (!contact.fullName) {
      return apiBadRequest('Contact has no name');
    }

    const { firstName, lastName } = parseNameParts(contact.fullName);

    console.log(`[WaterfallPhone] Looking up phone for: ${contact.fullName} (${id})`);

    const result = await enrichPersonPDL(
      firstName,
      lastName,
      contact.companyDomain || '',
      {
        email: contact.email || undefined,
        linkedinUrl: contact.linkedinUrl || undefined,
      }
    );

    if (!result || !result.found) {
      return apiError('No phone number found via PDL', { status: 200 });
    }

    if (result.mobilePhone) {
      await db.update(contacts)
        .set({
          phone: result.mobilePhone,
          enrichmentSource: 'pdl',
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));

      console.log(`[WaterfallPhone] Saved phone for ${contact.fullName}`);
    }

    return apiSuccess({
      phone: result.mobilePhone || null,
      message: result.mobilePhone ? 'Phone found via PDL' : 'PDL matched but no phone available',
    });
  } catch (error) {
    console.error('[WaterfallPhone] API error:', error);
    
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return apiUnauthorized();
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return apiError('Admin access required', { status: 403 });
      }
    }
    
    return apiError('Failed to trigger phone lookup');
  }
}
