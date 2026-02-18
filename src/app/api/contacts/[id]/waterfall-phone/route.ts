import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichPersonPDL } from '@/lib/pdl';
import { findPhoneByLinkedIn } from '@/lib/findymail';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { apiSuccess, apiError, apiNotFound, apiBadRequest, apiUnauthorized } from '@/lib/api-response';
import { normalizePhoneWithExtension } from '@/lib/phone-format';
import { trackCostFireAndForget } from '@/lib/cost-tracker';

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

    let foundPhone: string | null = null;
    let phoneSource: string | null = null;
    let phoneLabel: string | null = null;

    if (contact.linkedinUrl) {
      console.log(`[WaterfallPhone] Step 1: Trying Findymail phone finder with LinkedIn URL`);
      try {
        const findymailResult = await findPhoneByLinkedIn(contact.linkedinUrl);
        
        trackCostFireAndForget({
          provider: 'findymail',
          endpoint: 'search/phone',
          entityType: 'contact',
          entityId: id,
          success: findymailResult.found,
          metadata: { found: findymailResult.found },
        });

        if (findymailResult.found && findymailResult.phone) {
          foundPhone = findymailResult.phone;
          phoneSource = 'findymail_phone';
          phoneLabel = 'mobile';
          console.log(`[WaterfallPhone] Findymail phone found: ${foundPhone}`);
        } else {
          console.log(`[WaterfallPhone] Findymail phone not found, falling back to PDL`);
        }
      } catch (err: any) {
        console.warn(`[WaterfallPhone] Findymail phone finder error (will try PDL):`, err.message);
      }
    } else {
      console.log(`[WaterfallPhone] No LinkedIn URL, skipping Findymail phone finder`);
    }

    if (!foundPhone) {
      console.log(`[WaterfallPhone] Step 2: Trying PDL for phone`);
      const result = await enrichPersonPDL(
        firstName,
        lastName,
        contact.companyDomain || '',
        {
          email: contact.email || undefined,
          linkedinUrl: contact.linkedinUrl || undefined,
        }
      );

      if (result?.found && result.mobilePhone) {
        foundPhone = result.mobilePhone;
        phoneSource = 'pdl';
        phoneLabel = 'mobile';
        console.log(`[WaterfallPhone] PDL phone found: ${foundPhone}`);
      } else {
        console.log(`[WaterfallPhone] PDL: no phone available`);
      }
    }

    if (foundPhone) {
      const { normalized, extension } = normalizePhoneWithExtension(foundPhone);

      await db.update(contacts)
        .set({
          phone: normalized || foundPhone,
          normalizedPhone: normalized || foundPhone,
          phoneSource: phoneSource,
          phoneLabel: phoneLabel,
          phoneExtension: extension || null,
          enrichedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));

      console.log(`[WaterfallPhone] Saved phone for ${contact.fullName} via ${phoneSource}${extension ? ` ext ${extension}` : ''}`);

      return apiSuccess({
        phone: normalized || foundPhone,
        extension: extension || null,
        source: phoneSource,
        message: `Phone found via ${phoneSource}`,
      });
    }

    return apiSuccess({
      phone: null,
      message: 'No phone number found',
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
