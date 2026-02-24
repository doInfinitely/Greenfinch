import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

async function requireGreenfinchAdmin() {
  const { orgSlug, orgRole } = await auth();
  if (orgSlug !== 'greenfinch' || (orgRole !== 'org:admin' && orgRole !== 'org:super_admin')) {
    return null;
  }
  return true;
}

export async function GET() {
  try {
    if (!await requireGreenfinchAdmin()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const client = await clerkClient();
    const orgs = await client.organizations.getOrganizationList({ limit: 100 });

    const data = orgs.data.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      membersCount: org.membersCount,
      createdAt: new Date(org.createdAt).toISOString(),
      imageUrl: org.imageUrl,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[Admin] organizations GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!await requireGreenfinchAdmin()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { name, slug } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
    }

    const { userId } = await auth();
    const client = await clerkClient();

    const org = await client.organizations.createOrganization({
      name: name.trim(),
      slug: slug?.trim() || undefined,
      createdBy: userId!,
    });

    return NextResponse.json({
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        membersCount: org.membersCount,
        createdAt: new Date(org.createdAt).toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[Admin] organizations POST error:', error);
    const msg = error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || 'Failed to create organization';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
