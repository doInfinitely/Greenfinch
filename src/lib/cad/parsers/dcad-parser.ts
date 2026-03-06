import * as fs from 'fs';
import * as readline from 'readline';
import { parse } from 'csv-parse';
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

async function* parseCsvFile(filePath: string): AsyncIterable<Record<string, string>> {
  const stream = fs.createReadStream(filePath);
  const parser = stream.pipe(parse({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }));

  for await (const record of parser) {
    yield record;
  }
}

export class DcadParser implements CadParser {
  readonly countyCode = 'DCAD' as const;
  private extractDir: string;
  private appraisalYear: number;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    const filePath = findFile(this.extractDir, 'ACCOUNT_INFO.csv');
    if (!filePath) throw new Error('ACCOUNT_INFO.csv not found in extracted files');

    console.log(`[DCAD Parser] Parsing account info from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const appraisalYr = parseNum(row['APPRAISAL_YR']);
      if (appraisalYr && appraisalYr !== this.appraisalYear) continue;

      yield {
        countyCode: 'DCAD',
        accountNum: row['ACCOUNT_NUM'] || '',
        appraisalYear: this.appraisalYear,
        gisParcelId: trimOrNull(row['GIS_PARCEL_ID']),
        divisionCd: trimOrNull(row['DIVISION_CD']),
        bizName: trimOrNull(row['BIZ_NAME']),
        ownerName1: trimOrNull(row['OWNER_NAME1']),
        ownerName2: trimOrNull(row['OWNER_NAME2']),
        ownerAddressLine1: trimOrNull(row['OWNER_ADDRESS_LINE1']),
        ownerCity: trimOrNull(row['OWNER_CITY']),
        ownerState: trimOrNull(row['OWNER_STATE']),
        ownerZipcode: trimOrNull(row['OWNER_ZIPCODE']),
        phoneNum: trimOrNull(row['PHONE_NUM']),
        deedTxfrDate: trimOrNull(row['DEED_TXFR_DATE']),
        legal1: trimOrNull(row['LEGAL_1']),
        legal2: trimOrNull(row['LEGAL_2']),
        legal3: trimOrNull(row['LEGAL_3']),
        legal4: trimOrNull(row['LEGAL_4']),
        propertyAddress: trimOrNull(row['PROPERTY_ADDRESS']),
        propertyCity: trimOrNull(row['PROPERTY_CITY']),
        propertyZipcode: trimOrNull(row['PROPERTY_ZIPCODE']),
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findFile(this.extractDir, 'ACCOUNT_APPRL_YEAR.csv');
    if (!filePath) throw new Error('ACCOUNT_APPRL_YEAR.csv not found in extracted files');

    console.log(`[DCAD Parser] Parsing appraisal values from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const appraisalYr = parseNum(row['APPRAISAL_YR']);
      if (appraisalYr && appraisalYr !== this.appraisalYear) continue;

      const sptdCode = trimOrNull(row['SPTD_CODE']);
      const ptadCode = toPtadCode('DCAD', sptdCode);

      yield {
        countyCode: 'DCAD',
        accountNum: row['ACCOUNT_NUM'] || '',
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: parseNum(row['IMPR_VAL']),
        landVal: parseNum(row['LAND_VAL']),
        totalVal: parseNum(row['TOT_VAL']),
        cityJurisDesc: trimOrNull(row['CITY_JURIS_DESC']),
        isdJurisDesc: trimOrNull(row['ISD_JURIS_DESC']),
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    // DCAD buildings come from COM_DETAIL joined with TAXABLE_OBJECT
    // First build a map of TAX_OBJ_ID → ACCOUNT_NUM from TAXABLE_OBJECT
    const taxObjFile = findFile(this.extractDir, 'TAXABLE_OBJECT.csv');
    const comDetailFile = findFile(this.extractDir, 'COM_DETAIL.csv');

    if (!comDetailFile) throw new Error('COM_DETAIL.csv not found in extracted files');

    // Build TAX_OBJ_ID to ACCOUNT_NUM mapping if TAXABLE_OBJECT exists
    const taxObjToAccount = new Map<string, string>();
    if (taxObjFile) {
      console.log(`[DCAD Parser] Building TAXABLE_OBJECT mapping from ${taxObjFile}`);
      for await (const row of parseCsvFile(taxObjFile)) {
        const taxObjId = row['TAX_OBJ_ID'];
        const accountNum = row['ACCOUNT_NUM'];
        if (taxObjId && accountNum) {
          taxObjToAccount.set(taxObjId, accountNum);
        }
      }
      console.log(`[DCAD Parser] Built ${taxObjToAccount.size} TAX_OBJ_ID → ACCOUNT_NUM mappings`);
    }

    console.log(`[DCAD Parser] Parsing buildings from ${comDetailFile}`);

    for await (const row of parseCsvFile(comDetailFile)) {
      const taxObjId = trimOrNull(row['TAX_OBJ_ID']);
      // If we have the TAXABLE_OBJECT mapping, use it. Otherwise use TAX_OBJ_ID as account num
      const accountNum = taxObjId ? (taxObjToAccount.get(taxObjId) || taxObjId) : '';

      yield {
        countyCode: 'DCAD',
        accountNum,
        taxObjId,
        appraisalYear: this.appraisalYear,
        propertyName: trimOrNull(row['PROPERTY_NAME']),
        bldgClassDesc: trimOrNull(row['BLDG_CLASS_DESC']),
        bldgClassCd: trimOrNull(row['BLDG_CLASS_CD']),
        yearBuilt: parseNum(row['YEAR_BUILT']),
        remodelYear: parseNum(row['REMODEL_YR']),
        grossBldgArea: parseNum(row['GROSS_BLDG_AREA']),
        numStories: parseNum(row['NUM_STORIES']),
        numUnits: parseNum(row['NUM_UNITS']),
        netLeaseArea: parseNum(row['NET_LEASE_AREA']),
        constructionType: trimOrNull(row['CONSTR_TYP_DESC']),
        foundationType: trimOrNull(row['FOUNDATION_TYP_DESC']),
        heatingType: trimOrNull(row['HEATING_TYP_DESC']),
        acType: trimOrNull(row['AC_TYP_DESC']),
        qualityGrade: trimOrNull(row['PROPERTY_QUAL_DESC']),
        conditionGrade: trimOrNull(row['PROPERTY_COND_DESC']),
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findFile(this.extractDir, 'LAND.csv');
    if (!filePath) throw new Error('LAND.csv not found in extracted files');

    console.log(`[DCAD Parser] Parsing land from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const appraisalYr = parseNum(row['APPRAISAL_YR']);
      if (appraisalYr && appraisalYr !== this.appraisalYear) continue;

      yield {
        countyCode: 'DCAD',
        accountNum: row['ACCOUNT_NUM'] || '',
        appraisalYear: this.appraisalYear,
        landTypeCd: trimOrNull(row['LAND_TYPE_CD']),
        zoningDesc: trimOrNull(row['ZONING_DESC']),
        frontDim: parseNum(row['FRONT_DIM']),
        depthDim: parseNum(row['DEPTH_DIM']),
        landArea: parseNum(row['LAND_AREA']) || parseNum(row['AREA_SIZE']),
        landAreaUom: trimOrNull(row['LAND_AREA_UOM']) || trimOrNull(row['AREA_UOM_DESC']),
        costPerUom: parseNum(row['COST_PER_UOM']),
      };
    }
  }
}
