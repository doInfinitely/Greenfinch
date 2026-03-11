/**
 * Downloads CAD data files for any supported county, parses and stages them
 * into local PostgreSQL, then runs ingestion to populate the properties table.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/download-and-ingest-cad.ts --county DCAD [--zip ZIPCODE] [--limit N] [--skip-download] [--extract-dir /path/to/files]
 *
 * Counties: DCAD (Dallas), TAD (Tarrant), CCAD (Collin), DENT (Denton)
 *
 * For counties with downloadMethod='manual' (TAD, CCAD, DENT), you must
 * download the files yourself and pass --extract-dir to point at them.
 */

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
} from '../src/lib/cad';
import { runIngestion, runAllZipsIngestion } from '../src/lib/dcad-ingestion';
import { COUNTY_CONFIGS, type CountyCode } from '../src/lib/cad/types';

function parseArgs() {
  const args = process.argv.slice(2);
  let county: string | undefined;
  let zipCode: string | undefined;
  let limit = 500;
  let skipDownload = false;
  let extractDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--county' && args[i + 1]) county = args[i + 1].toUpperCase();
    if (args[i] === '--zip' && args[i + 1]) zipCode = args[i + 1];
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
    if (args[i] === '--skip-download') skipDownload = true;
    if (args[i] === '--extract-dir' && args[i + 1]) extractDir = args[i + 1];
  }
  return { county, zipCode, limit, skipDownload, extractDir };
}

async function main() {
  const { county, zipCode, limit, skipDownload, extractDir: extractDirArg } = parseArgs();

  if (!county || !(county in COUNTY_CONFIGS)) {
    console.error(`Error: --county is required. Valid values: ${Object.keys(COUNTY_CONFIGS).join(', ')}`);
    process.exit(1);
  }

  const countyCode = county as CountyCode;
  const config = COUNTY_CONFIGS[countyCode];
  const year = new Date().getFullYear();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log(`║       ${config.name.padEnd(44)}     ║`);
  console.log('║          CAD Download & Ingestion Pipeline              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  County: ${countyCode}`);
  console.log(`  Year: ${year}`);
  if (zipCode) console.log(`  ZIP filter: ${zipCode}`);
  console.log(`  Ingestion limit: ${limit}`);
  console.log(`  Download method: ${config.downloadMethod}`);
  console.log();

  let extractDir: string | null = extractDirArg || null;

  if (!skipDownload && !extractDirArg) {
    if (config.downloadMethod === 'manual') {
      console.error(`Error: ${countyCode} requires manual download. Please download files from:`);
      console.error(`  ${config.downloadUrl}`);
      console.error(`Then re-run with: --extract-dir /path/to/extracted/files`);
      process.exit(1);
    }

    // ── Step 1: Download & Extract ──────────────────────────────────
    console.log('━━━ Step 1: Download & Extract ━━━');
    const downloadId = await createDownloadRecord(countyCode, year);
    console.log(`  Download record: ${downloadId}`);

    try {
      await updateDownloadStatus(downloadId, 'downloading');
      console.log(`  Downloading from ${config.downloadUrl}...`);
      const startDownload = Date.now();
      const result = await downloadAndExtract(countyCode, config.downloadUrl);
      extractDir = result.extractDir;
      console.log(`  Downloaded & extracted in ${((Date.now() - startDownload) / 1000).toFixed(1)}s`);
      console.log(`  Files: ${result.files.join(', ')}`);

      await stageData(countyCode, year, extractDir!, downloadId);
      await updateDownloadStatus(downloadId, 'complete');

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ERROR: ${msg}`);
      await updateDownloadStatus(downloadId, 'error', { errorMessage: msg });
      process.exit(1);
    } finally {
      if (extractDir && !extractDirArg) {
        cleanupTempDir(extractDir);
        console.log('  Cleaned up temp files');
      }
    }
  } else if (extractDirArg && !skipDownload) {
    // Manual download — just stage from the provided directory
    console.log('━━━ Step 1: Using provided extract directory ━━━');
    console.log(`  Directory: ${extractDirArg}`);
    const downloadId = await createDownloadRecord(countyCode, year);
    try {
      await stageData(countyCode, year, extractDirArg, downloadId);
      await updateDownloadStatus(downloadId, 'complete');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ERROR: ${msg}`);
      await updateDownloadStatus(downloadId, 'error', { errorMessage: msg });
      process.exit(1);
    }
  } else {
    console.log('━━━ Skipping download (--skip-download) ━━━');
  }

  // ── Step 3: Ingestion ────────────────────────────────────────────
  console.log('\n━━━ Step 3: Ingestion ━━━');
  const startIngest = Date.now();

  if (zipCode) {
    console.log(`  Running ingestion for ZIP ${zipCode} (limit: ${limit})...`);
    const stats = await runIngestion(zipCode, limit, {}, countyCode);
    console.log(`  Done in ${((Date.now() - startIngest) / 1000).toFixed(1)}s`);
    console.log(`  Stats:`, JSON.stringify(stats, null, 2));
  } else {
    console.log(`  Running ingestion for ALL ZIPs (limit: ${limit})...`);
    const stats = await runAllZipsIngestion(limit, {}, countyCode);
    console.log(`  Done in ${((Date.now() - startIngest) / 1000).toFixed(1)}s`);
    console.log(`  Stats:`, JSON.stringify(stats, null, 2));
  }

  console.log('\n  Pipeline complete.');
}

async function stageData(countyCode: CountyCode, year: number, extractDir: string, downloadId: string) {
  console.log('\n━━━ Step 2: Parse & Stage ━━━');
  await clearStagingData(countyCode, year);
  console.log('  Cleared old staging data');

  const parser = createParser(countyCode, extractDir, year);
  let totalRows = 0;

  console.log('  Staging account info...');
  const startAccounts = Date.now();
  const accountRows = await stageAccountInfo(parser.parseAccountInfo(''), downloadId);
  totalRows += accountRows;
  console.log(`    ${accountRows.toLocaleString()} rows in ${((Date.now() - startAccounts) / 1000).toFixed(1)}s`);

  console.log('  Staging appraisal values...');
  const startAppraisals = Date.now();
  const appraisalRows = await stageAppraisalValues(parser.parseAppraisalValues(''), downloadId);
  totalRows += appraisalRows;
  console.log(`    ${appraisalRows.toLocaleString()} rows in ${((Date.now() - startAppraisals) / 1000).toFixed(1)}s`);

  console.log('  Staging buildings...');
  const startBuildings = Date.now();
  const buildingRows = await stageBuildings(parser.parseBuildings(''), downloadId);
  totalRows += buildingRows;
  console.log(`    ${buildingRows.toLocaleString()} rows in ${((Date.now() - startBuildings) / 1000).toFixed(1)}s`);

  console.log('  Staging land...');
  const startLand = Date.now();
  const landRows = await stageLand(parser.parseLand(''), downloadId);
  totalRows += landRows;
  console.log(`    ${landRows.toLocaleString()} rows in ${((Date.now() - startLand) / 1000).toFixed(1)}s`);

  console.log(`\n  Total staged: ${totalRows.toLocaleString()} rows`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
