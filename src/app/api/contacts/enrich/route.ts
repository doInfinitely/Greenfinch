import { NextRequest, NextResponse } from 'next/server';
import { enrichPersonPDL } from '@/lib/pdl';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, linkedinUrl, firstName, lastName, domain } = body;

    if (!email && !linkedinUrl) {
      return NextResponse.json(
        { error: 'Either email or linkedinUrl is required' },
        { status: 400 }
      );
    }

    const result = await enrichPersonPDL(
      firstName || '',
      lastName || '',
      domain || '',
      { email, linkedinUrl }
    );

    if (!result || !result.found) {
      return NextResponse.json({ found: false, error: 'No match found' });
    }

    return NextResponse.json({
      found: true,
      fullName: result.fullName,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email || result.workEmail,
      phone: result.mobilePhone,
      title: result.title,
      company: result.companyName,
      companyDomain: result.companyDomain,
      linkedinUrl: result.linkedinUrl,
      location: result.location,
      photoUrl: result.photoUrl,
    });
  } catch (error) {
    console.error('[API] Contact enrich error:', error);
    return NextResponse.json(
      { error: 'Failed to enrich contact' },
      { status: 500 }
    );
  }
}
