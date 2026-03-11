/**
 * Orchestrates CAD ingestion for all 4 DFW counties sequentially.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ingest-all-dfw.ts [--limit N] [--skip-download]
 *
 * Each county must have its data files at ./data/cad/{COUNTY}/ (for manual-download counties).
 * DCAD downloads automatically; TAD/CCAD/DENT require pre-downloaded files.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { COUNTY_CONFIGS, type CountyCode } from '../src/lib/cad/types';

const DFW_COUNTIES: CountyCode[] = ['DCAD', 'TAD', 'CCAD', 'DENT'];

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 500;
  let skipDownload = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
    if (args[i] === '--skip-download') skipDownload = true;
  }
  return { limit, skipDownload };
}

interface CountyResult {
  county: CountyCode;
  status: 'success' | 'skipped' | 'error';
  durationMs: number;
  message?: string;
}

async function main() {
  const { limit, skipDownload } = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         DFW Metro — Multi-County Ingestion              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Counties: ${DFW_COUNTIES.join(', ')}`);
  console.log(`  Ingestion limit per county: ${limit}`);
  console.log(`  Skip download: ${skipDownload}`);
  console.log();

  const results: CountyResult[] = [];

  for (const county of DFW_COUNTIES) {
    const config = COUNTY_CONFIGS[county];
    const dataDir = `./data/cad/${county}/`;
    const start = Date.now();

    console.log(`\n${'━'.repeat(58)}`);
    console.log(`  Processing: ${config.name} (${county})`);
    console.log(`${'━'.repeat(58)}`);

    // For manual-download counties, check if data dir exists
    if (config.downloadMethod === 'manual') {
      if (!existsSync(dataDir)) {
        console.log(`  WARNING: No data directory found at ${dataDir}`);
        console.log(`  Download files from: ${config.downloadUrl}`);
        console.log(`  Skipping ${county}.`);
        results.push({ county, status: 'skipped', durationMs: Date.now() - start, message: `No data at ${dataDir}` });
        continue;
      }
    }

    try {
      const childArgs = [
        '--env-file=.env.local',
        'scripts/download-and-ingest-cad.ts',
        '--county', county,
        '--limit', String(limit),
      ];

      if (skipDownload) {
        childArgs.push('--skip-download');
      }

      if (config.downloadMethod === 'manual' && existsSync(dataDir)) {
        childArgs.push('--extract-dir', dataDir);
      }

      execFileSync('npx', ['tsx', ...childArgs], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      const elapsed = Date.now() - start;
      console.log(`\n  ${county} completed in ${(elapsed / 1000).toFixed(1)}s`);
      results.push({ county, status: 'success', durationMs: elapsed });
    } catch (error) {
      const elapsed = Date.now() - start;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`\n  ERROR processing ${county}: ${msg}`);
      results.push({ county, status: 'error', durationMs: elapsed, message: msg });
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(58)}`);
  console.log('  DFW Ingestion Summary');
  console.log(`${'═'.repeat(58)}`);
  for (const r of results) {
    const icon = r.status === 'success' ? 'OK' : r.status === 'skipped' ? 'SKIP' : 'ERR';
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    const detail = r.message ? ` — ${r.message}` : '';
    console.log(`  [${icon}] ${r.county.padEnd(6)} ${time.padStart(8)}${detail}`);
  }

  const errors = results.filter(r => r.status === 'error');
  if (errors.length > 0) {
    console.log(`\n  ${errors.length} county(ies) failed. See errors above.`);
    process.exit(1);
  }

  console.log('\n  All counties processed.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
