import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { requireCredits } from '@/lib/credit-guard';
import { InsufficientCreditsError } from '@/lib/credits';
import { rateLimitMiddleware, checkRateLimit as checkRateLimitFn, addRateLimitHeaders, getIdentifier } from '@/lib/rate-limit';
import { findEmailByName } from '@/lib/findymail';
import { findEmail as hunterFindEmail } from '@/lib/hunter';
import { validateEmail as zerobounceValidate } from '@/lib/zerobounce';
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
    const { orgId } = await auth();

    const { id } = await params;

    await requireCredits('email_lookup', 'contact', id);

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

    if (!contact.companyDomain) {
      return apiBadRequest('Contact has no company domain for email discovery');
    }

    const { firstName, lastName } = parseNameParts(contact.fullName);

    console.log(`[WaterfallEmail] Finding email for: ${contact.fullName} @ ${contact.companyDomain}`);

    let foundEmail: string | null = null;
    let emailSource: string | null = null;

    const findymailResult = await findEmailByName(firstName, lastName, contact.companyDomain);
    if (findymailResult.found && findymailResult.email) {
      foundEmail = findymailResult.email;
      emailSource = 'findymail_finder';
      console.log(`[WaterfallEmail] Findymail found: ${foundEmail}`);
    }

    if (!foundEmail) {
      const hunterResult = await hunterFindEmail(firstName, lastName, contact.companyDomain, { clerkOrgId: orgId || undefined });
      if (hunterResult.email) {
        foundEmail = hunterResult.email;
        emailSource = 'hunter_finder';
        console.log(`[WaterfallEmail] Hunter found: ${foundEmail}`);
      }
    }

    if (!foundEmail) {
      return apiError('No email found via Findymail or Hunter', { status: 200 });
    }

    let emailStatus = 'unverified';
    try {
      const zbResult = await zerobounceValidate(foundEmail);
      emailStatus = zbResult.status === 'valid' ? 'valid' : (zbResult.status === 'catch-all' ? 'catch-all' : 'invalid');
    } catch {
      console.warn(`[WaterfallEmail] ZeroBounce validation failed for ${foundEmail}`);
    }

    await db.update(contacts)
      .set({
        email: foundEmail,
        emailSource,
        emailStatus,
        enrichmentSource: emailSource === 'findymail_finder' ? 'findymail' : 'hunter',
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id));

    console.log(`[WaterfallEmail] Saved email ${foundEmail} (${emailSource}, status: ${emailStatus}) for ${contact.fullName}`);

    return apiSuccess({
      email: foundEmail,
      emailSource,
      emailStatus,
      message: `Email found via ${emailSource}`,
    });
  } catch (error) {
    console.error('[WaterfallEmail] API error:', error);
    
    if (error instanceof InsufficientCreditsError) {
      return apiError('Insufficient credits', { status: 402, meta: { required: error.required, available: error.available } });
    }
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return apiUnauthorized();
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return apiError('Admin access required', { status: 403 });
      }
    }

    return apiError('Failed to trigger email lookup');
  }
}
