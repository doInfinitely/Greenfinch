import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { rateLimitMiddleware, checkRateLimit as checkRateLimitFn, addRateLimitHeaders, getIdentifier } from '@/lib/rate-limit';
import { findEmailByName } from '@/lib/findymail';
import { findEmail as hunterFindEmail } from '@/lib/hunter';
import { validateEmail as zerobounceValidate } from '@/lib/zerobounce';

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
      return NextResponse.json({ error: 'Contact has no name' }, { status: 400 });
    }

    if (!contact.companyDomain) {
      return NextResponse.json({ error: 'Contact has no company domain for email discovery' }, { status: 400 });
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
      const hunterResult = await hunterFindEmail(firstName, lastName, contact.companyDomain);
      if (hunterResult.found && hunterResult.email) {
        foundEmail = hunterResult.email;
        emailSource = 'hunter_finder';
        console.log(`[WaterfallEmail] Hunter found: ${foundEmail}`);
      }
    }

    if (!foundEmail) {
      const identifier = getIdentifier(request);
      const route = new URL(request.url).pathname;
      const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

      const response = NextResponse.json({
        success: false,
        message: 'No email found via Findymail or Hunter',
      });
      addRateLimitHeaders(response, rateInfo);
      return response;
    }

    let emailStatus = 'unverified';
    try {
      const zbResult = await zerobounceValidate(foundEmail);
      emailStatus = zbResult.isValid ? 'valid' : (zbResult.status === 'catch-all' ? 'catch-all' : 'invalid');
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

    const identifier = getIdentifier(request);
    const route = new URL(request.url).pathname;
    const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

    const response = NextResponse.json({
      success: true,
      email: foundEmail,
      emailSource,
      emailStatus,
      message: `Email found via ${emailSource}`,
    });
    addRateLimitHeaders(response, rateInfo);
    return response;
  } catch (error) {
    console.error('[WaterfallEmail] API error:', error);
    
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to trigger email lookup' },
      { status: 500 }
    );
  }
}
