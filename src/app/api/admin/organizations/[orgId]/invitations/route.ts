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

    const invitations = await client.organizations.getOrganizationInvitationList({
      organizationId: orgId,
      limit: 100,
    });

    const pending = invitations.data
      .filter(inv => inv.status === 'pending')
      .map(inv => ({
        id: inv.id,
        email: inv.emailAddress,
        role: inv.role,
        status: inv.status,
        createdAt: new Date(inv.createdAt).toISOString(),
      }));

    return NextResponse.json({ invitations: pending });
  } catch (error) {
    console.error('[Admin] org invitations GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    if (!await requireGreenfinchAdmin()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orgId } = await params;
    const { invitationId } = await req.json();

    const { userId } = await auth();
    const client = await clerkClient();

    await client.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: userId!,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Admin] org invitations DELETE error:', error);
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 });
  }
}
