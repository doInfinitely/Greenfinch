import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { ilike, or } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ contacts: [] });
    }

    const searchPattern = `%${query}%`;

    const results = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        title: contacts.title,
        employerName: contacts.employerName,
      })
      .from(contacts)
      .where(
        or(
          ilike(contacts.fullName, searchPattern),
          ilike(contacts.email, searchPattern),
          ilike(contacts.employerName, searchPattern)
        )
      )
      .limit(10);

    return NextResponse.json({ contacts: results });
  } catch (error) {
    console.error('[API] Contact search error:', error);
    return NextResponse.json(
      { error: 'Failed to search contacts' },
      { status: 500 }
    );
  }
}
