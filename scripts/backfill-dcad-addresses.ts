/**
 * Backfills regrid_address for DCAD properties by constructing addresses from
 * STREET_NUM + FULL_STREET_NAME in the raw CSV data.
 *
 * Usage:
 *   npx tsx scripts/backfill-dcad-addresses.ts [--dry-run]
 */

import { db } from '../src/lib/db';
import { properties } from '../src/lib/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Backfill DCAD Property Addresses                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (dryRun) console.log('  DRY RUN — no updates');

  // Read DCAD CSV and build address map
  const csvPath = path.join(import.meta.dirname, '..', 'data', 'cad', 'DCAD', 'ACCOUNT_INFO.CSV');
  if (!fs.existsSync(csvPath)) {
    console.error('  Error: DCAD ACCOUNT_INFO.CSV not found at', csvPath);
    process.exit(1);
  }

  console.log('  Reading DCAD CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, relax_column_count: true });
  console.log(`  Parsed ${rows.length} CSV rows`);

  // Build account_num → address map
  const addressMap = new Map<string, { address: string; city: string; zip: string }>();
  let hasAddr = 0;

  for (const row of rows) {
    const accountNum = (row['ACCOUNT_NUM'] || '').trim();
    const streetNum = (row['STREET_NUM'] || '').trim();
    const streetName = (row['FULL_STREET_NAME'] || '').trim();
    const city = (row['PROPERTY_CITY'] || '').trim();
    const zip = (row['PROPERTY_ZIPCODE'] || '').trim().substring(0, 5);

    if (!accountNum) continue;
    const key = `DCAD-${accountNum}`;
    if (streetNum && streetName) {
      const address = `${streetNum} ${streetName}`;
      addressMap.set(key, { address, city, zip });
      hasAddr++;
    } else if (streetName) {
      // Some properties have street name but no number
      addressMap.set(key, { address: streetName, city, zip });
      hasAddr++;
    }
  }

  console.log(`  ${hasAddr} CSV rows have constructable addresses`);

  // Get DCAD properties needing addresses
  const dcadProps = await db
    .select({ id: properties.id, propertyKey: properties.propertyKey })
    .from(properties)
    .where(and(
      eq(properties.isActive, true),
      or(isNull(properties.cadCountyCode), eq(properties.cadCountyCode, 'DCAD')),
      or(isNull(properties.regridAddress), eq(properties.regridAddress, ''))
    ));

  console.log(`  ${dcadProps.length} DCAD properties need addresses`);

  // Match and update
  let updated = 0;
  let noMatch = 0;
  const BATCH_SIZE = 200;

  for (let i = 0; i < dcadProps.length; i += BATCH_SIZE) {
    const batch = dcadProps.slice(i, i + BATCH_SIZE);
    const updates: Promise<void>[] = [];

    for (const prop of batch) {
      const addrData = addressMap.get(prop.propertyKey);
      if (!addrData) {
        noMatch++;
        continue;
      }

      const fullAddr = `${addrData.address}, ${addrData.city}, TX ${addrData.zip}`;

      if (!dryRun) {
        updates.push(
          db.update(properties)
            .set({
              regridAddress: fullAddr,
              city: addrData.city || undefined,
              zip: addrData.zip || undefined,
            })
            .where(eq(properties.id, prop.id))
            .then(() => { updated++; })
        );
      } else {
        updated++;
      }
    }

    if (updates.length > 0) await Promise.all(updates);

    const processed = Math.min(i + BATCH_SIZE, dcadProps.length);
    if (processed % 5000 === 0 || processed === dcadProps.length) {
      console.log(`  Progress: ${processed}/${dcadProps.length} | updated: ${updated} | no-match: ${noMatch}`);
    }
  }

  console.log(`\n  Done! Updated: ${updated}, No match: ${noMatch}`);
  if (dryRun) console.log('  (DRY RUN — no database updates made)');
}

main().catch(console.error).finally(() => process.exit(0));
