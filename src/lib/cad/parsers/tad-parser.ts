import * as fs from 'fs';
import * as readline from 'readline';
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

/**
 * Split combined "CITY, ST" field into { city, state }.
 * Handles formats like "FT WORTH, TX" or "ARLINGTON,TX".
 */
function splitCityState(val: string | undefined | null): { city: string | null; state: string | null } {
  if (!val || val.trim() === '') return { city: null, state: null };
  const trimmed = val.trim();
  const commaIdx = trimmed.lastIndexOf(',');
  if (commaIdx === -1) return { city: trimmed, state: null };
  return {
    city: trimmed.slice(0, commaIdx).trim() || null,
    state: trimmed.slice(commaIdx + 1).trim() || null,
  };
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

/**
 * Find the combined TAD data file.
 * Tries: PropertyData_YYYY.txt → PropertyData*.txt → prop.txt (legacy)
 */
function findTadFile(extractDir: string): string {
  const combined = findFileByPattern(
    extractDir,
    'PropertyData_*.txt',
    'PropertyData*.txt',
  );
  if (combined) return combined;

  const legacy = findFile(extractDir, 'prop.txt');
  if (legacy) return legacy;

  throw new Error(
    'TAD data file not found. Expected PropertyData_YYYY.txt or prop.txt in extracted files',
  );
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
    const filePath = findTadFile(this.extractDir);
    console.log(`[TAD Parser] Parsing account info from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      const { city: ownerCity, state: ownerState } = splitCityState(
        row['Owner_CityState'] || row['OWNER_CITYSTATE'],
      );

      yield {
        countyCode: 'TAD',
        accountNum: row['Account_Num'] || row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        gisParcelId: trimOrNull(row['GIS_Link']) || trimOrNull(row['GEO_ID']),
        divisionCd: trimOrNull(row['Property_Class']) || trimOrNull(row['PROP_TYPE_CD']),
        bizName: trimOrNull(row['DBA']),
        ownerName1: trimOrNull(row['Owner_Name']) || trimOrNull(row['OWNER_NAME']),
        ownerName2: null,
        ownerAddressLine1: trimOrNull(row['Owner_Address']) || trimOrNull(row['OWNER_ADDR_LINE1']),
        ownerCity: ownerCity || trimOrNull(row['OWNER_CITY']),
        ownerState: ownerState || trimOrNull(row['OWNER_STATE']),
        ownerZipcode: trimOrNull(row['Owner_Zip']) || trimOrNull(row['OWNER_ZIP']),
        phoneNum: null,
        deedTxfrDate: trimOrNull(row['Deed_Date']) || trimOrNull(row['DEED_DATE']),
        legal1: trimOrNull(row['LegalDescription']) || trimOrNull(row['LEGAL_DESC']),
        legal2: null,
        legal3: null,
        legal4: null,
        propertyAddress: trimOrNull(row['Situs_Address']) || trimOrNull(row['SITUS_ADDR']),
        propertyCity: null, // Not available separately in combined format
        propertyZipcode: null,
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findTadFile(this.extractDir);
    console.log(`[TAD Parser] Parsing appraisal values from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      const sptdCode = trimOrNull(row['State_Use_Code']) || trimOrNull(row['STATE_CD']);
      const ptadCode = toPtadCode('TAD', sptdCode);

      yield {
        countyCode: 'TAD',
        accountNum: row['Account_Num'] || row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: parseNum(row['Improvement_Value']) || parseNum(row['IMPR_VAL']),
        landVal: parseNum(row['Land_Value']) || parseNum(row['LAND_VAL']),
        totalVal: parseNum(row['Total_Value']) || parseNum(row['TOT_VAL']),
        cityJurisDesc: null,
        isdJurisDesc: null,
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findTadFile(this.extractDir);
    console.log(`[TAD Parser] Parsing buildings from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      yield {
        countyCode: 'TAD',
        accountNum: row['Account_Num'] || row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        taxObjId: null,
        appraisalYear: this.appraisalYear,
        propertyName: null,
        bldgClassDesc: trimOrNull(row['Property_Class']),
        bldgClassCd: null,
        yearBuilt: parseNum(row['Year_Built']),
        remodelYear: null,
        grossBldgArea: parseNum(row['Living_Area']),
        numStories: null,
        numUnits: null,
        netLeaseArea: null,
        constructionType: null,
        foundationType: null,
        heatingType: trimOrNull(row['Central_Heat_Ind']) === 'Y' ? 'Central' : null,
        acType: trimOrNull(row['Central_Air_Ind']) === 'Y' ? 'Central' : null,
        qualityGrade: null,
        conditionGrade: null,
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findTadFile(this.extractDir);
    console.log(`[TAD Parser] Parsing land from ${filePath}`);

    for await (const row of parsePipeDelimited(filePath)) {
      const acres = parseNum(row['Land_Acres']);
      const sqft = parseNum(row['Land_SqFt']);

      yield {
        countyCode: 'TAD',
        accountNum: row['Account_Num'] || row['ACCOUNT_NUM'] || row['PROP_ID'] || '',
        appraisalYear: this.appraisalYear,
        landTypeCd: null,
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
