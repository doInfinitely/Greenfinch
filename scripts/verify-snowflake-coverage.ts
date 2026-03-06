/**
 * Verification script: checks that local PostgreSQL `properties` table
 * covers the Regrid parcel data still in Snowflake (TX_DALLAS).
 *
 * The DCAD_LAND_2025 database no longer exists in Snowflake, so we can only
 * compare the Regrid parcels. This verifies that after CAD download + ingestion,
 * all parcels that were queryable via Snowflake are present locally.
 *
 * Usage:
 *   npx tsx scripts/verify-snowflake-coverage.ts [--sample N] [--zip ZIPCODE] [--limit N]
 *
 * Requires SNOWFLAKE_* and DATABASE_URL env vars.
 */

import snowflakePkg from 'snowflake-sdk';
const snowflake = (snowflakePkg as any).default || snowflakePkg;
import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq, and, inArray } from 'drizzle-orm';

snowflake.configure({ logLevel: 'ERROR' });

const REGRID_TABLE = 'NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE.PREMIUM_PARCELS.TX_DALLAS';

// ── Snowflake connection ──────────────────────────────────────────────

function formatPrivateKey(key: string): string {
  let formatted = key.trim();
  if (formatted.indexOf('\n') === -1) {
    formatted = formatted
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
    const header = '-----BEGIN PRIVATE KEY-----\n';
    const footer = '\n-----END PRIVATE KEY-----';
    const body = formatted.slice(header.length - 1, formatted.length - footer.length + 1).trim();
    const bodyWithNewlines = body.match(/.{1,64}/g)?.join('\n') || body;
    formatted = `-----BEGIN PRIVATE KEY-----\n${bodyWithNewlines}\n-----END PRIVATE KEY-----`;
  }
  return formatted;
}

function executeQuery<T>(sqlText: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
    if (!privateKey) throw new Error('SNOWFLAKE_PRIVATE_KEY not set');

    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT_GF!,
      username: process.env.SNOWFLAKE_USER_GF!,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey: formatPrivateKey(privateKey),
      database: process.env.SNOWFLAKE_REGRID_DB!,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    });

    connection.connect((err: any) => {
      if (err) { reject(err); return; }
      connection.execute({
        sqlText,
        complete: (err: any, _stmt: any, rows: any[]) => {
          connection.destroy(() => {});
          if (err) reject(err);
          else resolve((rows || []) as T[]);
        },
      });
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let sampleSize = 50;
  let zipFilter: string | undefined;
  let limit = 0; // 0 = no limit

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i + 1]) sampleSize = parseInt(args[i + 1]);
    if (args[i] === '--zip' && args[i + 1]) zipFilter = args[i + 1];
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
  }
  return { sampleSize, zipFilter, limit };
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.00%';
  return (n / total * 100).toFixed(2) + '%';
}

function normalizeStr(s: string | null | undefined): string {
  return (s || '').trim().toUpperCase();
}

function closeEnough(a: number | null | undefined, b: number | null | undefined, tolerance = 0.01): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= tolerance;
}

// ── Main ──────────────────────────────────────────────────────────────

interface SnowflakeParcel {
  PARCELNUMB: string;
  LL_UUID: string;
  LL_STACK_UUID: string | null;
  ADDRESS: string | null;
  SCITY: string | null;
  SZIP: string | null;
  OWNER: string | null;
  USEDESC: string | null;
  YEARBUILT: number | null;
  PARVAL: number | null;
  IMPROVVAL: number | null;
  LANDVAL: number | null;
  SQFT: number | null;
  LL_GISACRE: number | null;
}

