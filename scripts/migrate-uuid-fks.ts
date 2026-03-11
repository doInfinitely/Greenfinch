/**
 * Epic 11 — Data migration: populate UUID FK columns on lookup tables
 *
 * Run after applying the 0004 schema migration.
 * Usage: npx tsx scripts/migrate-uuid-fks.ts
 */

import { db } from '../src/lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Epic 11: Populating UUID FK columns on lookup tables...\n');

  // 1. parcel_to_property.property_id from properties.id via propertyKey join
  const p2pResult = await db.execute(sql`
    UPDATE parcel_to_property ptp
    SET property_id = p.id
    FROM properties p
    WHERE ptp.property_key = p.property_key
      AND ptp.property_id IS NULL
  `);
  console.log(`parcel_to_property: updated ${p2pResult.rowCount} rows`);

  // 2. parcelnumb_mapping.parent_property_id from properties.id via parentPropertyKey join
  const pmResult = await db.execute(sql`
    UPDATE parcelnumb_mapping pm
    SET parent_property_id = p.id
    FROM properties p
    WHERE pm.parent_property_key = p.property_key
      AND pm.parent_property_id IS NULL
  `);
  console.log(`parcelnumb_mapping: updated ${pmResult.rowCount} rows`);

  // 3. Verification
  const [p2pOrphans] = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM parcel_to_property
    WHERE property_key IS NOT NULL AND property_id IS NULL
  `);
  const [pmOrphans] = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM parcelnumb_mapping
    WHERE parent_property_key IS NOT NULL AND parent_property_id IS NULL
  `);

  console.log(`\nVerification:`);
  console.log(`  parcel_to_property orphans (property_key set but property_id NULL): ${(p2pOrphans as any).cnt}`);
  console.log(`  parcelnumb_mapping orphans (parent_property_key set but parent_property_id NULL): ${(pmOrphans as any).cnt}`);

  const p2pCount = Number((p2pOrphans as any).cnt);
  const pmCount = Number((pmOrphans as any).cnt);

  if (p2pCount > 0 || pmCount > 0) {
    console.log('\n⚠ Some rows could not be resolved — their property_key references a property that no longer exists.');
  } else {
    console.log('\n✓ All rows resolved successfully.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
