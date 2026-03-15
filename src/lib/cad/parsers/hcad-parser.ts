import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import type { CadParser, CadAccountInfoRow, CadAppraisalRow, CadBuildingRow, CadLandRow } from '../types';
import { toPtadCode } from '../county-codes';
import { findFile } from '../download-manager';

function parseNum(val: string | undefined | null): number | null {
  if (!val || val.trim() === '') return null;
  const n = Number(val.trim());
  return isNaN(n) ? null : n;
}

function trimOrNull(val: string | undefined | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Parse a tab-delimited file line-by-line, yielding header-keyed records.
 */
async function* parseTsvFile(filePath: string): AsyncIterable<Record<string, string>> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] | null = null;

  for await (const line of rl) {
    if (!headers) {
      headers = line.split('\t');
      continue;
    }
    const values = line.split('\t');
    const record: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = values[i] ?? '';
    }
    yield record;
  }
}

/** Pre-loaded jur_value data per account */
interface JurValueEntry {
  appraisedVal: number | null;
  isdDistrict: string | null;
  cityDistrict: string | null;
}

/**
 * Harris County Appraisal District (HCAD) parser.
 *
 * HCAD publishes tab-delimited text files. Data is scattered across multiple
 * files that must be joined on the `acct` field:
 *
 * - ownership_history.txt  → account info (owner name, site address)
 * - jur_value.txt          → appraisal values + tax district info (14M rows)
 * - building_other.txt     → commercial building details
 * - land.txt               → land parcels
 * - desc_r_12_real_jurisdictions.txt → district code → name lookup
 *
 * Strategy: Two-pass approach
 *   Pass 1 (pre-load): Build in-memory maps from jur_value + desc_r_12
 *   Pass 2 (stream):   Parse each file, enriching with pre-loaded data
 */
export class HcadParser implements CadParser {
  readonly countyCode = 'HCAD' as const;
  private extractDir: string;
  private appraisalYear: number;

  // Pre-loaded lookup maps (populated by preload())
  private jurValueMap = new Map<string, JurValueEntry>();
  private districtDescMap = new Map<string, string>();
  private preloaded = false;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  /**
   * Pre-load jur_value.txt and desc_r_12 into memory.
   * Called automatically before any parse method that needs the data.
   */
  private async preload(): Promise<void> {
    if (this.preloaded) return;

    // Load district descriptions (desc_r_12) — small file (~200 rows)
    const descFile = findFile(this.extractDir, 'desc_r_12_real_jurisdictions.txt');
    if (descFile) {
      console.log(`[HCAD Parser] Loading district descriptions from ${descFile}`);
      for await (const row of parseTsvFile(descFile)) {
        const code = (row['Code'] || '').trim();
        const desc = (row['Description'] || '').trim();
        if (code) this.districtDescMap.set(code, desc);
      }
      console.log(`[HCAD Parser] Loaded ${this.districtDescMap.size} district descriptions`);
    }

    // Load jur_value.txt — 14M rows, aggregate per account
    // We pick: appraised_val (same across districts), ISD (tp_cd='I'), city (tp_cd='C')
    const jurFile = findFile(this.extractDir, 'jur_value.txt');
    if (!jurFile) throw new Error('jur_value.txt not found in extracted files');

    console.log(`[HCAD Parser] Pre-loading jur_value.txt (this may take a minute)...`);
    let rowCount = 0;

    for await (const row of parseTsvFile(jurFile)) {
      rowCount++;
      if (rowCount % 3_000_000 === 0) {
        console.log(`[HCAD Parser]   ... ${(rowCount / 1_000_000).toFixed(1)}M rows processed`);
      }

      const acct = (row['acct'] || '').trim();
      if (!acct) continue;

      const tpCd = (row['tp_cd'] || '').trim();
      const district = (row['tax_district'] || '').trim();
      const appraisedVal = parseNum(row['appraised_val']);

      let entry = this.jurValueMap.get(acct);
      if (!entry) {
        entry = { appraisedVal, isdDistrict: null, cityDistrict: null };
        this.jurValueMap.set(acct, entry);
      }

      // Pick up ISD and city district codes
      if (tpCd === 'I' && !entry.isdDistrict) {
        entry.isdDistrict = district;
      } else if (tpCd === 'C' && !entry.cityDistrict) {
        entry.cityDistrict = district;
      }
    }

    console.log(`[HCAD Parser] Pre-loaded ${this.jurValueMap.size.toLocaleString()} unique accounts from ${rowCount.toLocaleString()} jur_value rows`);
    this.preloaded = true;
  }

  /**
   * Resolve a district code to a city name via desc_r_12.
   * Strips "CITY OF " prefix for cleaner output.
   */
  private resolveCityName(districtCode: string | null): string | null {
    if (!districtCode) return null;
    const desc = this.districtDescMap.get(districtCode);
    if (!desc) return null;
    return desc.replace(/^CITY OF /i, '').trim() || null;
  }

