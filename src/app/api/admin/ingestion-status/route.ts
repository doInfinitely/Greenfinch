import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/permissions';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    const { orgRole } = await auth();
    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const countyStats = await db.execute(sql`
      SELECT
        cad_county_code AS county_code,
        COUNT(*) AS total_properties,
        COUNT(CASE WHEN enrichment_status = 'complete' THEN 1 END) AS enriched_count,
        COUNT(CASE WHEN enrichment_status = 'in_progress' THEN 1 END) AS in_progress_count,
        MAX(created_at) AS last_ingested
      FROM properties
      WHERE cad_county_code IS NOT NULL
        AND (is_active IS NULL OR is_active = true)
      GROUP BY cad_county_code
      ORDER BY cad_county_code
    `);

    const COUNTY_LABELS: Record<string, string> = {
      DCAD: 'Dallas',
      TAD: 'Tarrant',
      CCAD: 'Collin',
      DENT: 'Denton',
    };

    const data = (countyStats.rows as any[]).map(row => ({
      countyCode: row.county_code,
      countyName: COUNTY_LABELS[row.county_code] || row.county_code,
      totalProperties: Number(row.total_properties),
      enrichedCount: Number(row.enriched_count),
      inProgressCount: Number(row.in_progress_count),
      coveragePercent: Number(row.total_properties) > 0
        ? Math.round((Number(row.enriched_count) / Number(row.total_properties)) * 100)
        : 0,
      lastIngested: row.last_ingested,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Admin] Ingestion status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
