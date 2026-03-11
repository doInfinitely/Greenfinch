import { db } from '../db';
import { cadAccountInfo, cadAppraisalValues, cadBuildings, cadLand, cadDownloads } from '../schema';
import { sql, eq, and } from 'drizzle-orm';
import type { CountyCode, CadAccountInfoRow, CadAppraisalRow, CadBuildingRow, CadLandRow } from './types';

const BATCH_SIZE = 1000;

/**
 * Deduplicate a batch by composite key, keeping the last occurrence.
 * Needed because some CAD files (e.g. Denton) have duplicate prop_ids,
 * and Postgres ON CONFLICT DO UPDATE can't affect the same row twice in one INSERT.
 */
function deduplicateBatch<T>(batch: T[], keyFn: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of batch) {
    map.set(keyFn(row), row);
  }
  return Array.from(map.values());
}

export async function createDownloadRecord(
  countyCode: CountyCode,
  appraisalYear: number,
): Promise<string> {
  const [record] = await db.insert(cadDownloads).values({
    countyCode,
    appraisalYear,
    status: 'pending',
    startedAt: new Date(),
  }).returning({ id: cadDownloads.id });
  return record.id;
}

export async function updateDownloadStatus(
  downloadId: string,
  status: string,
  extra?: { rowsImported?: number; errorMessage?: string },
): Promise<void> {
  const updates: Record<string, any> = { status };
  if (extra?.rowsImported !== undefined) updates.rowsImported = extra.rowsImported;
  if (extra?.errorMessage !== undefined) updates.errorMessage = extra.errorMessage;
  if (status === 'complete' || status === 'error') updates.completedAt = new Date();

  await db.update(cadDownloads).set(updates).where(eq(cadDownloads.id, downloadId));
}

export async function stageAccountInfo(
  rows: AsyncIterable<CadAccountInfoRow>,
  downloadId: string,
): Promise<number> {
  let totalImported = 0;
  let batch: (CadAccountInfoRow & { downloadId: string })[] = [];

  for await (const row of rows) {
    batch.push({ ...row, downloadId });

    if (batch.length >= BATCH_SIZE) {
      await upsertAccountInfoBatch(batch);
      totalImported += batch.length;
      batch = [];

      if (totalImported % 10000 === 0) {
        console.log(`[CAD Staging] Account info: ${totalImported} rows staged`);
      }
    }
  }

  if (batch.length > 0) {
    await upsertAccountInfoBatch(batch);
    totalImported += batch.length;
  }

  console.log(`[CAD Staging] Account info complete: ${totalImported} rows`);
  return totalImported;
}

async function upsertAccountInfoBatch(batch: (CadAccountInfoRow & { downloadId: string })[]) {
  const deduped = deduplicateBatch(batch, r => `${r.countyCode}|${r.accountNum}|${r.appraisalYear}`);
  await db.insert(cadAccountInfo)
    .values(deduped)
    .onConflictDoUpdate({
      target: [cadAccountInfo.countyCode, cadAccountInfo.accountNum, cadAccountInfo.appraisalYear],
      set: {
        gisParcelId: sql`EXCLUDED.gis_parcel_id`,
        divisionCd: sql`EXCLUDED.division_cd`,
        bizName: sql`EXCLUDED.biz_name`,
        ownerName1: sql`EXCLUDED.owner_name1`,
        ownerName2: sql`EXCLUDED.owner_name2`,
        ownerAddressLine1: sql`EXCLUDED.owner_address_line1`,
        ownerCity: sql`EXCLUDED.owner_city`,
        ownerState: sql`EXCLUDED.owner_state`,
        ownerZipcode: sql`EXCLUDED.owner_zipcode`,
        phoneNum: sql`EXCLUDED.phone_num`,
        deedTxfrDate: sql`EXCLUDED.deed_txfr_date`,
        legal1: sql`EXCLUDED.legal_1`,
        legal2: sql`EXCLUDED.legal_2`,
        legal3: sql`EXCLUDED.legal_3`,
        legal4: sql`EXCLUDED.legal_4`,
        propertyAddress: sql`EXCLUDED.property_address`,
        propertyCity: sql`EXCLUDED.property_city`,
        propertyZipcode: sql`EXCLUDED.property_zipcode`,
        downloadId: sql`EXCLUDED.download_id`,
      },
    });
}

