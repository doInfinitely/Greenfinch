import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { ilike, or } from 'drizzle-orm';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const limitParam = searchParams.get('limit');
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam || String(DEFAULT_LIMIT), 10)));

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
        location: contacts.location,
        photoUrl: contacts.photoUrl,
      })
      .from(contacts)
      .where(
        or(
          ilike(contacts.fullName, searchPattern),
          ilike(contacts.email, searchPattern)
        )
      )
      .limit(limit);

    return NextResponse.json({ contacts: results });
  } catch (error) {
    console.error('[API] Contact search error:', error);
    return NextResponse.json(
      { error: 'Failed to search contacts' },
      { status: 500 }
    );
  }
}
