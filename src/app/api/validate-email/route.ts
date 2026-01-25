import { NextRequest, NextResponse } from 'next/server';
import { validateEmail, validateAndUpdateContact, getCreditsUsed } from '@/lib/neverbounce';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, contactId } = body;

    if (contactId) {
      const result = await validateAndUpdateContact(contactId);
      if (!result) {
        return NextResponse.json(
          { error: 'Contact not found or has no email' },
          { status: 404 }
        );
      }
      return NextResponse.json({ 
        result: {
          isValid: result.isValid,
          confidence: result.confidence,
          status: result.status,
          details: result.details,
        },
        creditsUsed: result.creditsUsed,
        totalCreditsUsed: getCreditsUsed(),
      });
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
    return NextResponse.json({ 
      result: {
        isValid: result.isValid,
        confidence: result.confidence,
        status: result.status,
        details: result.details,
      },
      creditsUsed: result.creditsUsed,
      totalCreditsUsed: getCreditsUsed(),
    });
  } catch (error) {
    console.error('Email validation API error:', error);
    return NextResponse.json(
      { error: 'Failed to validate email' },
      { status: 500 }
    );
  }
}