  private resolveDistrictName(districtCode: string | null): string | null {
    if (!districtCode) return null;
    return this.districtDescMap.get(districtCode) ?? null;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    await this.preload();

    const filePath = findFile(this.extractDir, 'ownership_history.txt');
    if (!filePath) throw new Error('ownership_history.txt not found in extracted files');

    console.log(`[HCAD Parser] Parsing account info from ${filePath}`);

    for await (const row of parseTsvFile(filePath)) {
      const acct = (row['acct'] || '').trim();
      if (!acct) continue;

      const jurEntry = this.jurValueMap.get(acct);
      const cityName = this.resolveCityName(jurEntry?.cityDistrict ?? null);

      yield {
        countyCode: 'HCAD',
        accountNum: acct,
        appraisalYear: this.appraisalYear,
        gisParcelId: null,
        divisionCd: null,
        bizName: null,
        ownerName1: trimOrNull(row['name']),
        ownerName2: null,
        ownerAddressLine1: null,
        ownerCity: null,
        ownerState: null,
        ownerZipcode: null,
        phoneNum: null,
        deedTxfrDate: trimOrNull(row['purchase_date']),
        legal1: null,
        legal2: null,
        legal3: null,
        legal4: null,
        propertyAddress: trimOrNull(row['site_address']),
        propertyCity: cityName,
        propertyZipcode: null, // Not in HCAD text files — geocode later
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    await this.preload();

    // Emit one row per account from the pre-loaded jur_value map
    console.log(`[HCAD Parser] Emitting appraisal values for ${this.jurValueMap.size.toLocaleString()} accounts`);

    // We also need the property_use_cd (sptd code) from building_other for each account.
    // Since building_other only has commercial buildings, we load state_class from it.
    // For accounts without a building record, we won't have a sptd code — that's okay,
    // the ingestion pipeline filters on ptad code anyway.
    const sptdMap = new Map<string, string>();

    const buildingFile = findFile(this.extractDir, 'building_other.txt');
    if (buildingFile) {
      for await (const row of parseTsvFile(buildingFile)) {
        const acct = (row['acct'] || '').trim();
        const useCode = trimOrNull(row['property_use_cd']);
        if (acct && useCode && !sptdMap.has(acct)) {
          sptdMap.set(acct, useCode);
        }
      }
      console.log(`[HCAD Parser] Loaded ${sptdMap.size.toLocaleString()} sptd codes from building_other`);
    }

    for (const [acct, entry] of this.jurValueMap) {
      const sptdCode = sptdMap.get(acct) ?? null;
      const ptadCode = toPtadCode('HCAD', sptdCode);
      const isdName = this.resolveDistrictName(entry.isdDistrict);
      const cityName = this.resolveCityName(entry.cityDistrict);

      yield {
        countyCode: 'HCAD',
        accountNum: acct,
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: null,  // Not split in HCAD jur_value
        landVal: null,
        totalVal: entry.appraisedVal,
        cityJurisDesc: cityName,
        isdJurisDesc: isdName,
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findFile(this.extractDir, 'building_other.txt');
    if (!filePath) throw new Error('building_other.txt not found in extracted files');

    console.log(`[HCAD Parser] Parsing buildings from ${filePath}`);

    for await (const row of parseTsvFile(filePath)) {
      const acct = (row['acct'] || '').trim();
      if (!acct) continue;

      yield {
        countyCode: 'HCAD',
        accountNum: acct,
        taxObjId: trimOrNull(row['bld_num']),
        appraisalYear: this.appraisalYear,
        propertyName: trimOrNull(row['prop_nm']),
        bldgClassDesc: null,
        bldgClassCd: trimOrNull(row['impr_tp']),
        yearBuilt: parseNum(row['date_erected']),
        remodelYear: parseNum(row['yr_remodel']),
        grossBldgArea: parseNum(row['im_sq_ft']) || parseNum(row['gross_ar']),
        numStories: null,
        numUnits: parseNum(row['units']),
        netLeaseArea: parseNum(row['nra']),
        constructionType: trimOrNull(row['structure_dscr']),
        foundationType: null,
        heatingType: null,
        acType: null,
        qualityGrade: (() => {
          const qa = trimOrNull(row['qa_cd']);
          const dscr = trimOrNull(row['dscr']);
          if (qa && dscr) return `${qa} - ${dscr}`;
          return dscr || qa;
        })(),
        conditionGrade: null,
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findFile(this.extractDir, 'land.txt');
    if (!filePath) throw new Error('land.txt not found in extracted files');

    console.log(`[HCAD Parser] Parsing land from ${filePath}`);

    for await (const row of parseTsvFile(filePath)) {
      const acct = (row['acct'] || '').trim();
      if (!acct) continue;

      const tp = trimOrNull(row['tp']);  // SF or AC
      const uom = tp === 'AC' ? 'AC' : tp === 'SF' ? 'SF' : null;

      yield {
        countyCode: 'HCAD',
        accountNum: acct,
        appraisalYear: this.appraisalYear,
        landTypeCd: trimOrNull(row['use_cd']),
        zoningDesc: trimOrNull(row['use_dscr']),
        frontDim: null,
        depthDim: null,
        landArea: parseNum(row['uts']),
        landAreaUom: uom,
        costPerUom: parseNum(row['adj_unit_prc']),
      };
    }
  }
}
