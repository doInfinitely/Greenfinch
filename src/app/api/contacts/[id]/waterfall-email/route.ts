import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { triggerWaterfallEmail } from '@/lib/apollo';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { rateLimitMiddleware, checkRateLimit as checkRateLimitFn, addRateLimitHeaders, getIdentifier } from '@/lib/rate-limit';

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

    const { firstName, lastName } = parseNameParts(contact.fullName);

    console.log(`[WaterfallEmail] Triggering for contact: ${contact.fullName} (${id})`);

    const result = await triggerWaterfallEmail({
      apolloId: contact.providerId || undefined,
      linkedinUrl: contact.linkedinUrl || undefined,
      firstName,
      lastName,
      domain: contact.companyDomain || undefined,
    });

    if (!result.success) {
      console.error(`[WaterfallEmail] Failed for ${contact.fullName}:`, result.error);
      return NextResponse.json(
        { 
          error: 'Waterfall email request failed', 
          details: result.error,
          waterfallStatus: result.waterfallStatus,
        },
        { status: 422 }
      );
    }

    // CRITICAL: Validate that Apollo returned the correct person before saving any data
    // Apollo may return a different person at the same domain, causing data corruption
    // We require BOTH first AND last name to match (strict validation)
    const returnedName = result.returnedName?.toLowerCase().trim() || '';
    const requestedFirstName = firstName.toLowerCase().trim();
    const requestedLastName = lastName.toLowerCase().trim();
    
    // Split returned name into words for word-boundary matching
    const returnedWords = returnedName.split(/\s+/);
    
    // Strict match: require BOTH first and last name to appear as whole words
    const firstNameMatches = returnedWords.some(word => word === requestedFirstName);
    const lastNameMatches = requestedLastName ? returnedWords.some(word => word === requestedLastName) : false;
    const strictNameMatch = firstNameMatches && lastNameMatches;
    
    // Strong identifiers: apolloId or linkedinUrl that we sent TO Apollo (not what Apollo returns)
    const hadStrongIdentifier = !!(contact.providerId || contact.linkedinUrl);
    
    // VALIDATION RULES:
    // 1. If Apollo returned a name, it MUST match (strict) regardless of whether we had strong identifier
    // 2. If Apollo did NOT return a name, only trust it if we had a strong identifier
    // 3. Never blindly trust "no name returned" without a strong identifier
    let shouldSaveApolloData = false;
    let validationReason = '';
    
    if (result.returnedName) {
      // Apollo returned a name - must match strictly
      if (strictNameMatch) {
        shouldSaveApolloData = true;
        validationReason = 'strict name match passed';
      } else {
        shouldSaveApolloData = false;
        validationReason = `name mismatch: requested "${firstName} ${lastName}", Apollo returned "${result.returnedName}"`;
        console.warn(`[WaterfallEmail] ${validationReason}`);
        console.warn(`[WaterfallEmail] NOT saving Apollo's providerId/linkedinUrl/photoUrl to prevent data corruption`);
      }
    } else {
      // Apollo did NOT return a name - only trust if we had strong identifier
      if (hadStrongIdentifier) {
        shouldSaveApolloData = true;
        validationReason = 'no name returned but had strong identifier (providerId/linkedinUrl)';
      } else {
        shouldSaveApolloData = false;
        validationReason = 'no name returned and no strong identifier - cannot validate match';
        console.warn(`[WaterfallEmail] ${validationReason}`);
      }
    }
    
    console.log(`[WaterfallEmail] Validation: ${validationReason}, shouldSave=${shouldSaveApolloData}`);
    
    // Only update the contact record if validation passed
    // Do NOT update enrichmentSource/updatedAt if validation failed - this would mask the failure
    if (shouldSaveApolloData) {
      const updateData: Record<string, any> = {
        enrichmentSource: 'apollo',
        updatedAt: new Date(),
      };
      
      if (result.apolloId) {
        updateData.providerId = result.apolloId;
      }
      
      // Update LinkedIn URL if contact doesn't have one and Apollo provided it
      if (result.linkedinUrl && !contact.linkedinUrl) {
        updateData.linkedinUrl = result.linkedinUrl;
        console.log(`[WaterfallEmail] Setting LinkedIn URL from Apollo: ${result.linkedinUrl}`);
      }
      
      // Update photo URL if contact doesn't have one and Apollo provided it
      if (result.photoUrl && !contact.photoUrl) {
        updateData.photoUrl = result.photoUrl;
        console.log(`[WaterfallEmail] Setting photo URL from Apollo`);
      }
      
      await db.update(contacts)
        .set(updateData)
        .where(eq(contacts.id, id));
        
      console.log(`[WaterfallEmail] Contact updated successfully`);
    } else {
      console.warn(`[WaterfallEmail] Validation FAILED - contact NOT updated to prevent data corruption`);
    }

    console.log(`[WaterfallEmail] Request accepted for ${contact.fullName}, Apollo ID: ${result.apolloId}`);

    // Get rate limit info for headers
    const identifier = getIdentifier(request);
    const route = new URL(request.url).pathname;
    const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

    const response = NextResponse.json({
      success: true,
      message: 'Email lookup initiated. Results will arrive shortly via webhook.',
      requestId: result.requestId,
      apolloId: result.apolloId,
      waterfallStatus: result.waterfallStatus,
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
