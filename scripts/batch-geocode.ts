/**
 * Batch geocodes properties that have lat=0 or lat IS NULL.
 * Critical for newly-ingested counties where CAD data has no coordinates.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/batch-geocode.ts [--county DCAD] [--limit 1000] [--dry-run]
 */

import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq, and, or, sql, isNull } from 'drizzle-orm';

function parseArgs() {
  const args = process.argv.slice(2);
  let county: string | undefined;
  let limit = 0; // 0 = unlimited
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--county' && args[i + 1]) county = args[i + 1].toUpperCase();
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
    if (args[i] === '--dry-run') dryRun = true;
  }
  return { county, limit, dryRun };
}

const BATCH_SIZE = 40; // Stay under Google's 50 QPS limit
const DELAY_MS = 1050; // ~1 second between batches

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeAddress(fullAddress: string, apiKey: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lon: lng };
  }

  if (data.status === 'OVER_QUERY_LIMIT') {
    throw new Error('Google Geocoding API rate limit exceeded');
  }

  return null;
}

async function main() {
  const { county, limit, dryRun } = parseArgs();

  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleApiKey) {
    console.error('Error: GOOGLE_MAPS_API_KEY not set in environment');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              Batch Geocoding Script                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (county) console.log(`  County filter: ${county}`);
  if (limit) console.log(`  Limit: ${limit}`);
  if (dryRun) console.log(`  DRY RUN — no updates will be written`);
  console.log();

  // Query properties needing geocoding
  const conditions = [
    eq(properties.isActive, true),
    or(
      eq(properties.lat, 0),
      isNull(properties.lat)
    ),
  ];

  if (county) {
    conditions.push(eq(properties.cadCountyCode, county));
  }

  let query = db
    .select({
      id: properties.id,
      propertyKey: properties.propertyKey,
      validatedAddress: properties.validatedAddress,
      regridAddress: properties.regridAddress,
      city: properties.city,
      state: properties.state,
      zip: properties.zip,
    })
    .from(properties)
    .where(and(...conditions))
    .orderBy(properties.propertyKey);

  const rows = limit
    ? await query.limit(limit)
    : await query;

  console.log(`  Found ${rows.length} properties needing geocoding`);
  if (rows.length === 0) {
    console.log('  Nothing to do.');
    process.exit(0);
  }

  let geocoded = 0;
  let failed = 0;
  let noAddress = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (row) => {
      const address = row.validatedAddress || row.regridAddress;
      if (!address) {
        noAddress++;
        return;
      }

      const fullAddress = [address, row.city, row.state, row.zip].filter(Boolean).join(', ');

      try {
        const result = await geocodeAddress(fullAddress, googleApiKey);
        if (result) {
          if (!dryRun) {
            await db
              .update(properties)
              .set({
                lat: result.lat,
                lon: result.lon,
                geocodedLat: result.lat,
                geocodedLon: result.lon,
              })
              .where(eq(properties.id, row.id));
          }
          geocoded++;
        } else {
          failed++;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('rate limit')) {
          throw error; // Propagate rate limit errors to stop processing
        }
        failed++;
      }
    });

    await Promise.all(promises);

    const processed = Math.min(i + BATCH_SIZE, rows.length);
    if (processed % 100 === 0 || processed === rows.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (geocoded / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`  Progress: ${processed}/${rows.length} | geocoded: ${geocoded} | failed: ${failed} | no-address: ${noAddress} | ${elapsed}s | ${rate}/s`);
    }

    // Rate limit delay between batches
    if (i + BATCH_SIZE < rows.length) {
      await sleep(DELAY_MS);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Complete in ${totalTime}s`);
  console.log(`  Geocoded: ${geocoded}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  No address: ${noAddress}`);
  if (dryRun) console.log(`  (DRY RUN — no database updates made)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
