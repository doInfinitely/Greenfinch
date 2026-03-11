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

    const data = await queryOrgMetrics(orgId, timeframe, {
      userId: !isAdmin ? undefined : userId,
      includeUserBreakdown: view === 'org' && isAdmin,
    });

    const lines: string[] = [];

    // Summary section
    lines.push('Metric,Value');
    lines.push(`Properties Viewed,${data.propertiesViewed}`);
    lines.push(`Contacts Discovered,${data.contactsDiscovered}`);
    lines.push(`Active Users,${data.activeUsers}`);
    lines.push(`Pipeline Created,${data.pipelineCreated}`);
    lines.push(`Stage Transitions,${data.stageTransitions}`);
    lines.push(`Deals Won,${data.dealsWon}`);
    lines.push(`Deals Won Value,${data.dealsWonValue}`);
    lines.push(`Deals Lost,${data.dealsLost}`);
    lines.push(`Credits Used,${data.creditsUsed}`);
    lines.push(`Enrichment Spend,${data.enrichmentSpend}`);
    lines.push(`Avg Days to Won,${data.avgDaysToWon ?? 'N/A'}`);

    // Weekly trends
    if (data.weeklyTrends.length > 0) {
      lines.push('');
      lines.push('Week,Pipeline Created,Deals Won,Won Value');
      for (const t of data.weeklyTrends) {
        lines.push(`${t.week},${t.pipelineCreated},${t.dealsWon},${t.wonValue}`);
      }
    }

    // User breakdown
    if (data.userBreakdown && data.userBreakdown.length > 0) {
      lines.push('');
      lines.push('User,Email,Properties Viewed,Contacts Discovered,Pipeline Created,Deals Won,Credits Used');
      for (const u of data.userBreakdown) {
        lines.push(`"${u.userName}",${u.email || ''},${u.propertiesViewed},${u.contactsDiscovered},${u.pipelineCreated},${u.dealsWon},${u.creditsUsed}`);
      }
    }

    const csv = lines.join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="metrics-${timeframe}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting metrics:', error);
    return NextResponse.json({ error: 'Failed to export metrics' }, { status: 500 });
  }
}
