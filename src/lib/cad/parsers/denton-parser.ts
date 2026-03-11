import * as fs from 'fs';
import * as readline from 'readline';
import type { CadParser, CadAccountInfoRow, CadAppraisalRow, CadBuildingRow, CadLandRow } from '../types';
import { toPtadCode } from '../county-codes';
import { findFileByPattern } from '../download-manager';

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
 * Extract a field from a fixed-width line by 1-based character positions.
 * Positions are inclusive: pos 1-12 extracts characters at indices 0..11.
 */
function extractField(line: string, startPos: number, endPos: number): string {
  return line.slice(startPos - 1, endPos).trim();
}

function extractFieldOrNull(line: string, startPos: number, endPos: number): string | null {
  const val = extractField(line, startPos, endPos);
  return val === '' ? null : val;
}

function extractFieldNum(line: string, startPos: number, endPos: number): number | null {
  return parseNum(extractField(line, startPos, endPos));
}

/**
 * Read a fixed-width file line by line, yielding each line as a raw string.
 */
async function* readLines(filePath: string): AsyncIterable<string> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield line;
  }
}

/**
 * Find a Denton fixed-width data file by pattern.
 */
function findDentFile(extractDir: string, ...patterns: string[]): string {
  const found = findFileByPattern(extractDir, ...patterns);
  if (!found) {
    throw new Error(
      `DENT data file not found. Expected ${patterns.join(' or ')} in extracted files`,
    );
  }
  return found;
}

// --- Field position specs from TP CAMA layout ---

// APPRAISAL_INFO.TXT positions
const AI = {
  propId:             [1, 12] as const,
  propTypeCd:         [13, 17] as const,
  propValYr:          [18, 22] as const,
  geoId:              [547, 596] as const,
  ownerName:          [609, 678] as const,
  ownerAddrLine1:     [694, 753] as const,
  ownerCity:          [874, 923] as const,
  ownerState:         [924, 973] as const,
  ownerZip:           [979, 983] as const,
  situsPrefx:         [1040, 1049] as const,
  situsStreet:        [1050, 1099] as const,
  situsSuffix:        [1100, 1109] as const,
  situsCity:          [1110, 1139] as const,
  situsZip:           [1140, 1149] as const,
  legalDesc:          [1150, 1404] as const,
  landHstdVal:        [1796, 1810] as const,
  landNonHstdVal:     [1811, 1825] as const,
  imprvHstdVal:       [1826, 1840] as const,
  imprvNonHstdVal:    [1841, 1855] as const,
  appraisedVal:       [1916, 1930] as const,
  deedDt:             [2034, 2058] as const,
  imprvStateCd:       [2732, 2741] as const,
  landStateCd:        [2742, 2751] as const,
  dba:                [4136, 4175] as const,
  situsNum:           [4460, 4474] as const,
} as const;

// IMPROVEMENT_INFO.TXT positions
const II = {
  propId:             [1, 12] as const,
  imprvId:            [17, 28] as const,
  imprvTypeCd:        [29, 38] as const,
  imprvTypeDesc:      [39, 63] as const,
  imprvStateCd:       [64, 68] as const,
  imprvVal:           [70, 83] as const,
} as const;

// LAND_DETAIL.TXT positions
const LD = {
  propId:             [1, 12] as const,
  landTypeCd:         [29, 38] as const,
  landTypeDesc:       [39, 63] as const,
  stateCd:            [64, 68] as const,
  sizeAcres:          [70, 83] as const,
  sizeSqFt:           [84, 97] as const,
  effectiveFront:     [98, 111] as const,
  effectiveDepth:     [112, 125] as const,
  landSegMktVal:      [141, 154] as const,
} as const;

export class DentonParser implements CadParser {
  readonly countyCode = 'DENT' as const;
  private extractDir: string;
  private appraisalYear: number;

  constructor(extractDir: string, appraisalYear: number = 2025) {
    this.extractDir = extractDir;
    this.appraisalYear = appraisalYear;
  }

