import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { territories, users } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, userId: clerkUserId } = await auth();
    if (!orgId || !clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Look up user's DB id
    const [dbUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!dbUser) {
      return NextResponse.json({ territory: null });
    }

    const [territory] = await db
      .select()
      .from(territories)
      .where(and(
        eq(territories.clerkOrgId, orgId),
        eq(territories.assignedUserId, dbUser.id),
        eq(territories.isActive, true)
      ))
      .limit(1);

    return NextResponse.json({ territory: territory || null });
  } catch (error) {
    console.error('Error fetching user territory:', error);
    return NextResponse.json({ error: 'Failed to fetch territory' }, { status: 500 });
  }
}
