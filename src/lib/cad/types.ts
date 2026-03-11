export type CountyCode = 'DCAD' | 'TAD' | 'CCAD' | 'DENT';

export interface CadAccountInfoRow {
  countyCode: CountyCode;
  accountNum: string;
  appraisalYear: number;
  gisParcelId: string | null;
  divisionCd: string | null;
  bizName: string | null;
  ownerName1: string | null;
  ownerName2: string | null;
  ownerAddressLine1: string | null;
  ownerCity: string | null;
  ownerState: string | null;
  ownerZipcode: string | null;
  phoneNum: string | null;
  deedTxfrDate: string | null;
  legal1: string | null;
  legal2: string | null;
  legal3: string | null;
  legal4: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyZipcode: string | null;
}

export interface CadAppraisalRow {
  countyCode: CountyCode;
  accountNum: string;
  appraisalYear: number;
  sptdCode: string | null;
  ptadCode: string | null;
  improvVal: number | null;
  landVal: number | null;
  totalVal: number | null;
  cityJurisDesc: string | null;
  isdJurisDesc: string | null;
}

export interface CadBuildingRow {
  countyCode: CountyCode;
  accountNum: string;
  taxObjId: string | null;
  appraisalYear: number;
  propertyName: string | null;
  bldgClassDesc: string | null;
  bldgClassCd: string | null;
  yearBuilt: number | null;
  remodelYear: number | null;
  grossBldgArea: number | null;
  numStories: number | null;
  numUnits: number | null;
  netLeaseArea: number | null;
  constructionType: string | null;
  foundationType: string | null;
  heatingType: string | null;
  acType: string | null;
  qualityGrade: string | null;
  conditionGrade: string | null;
}

export interface CadLandRow {
  countyCode: CountyCode;
  accountNum: string;
  appraisalYear: number;
  landTypeCd: string | null;
  zoningDesc: string | null;
  frontDim: number | null;
  depthDim: number | null;
  landArea: number | null;
  landAreaUom: string | null;
  costPerUom: number | null;
}

export interface CadParser {
  countyCode: CountyCode;
  parseAccountInfo(filePath: string): AsyncIterable<CadAccountInfoRow>;
  parseAppraisalValues(filePath: string): AsyncIterable<CadAppraisalRow>;
  parseBuildings(filePath: string): AsyncIterable<CadBuildingRow>;
  parseLand(filePath: string): AsyncIterable<CadLandRow>;
}

export interface CountyConfig {
  code: CountyCode;
  name: string;
  downloadUrl: string;
  downloadMethod: 'direct' | 'manual';
  fileFormat: 'csv' | 'pipe-delimited' | 'fixed-width';
  files: {
    accountInfo: string;
    appraisalValues: string;
    buildings: string[];   // May need multiple files (e.g. COM_DETAIL + TAXABLE_OBJECT)
    land: string;
  };
}

export const COUNTY_CONFIGS: Record<CountyCode, CountyConfig> = {
  DCAD: {
    code: 'DCAD',
    name: 'Dallas Central Appraisal District',
    downloadUrl: 'https://www.dallascad.org/ViewPDFs.aspx?type=3&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CDATA%20PRODUCTS%5CDCAD2025_CURRENT.ZIP',
    downloadMethod: 'direct',
    fileFormat: 'csv',
    files: {
      accountInfo: 'ACCOUNT_INFO.csv',
      appraisalValues: 'ACCOUNT_APPRL_YEAR.csv',
      buildings: ['COM_DETAIL.csv', 'TAXABLE_OBJECT.csv'],
      land: 'LAND.csv',
    },
  },
  TAD: {
    code: 'TAD',
    name: 'Tarrant Appraisal District',
    downloadUrl: 'https://www.tad.org/resources/data-downloads',
    downloadMethod: 'manual',
    fileFormat: 'pipe-delimited',
    files: {
      accountInfo: 'PropertyData*.txt',  // Combined single file
      appraisalValues: 'PropertyData*.txt',
      buildings: ['PropertyData*.txt'],
      land: 'PropertyData*.txt',
    },
  },
  CCAD: {
    code: 'CCAD',
    name: 'Collin Central Appraisal District',
    downloadUrl: 'https://data.texas.gov/',  // data.texas.gov combined export
    downloadMethod: 'manual',
    fileFormat: 'csv',
    files: {
      accountInfo: 'CollinCAD_Appraisal.csv',  // Combined single file
      appraisalValues: 'CollinCAD_Appraisal.csv',
      buildings: ['CollinCAD_Appraisal.csv'],
      land: 'CollinCAD_Appraisal.csv',
    },
  },
  DENT: {
    code: 'DENT',
    name: 'Denton Central Appraisal District',
    downloadUrl: 'https://www.dentoncad.com/data-extracts/',
    downloadMethod: 'manual',
    fileFormat: 'fixed-width',
    files: {
      accountInfo: '*_APPRAISAL_INFO.TXT',
      appraisalValues: '*_APPRAISAL_INFO.TXT',
      buildings: ['*_APPRAISAL_IMPROVEMENT_INFO.TXT'],
      land: '*_APPRAISAL_LAND_DETAIL.TXT',
    },
  },
};
