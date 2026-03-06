import * as fs from 'fs';
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

export class DentonParser implements CadParser {
  readonly countyCode = 'DENT' as const;
  private extractDir: string;
  private appraisalYear: number;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    const filePath = findFile(this.extractDir, 'Property.csv');
    if (!filePath) throw new Error('Property.csv not found in extracted files');

    console.log(`[DENT Parser] Parsing account info from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      yield {
        countyCode: 'DENT',
        accountNum: row['prop_id'] || row['PROP_ID'] || row['ACCOUNT_NUM'] || '',
        appraisalYear: this.appraisalYear,
        gisParcelId: trimOrNull(row['geo_id']) || trimOrNull(row['GEO_ID']),
        divisionCd: trimOrNull(row['prop_type_cd']) || trimOrNull(row['PROP_TYPE_CD']),
        bizName: trimOrNull(row['dba']) || trimOrNull(row['DBA']),
        ownerName1: trimOrNull(row['owner_name']) || trimOrNull(row['OWNER_NAME']),
        ownerName2: trimOrNull(row['owner_name2']) || trimOrNull(row['OWNER_NAME2']),
        ownerAddressLine1: trimOrNull(row['owner_addr_line1']) || trimOrNull(row['OWNER_ADDR_LINE1']),
        ownerCity: trimOrNull(row['owner_city']) || trimOrNull(row['OWNER_CITY']),
        ownerState: trimOrNull(row['owner_state']) || trimOrNull(row['OWNER_STATE']),
        ownerZipcode: trimOrNull(row['owner_zip']) || trimOrNull(row['OWNER_ZIP']),
        phoneNum: trimOrNull(row['phone_num']) || trimOrNull(row['PHONE_NUM']),
        deedTxfrDate: trimOrNull(row['deed_date']) || trimOrNull(row['DEED_DATE']),
        legal1: trimOrNull(row['legal_desc']) || trimOrNull(row['LEGAL_DESC']),
        legal2: null,
        legal3: null,
        legal4: null,
        propertyAddress: trimOrNull(row['situs_addr']) || trimOrNull(row['SITUS_ADDR']),
        propertyCity: trimOrNull(row['situs_city']) || trimOrNull(row['SITUS_CITY']),
        propertyZipcode: trimOrNull(row['situs_zip']) || trimOrNull(row['SITUS_ZIP']),
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findFile(this.extractDir, 'Property.csv');
    if (!filePath) throw new Error('Property.csv not found in extracted files');

    console.log(`[DENT Parser] Parsing appraisal values from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const sptdCode = trimOrNull(row['state_cd']) || trimOrNull(row['STATE_CD']);
      const ptadCode = toPtadCode('DENT', sptdCode);

      yield {
        countyCode: 'DENT',
        accountNum: row['prop_id'] || row['PROP_ID'] || row['ACCOUNT_NUM'] || '',
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: parseNum(row['impr_val']) || parseNum(row['IMPR_VAL']),
        landVal: parseNum(row['land_val']) || parseNum(row['LAND_VAL']),
        totalVal: parseNum(row['tot_val']) || parseNum(row['TOT_VAL']),
        cityJurisDesc: trimOrNull(row['city']) || trimOrNull(row['CITY']),
        isdJurisDesc: trimOrNull(row['isd']) || trimOrNull(row['ISD']),
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findFile(this.extractDir, 'Improvement.csv');
    if (!filePath) throw new Error('Improvement.csv not found in extracted files');

    console.log(`[DENT Parser] Parsing buildings from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      yield {
        countyCode: 'DENT',
        accountNum: row['prop_id'] || row['PROP_ID'] || row['ACCOUNT_NUM'] || '',
        taxObjId: trimOrNull(row['impr_id']) || trimOrNull(row['IMPR_ID']),
        appraisalYear: this.appraisalYear,
        propertyName: trimOrNull(row['impr_desc']) || trimOrNull(row['IMPR_DESC']),
        bldgClassDesc: trimOrNull(row['class_desc']) || trimOrNull(row['CLASS_DESC']),
        bldgClassCd: trimOrNull(row['class_cd']) || trimOrNull(row['CLASS_CD']),
        yearBuilt: parseNum(row['yr_built']) || parseNum(row['YR_BUILT']),
        remodelYear: parseNum(row['yr_remodel']) || parseNum(row['YR_REMODEL']),
        grossBldgArea: parseNum(row['living_area']) || parseNum(row['LIVING_AREA']),
        numStories: parseNum(row['stories']) || parseNum(row['NUM_STORIES']),
        numUnits: parseNum(row['units']) || parseNum(row['NUM_UNITS']),
        netLeaseArea: parseNum(row['net_lease_area']) || parseNum(row['NET_LEASE_AREA']),
        constructionType: trimOrNull(row['ext_wall_desc']) || trimOrNull(row['CONSTRUCTION_TYPE']),
        foundationType: trimOrNull(row['foundation_desc']) || trimOrNull(row['FOUNDATION_TYPE']),
        heatingType: trimOrNull(row['heat_desc']) || trimOrNull(row['HEATING_TYPE']),
        acType: trimOrNull(row['ac_desc']) || trimOrNull(row['AC_TYPE']),
        qualityGrade: trimOrNull(row['quality_desc']) || trimOrNull(row['QUALITY_GRADE']),
        conditionGrade: trimOrNull(row['condition_desc']) || trimOrNull(row['CONDITION_GRADE']),
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findFile(this.extractDir, 'Land.csv');
    if (!filePath) throw new Error('Land.csv not found in extracted files');

    console.log(`[DENT Parser] Parsing land from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      yield {
        countyCode: 'DENT',
        accountNum: row['prop_id'] || row['PROP_ID'] || row['ACCOUNT_NUM'] || '',
        appraisalYear: this.appraisalYear,
        landTypeCd: trimOrNull(row['land_type']) || trimOrNull(row['LAND_TYPE_CD']),
        zoningDesc: trimOrNull(row['zoning']) || trimOrNull(row['ZONING_DESC']),
        frontDim: parseNum(row['front_ft']) || parseNum(row['FRONT_DIM']),
        depthDim: parseNum(row['depth_ft']) || parseNum(row['DEPTH_DIM']),
        landArea: parseNum(row['area_size']) || parseNum(row['LAND_AREA']),
        landAreaUom: trimOrNull(row['area_uom']) || trimOrNull(row['LAND_AREA_UOM']),
        costPerUom: parseNum(row['unit_price']) || parseNum(row['COST_PER_UOM']),
      };
    }
  }
}
