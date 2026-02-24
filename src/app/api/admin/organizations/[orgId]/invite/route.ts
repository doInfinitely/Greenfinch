import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgSlug, orgRole, userId } = await auth();

    if (orgSlug !== 'greenfinch' || (orgRole !== 'org:admin' && orgRole !== 'org:super_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orgId } = await params;
    const { email, role } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const client = await clerkClient();
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email.trim(),
      role: role === 'admin' ? 'org:admin' : 'org:member',
      inviterUserId: userId!,
    });

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        email: invitation.emailAddress,
        role: invitation.role,
        status: invitation.status,
      },
    });
  } catch (error: any) {
    console.error('[Admin] org invite POST error:', error);
    const msg = error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || 'Failed to send invitation';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
