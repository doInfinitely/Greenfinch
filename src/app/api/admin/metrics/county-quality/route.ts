import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/permissions';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    const { orgRole } = await auth();
    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const qualityStats = await db.execute(sql`
      SELECT
        p.cad_county_code AS county_code,
        COUNT(*) AS total,
        COUNT(CASE WHEN p.validated_address IS NOT NULL THEN 1 END) AS validated_address_count,
        COUNT(CASE WHEN p.geocoded_lat IS NOT NULL THEN 1 END) AS geocoded_count,
        COALESCE(AVG(contact_counts.cnt), 0) AS avg_contacts_per_property,
        COUNT(CASE WHEN p.revenue_estimates IS NOT NULL THEN 1 END) AS revenue_estimated_count
      FROM properties p
      LEFT JOIN (
        SELECT cp.property_id, COUNT(*) AS cnt
        FROM contact_properties cp
        GROUP BY cp.property_id
      ) contact_counts ON contact_counts.property_id = p.id
      WHERE p.cad_county_code IS NOT NULL
        AND (p.is_active IS NULL OR p.is_active = true)
      GROUP BY p.cad_county_code
      ORDER BY p.cad_county_code
    `);

    const COUNTY_LABELS: Record<string, string> = {
      DCAD: 'Dallas',
      TAD: 'Tarrant',
      CCAD: 'Collin',
      DENT: 'Denton',
    };

    const data = (qualityStats.rows as any[]).map(row => {
      const total = Number(row.total);
      return {
        countyCode: row.county_code,
        countyName: COUNTY_LABELS[row.county_code] || row.county_code,
        total,
        addressQualityPercent: total > 0
          ? Math.round((Number(row.validated_address_count) / total) * 100)
          : 0,
        geocodedPercent: total > 0
          ? Math.round((Number(row.geocoded_count) / total) * 100)
          : 0,
        avgContactsPerProperty: Number(Number(row.avg_contacts_per_property).toFixed(1)),
        revenueEstimateCoveragePercent: total > 0
          ? Math.round((Number(row.revenue_estimated_count) / total) * 100)
          : 0,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Admin] County quality error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
