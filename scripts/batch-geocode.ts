/**
 * Batch geocodes properties that have lat=0 or lat IS NULL.
 *
 * Supports multiple geocoding providers:
 *   - census:  US Census Bureau Geocoder (free, no API key, batch mode)
 *   - google:  Google Maps Geocoding API (requires GOOGLE_MAPS_API_KEY)
 *   - mapbox:  Mapbox Geocoding API (requires MAPBOX_API_KEY)
 *
 * Usage:
 *   npx tsx scripts/batch-geocode.ts [--provider census|google|mapbox] [--county DCAD] [--limit 1000] [--dry-run]
 */

import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq, and, or, sql, isNull } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

type Provider = 'census' | 'google' | 'mapbox';

// ── Local file cache for geocode results ─────────────────────────────────
const CACHE_FILE = path.join(import.meta.dirname, '..', '.geocode-cache.json');
let geocodeCache: Record<string, { lat: number; lon: number } | null> = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      geocodeCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      console.log(`  Loaded ${Object.keys(geocodeCache).length} cached geocode results`);
    }
  } catch { /* ignore corrupt cache */ }
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(geocodeCache));
}

function getCached(address: string): { lat: number; lon: number } | null | undefined {
  return geocodeCache[address];
}

function setCache(address: string, result: { lat: number; lon: number } | null) {
  geocodeCache[address] = result;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let county: string | undefined;
  let limit = 0;
  let dryRun = false;
  let provider: Provider = 'census';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--county' && args[i + 1]) county = args[i + 1].toUpperCase();
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
    if (args[i] === '--dry-run') dryRun = true;
    if (args[i] === '--provider' && args[i + 1]) provider = args[i + 1] as Provider;
  }
  return { county, limit, dryRun, provider };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Census Bureau Geocoder (free, batch mode) ──────────────────────────────

async function geocodeCensusBatch(
  rows: Array<{ id: string; address: string; city: string; state: string; zip: string }>
): Promise<Map<string, { lat: number; lon: number }>> {
  const results = new Map<string, { lat: number; lon: number }>();

  // Census batch API accepts CSV: unique_id, street, city, state, zip
  const csvLines = rows.map(r =>
    `${r.id},"${r.address}","${r.city}","${r.state}","${r.zip}"`
  );
  const csvContent = csvLines.join('\n');

  const formData = new FormData();
  formData.append('addressFile', new Blob([csvContent], { type: 'text/csv' }), 'addresses.csv');
  formData.append('benchmark', 'Public_AR_Current');

  try {
    const response = await fetch(
      'https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
      { method: 'POST', body: formData }
    );

    if (!response.ok) {
      console.error(`  Census API error: ${response.status} ${response.statusText}`);
      return results;
    }

    const text = await response.text();
    const lines = text.trim().split('\n');

    for (const line of lines) {
      // CSV format: "id","input_address","match","exact/non-exact","matched_address","lon/lat","tiger_line_id","side"
      const parts = line.split('","').map(s => s.replace(/^"|"$/g, ''));
      if (parts.length < 6) continue;

      const id = parts[0].replace(/^"/, '');
      const matchType = parts[2];

      if (matchType === 'Match') {
        const coordStr = parts[5];
        const [lon, lat] = coordStr.split(',').map(Number);
        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          results.set(id, { lat, lon });
        }
      }
    }
  } catch (error) {
    console.error('  Census batch error:', error instanceof Error ? error.message : error);
  }

  return results;
}

// ── Google Maps Geocoder ───────────────────────────────────────────────────

