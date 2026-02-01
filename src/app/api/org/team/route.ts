import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, userId } = await auth();
    
    if (!orgId || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clerkClient();
    const memberships = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });

    const clerkUserIds = memberships.data
      .map(m => m.publicUserData?.userId)
      .filter(Boolean) as string[];

    if (clerkUserIds.length === 0) {
      return NextResponse.json({ team: [] });
    }

    const dbUsers = await db
      .select({
        id: users.id,
        clerkId: users.clerkId,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .where(inArray(users.clerkId, clerkUserIds));

    const team = memberships.data.map(m => {
      const clerkUserId = m.publicUserData?.userId;
      const dbUser = dbUsers.find(u => u.clerkId === clerkUserId);
      
      const firstName = m.publicUserData?.firstName || dbUser?.firstName || '';
      const lastName = m.publicUserData?.lastName || dbUser?.lastName || '';
      const displayName = [firstName, lastName].filter(Boolean).join(' ') || m.publicUserData?.identifier || 'Unknown';
      
      return {
        id: dbUser?.id || null,
        clerkId: clerkUserId,
        email: m.publicUserData?.identifier || dbUser?.email || '',
        firstName,
        lastName,
        profileImageUrl: m.publicUserData?.imageUrl || dbUser?.profileImageUrl || '',
        displayName,
        handle: displayName.toLowerCase().replace(/\s+/g, '.'),
      };
    }).filter(m => m.id);

    return NextResponse.json({ team });
  } catch (error) {
    console.error('Error fetching team:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }
}
