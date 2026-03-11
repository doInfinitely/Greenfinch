import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { requireAdminAccess } from '@/lib/auth';
import { queryCrossOrgMetrics } from '@/lib/metrics-queries';

export async function GET(request: NextRequest) {
  try {
    await requireAdminAccess();

    const searchParams = request.nextUrl.searchParams;
    const timeframe = searchParams.get('timeframe') || 'month';
    const orgId = searchParams.get('orgId') || undefined;

    const data = await queryCrossOrgMetrics(timeframe, orgId);

    // Resolve org names via Clerk
    if (data.orgBreakdown.length > 0) {
      try {
        const clerk = await clerkClient();
        const orgIds = data.orgBreakdown.map(o => o.orgId);
        const orgResults = await Promise.allSettled(
          orgIds.map(id => clerk.organizations.getOrganization({ organizationId: id }))
        );
        for (let i = 0; i < data.orgBreakdown.length; i++) {
          const result = orgResults[i];
          if (result.status === 'fulfilled') {
            data.orgBreakdown[i].orgName = result.value.name;
          }
        }
      } catch (e) {
        console.error('Error resolving org names:', e);
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    if (error?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error?.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error fetching admin metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
