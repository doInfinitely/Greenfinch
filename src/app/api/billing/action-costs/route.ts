import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { creditActionCosts } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const costs = await db
      .select()
      .from(creditActionCosts)
      .where(eq(creditActionCosts.isActive, true));

    return NextResponse.json({ success: true, data: costs });
  } catch (error) {
    console.error('[Billing] Action costs error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
