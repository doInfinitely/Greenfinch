import { NextRequest, NextResponse } from 'next/server';
import { describeTable, sampleAccountInfo } from '@/lib/dcad-ingestion';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const table = searchParams.get('table') || 'DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO';
    const zip = searchParams.get('zip') || '75225';
    
    const columns = await describeTable(table);
    const sample = await sampleAccountInfo(zip);
    
    return NextResponse.json({
      table,
      columns: columns.map((c: any) => ({
        name: c.name,
        type: c.type,
        nullable: c.null,
      })),
      sampleKeys: sample.length > 0 ? Object.keys(sample[0]) : [],
      sampleRow: sample[0] || null,
    });
  } catch (error: any) {
    console.error('Error discovering columns:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
