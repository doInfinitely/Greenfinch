import { NextRequest, NextResponse } from 'next/server';
import { validateEmail, validateAndUpdateContact, getCreditsUsed } from '@/lib/neverbounce';
import { rateLimitMiddleware, checkRateLimit as checkRateLimitFn, addRateLimitHeaders, getIdentifier } from '@/lib/rate-limit';

const checkRateLimit = rateLimitMiddleware(20, 60);

export async function POST(request: NextRequest) {
  try {
    const rateResponse = await checkRateLimit(request);
    if (rateResponse) return rateResponse;

    const body = await request.json();
    const { email, contactId } = body;

    // Get rate limit info for headers
    const identifier = getIdentifier(request);
    const route = new URL(request.url).pathname;
    const rateInfo = await checkRateLimitFn(identifier, route, 20, 60);

    if (contactId) {
      const result = await validateAndUpdateContact(contactId);
      if (!result) {
        return NextResponse.json(
          { error: 'Contact not found or has no email' },
          { status: 404 }
        );
      }
      const response = NextResponse.json({ 
        result: {
          isValid: result.isValid,
          confidence: result.confidence,
          status: result.status,
          details: result.details,
        },
        creditsUsed: result.creditsUsed,
        totalCreditsUsed: getCreditsUsed(),
      });
      addRateLimitHeaders(response, rateInfo);
      return response;
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email or contactId required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const result = await validateEmail(email);
    const response = NextResponse.json({ 
      result: {
        isValid: result.isValid,
        confidence: result.confidence,
        status: result.status,
        details: result.details,
      },
      creditsUsed: result.creditsUsed,
      totalCreditsUsed: getCreditsUsed(),
    });
    addRateLimitHeaders(response, rateInfo);
    return response;
  } catch (error) {
    console.error('Email validation API error:', error);
    return NextResponse.json(
      { error: 'Failed to validate email' },
      { status: 500 }
    );
  }
}
