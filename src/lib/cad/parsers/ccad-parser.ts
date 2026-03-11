import * as fs from 'fs';
import { parse } from 'csv-parse';
import type { CadParser, CadAccountInfoRow, CadAppraisalRow, CadBuildingRow, CadLandRow } from '../types';
import { toPtadCode } from '../county-codes';
import { findFile, findFileByPattern } from '../download-manager';

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

/**
 * Find the CCAD data file.
 * Tries: CollinCAD_Appraisal.csv → CollinCAD*.csv → Property.csv (legacy)
 */
function findCcadFile(extractDir: string, legacyName: string): string {
  const combined = findFileByPattern(
    extractDir,
    'CollinCAD_Appraisal.csv',
    'CollinCAD*.csv',
  );
  if (combined) return combined;

  const legacy = findFile(extractDir, legacyName);
  if (legacy) return legacy;

  throw new Error(
    `CCAD data file not found. Expected CollinCAD_Appraisal.csv or ${legacyName} in extracted files`,
  );
}

export class CcadParser implements CadParser {
  readonly countyCode = 'CCAD' as const;
  private extractDir: string;
  private appraisalYear: number;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    const filePath = findCcadFile(this.extractDir, 'Property.csv');
    console.log(`[CCAD Parser] Parsing account info from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      yield {
        countyCode: 'CCAD',
        accountNum: row['propID'] || row['prop_id'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        gisParcelId: trimOrNull(row['geoID']) || trimOrNull(row['geo_id']),
        divisionCd: trimOrNull(row['propType']) || trimOrNull(row['prop_type_cd']),
        bizName: trimOrNull(row['dbaName']) || trimOrNull(row['dba']),
        ownerName1: trimOrNull(row['ownerName']) || trimOrNull(row['owner_name']),
        ownerName2: trimOrNull(row['ownerNameAddtl']) || trimOrNull(row['owner_name2']),
        ownerAddressLine1: trimOrNull(row['ownerAddrLine1']) || trimOrNull(row['owner_addr_line1']),
        ownerCity: trimOrNull(row['ownerAddrCity']) || trimOrNull(row['owner_city']),
        ownerState: trimOrNull(row['ownerAddrState']) || trimOrNull(row['owner_state']),
        ownerZipcode: trimOrNull(row['ownerAddrZip']) || trimOrNull(row['owner_zip']),
        phoneNum: null,
        deedTxfrDate: trimOrNull(row['deedEffDate']) || trimOrNull(row['deedFileDate']) || trimOrNull(row['deed_date']),
        legal1: trimOrNull(row['legalDescription']) || trimOrNull(row['legal_desc']),
        legal2: null,
        legal3: null,
        legal4: null,
        propertyAddress: trimOrNull(row['situsConcat']) || trimOrNull(row['situs_addr']),
        propertyCity: trimOrNull(row['situsCity']) || trimOrNull(row['situs_city']),
        propertyZipcode: trimOrNull(row['situsZip']) || trimOrNull(row['situs_zip']),
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findCcadFile(this.extractDir, 'Property.csv');
    console.log(`[CCAD Parser] Parsing appraisal values from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const sptdCode = trimOrNull(row['propUseCode']) || trimOrNull(row['propCategoryCode']) || trimOrNull(row['state_cd']);
      const ptadCode = toPtadCode('CCAD', sptdCode);

      yield {
        countyCode: 'CCAD',
        accountNum: row['propID'] || row['prop_id'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: parseNum(row['currValImprv']) || parseNum(row['impr_val']),
        landVal: parseNum(row['currValLand']) || parseNum(row['land_val']),
        totalVal: parseNum(row['currValMarket']) || parseNum(row['tot_val']),
        cityJurisDesc: trimOrNull(row['situsCity']) || trimOrNull(row['city']),
        isdJurisDesc: null,
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findCcadFile(this.extractDir, 'Improvement.csv');
    console.log(`[CCAD Parser] Parsing buildings from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      yield {
        countyCode: 'CCAD',
        accountNum: row['propID'] || row['prop_id'] || row['PROP_ID'] || '',
        taxObjId: null,
        appraisalYear: this.appraisalYear,
        propertyName: null,
        bldgClassDesc: trimOrNull(row['imprvClassCd']) || trimOrNull(row['class_desc']),
        bldgClassCd: trimOrNull(row['imprvClassCd']) || trimOrNull(row['class_cd']),
        yearBuilt: parseNum(row['imprvYearBuilt']) || parseNum(row['yr_built']),
        remodelYear: null,
        grossBldgArea: parseNum(row['imprvMainArea']) || parseNum(row['living_area']),
        numStories: null,
        numUnits: parseNum(row['imprvUnits']) || parseNum(row['units']),
        netLeaseArea: null,
        constructionType: null,
        foundationType: null,
        heatingType: null,
        acType: null,
        qualityGrade: null,
        conditionGrade: null,
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findCcadFile(this.extractDir, 'Land.csv');
    console.log(`[CCAD Parser] Parsing land from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const acres = parseNum(row['landSizeAcres']) || parseNum(row['area_size']);
      const sqft = parseNum(row['landSizeSqft']);

      yield {
        countyCode: 'CCAD',
        accountNum: row['propID'] || row['prop_id'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        landTypeCd: trimOrNull(row['landTypeCode']) || trimOrNull(row['land_type']),
        zoningDesc: null,
        frontDim: null,
        depthDim: null,
        landArea: acres || sqft,
        landAreaUom: acres ? 'AC' : sqft ? 'SF' : null,
        costPerUom: null,
      };
    }
  }
}
