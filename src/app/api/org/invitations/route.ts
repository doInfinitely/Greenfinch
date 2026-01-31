import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

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
    const invitations = await client.organizations.getOrganizationInvitationList({
      organizationId: orgId,
      limit: 100,
    });

    const formattedInvitations = invitations.data
      .filter(inv => inv.status === 'pending')
      .map(inv => ({
        id: inv.id,
        email: inv.emailAddress,
        role: inv.role,
        status: inv.status,
        createdAt: new Date(inv.createdAt).toISOString(),
      }));

    return NextResponse.json({ invitations: formattedInvitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { email, role } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const client = await clerkClient();
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: role === 'admin' ? 'org:admin' : 'org:member',
      inviterUserId: (await auth()).userId!,
    });

    return NextResponse.json({ 
      invitation: {
        id: invitation.id,
        email: invitation.emailAddress,
        role: invitation.role,
        status: invitation.status,
      }
    });
  } catch (error: any) {
    console.error('Error creating invitation:', error);
    
    if (error?.errors?.[0]?.message) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    
    return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
  }
}
