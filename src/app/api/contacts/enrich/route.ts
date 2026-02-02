import { NextRequest, NextResponse } from 'next/server';
import { enrichPersonByEmail, enrichPersonByLinkedIn } from '@/lib/apollo';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, linkedinUrl } = body;

    if (!email && !linkedinUrl) {
      return NextResponse.json(
        { error: 'Either email or linkedinUrl is required' },
        { status: 400 }
      );
    }

    let result;
    
    if (email) {
      result = await enrichPersonByEmail(email);
    } else if (linkedinUrl) {
      result = await enrichPersonByLinkedIn(linkedinUrl);
    }

    if (!result || !result.found) {
      return NextResponse.json({ found: false, error: result?.error || 'No match found' });
    }

    return NextResponse.json({
      found: true,
      apolloId: result.apolloId,
      fullName: result.fullName,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      phone: result.phone,
      title: result.title,
      company: result.company,
      companyDomain: result.companyDomain,
      linkedinUrl: result.linkedinUrl,
      location: result.location,
      photoUrl: result.photoUrl,
      emailStatus: result.emailStatus,
    });
  } catch (error) {
    console.error('[API] Contact enrich error:', error);
    return NextResponse.json(
      { error: 'Failed to enrich contact' },
      { status: 500 }
    );
  }
}
