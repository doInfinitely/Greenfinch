export type { CountyCode, CadParser, CadAccountInfoRow, CadAppraisalRow, CadBuildingRow, CadLandRow, CountyConfig } from './types';
export { COUNTY_CONFIGS } from './types';
export { downloadAndExtract, findFile, cleanupTempDir } from './download-manager';
export { createDownloadRecord, updateDownloadStatus, stageAccountInfo, stageAppraisalValues, stageBuildings, stageLand, clearStagingData } from './staging';
export { toPtadCode, isIncludedProperty, getCountyName, INCLUDED_PTAD_CODES } from './county-codes';

export { DcadParser } from './parsers/dcad-parser';
export { TadParser } from './parsers/tad-parser';
export { CcadParser } from './parsers/ccad-parser';
export { DentonParser } from './parsers/denton-parser';
export { HcadParser } from './parsers/hcad-parser';
export { ChambersParser } from './parsers/chambers-parser';

import type { CountyCode, CadParser } from './types';
import { DcadParser } from './parsers/dcad-parser';
import { TadParser } from './parsers/tad-parser';
import { CcadParser } from './parsers/ccad-parser';
import { DentonParser } from './parsers/denton-parser';
import { HcadParser } from './parsers/hcad-parser';
import { ChambersParser } from './parsers/chambers-parser';

export function createParser(countyCode: CountyCode, extractDir: string, appraisalYear: number = 2025): CadParser {
  switch (countyCode) {
    case 'DCAD': return new DcadParser(extractDir, appraisalYear);
    case 'TAD': return new TadParser(extractDir, appraisalYear);
    case 'CCAD': return new CcadParser(extractDir, appraisalYear);
    case 'DENT': return new DentonParser(extractDir, appraisalYear);
    case 'HCAD': return new HcadParser(extractDir, appraisalYear);
    case 'CHAM': return new ChambersParser(extractDir, appraisalYear);
    default: throw new Error(`No parser available for county: ${countyCode}`);
  }
}
