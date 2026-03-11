import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { queryCrossOrgMetrics } from '@/lib/metrics-queries';

export async function GET(request: NextRequest) {
  try {
    await requireAdminAccess();

    const searchParams = request.nextUrl.searchParams;
    const timeframe = searchParams.get('timeframe') || 'month';
    const orgId = searchParams.get('orgId') || undefined;

    const data = await queryCrossOrgMetrics(timeframe, orgId);

    const lines: string[] = [];

    // Summary
    lines.push('Metric,Value');
    lines.push(`Total Orgs,${data.totalOrgs}`);
    lines.push(`Active Users,${data.activeUsers}`);
    lines.push(`Properties Viewed,${data.propertiesViewed}`);
    lines.push(`Contacts Discovered,${data.contactsDiscovered}`);
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

    // Org breakdown
    if (data.orgBreakdown.length > 0) {
      lines.push('');
      lines.push('Org ID,Org Name,Active Users,Properties Viewed,Pipeline Created,Deals Won,Enrichment Spend');
      for (const o of data.orgBreakdown) {
        lines.push(`${o.orgId},"${o.orgName}",${o.activeUsers},${o.propertiesViewed},${o.pipelineCreated},${o.dealsWon},${o.enrichmentSpend}`);
      }
    }

    const csv = lines.join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="platform-metrics-${timeframe}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error: any) {
    if (error?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error?.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error exporting admin metrics:', error);
    return NextResponse.json({ error: 'Failed to export metrics' }, { status: 500 });
  }
}
