import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq } from 'drizzle-orm';

/** Resolves a propertyKey to a UUID. Used for redirecting old propertyKey URLs. */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'key parameter is required' }, { status: 400 });
  }

  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, key))
    .limit(1);

  if (!row) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  return NextResponse.json({ found: true, id: row.id });
}