async function geocodeGoogle(
  fullAddress: string, apiKey: string
): Promise<{ lat: number; lon: number } | null> {
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

// ── Mapbox Geocoder ────────────────────────────────────────────────────────

async function geocodeMapbox(
  fullAddress: string, accessToken: string
): Promise<{ lat: number; lon: number } | null> {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(fullAddress)}&country=us&limit=1&access_token=${accessToken}`;
  const response = await fetch(url);
  const data = await response.json();

  const feature = data.features?.[0];
  if (feature?.geometry?.coordinates) {
    const [lon, lat] = feature.geometry.coordinates;
    return { lat, lon };
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { county, limit, dryRun, provider } = parseArgs();

  let apiKey = '';
  if (provider === 'google') {
    apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) { console.error('Error: GOOGLE_MAPS_API_KEY not set'); process.exit(1); }
  } else if (provider === 'mapbox') {
    apiKey = process.env.MAPBOX_API_KEY || '';
    if (!apiKey) { console.error('Error: MAPBOX_API_KEY not set'); process.exit(1); }
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              Batch Geocoding Script                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Provider: ${provider}`);
  if (county) console.log(`  County filter: ${county}`);
  if (limit) console.log(`  Limit: ${limit}`);
  if (dryRun) console.log(`  DRY RUN — no updates will be written`);
  loadCache();
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
    if (county === 'DCAD') {
      // DCAD properties may have NULL cad_county_code (legacy)
      conditions.push(or(
        eq(properties.cadCountyCode, 'DCAD'),
        isNull(properties.cadCountyCode)
      )!);
    } else {
      conditions.push(eq(properties.cadCountyCode, county));
    }
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

  const rows = limit ? await query.limit(limit) : await query;

  console.log(`  Found ${rows.length} properties needing geocoding`);
  if (rows.length === 0) {
    console.log('  Nothing to do.');
    process.exit(0);
  }

  let geocoded = 0;
  let failed = 0;
  let noAddress = 0;
  let cacheHits = 0;
  const startTime = Date.now();

  if (provider === 'census') {
    // Census batch mode: send batches of up to 1000 addresses
    const CENSUS_BATCH = 1000;

    for (let i = 0; i < rows.length; i += CENSUS_BATCH) {
      const batch = rows.slice(i, i + CENSUS_BATCH);

      // Build address records
      const addressRows: Array<{ id: string; address: string; city: string; state: string; zip: string }> = [];
      const batchNoAddress: string[] = [];

      for (const row of batch) {
        const address = row.validatedAddress || row.regridAddress;
        if (!address) {
          noAddress++;
          batchNoAddress.push(row.id);
          continue;
        }
        addressRows.push({
          id: row.id,
          address,
          city: row.city || '',
          state: row.state || 'TX',
          zip: (row.zip || '').substring(0, 5),
        });
      }

      if (addressRows.length > 0) {
        const results = await geocodeCensusBatch(addressRows);

        // Update DB
        for (const [id, coords] of results) {
          if (!dryRun) {
            await db
              .update(properties)
              .set({ lat: coords.lat, lon: coords.lon })
              .where(eq(properties.id, id));
          }
          geocoded++;
        }

        failed += addressRows.length - results.size;
      }

      const processed = Math.min(i + CENSUS_BATCH, rows.length);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Progress: ${processed}/${rows.length} | geocoded: ${geocoded} | failed: ${failed} | no-address: ${noAddress} | ${elapsed}s`);

      // Small delay between batches to be nice to Census API
      if (i + CENSUS_BATCH < rows.length) {
        await sleep(500);
      }
    }
  } else {
    // Single-address mode (Google/Mapbox)
    const BATCH_SIZE = 40;
    const DELAY_MS = provider === 'mapbox' ? 200 : 1050;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      // Split batch into cached vs uncached
      const uncachedRows: typeof batch = [];
      for (const row of batch) {
        const address = row.validatedAddress || row.regridAddress;
        if (!address) { noAddress++; continue; }

        const fullAddress = [address, row.city, row.state || 'TX', row.zip].filter(Boolean).join(', ');
        const cached = getCached(fullAddress);
        if (cached !== undefined) {
          // Cache hit (could be null = previously failed)
          if (cached) {
            if (!dryRun) {
              await db.update(properties).set({ lat: cached.lat, lon: cached.lon }).where(eq(properties.id, row.id));
            }
            geocoded++;
          } else {
            failed++;
          }
          cacheHits++;
        } else {
          uncachedRows.push(row);
        }
      }

      // Only call API for uncached addresses
      const promises = uncachedRows.map(async (row) => {
        const address = row.validatedAddress || row.regridAddress;
        if (!address) return;

        const fullAddress = [address, row.city, row.state || 'TX', row.zip].filter(Boolean).join(', ');

        try {
          const result = provider === 'google'
            ? await geocodeGoogle(fullAddress, apiKey)
            : await geocodeMapbox(fullAddress, apiKey);

          setCache(fullAddress, result);

          if (result) {
            if (!dryRun) {
              await db
                .update(properties)
                .set({ lat: result.lat, lon: result.lon })
                .where(eq(properties.id, row.id));
            }
            geocoded++;
          } else {
            failed++;
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('rate limit')) {
            throw error;
          }
          failed++;
        }
      });

      if (promises.length > 0) await Promise.all(promises);

      const processed = Math.min(i + BATCH_SIZE, rows.length);
      if (processed % 200 === 0 || processed === rows.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = geocoded > 0 ? (geocoded / ((Date.now() - startTime) / 1000)).toFixed(1) : '0';
        console.log(`  Progress: ${processed}/${rows.length} | geocoded: ${geocoded} | failed: ${failed} | no-address: ${noAddress} | cache-hits: ${cacheHits} | ${elapsed}s | ${rate}/s`);
        saveCache();
      }

      // Only delay if we made API calls
      if (uncachedRows.length > 0 && i + BATCH_SIZE < rows.length) {
        await sleep(DELAY_MS);
      }
    }
  }

  saveCache();
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Complete in ${totalTime}s`);
  console.log(`  Geocoded: ${geocoded}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  No address: ${noAddress}`);
  console.log(`  Cache hits: ${cacheHits}`);
  if (dryRun) console.log(`  (DRY RUN — no database updates made)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
