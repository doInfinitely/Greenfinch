import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { cadDownloads } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import type { CountyCode } from '@/lib/cad/types';
import { COUNTY_CONFIGS } from '@/lib/cad/types';
import {
  downloadAndExtract,
  cleanupTempDir,
  createParser,
  createDownloadRecord,
  updateDownloadStatus,
  stageAccountInfo,
  stageAppraisalValues,
  stageBuildings,
  stageLand,
  clearStagingData,
} from '@/lib/cad';

const VALID_COUNTY_CODES: CountyCode[] = ['DCAD', 'TAD', 'CCAD', 'DENT'];

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
    const body = await request.json();
    const { countyCode, year = 2025, downloadUrl } = body;

    if (!countyCode || !VALID_COUNTY_CODES.includes(countyCode)) {
      return NextResponse.json(
        { error: `Invalid countyCode. Must be one of: ${VALID_COUNTY_CODES.join(', ')}` },
        { status: 400 },
      );
    }

    if (typeof year !== 'number' || year < 2020 || year > 2030) {
      return NextResponse.json(
        { error: 'Invalid year. Must be between 2020 and 2030' },
        { status: 400 },
      );
    }

    const config = COUNTY_CONFIGS[countyCode as CountyCode];
    const url = downloadUrl || config.downloadUrl;

    // Create download record
    const downloadId = await createDownloadRecord(countyCode, year);
    console.log(`[CAD Download] Created download record ${downloadId} for ${countyCode} year ${year}`);

    // Run download/parse/stage pipeline asynchronously
    runDownloadPipeline(downloadId, countyCode as CountyCode, year, url).catch(err => {
      console.error(`[CAD Download] Pipeline error for ${downloadId}:`, err);
    });

    return NextResponse.json({
      downloadId,
      status: 'started',
      countyCode,
      year,
      message: `Download started for ${config.name}. Check status at GET /api/admin/cad-download?id=${downloadId}`,
    });
  } catch (error) {
    console.error('[CAD Download] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start download', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

async function runDownloadPipeline(
  downloadId: string,
  countyCode: CountyCode,
  year: number,
  downloadUrl: string,
) {
  let extractDir: string | null = null;

  try {
    // Step 1: Download
    await updateDownloadStatus(downloadId, 'downloading');
    const result = await downloadAndExtract(countyCode, downloadUrl);
    extractDir = result.extractDir;

    // Step 2: Clear old data and parse
    await updateDownloadStatus(downloadId, 'parsing');
    await clearStagingData(countyCode, year);

    const parser = createParser(countyCode, extractDir, year);
    let totalRows = 0;

    // Stage account info
    const accountRows = await stageAccountInfo(parser.parseAccountInfo(''), downloadId);
    totalRows += accountRows;

    // Stage appraisal values
    const appraisalRows = await stageAppraisalValues(parser.parseAppraisalValues(''), downloadId);
    totalRows += appraisalRows;

    // Stage buildings
    const buildingRows = await stageBuildings(parser.parseBuildings(''), downloadId);
    totalRows += buildingRows;

    // Stage land
    const landRows = await stageLand(parser.parseLand(''), downloadId);
    totalRows += landRows;

    // Step 3: Complete
    await updateDownloadStatus(downloadId, 'complete', { rowsImported: totalRows });
    console.log(`[CAD Download] Pipeline complete for ${countyCode}: ${totalRows} total rows staged`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CAD Download] Pipeline failed for ${countyCode}:`, errorMessage);
    await updateDownloadStatus(downloadId, 'error', { errorMessage });
  } finally {
    if (extractDir) {
      cleanupTempDir(extractDir);
    }
  }
}

export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const [download] = await db
        .select()
        .from(cadDownloads)
        .where(eq(cadDownloads.id, id));

      if (!download) {
        return NextResponse.json({ error: 'Download not found' }, { status: 404 });
      }

      return NextResponse.json(download);
    }

    // List all downloads
    const downloads = await db
      .select()
      .from(cadDownloads)
      .orderBy(desc(cadDownloads.createdAt))
      .limit(50);

    return NextResponse.json({ downloads });
  } catch (error) {
    console.error('[CAD Download] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch downloads' },
      { status: 500 },
    );
  }
}
