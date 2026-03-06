/**
 * Downloads DCAD data files, parses and stages them into local PostgreSQL,
 * then runs ingestion to populate the properties table.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/download-and-ingest-dcad.ts [--zip ZIPCODE] [--limit N] [--skip-download]
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

function parseArgs() {
  const args = process.argv.slice(2);
  let zipCode: string | undefined;
  let limit = 500;
  let skipDownload = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--zip' && args[i + 1]) zipCode = args[i + 1];
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
    if (args[i] === '--skip-download') skipDownload = true;
  }
  return { zipCode, limit, skipDownload };
}

async function main() {
  const { zipCode, limit, skipDownload } = parseArgs();
  const countyCode = 'DCAD';
  const year = 2025;
  const downloadUrl = 'https://www.dallascad.org/ViewPDFs.aspx?type=3&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CDATA%20PRODUCTS%5CDCAD2025_CURRENT.ZIP';

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          DCAD Download & Ingestion Pipeline             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  County: ${countyCode}`);
  console.log(`  Year: ${year}`);
  if (zipCode) console.log(`  ZIP filter: ${zipCode}`);
  console.log(`  Ingestion limit: ${limit}`);
  console.log();

  if (!skipDownload) {
    // ── Step 1: Download & Extract ──────────────────────────────────
    console.log('━━━ Step 1: Download & Extract ━━━');
    const downloadId = await createDownloadRecord(countyCode, year);
    console.log(`  Download record: ${downloadId}`);

    let extractDir: string | null = null;
    try {
      await updateDownloadStatus(downloadId, 'downloading');
      console.log(`  Downloading from ${downloadUrl}...`);
      const startDownload = Date.now();
      const result = await downloadAndExtract(countyCode, downloadUrl);
      extractDir = result.extractDir;
      console.log(`  Downloaded & extracted in ${((Date.now() - startDownload) / 1000).toFixed(1)}s`);
      console.log(`  Files: ${result.files.join(', ')}`);

      // ── Step 2: Parse & Stage ──────────────────────────────────────
      console.log('\n━━━ Step 2: Parse & Stage ━━━');
      await updateDownloadStatus(downloadId, 'parsing');
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

      await updateDownloadStatus(downloadId, 'complete', { rowsImported: totalRows });
      console.log(`\n  Total staged: ${totalRows.toLocaleString()} rows`);

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ERROR: ${msg}`);
      await updateDownloadStatus(downloadId, 'error', { errorMessage: msg });
      process.exit(1);
    } finally {
      if (extractDir) {
        cleanupTempDir(extractDir);
        console.log('  Cleaned up temp files');
      }
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

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
