import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

async function requireGreenfinchAdmin() {
  const { orgSlug, orgRole } = await auth();
  if (orgSlug !== 'greenfinch' || (orgRole !== 'org:admin' && orgRole !== 'org:super_admin')) {
    return false;
  }
  return true;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    if (!await requireGreenfinchAdmin()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orgId } = await params;
    const client = await clerkClient();

    const memberships = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });

    const members = memberships.data.map(m => ({
      id: m.id,
      clerkUserId: m.publicUserData?.userId,
      displayName: [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') || m.publicUserData?.identifier || 'Unknown',
      email: m.publicUserData?.identifier,
      profileImageUrl: m.publicUserData?.imageUrl || null,
      role: m.role,
      joinedAt: new Date(m.createdAt).toISOString(),
    }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[Admin] org members GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}