export async function stageAppraisalValues(
  rows: AsyncIterable<CadAppraisalRow>,
  downloadId: string,
): Promise<number> {
  let totalImported = 0;
  let batch: (CadAppraisalRow & { downloadId: string })[] = [];

  for await (const row of rows) {
    batch.push({ ...row, downloadId });

    if (batch.length >= BATCH_SIZE) {
      await upsertAppraisalBatch(batch);
      totalImported += batch.length;
      batch = [];

      if (totalImported % 10000 === 0) {
        console.log(`[CAD Staging] Appraisal values: ${totalImported} rows staged`);
      }
    }
  }

  if (batch.length > 0) {
    await upsertAppraisalBatch(batch);
    totalImported += batch.length;
  }

  console.log(`[CAD Staging] Appraisal values complete: ${totalImported} rows`);
  return totalImported;
}

async function upsertAppraisalBatch(batch: (CadAppraisalRow & { downloadId: string })[]) {
  const deduped = deduplicateBatch(batch, r => `${r.countyCode}|${r.accountNum}|${r.appraisalYear}`);
  await db.insert(cadAppraisalValues)
    .values(deduped)
    .onConflictDoUpdate({
      target: [cadAppraisalValues.countyCode, cadAppraisalValues.accountNum, cadAppraisalValues.appraisalYear],
      set: {
        sptdCode: sql`EXCLUDED.sptd_code`,
        ptadCode: sql`EXCLUDED.ptad_code`,
        improvVal: sql`EXCLUDED.improv_val`,
        landVal: sql`EXCLUDED.land_val`,
        totalVal: sql`EXCLUDED.total_val`,
        cityJurisDesc: sql`EXCLUDED.city_juris_desc`,
        isdJurisDesc: sql`EXCLUDED.isd_juris_desc`,
        downloadId: sql`EXCLUDED.download_id`,
      },
    });
}

export async function stageBuildings(
  rows: AsyncIterable<CadBuildingRow>,
  downloadId: string,
): Promise<number> {
  let totalImported = 0;
  let batch: (CadBuildingRow & { downloadId: string })[] = [];

  for await (const row of rows) {
    batch.push({ ...row, downloadId });

    if (batch.length >= BATCH_SIZE) {
      await insertBuildingBatch(batch);
      totalImported += batch.length;
      batch = [];

      if (totalImported % 10000 === 0) {
        console.log(`[CAD Staging] Buildings: ${totalImported} rows staged`);
      }
    }
  }

  if (batch.length > 0) {
    await insertBuildingBatch(batch);
    totalImported += batch.length;
  }

  console.log(`[CAD Staging] Buildings complete: ${totalImported} rows`);
  return totalImported;
}

async function insertBuildingBatch(batch: (CadBuildingRow & { downloadId: string })[]) {
  // Buildings don't have a unique constraint, so we just insert
  await db.insert(cadBuildings).values(batch);
}

export async function stageLand(
  rows: AsyncIterable<CadLandRow>,
  downloadId: string,
): Promise<number> {
  let totalImported = 0;
  let batch: (CadLandRow & { downloadId: string })[] = [];

  for await (const row of rows) {
    batch.push({ ...row, downloadId });

    if (batch.length >= BATCH_SIZE) {
      await insertLandBatch(batch);
      totalImported += batch.length;
      batch = [];

      if (totalImported % 10000 === 0) {
        console.log(`[CAD Staging] Land: ${totalImported} rows staged`);
      }
    }
  }

  if (batch.length > 0) {
    await insertLandBatch(batch);
    totalImported += batch.length;
  }

  console.log(`[CAD Staging] Land complete: ${totalImported} rows`);
  return totalImported;
}

async function insertLandBatch(batch: (CadLandRow & { downloadId: string })[]) {
  await db.insert(cadLand).values(batch);
}

export async function clearStagingData(
  countyCode: CountyCode,
  appraisalYear: number,
): Promise<void> {
  console.log(`[CAD Staging] Clearing staging data for ${countyCode} year ${appraisalYear}...`);

  await db.delete(cadBuildings).where(
    and(eq(cadBuildings.countyCode, countyCode), eq(cadBuildings.appraisalYear, appraisalYear))
  );
  await db.delete(cadLand).where(
    and(eq(cadLand.countyCode, countyCode), eq(cadLand.appraisalYear, appraisalYear))
  );
  await db.delete(cadAppraisalValues).where(
    and(eq(cadAppraisalValues.countyCode, countyCode), eq(cadAppraisalValues.appraisalYear, appraisalYear))
  );
  await db.delete(cadAccountInfo).where(
    and(eq(cadAccountInfo.countyCode, countyCode), eq(cadAccountInfo.appraisalYear, appraisalYear))
  );

  console.log(`[CAD Staging] Cleared staging data for ${countyCode} year ${appraisalYear}`);
}
