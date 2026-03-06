import * as fs from 'fs';
import * as readline from 'readline';
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

async function* parsePipeDelimited(filePath: string): AsyncIterable<Record<string, string>> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] | null = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = line.split('|').map(f => f.trim());

    if (!headers) {
      headers = fields;
      continue;
    }

    const record: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = fields[i] || '';
    }
    yield record;
  }
}

export class TadParser implements CadParser {
  readonly countyCode = 'TAD' as const;
  private extractDir: string;
  private appraisalYear: number;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    const filePath = findFile(this.extractDir, 'prop.txt');
    if (!filePath) throw new Error('prop.txt not found in extracted files');

    console.log(`[TAD Parser] Parsing account info from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      yield {
        countyCode: 'TAD',
        accountNum: row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        gisParcelId: trimOrNull(row['GEO_ID']) || trimOrNull(row['GIS_PARCEL_ID']),
        divisionCd: trimOrNull(row['PROP_TYPE_CD']),
        bizName: trimOrNull(row['DBA']),
        ownerName1: trimOrNull(row['OWNER_NAME']) || trimOrNull(row['OWNER_NAME1']),
        ownerName2: trimOrNull(row['OWNER_NAME2']),
        ownerAddressLine1: trimOrNull(row['OWNER_ADDR_LINE1']) || trimOrNull(row['OWNER_ADDRESS_LINE1']),
        ownerCity: trimOrNull(row['OWNER_CITY']),
        ownerState: trimOrNull(row['OWNER_STATE']),
        ownerZipcode: trimOrNull(row['OWNER_ZIP']) || trimOrNull(row['OWNER_ZIPCODE']),
        phoneNum: trimOrNull(row['PHONE_NUM']),
        deedTxfrDate: trimOrNull(row['DEED_DATE']) || trimOrNull(row['DEED_TXFR_DATE']),
        legal1: trimOrNull(row['LEGAL_DESC']) || trimOrNull(row['LEGAL_1']),
        legal2: trimOrNull(row['LEGAL_2']),
        legal3: trimOrNull(row['LEGAL_3']),
        legal4: trimOrNull(row['LEGAL_4']),
        propertyAddress: trimOrNull(row['SITUS_ADDR']) || trimOrNull(row['PROPERTY_ADDRESS']),
        propertyCity: trimOrNull(row['SITUS_CITY']) || trimOrNull(row['PROPERTY_CITY']),
        propertyZipcode: trimOrNull(row['SITUS_ZIP']) || trimOrNull(row['PROPERTY_ZIPCODE']),
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findFile(this.extractDir, 'prop.txt');
    if (!filePath) throw new Error('prop.txt not found in extracted files');

    console.log(`[TAD Parser] Parsing appraisal values from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      const sptdCode = trimOrNull(row['STATE_CD']) || trimOrNull(row['SPTD_CODE']);
      const ptadCode = toPtadCode('TAD', sptdCode);

      yield {
        countyCode: 'TAD',
        accountNum: row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: parseNum(row['IMPR_VAL']) || parseNum(row['IMPROVEMENT_VALUE']),
        landVal: parseNum(row['LAND_VAL']) || parseNum(row['LAND_VALUE']),
        totalVal: parseNum(row['TOT_VAL']) || parseNum(row['TOTAL_VALUE']),
        cityJurisDesc: trimOrNull(row['CITY_JURIS_DESC']) || trimOrNull(row['CITY']),
        isdJurisDesc: trimOrNull(row['ISD_JURIS_DESC']) || trimOrNull(row['ISD']),
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findFile(this.extractDir, 'improvement.txt') ||
                     findFile(this.extractDir, 'improvement_detail.txt');
    if (!filePath) throw new Error('improvement.txt not found in extracted files');

    console.log(`[TAD Parser] Parsing buildings from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      yield {
        countyCode: 'TAD',
        accountNum: row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        taxObjId: trimOrNull(row['IMPR_ID']) || trimOrNull(row['TAX_OBJ_ID']),
        appraisalYear: this.appraisalYear,
        propertyName: trimOrNull(row['IMPR_DESC']) || trimOrNull(row['PROPERTY_NAME']),
        bldgClassDesc: trimOrNull(row['BLDG_CLASS_DESC']) || trimOrNull(row['CLASS_DESC']),
        bldgClassCd: trimOrNull(row['BLDG_CLASS_CD']) || trimOrNull(row['CLASS_CD']),
        yearBuilt: parseNum(row['YEAR_BUILT']) || parseNum(row['YR_BUILT']),
        remodelYear: parseNum(row['REMODEL_YR']) || parseNum(row['YR_REMODEL']),
        grossBldgArea: parseNum(row['LIVING_AREA']) || parseNum(row['GROSS_BLDG_AREA']),
        numStories: parseNum(row['NUM_STORIES']) || parseNum(row['STORIES']),
        numUnits: parseNum(row['NUM_UNITS']) || parseNum(row['UNITS']),
        netLeaseArea: parseNum(row['NET_LEASE_AREA']),
        constructionType: trimOrNull(row['CONSTRUCTION_TYPE']) || trimOrNull(row['EXT_WALL_DESC']),
        foundationType: trimOrNull(row['FOUNDATION_TYPE']) || trimOrNull(row['FOUNDATION_DESC']),
        heatingType: trimOrNull(row['HEATING_TYPE']) || trimOrNull(row['HEAT_DESC']),
        acType: trimOrNull(row['AC_TYPE']) || trimOrNull(row['AC_DESC']),
        qualityGrade: trimOrNull(row['QUALITY_GRADE']) || trimOrNull(row['QUALITY_DESC']),
        conditionGrade: trimOrNull(row['CONDITION_GRADE']) || trimOrNull(row['CONDITION_DESC']),
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findFile(this.extractDir, 'land.txt');
    if (!filePath) throw new Error('land.txt not found in extracted files');

    console.log(`[TAD Parser] Parsing land from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      yield {
        countyCode: 'TAD',
        accountNum: row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        landTypeCd: trimOrNull(row['LAND_TYPE_CD']) || trimOrNull(row['LAND_TYPE']),
        zoningDesc: trimOrNull(row['ZONING_DESC']) || trimOrNull(row['ZONING']),
        frontDim: parseNum(row['FRONT_DIM']) || parseNum(row['FRONT_FT']),
        depthDim: parseNum(row['DEPTH_DIM']) || parseNum(row['DEPTH_FT']),
        landArea: parseNum(row['LAND_AREA']) || parseNum(row['AREA_SIZE']),
        landAreaUom: trimOrNull(row['LAND_AREA_UOM']) || trimOrNull(row['AREA_UOM']),
        costPerUom: parseNum(row['COST_PER_UOM']) || parseNum(row['UNIT_PRICE']),
      };
    }
  }
}
