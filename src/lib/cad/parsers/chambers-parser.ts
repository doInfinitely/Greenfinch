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
 * Find the Chambers certified roll CSV.
 * Tries: 2025-certified-roll.csv → *certified-roll*.csv
 */
function findChamFile(extractDir: string): string {
  const found = findFileByPattern(
    extractDir,
    '2025-certified-roll.csv',
    '*certified-roll*.csv',
    '*certified*.csv',
  );
  if (found) return found;

  throw new Error(
    'Chambers certified roll CSV not found. Expected 2025-certified-roll.csv in data directory',
  );
}

/**
 * Build a situs address from the component fields.
 */
function buildAddress(row: Record<string, string>): string | null {
  const num = (row['Prop_Street_Number'] || '').trim();
  const street = (row['Prop_Street'] || '').trim();
  const dir = (row['Prop_Street_Dir'] || '').trim();

  const parts = [num, street, dir].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Chambers County Appraisal District parser.
 *
 * Chambers publishes a single certified roll CSV with all property data
 * in a flat format. Each row is one property with owner, location,
 * valuation, and category data combined.
 */
export class ChambersParser implements CadParser {
  readonly countyCode = 'CHAM' as const;
  private extractDir: string;
  private appraisalYear: number;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    const filePath = findChamFile(this.extractDir);
    console.log(`[CHAM Parser] Parsing account info from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      yield {
        countyCode: 'CHAM',
        accountNum: row['Account'] || '',
        appraisalYear: this.appraisalYear,
        gisParcelId: trimOrNull(row['Parcel_ID']),
        divisionCd: null,
        bizName: trimOrNull(row['DBA']),
        ownerName1: trimOrNull(row['Name']),
        ownerName2: trimOrNull(row['Careof']),
        ownerAddressLine1: trimOrNull(row['Street']),
        ownerCity: trimOrNull(row['City']),
        ownerState: trimOrNull(row['State']),
        ownerZipcode: trimOrNull(row['Zip5']),
        phoneNum: null,
        deedTxfrDate: null,
        legal1: trimOrNull(row['Legal1']),
        legal2: trimOrNull(row['Legal2']),
        legal3: trimOrNull(row['Legal3']),
        legal4: trimOrNull(row['Legal4']),
        propertyAddress: buildAddress(row),
        propertyCity: trimOrNull(row['Prop_City']),
        propertyZipcode: trimOrNull(row['Prop_Zip5']),
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findChamFile(this.extractDir);
    console.log(`[CHAM Parser] Parsing appraisal values from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const sptdCode = trimOrNull(row['Primary_Category_Code']);
      const ptadCode = toPtadCode('CHAM', sptdCode);

      const improvHs = parseNum(row['Improvement_Hs']) ?? 0;
      const improvNhs = parseNum(row['Improvement_Nhs']) ?? 0;
      const improvVal = (improvHs + improvNhs) || null;

      const landHs = parseNum(row['Land_Hs']) ?? 0;
      const landNhs = parseNum(row['Land_Nhs']) ?? 0;
      const landVal = (landHs + landNhs) || null;

      yield {
        countyCode: 'CHAM',
        accountNum: row['Account'] || '',
        appraisalYear: this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal,
        landVal,
        totalVal: parseNum(row['Market_Value']),
        cityJurisDesc: trimOrNull(row['Prop_City']),
        isdJurisDesc: trimOrNull(row['Jur_Name']),
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findChamFile(this.extractDir);
    console.log(`[CHAM Parser] Parsing buildings from ${filePath}`);

    // Certified roll has limited building data — no year built, sqft, etc.
    // We emit a row per property so the account exists in the buildings table.
    for await (const row of parseCsvFile(filePath)) {
      const improvHs = parseNum(row['Improvement_Hs']) ?? 0;
      const improvNhs = parseNum(row['Improvement_Nhs']) ?? 0;
      // Only emit if there's an improvement value
      if (improvHs + improvNhs === 0) continue;

      yield {
        countyCode: 'CHAM',
        accountNum: row['Account'] || '',
        taxObjId: null,
        appraisalYear: this.appraisalYear,
        propertyName: trimOrNull(row['DBA']),
        bldgClassDesc: null,
        bldgClassCd: null,
        yearBuilt: null,
        remodelYear: null,
        grossBldgArea: null,
        numStories: null,
        numUnits: null,
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
    const filePath = findChamFile(this.extractDir);
    console.log(`[CHAM Parser] Parsing land from ${filePath}`);

    for await (const row of parseCsvFile(filePath)) {
      const acres = parseNum(row['Acres']);
      if (!acres) continue;

      yield {
        countyCode: 'CHAM',
        accountNum: row['Account'] || '',
        appraisalYear: this.appraisalYear,
        landTypeCd: trimOrNull(row['Primary_Category_Code']),
        zoningDesc: null,
        frontDim: null,
        depthDim: null,
        landArea: acres,
        landAreaUom: 'AC',
        costPerUom: null,
      };
    }
  }
}
