/**
 * Query Performance Benchmarks
 *
 * Runs common query patterns against the properties table and reports
 * Avg / Min / Max / P95 latency plus row counts.
 *
 * Usage:
 *   npx tsx scripts/benchmark-queries.ts
 *   ITERATIONS=20 npx tsx scripts/benchmark-queries.ts
 */

import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq, and, gte, lte, ilike, sql, count } from 'drizzle-orm';

const ITERATIONS = parseInt(process.env.ITERATIONS || '10', 10);

// Dallas metro bounding box (roughly)
const DALLAS_BBOX = {
  minLat: 32.65,
  maxLat: 32.95,
  minLon: -96.95,
  maxLon: -96.65,
};

interface BenchmarkResult {
  name: string;
  times: number[];
  rowCount: number;
}

async function timeQuery<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  return { result, ms };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Benchmark definitions ──────────────────────────────────────────────

async function benchGeoJsonBBox(): Promise<BenchmarkResult> {
  const times: number[] = [];
  let rowCount = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const { result, ms } = await timeQuery(() =>
      db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            gte(properties.lat, DALLAS_BBOX.minLat),
            lte(properties.lat, DALLAS_BBOX.maxLat),
            gte(properties.lon, DALLAS_BBOX.minLon),
            lte(properties.lon, DALLAS_BBOX.maxLon)
          )
        )
    );
    times.push(ms);
    rowCount = result.length;
  }

  return { name: 'GeoJSON bounding-box (Dallas viewport)', times, rowCount };
}

async function benchTextSearch(): Promise<BenchmarkResult> {
  const times: number[] = [];
  let rowCount = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const { result, ms } = await timeQuery(() =>
      db
        .select({ id: properties.id })
        .from(properties)
        .where(ilike(properties.regridAddress, '%plaza%'))
    );
    times.push(ms);
    rowCount = result.length;
  }

  return { name: 'Text search (ilike "plaza")', times, rowCount };
}

async function benchFilteredQuery(): Promise<BenchmarkResult> {
  const times: number[] = [];
  let rowCount = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const { result, ms } = await timeQuery(() =>
      db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.assetCategory, 'Office'),
            gte(properties.buildingSqft, 10000)
          )
        )
    );
    times.push(ms);
    rowCount = result.length;
  }

  return { name: 'Filtered (Office + >10k sqft)', times, rowCount };
}

async function benchCountyFilter(): Promise<BenchmarkResult> {
  const times: number[] = [];
  let rowCount = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const { result, ms } = await timeQuery(() =>
      db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.cadCountyCode, 'DCAD'))
    );
    times.push(ms);
    rowCount = result.length;
  }

  return { name: 'County filter (DCAD)', times, rowCount };
}

async function benchCountParents(): Promise<BenchmarkResult> {
  const times: number[] = [];
  let rowCount = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const { result, ms } = await timeQuery(() =>
      db
        .select({ total: count() })
        .from(properties)
        .where(eq(properties.isParentProperty, true))
    );
    times.push(ms);
    rowCount = result[0]?.total ?? 0;
  }

  return { name: 'Count all active parent properties', times, rowCount };
}

// ── Runner ─────────────────────────────────────────────────────────────

function formatRow(r: BenchmarkResult): string {
  const sorted = [...r.times].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p95 = percentile(sorted, 95);

  return [
    r.name.padEnd(42),
    `${avg.toFixed(1).padStart(8)} ms`,
    `${min.toFixed(1).padStart(8)} ms`,
    `${max.toFixed(1).padStart(8)} ms`,
    `${p95.toFixed(1).padStart(8)} ms`,
    `${String(r.rowCount).padStart(8)} rows`,
  ].join('  |  ');
}

async function main() {
  console.log(`\nRunning ${ITERATIONS} iterations per query...\n`);

  const benchmarks = [
    benchGeoJsonBBox,
    benchTextSearch,
    benchFilteredQuery,
    benchCountyFilter,
    benchCountParents,
  ];

  const header = [
    'Query'.padEnd(42),
    '     Avg',
    '     Min',
    '     Max',
    '     P95',
    '    Rows',
  ].join('  |  ');

  const separator = '-'.repeat(header.length);

  console.log(header);
  console.log(separator);

  for (const bench of benchmarks) {
    const result = await bench();
    console.log(formatRow(result));
  }

  console.log(separator);
  console.log('\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
