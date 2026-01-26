import { NextRequest, NextResponse } from 'next/server';
import { runIngestion, runMultiZipIngestion, countCommercialPropertiesByZip } from '@/lib/dcad-ingestion';
import { MVP_ZIP_CODE, MVP_ZIP_CODES } from '@/lib/constants';
import { requireAdminAccess } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    let body: { mode?: string; zipCode?: string } = {};
    try {
      body = await request.json();
    } catch {
    }

    if (body.mode !== undefined && body.mode !== 'count' && body.mode !== 'mvp' && body.mode !== 'multi-zip') {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "count", "mvp", or "multi-zip"' },
        { status: 400 }
      );
    }

    if (body.zipCode !== undefined) {
      const zipCodeRegex = /^\d{5}$/;
      if (!zipCodeRegex.test(body.zipCode)) {
        return NextResponse.json(
          { error: 'Invalid zipCode. Must be a 5-digit string' },
          { status: 400 }
        );
      }
    }

    if (body.mode === 'count') {
      const zipCounts: Record<string, number> = {};
      let totalParcels = 0;
      for (const zip of MVP_ZIP_CODES) {
        const count = await countCommercialPropertiesByZip(zip);
        zipCounts[zip] = count;
        totalParcels += count;
      }
      return NextResponse.json({
        success: true,
        totalParcels,
        zipCounts,
        mvpZipCodes: MVP_ZIP_CODES,
      });
    }

    if (body.mode === 'multi-zip') {
      console.log(`Starting DCAD-based ingestion for ${MVP_ZIP_CODES.length} ZIP codes: ${MVP_ZIP_CODES.join(', ')}`);
      const stats = await runMultiZipIngestion(MVP_ZIP_CODES, 500);
      return NextResponse.json({
        success: true,
        mode: 'multi-zip',
        zipCodes: MVP_ZIP_CODES,
        stats,
      });
    }

    const zipCode = body.zipCode || MVP_ZIP_CODE;
    console.log(`Starting DCAD-based ingestion for ZIP ${zipCode}`);
    const stats = await runIngestion(zipCode, 500);
    
    return NextResponse.json({
      success: true,
      mode: 'mvp',
      zipCode,
      stats,
    });
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { 
        error: 'Ingestion failed', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
