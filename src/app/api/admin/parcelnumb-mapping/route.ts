import { NextResponse } from 'next/server';
import { buildParcelnumbMapping } from '@/lib/dcad-ingestion';
import { db } from '@/lib/db';
import { parcelnumbMapping } from '@/lib/schema';
import { sql } from 'drizzle-orm';

export async function POST() {
  try {
    const result = await buildParcelnumbMapping();
    
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(parcelnumbMapping);
    
    return NextResponse.json({
      success: true,
      mapped: result.mapped,
      errors: result.errors,
      totalMappings: countResult[0]?.count || 0,
    });
  } catch (error) {
    console.error('Error building parcelnumb mapping:', error);
    return NextResponse.json(
      { error: 'Failed to build parcelnumb mapping' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(parcelnumbMapping);
    
    const withParent = await db
      .select({ count: sql<number>`count(*)` })
      .from(parcelnumbMapping)
      .where(sql`parent_property_key IS NOT NULL`);
    
    return NextResponse.json({
      totalMappings: countResult[0]?.count || 0,
      withParentProperty: withParent[0]?.count || 0,
    });
  } catch (error) {
    console.error('Error getting parcelnumb mapping stats:', error);
    return NextResponse.json(
      { error: 'Failed to get mapping stats' },
      { status: 500 }
    );
  }
}
