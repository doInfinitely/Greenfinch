import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { creditPacks } from '@/lib/schema';
import { eq, asc } from 'drizzle-orm';

export async function GET() {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const packs = await db
      .select()
      .from(creditPacks)
      .where(eq(creditPacks.isActive, true))
      .orderBy(asc(creditPacks.sortOrder));

    return NextResponse.json({ success: true, data: packs });
  } catch (error) {
    console.error('[Billing] Packs error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
