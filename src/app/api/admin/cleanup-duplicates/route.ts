import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { runDeduplication } from '@/lib/deduplication';

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();

    const pcDupes = await db.execute(sql`
      SELECT COUNT(*) as total_dupes FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY property_id, contact_id ORDER BY discovered_at ASC NULLS LAST, id ASC
        ) as rn FROM property_contacts WHERE property_id IS NOT NULL AND contact_id IS NOT NULL
      ) sub WHERE rn > 1
    `);

    const poDupes = await db.execute(sql`
      SELECT COUNT(*) as total_dupes FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY property_id, org_id ORDER BY id ASC
        ) as rn FROM property_organizations WHERE property_id IS NOT NULL AND org_id IS NOT NULL
      ) sub WHERE rn > 1
    `);

    const coDupes = await db.execute(sql`
      SELECT COUNT(*) as total_dupes FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY contact_id, org_id ORDER BY id ASC
        ) as rn FROM contact_organizations WHERE contact_id IS NOT NULL AND org_id IS NOT NULL
      ) sub WHERE rn > 1
    `);

    return NextResponse.json({
      success: true,
      data: {
        preview: true,
        duplicatePropertyContacts: Number(pcDupes.rows?.[0]?.total_dupes || 0),
        duplicatePropertyOrganizations: Number(poDupes.rows?.[0]?.total_dupes || 0),
        duplicateContactOrganizations: Number(coDupes.rows?.[0]?.total_dupes || 0),
      },
    });
  } catch (error) {
    console.error('[CleanupDuplicates] Preview error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();

    let pcRemoved = 0;
    let poRemoved = 0;
    let coRemoved = 0;

    const pcResult = await db.execute(sql`
      DELETE FROM property_contacts WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY property_id, contact_id ORDER BY discovered_at ASC NULLS LAST, id ASC
          ) as rn FROM property_contacts WHERE property_id IS NOT NULL AND contact_id IS NOT NULL
        ) sub WHERE rn > 1
      )
    `);
    pcRemoved = pcResult.rowCount || 0;

    const poResult = await db.execute(sql`
      DELETE FROM property_organizations WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY property_id, org_id ORDER BY id ASC
          ) as rn FROM property_organizations WHERE property_id IS NOT NULL AND org_id IS NOT NULL
        ) sub WHERE rn > 1
      )
    `);
    poRemoved = poResult.rowCount || 0;

    const coResult = await db.execute(sql`
      DELETE FROM contact_organizations WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY contact_id, org_id ORDER BY id ASC
          ) as rn FROM contact_organizations WHERE contact_id IS NOT NULL AND org_id IS NOT NULL
        ) sub WHERE rn > 1
      )
    `);
    coRemoved = coResult.rowCount || 0;

    console.log(`[CleanupDuplicates] Removed junction dupes: ${pcRemoved} property_contacts, ${poRemoved} property_organizations, ${coRemoved} contact_organizations`);

    const indexResults: string[] = [];
    try {
      await db.execute(sql`DROP INDEX IF EXISTS idx_property_contacts`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_property_contacts_unique ON property_contacts (property_id, contact_id) WHERE property_id IS NOT NULL AND contact_id IS NOT NULL`);
      indexResults.push('property_contacts: unique index created');
    } catch (e) {
      indexResults.push(`property_contacts: ${e instanceof Error ? e.message : 'failed'}`);
    }
    try {
      await db.execute(sql`DROP INDEX IF EXISTS idx_property_organizations`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_property_organizations_unique ON property_organizations (property_id, org_id) WHERE property_id IS NOT NULL AND org_id IS NOT NULL`);
      indexResults.push('property_organizations: unique index created');
    } catch (e) {
      indexResults.push(`property_organizations: ${e instanceof Error ? e.message : 'failed'}`);
    }
    try {
      await db.execute(sql`DROP INDEX IF EXISTS idx_contact_organizations`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_organizations_unique ON contact_organizations (contact_id, org_id) WHERE contact_id IS NOT NULL AND org_id IS NOT NULL`);
      indexResults.push('contact_organizations: unique index created');
    } catch (e) {
      indexResults.push(`contact_organizations: ${e instanceof Error ? e.message : 'failed'}`);
    }

    console.log(`[CleanupDuplicates] Index results: ${indexResults.join(', ')}`);

    const dedupResult = await runDeduplication();

    return NextResponse.json({
      success: true,
      data: {
        junctionCleanup: {
          propertyContactsRemoved: pcRemoved,
          propertyOrganizationsRemoved: poRemoved,
          contactOrganizationsRemoved: coRemoved,
        },
        uniqueIndexes: indexResults,
        contactDeduplication: {
          organizationsMerged: dedupResult.organizationsMerged,
          contactsMerged: dedupResult.contactsMerged,
          potentialDuplicatesFlagged: dedupResult.potentialDuplicatesFlagged,
          errors: dedupResult.errors,
        },
      },
    });
  } catch (error) {
    console.error('[CleanupDuplicates] Cleanup error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