  private buildSitusAddress(line: string): string | null {
    const num = extractFieldOrNull(line, ...AI.situsNum);
    const prefix = extractFieldOrNull(line, ...AI.situsPrefx);
    const street = extractFieldOrNull(line, ...AI.situsStreet);
    const suffix = extractFieldOrNull(line, ...AI.situsSuffix);
    const parts = [num, prefix, street, suffix].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  async *parseAccountInfo(): AsyncIterable<CadAccountInfoRow> {
    const filePath = findDentFile(
      this.extractDir,
      '*APPRAISAL_INFO*',
      '*_APPRAISAL_INFO.TXT',
    );
    console.log(`[DENT Parser] Parsing account info from ${filePath}`);

    for await (const line of readLines(filePath)) {
      const propId = extractField(line, ...AI.propId);
      if (!propId) continue;

      yield {
        countyCode: 'DENT',
        accountNum: propId,
        appraisalYear: parseNum(extractField(line, ...AI.propValYr)) || this.appraisalYear,
        gisParcelId: extractFieldOrNull(line, ...AI.geoId),
        divisionCd: extractFieldOrNull(line, ...AI.propTypeCd),
        bizName: extractFieldOrNull(line, ...AI.dba),
        ownerName1: extractFieldOrNull(line, ...AI.ownerName),
        ownerName2: null,
        ownerAddressLine1: extractFieldOrNull(line, ...AI.ownerAddrLine1),
        ownerCity: extractFieldOrNull(line, ...AI.ownerCity),
        ownerState: extractFieldOrNull(line, ...AI.ownerState),
        ownerZipcode: extractFieldOrNull(line, ...AI.ownerZip),
        phoneNum: null,
        deedTxfrDate: extractFieldOrNull(line, ...AI.deedDt),
        legal1: extractFieldOrNull(line, ...AI.legalDesc),
        legal2: null,
        legal3: null,
        legal4: null,
        propertyAddress: this.buildSitusAddress(line),
        propertyCity: extractFieldOrNull(line, ...AI.situsCity),
        propertyZipcode: extractFieldOrNull(line, ...AI.situsZip),
      };
    }
  }

  async *parseAppraisalValues(): AsyncIterable<CadAppraisalRow> {
    const filePath = findDentFile(
      this.extractDir,
      '*APPRAISAL_INFO*',
      '*_APPRAISAL_INFO.TXT',
    );
    console.log(`[DENT Parser] Parsing appraisal values from ${filePath}`);

    for await (const line of readLines(filePath)) {
      const propId = extractField(line, ...AI.propId);
      if (!propId) continue;

      const sptdCode = extractFieldOrNull(line, ...AI.imprvStateCd)
        || extractFieldOrNull(line, ...AI.landStateCd);
      const ptadCode = toPtadCode('DENT', sptdCode);

      const landVal = (extractFieldNum(line, ...AI.landHstdVal) || 0)
        + (extractFieldNum(line, ...AI.landNonHstdVal) || 0);
      const improvVal = (extractFieldNum(line, ...AI.imprvHstdVal) || 0)
        + (extractFieldNum(line, ...AI.imprvNonHstdVal) || 0);

      yield {
        countyCode: 'DENT',
        accountNum: propId,
        appraisalYear: parseNum(extractField(line, ...AI.propValYr)) || this.appraisalYear,
        sptdCode,
        ptadCode,
        improvVal: improvVal || null,
        landVal: landVal || null,
        totalVal: extractFieldNum(line, ...AI.appraisedVal),
        cityJurisDesc: extractFieldOrNull(line, ...AI.situsCity),
        isdJurisDesc: null,
      };
    }
  }

  async *parseBuildings(): AsyncIterable<CadBuildingRow> {
    const filePath = findDentFile(
      this.extractDir,
      '*IMPROVEMENT_INFO*',
      '*_APPRAISAL_IMPROVEMENT_INFO.TXT',
    );
    console.log(`[DENT Parser] Parsing buildings from ${filePath}`);

    for await (const line of readLines(filePath)) {
      const propId = extractField(line, ...II.propId);
      if (!propId) continue;

      yield {
        countyCode: 'DENT',
        accountNum: propId,
        taxObjId: extractFieldOrNull(line, ...II.imprvId),
        appraisalYear: this.appraisalYear,
        propertyName: extractFieldOrNull(line, ...II.imprvTypeDesc),
        bldgClassDesc: extractFieldOrNull(line, ...II.imprvTypeDesc),
        bldgClassCd: extractFieldOrNull(line, ...II.imprvTypeCd),
        yearBuilt: null, // Not available in improvement info file
        remodelYear: null,
        grossBldgArea: null, // Not available in improvement info file
        numStories: null,
        numUnits: null,
        netLeaseArea: null,
        constructionType: null,
        foundationType: null,
        heatingType: null,
        acType: null,
        qualityGrade: extractFieldOrNull(line, ...II.imprvStateCd),
        conditionGrade: null,
      };
    }
  }

  async *parseLand(): AsyncIterable<CadLandRow> {
    const filePath = findDentFile(
      this.extractDir,
      '*LAND_DETAIL*',
      '*_APPRAISAL_LAND_DETAIL.TXT',
    );
    console.log(`[DENT Parser] Parsing land from ${filePath}`);

    for await (const line of readLines(filePath)) {
      const propId = extractField(line, ...LD.propId);
      if (!propId) continue;

      const acres = extractFieldNum(line, ...LD.sizeAcres);
      const sqft = extractFieldNum(line, ...LD.sizeSqFt);

      yield {
        countyCode: 'DENT',
        accountNum: propId,
        appraisalYear: this.appraisalYear,
        landTypeCd: extractFieldOrNull(line, ...LD.landTypeCd),
        zoningDesc: extractFieldOrNull(line, ...LD.landTypeDesc),
        frontDim: extractFieldNum(line, ...LD.effectiveFront),
        depthDim: extractFieldNum(line, ...LD.effectiveDepth),
        landArea: acres || sqft,
        landAreaUom: acres ? 'AC' : sqft ? 'SF' : null,
        costPerUom: null,
      };
    }
  }
}
