import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, and, inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
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
      return NextResponse.json({ members: [] });
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

    const members = memberships.data.map(m => {
      const clerkUserId = m.publicUserData?.userId;
      const dbUser = dbUsers.find(u => u.clerkId === clerkUserId);
      
      return {
        id: clerkUserId || m.id, // Clerk user ID for team management (role updates, member removal)
        clerkUserId: clerkUserId,
        dbUserId: dbUser?.id || null, // Database user ID for pipeline assignments
        email: m.publicUserData?.identifier || dbUser?.email || '',
        firstName: m.publicUserData?.firstName || dbUser?.firstName || '',
        lastName: m.publicUserData?.lastName || dbUser?.lastName || '',
        profileImageUrl: m.publicUserData?.imageUrl || dbUser?.profileImageUrl || '',
        role: m.role,
        displayName: [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') || m.publicUserData?.identifier || 'Unknown',
        joinedAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
        membershipId: m.id,
        canBeAssignedOwner: !!dbUser?.id, // Flag if this member can be assigned as pipeline owner
      };
    });

    return NextResponse.json({ members });
  } catch (error) {
    console.error('Error fetching org members:', error);
    return NextResponse.json({ error: 'Failed to fetch organization members' }, { status: 500 });
  }
}
