import { NextRequest, NextResponse } from 'next/server';
import { runIngestion, runMultiZipIngestion, countCommercialPropertiesByZip } from '@/lib/dcad-ingestion';
import { requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { ingestionSettings } from '@/lib/schema';

const DEFAULT_ZIP_CODES = ['75225'];
const DEFAULT_LIMIT = 500;

async function getIngestionSettings(): Promise<{ zipCodes: string[]; limit: number }> {
  try {
    const settings = await db.select().from(ingestionSettings);
    const settingsMap: Record<string, unknown> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }
    
    return {
      zipCodes: (settingsMap.zip_codes as string[]) || DEFAULT_ZIP_CODES,
      limit: (settingsMap.default_limit as number) || DEFAULT_LIMIT,
    };
  } catch (error) {
    console.error('[Ingest] Failed to fetch settings, using defaults:', error);
    return { zipCodes: DEFAULT_ZIP_CODES, limit: DEFAULT_LIMIT };
  }
}

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
    let body: { mode?: string; zipCode?: string; zipCodes?: string[]; limit?: number } = {};
    try {
      body = await request.json();
    } catch {
    }

    const dbSettings = await getIngestionSettings();
    
    const configuredZipCodes = body.zipCodes || dbSettings.zipCodes;
    const configuredLimit = body.limit || dbSettings.limit;

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
      for (const zip of configuredZipCodes) {
        const count = await countCommercialPropertiesByZip(zip);
        zipCounts[zip] = count;
        totalParcels += count;
      }
      return NextResponse.json({
        success: true,
        totalParcels,
        zipCounts,
        configuredZipCodes,
        configuredLimit,
      });
    }

    if (body.mode === 'multi-zip') {
      console.log(`Starting DCAD-based ingestion for ${configuredZipCodes.length} ZIP codes: ${configuredZipCodes.join(', ')} with limit ${configuredLimit}`);
      const stats = await runMultiZipIngestion(configuredZipCodes, configuredLimit);
      return NextResponse.json({
        success: true,
        mode: 'multi-zip',
        zipCodes: configuredZipCodes,
        limit: configuredLimit,
        stats,
      });
    }

    const zipCode = body.zipCode || configuredZipCodes[0];
    console.log(`Starting DCAD-based ingestion for ZIP ${zipCode} with limit ${configuredLimit}`);
    const stats = await runIngestion(zipCode, configuredLimit);
    
    return NextResponse.json({
      success: true,
      mode: 'mvp',
      zipCode,
      limit: configuredLimit,
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