async function main() {
  const { sampleSize, zipFilter, limit } = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║    Snowflake Regrid → Local Properties Coverage Check   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (zipFilter) console.log(`  ZIP filter: ${zipFilter}`);
  if (limit) console.log(`  Limit: ${limit}`);
  console.log(`  Sample size for field checks: ${sampleSize}`);
  console.log();

  // ── 1. Count Snowflake parcels ────────────────────────────────────

  const zipClause = zipFilter ? `WHERE "szip" LIKE '${zipFilter}%'` : '';
  const limitClause = limit ? `LIMIT ${limit}` : '';

  console.log('━━━ Step 1: Count parcels in Snowflake ━━━');
  const countResult = await executeQuery<{ CNT: number }>(
    `SELECT COUNT(*) AS CNT FROM ${REGRID_TABLE} ${zipClause}`
  );
  const snowflakeTotal = countResult[0]?.CNT || 0;
  console.log(`  Snowflake TX_DALLAS parcels: ${snowflakeTotal.toLocaleString()}`);

  // ── 2. Download parcel keys from Snowflake ────────────────────────

  console.log('\n━━━ Step 2: Download parcel identifiers from Snowflake ━━━');
  const sfParcels = await executeQuery<SnowflakeParcel>(`
    SELECT "parcelnumb" AS PARCELNUMB,
           "ll_uuid" AS LL_UUID,
           "ll_stack_uuid" AS LL_STACK_UUID,
           "address" AS ADDRESS,
           "scity" AS SCITY,
           "szip" AS SZIP,
           "owner" AS OWNER,
           "usedesc" AS USEDESC,
           "yearbuilt" AS YEARBUILT,
           "parval" AS PARVAL,
           "improvval" AS IMPROVVAL,
           "landval" AS LANDVAL,
           "sqft" AS SQFT,
           "ll_gisacre" AS LL_GISACRE
    FROM ${REGRID_TABLE}
    ${zipClause}
    ${limitClause}
  `);
  console.log(`  Downloaded ${sfParcels.length.toLocaleString()} parcels`);

  // Build lookup maps keyed by different identifiers
  // Our properties table uses propertyKey = COALESCE(ll_stack_uuid, ll_uuid)
  const sfByPropertyKey = new Map<string, SnowflakeParcel>();
  const sfByLlUuid = new Map<string, SnowflakeParcel>();
  const sfByParcelnumb = new Map<string, SnowflakeParcel>();

  for (const p of sfParcels) {
    const propertyKey = p.LL_STACK_UUID || p.LL_UUID;
    sfByPropertyKey.set(propertyKey, p);
    sfByLlUuid.set(p.LL_UUID, p);
    if (p.PARCELNUMB) sfByParcelnumb.set(p.PARCELNUMB, p);
  }

  console.log(`  Unique property keys (stack||uuid): ${sfByPropertyKey.size.toLocaleString()}`);
  console.log(`  Unique ll_uuids: ${sfByLlUuid.size.toLocaleString()}`);
  console.log(`  Unique parcelnumbs: ${sfByParcelnumb.size.toLocaleString()}`);

  // ── 3. Check local properties table ───────────────────────────────

  console.log('\n━━━ Step 3: Check local properties coverage ━━━');

  // Get all property keys from local DB
  const localProps = await db.select({
    propertyKey: properties.propertyKey,
    sourceLlUuid: properties.sourceLlUuid,
  }).from(properties);

  const localPropertyKeys = new Set(localProps.map(p => p.propertyKey));
  const localLlUuids = new Set(localProps.map(p => p.sourceLlUuid).filter(Boolean));

  console.log(`  Local properties: ${localPropertyKeys.size.toLocaleString()}`);

  // Check coverage by property key
  const missingByKey = Array.from(sfByPropertyKey.keys()).filter(k => !localPropertyKeys.has(k));
  console.log(`  Missing by propertyKey: ${missingByKey.length.toLocaleString()} / ${sfByPropertyKey.size.toLocaleString()} (${pct(sfByPropertyKey.size - missingByKey.length, sfByPropertyKey.size)} coverage)`);

  // Check coverage by ll_uuid
  const missingByUuid = Array.from(sfByLlUuid.keys()).filter(k => !localLlUuids.has(k));
  console.log(`  Missing by ll_uuid: ${missingByUuid.length.toLocaleString()} / ${sfByLlUuid.size.toLocaleString()} (${pct(sfByLlUuid.size - missingByUuid.length, sfByLlUuid.size)} coverage)`);

  // Show sample of missing
  if (missingByKey.length > 0 && missingByKey.length <= 20) {
    console.log(`\n  Missing property keys:`);
    for (const key of missingByKey) {
      const p = sfByPropertyKey.get(key);
      console.log(`    ${key} — ${p?.ADDRESS}, ${p?.SCITY} ${p?.SZIP}`);
    }
  } else if (missingByKey.length > 20) {
    console.log(`\n  First 20 missing property keys:`);
    for (const key of missingByKey.slice(0, 20)) {
      const p = sfByPropertyKey.get(key);
      console.log(`    ${key} — ${p?.ADDRESS}, ${p?.SCITY} ${p?.SZIP}`);
    }
  }

  // ── 4. Field-level spot check ─────────────────────────────────────

  console.log(`\n━━━ Step 4: Field-level spot check (${sampleSize} properties) ━━━`);

  // Pick random property keys that exist in both
  const matchedKeys = Array.from(sfByPropertyKey.keys()).filter(k => localPropertyKeys.has(k));
  const sampleKeys = matchedKeys.sort(() => Math.random() - 0.5).slice(0, sampleSize);
  let fieldMismatches = 0;

  if (sampleKeys.length > 0) {
    const localSample = await db.select().from(properties)
      .where(inArray(properties.propertyKey, sampleKeys));
    const localSampleMap = new Map(localSample.map(p => [p.propertyKey, p]));

    for (const key of sampleKeys) {
      const sf = sfByPropertyKey.get(key);
      const local = localSampleMap.get(key);
      if (!sf || !local) continue;

      // Compare address
      if (normalizeStr(sf.ADDRESS) !== normalizeStr(local.regridAddress) &&
          normalizeStr(sf.ADDRESS) !== normalizeStr(local.validatedAddress)) {
        fieldMismatches++;
        if (fieldMismatches <= 10) {
          console.log(`  MISMATCH ${key}.address: SF="${sf.ADDRESS}" vs LOCAL="${local.regridAddress}"`);
        }
      }

      // Compare city
      if (normalizeStr(sf.SCITY) !== normalizeStr(local.city)) {
        fieldMismatches++;
        if (fieldMismatches <= 10) {
          console.log(`  MISMATCH ${key}.city: SF="${sf.SCITY}" vs LOCAL="${local.city}"`);
        }
      }

      // Compare zip
      if (normalizeStr(sf.SZIP) !== normalizeStr(local.zip)) {
        fieldMismatches++;
        if (fieldMismatches <= 10) {
          console.log(`  MISMATCH ${key}.zip: SF="${sf.SZIP}" vs LOCAL="${local.zip}"`);
        }
      }

      // Compare lot sqft
      if (!closeEnough(sf.SQFT, local.lotSqft)) {
        fieldMismatches++;
        if (fieldMismatches <= 10) {
          console.log(`  MISMATCH ${key}.lotSqft: SF=${sf.SQFT} vs LOCAL=${local.lotSqft}`);
        }
      }
    }
  }

  console.log(`  Field mismatches in sample: ${fieldMismatches}`);

  // ── 5. ZIP code breakdown ─────────────────────────────────────────

  if (!zipFilter) {
    console.log('\n━━━ Step 5: Coverage by ZIP code (top 20 ZIPs) ━━━');

    const zipCounts = new Map<string, { sf: number; missing: number }>();
    for (const [key, parcel] of sfByPropertyKey.entries()) {
      const zip = (parcel.SZIP || '').trim().substring(0, 5);
      if (!zip) continue;
      const entry = zipCounts.get(zip) || { sf: 0, missing: 0 };
      entry.sf++;
      if (!localPropertyKeys.has(key)) entry.missing++;
      zipCounts.set(zip, entry);
    }

    const sortedZips = Array.from(zipCounts.entries())
      .sort((a, b) => b[1].sf - a[1].sf)
      .slice(0, 20);

    console.log('  ZIP     | Snowflake | Missing | Coverage');
    console.log('  --------|-----------|---------|--------');
    for (const [zip, counts] of sortedZips) {
      const cv = pct(counts.sf - counts.missing, counts.sf);
      console.log(`  ${zip}   | ${counts.sf.toString().padStart(9)} | ${counts.missing.toString().padStart(7)} | ${cv}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                        ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  Snowflake parcels:  ${sfByPropertyKey.size.toString().padStart(10).padEnd(28)} ║`);
  console.log(`║  Local properties:   ${localPropertyKeys.size.toString().padStart(10).padEnd(28)} ║`);
  console.log(`║  Missing locally:    ${missingByKey.length.toString().padStart(10).padEnd(28)} ║`);
  console.log(`║  Coverage:           ${pct(sfByPropertyKey.size - missingByKey.length, sfByPropertyKey.size).padStart(10).padEnd(28)} ║`);
  console.log(`║  Field mismatches:   ${fieldMismatches.toString().padStart(10).padEnd(28)} ║`);
  console.log('╚════════════════════════════════════════════════════╝');

  if (missingByKey.length === 0 && fieldMismatches === 0) {
    console.log('\n  PASS: Local properties fully cover Snowflake Regrid data.');
  } else if (missingByKey.length === 0) {
    console.log(`\n  PARTIAL PASS: All parcels present but ${fieldMismatches} field mismatches in sample.`);
  } else {
    console.log(`\n  INFO: ${missingByKey.length} parcels not yet in local DB.`);
    console.log('  This is expected if you haven\'t run ingestion for all ZIP codes yet.');
    console.log('  Run: npx tsx --env-file=.env.local scripts/verify-snowflake-coverage.ts --zip <ZIP>');
    console.log('  to check specific ZIPs you\'ve ingested.');
  }

  process.exit(missingByKey.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
