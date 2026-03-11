import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { queryOrgMetrics } from '@/lib/metrics-queries';

export async function GET(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const timeframe = searchParams.get('timeframe') || 'month';
    const userId = searchParams.get('userId') || undefined;
    const view = searchParams.get('view') || 'personal';

    const isAdmin = orgRole === 'org:admin' || orgRole === 'org:manager';

    // Non-admins can only see org-wide view if no user filter
    const effectiveUserId = !isAdmin ? undefined : userId;
    const includeUserBreakdown = view === 'org' && isAdmin;

    const data = await queryOrgMetrics(orgId, timeframe, {
      userId: effectiveUserId,
      includeUserBreakdown,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
