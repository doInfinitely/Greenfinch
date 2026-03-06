import { NextRequest, NextResponse } from 'next/server';
import { runIngestion, runMultiZipIngestion, runAllZipsIngestion, countCommercialPropertiesByZip, countAllCommercialProperties, type IngestionFilters } from '@/lib/dcad-ingestion';
import { requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { ingestionSettings } from '@/lib/schema';
import type { CountyCode } from '@/lib/cad/types';

const DEFAULT_ZIP_CODES = ['75225'];
const DEFAULT_LIMIT = 500;
const VALID_COUNTY_CODES: CountyCode[] = ['DCAD', 'TAD', 'CCAD', 'DENT'];

async function getIngestionSettings(): Promise<{ zipCodes: string[]; limit: number; allZips: boolean; filters: IngestionFilters }> {
  try {
    const settings = await db.select().from(ingestionSettings);
    const settingsMap: Record<string, unknown> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    const storedZipCodes = settingsMap.zip_codes as string[] | undefined;
    const storedLimit = settingsMap.default_limit as number | undefined;
    const storedAllZips = settingsMap.all_zips as boolean | undefined;
    const storedFilters = settingsMap.ingestion_filters as IngestionFilters | undefined;

    const zipCodes = Array.isArray(storedZipCodes) && storedZipCodes.length > 0
      ? storedZipCodes
      : DEFAULT_ZIP_CODES;
    const limit = typeof storedLimit === 'number' && storedLimit >= 1 && storedLimit <= 100000
      ? storedLimit
      : DEFAULT_LIMIT;
    const allZips = storedAllZips === true;
    const filters: IngestionFilters = storedFilters || {};

    return { zipCodes, limit, allZips, filters };
  } catch (error) {
    console.error('[Ingest] Failed to fetch settings, using defaults:', error);
    return { zipCodes: DEFAULT_ZIP_CODES, limit: DEFAULT_LIMIT, allZips: false, filters: {} };
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
    let body: { mode?: string; zipCode?: string; zipCodes?: string[]; limit?: number; allZips?: boolean; countyCode?: string } = {};
    try {
      body = await request.json();
    } catch {
    }

    const dbSettings = await getIngestionSettings();

    // Validate optional countyCode
    const countyCode = body.countyCode as CountyCode | undefined;
    if (countyCode && !VALID_COUNTY_CODES.includes(countyCode)) {
      return NextResponse.json(
        { error: `Invalid countyCode. Must be one of: ${VALID_COUNTY_CODES.join(', ')}` },
        { status: 400 }
      );
    }

    let configuredZipCodes = dbSettings.zipCodes;
    let configuredLimit = dbSettings.limit;

    if (body.zipCodes !== undefined && body.allZips !== true) {
      if (!Array.isArray(body.zipCodes) || body.zipCodes.length === 0) {
        return NextResponse.json(
          { error: 'zipCodes must be a non-empty array of 5-digit strings' },
          { status: 400 }
        );
      }
      const validZips = body.zipCodes.filter(z => typeof z === 'string' && /^\d{5}$/.test(z));
      if (validZips.length === 0) {
        return NextResponse.json(
          { error: 'zipCodes must contain at least one valid 5-digit ZIP code' },
          { status: 400 }
        );
      }
      configuredZipCodes = validZips;
    }

    if (body.limit !== undefined) {
      const parsedLimit = typeof body.limit === 'number' ? body.limit : parseInt(String(body.limit));
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100000) {
        return NextResponse.json(
          { error: 'limit must be a number between 1 and 100000' },
          { status: 400 }
        );
      }
      configuredLimit = parsedLimit;
    }

    if (body.mode !== undefined && body.mode !== 'count' && body.mode !== 'mvp' && body.mode !== 'multi-zip' && body.mode !== 'all') {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "count", "mvp", "multi-zip", or "all"' },
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

    const allZips = body.allZips === true || (body.allZips === undefined && dbSettings.allZips);

    if (body.mode === 'count') {
      if (allZips) {
        const totalParcels = await countAllCommercialProperties(countyCode);
        return NextResponse.json({
          success: true,
          totalParcels,
          allZips: true,
          configuredLimit,
          countyCode: countyCode || 'all',
        });
      }
      const zipCountEntries = await Promise.all(
        configuredZipCodes.map(async (zip) => {
          const count = await countCommercialPropertiesByZip(zip, countyCode);
          return [zip, count] as const;
        })
      );
      const zipCounts: Record<string, number> = Object.fromEntries(zipCountEntries);
      const totalParcels = zipCountEntries.reduce((sum, [, c]) => sum + c, 0);
      return NextResponse.json({
        success: true,
        totalParcels,
        zipCounts,
        configuredZipCodes,
        configuredLimit,
        countyCode: countyCode || 'all',
      });
    }

    const configuredFilters = dbSettings.filters;

    if (body.mode === 'all' || allZips) {
      console.log(`Starting CAD-based ingestion for ALL ZIP codes with limit ${configuredLimit}${countyCode ? ` (county: ${countyCode})` : ''}`);
      const stats = await runAllZipsIngestion(configuredLimit, configuredFilters, countyCode);
      return NextResponse.json({
        success: true,
        mode: 'all',
        allZips: true,
        limit: configuredLimit,
        countyCode: countyCode || 'all',
        stats,
      });
    }

    if (body.mode === 'multi-zip') {
      console.log(`Starting CAD-based ingestion for ${configuredZipCodes.length} ZIP codes: ${configuredZipCodes.join(', ')} with limit ${configuredLimit}`);
      const stats = await runMultiZipIngestion(configuredZipCodes, configuredLimit, configuredFilters, countyCode);
      return NextResponse.json({
        success: true,
        mode: 'multi-zip',
        zipCodes: configuredZipCodes,
        limit: configuredLimit,
        countyCode: countyCode || 'all',
        stats,
      });
    }

    if (body.zipCode) {
      console.log(`Starting CAD-based ingestion for ZIP ${body.zipCode} with limit ${configuredLimit}`);
      const stats = await runIngestion(body.zipCode, configuredLimit, configuredFilters, countyCode);
      return NextResponse.json({
        success: true,
        mode: 'mvp',
        zipCode: body.zipCode,
        limit: configuredLimit,
        countyCode: countyCode || 'all',
        stats,
      });
    }

    console.log(`Starting CAD-based ingestion for ${configuredZipCodes.length} ZIP codes: ${configuredZipCodes.join(', ')} with limit ${configuredLimit}`);
    const stats = await runMultiZipIngestion(configuredZipCodes, configuredLimit, configuredFilters, countyCode);
    return NextResponse.json({
      success: true,
      mode: 'multi-zip',
      zipCodes: configuredZipCodes,
      limit: configuredLimit,
      countyCode: countyCode || 'all',
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
