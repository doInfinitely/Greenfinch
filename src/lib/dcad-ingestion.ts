import snowflake from 'snowflake-sdk';
import { db } from './db';
import { properties } from './schema';
import { eq } from 'drizzle-orm';
import { normalizeAddress, normalizeOwnerName, normalizeCity } from './normalization';
import { INCLUDED_SPTD_CODES } from './property-classifications';

snowflake.configure({ logLevel: 'ERROR' });

const COMMERCIAL_PROPERTIES_TABLE = 'DCAD_LAND_2025.PUBLIC.COMMERCIAL_PROPERTIES';
const ACCOUNT_APPRL_TABLE = 'DCAD_LAND_2025.PUBLIC.ACCOUNT_APPRL_YEAR';
const ACCOUNT_INFO_TABLE = 'DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO';
const REGRID_TABLE = 'NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE.PREMIUM_PARCELS.TX_DALLAS';

export interface DCadBuildingRow {
  taxObjId: string | null;
  propertyName: string | null;
  bldgClassDesc: string | null;
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

export interface DCadCommercialProperty {
  parcelId: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  usedesc: string | null;
  usecode: string | null;
  stateClass: string | null;
  
  regridYearBuilt: number | null;
  regridNumStories: number | null;
  regridImprovVal: number | null;
  regridLandVal: number | null;
  regridTotalVal: number | null;
  lotAcres: number | null;
  lotSqft: number | null;
  bldgFootprintSqft: number | null;
  
  accountNum: string;
  divisionCd: string;
  dcadImprovVal: number | null;
  dcadLandVal: number | null;
  dcadTotalVal: number | null;
  bldgClassCd: string | null;
  cityJurisDesc: string | null;
  isdJurisDesc: string | null;
  
  bizName: string | null;
  ownerName1: string | null;
  ownerName2: string | null;
  ownerAddressLine1: string | null;
  ownerCity: string | null;
  ownerState: string | null;
  ownerZipcode: string | null;
  ownerPhone: string | null;
  deedTxfrDate: string | null;
  
  dcadZoning: string | null;
  frontDim: number | null;
  depthDim: number | null;
  landArea: number | null;
  landAreaUom: string | null;
  landCostPerUom: number | null;
  
  taxObjId: string | null;
  propertyName: string | null;
  bldgClassDesc: string | null;
  dcadYearBuilt: number | null;
  remodelYr: number | null;
  grossBldgArea: number | null;
  dcadNumStories: number | null;
  numUnits: number | null;
  netLeaseArea: number | null;
  constructionType: string | null;
  foundationType: string | null;
  heatingType: string | null;
  acType: string | null;
  qualityGrade: string | null;
  conditionGrade: string | null;
}

export interface AggregatedProperty {
  parcelId: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  usedesc: string | null;
  usecode: string | null;
  
  regridYearBuilt: number | null;
  regridNumStories: number | null;
  regridImprovVal: number | null;
  regridLandVal: number | null;
  regridTotalVal: number | null;
  lotAcres: number | null;
  lotSqft: number | null;
  bldgFootprintSqft: number | null;
  
  accountNum: string;
  divisionCd: string;
  dcadImprovVal: number | null;
  dcadLandVal: number | null;
  dcadTotalVal: number | null;
  bldgClassCd: string | null;
  cityJurisDesc: string | null;
  isdJurisDesc: string | null;
  
  bizName: string | null;
  ownerName1: string | null;
  ownerName2: string | null;
  ownerAddressLine1: string | null;
  ownerCity: string | null;
  ownerState: string | null;
  ownerZipcode: string | null;
  ownerPhone: string | null;
  deedTxfrDate: string | null;
  
  dcadZoning: string | null;
  frontDim: number | null;
  depthDim: number | null;
  landArea: number | null;
  landAreaUom: string | null;
  landCostPerUom: number | null;
  
  buildings: DCadBuildingRow[];
  buildingCount: number;
  oldestYearBuilt: number | null;
  newestYearBuilt: number | null;
  totalGrossBldgArea: number | null;
  totalUnits: number | null;
  rentableArea: number | null;
  parkingSqft: number | null;
  primaryPropertyName: string | null;
}

function formatPrivateKey(key: string): string {
  let formatted = key.trim();
  
  if (!formatted.includes('\n')) {
    formatted = formatted
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
    
    const header = '-----BEGIN PRIVATE KEY-----\n';
    const footer = '\n-----END PRIVATE KEY-----';
    const body = formatted.slice(header.length - 1, formatted.length - footer.length + 1).trim();
    
    const bodyWithNewlines = body.match(/.{1,64}/g)?.join('\n') || body;
    formatted = `-----BEGIN PRIVATE KEY-----\n${bodyWithNewlines}\n-----END PRIVATE KEY-----`;
  }
  
  return formatted;
}

function createConnection() {
  const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  
  if (!privateKey) {
    throw new Error('SNOWFLAKE_PRIVATE_KEY environment variable is not set');
  }

  const formattedKey = formatPrivateKey(privateKey);

  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT_GF!,
    username: process.env.SNOWFLAKE_USER_GF!,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: formattedKey,
    database: process.env.SNOWFLAKE_REGRID_DB!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
  });
}

async function executeQuery<T>(sqlText: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const connection = createConnection();
    
    connection.connect((err) => {
      if (err) {
        reject(err);
        return;
      }
      
      connection.execute({
        sqlText,
        complete: (err, stmt, rows) => {
          connection.destroy(() => {});
          if (err) {
            reject(err);
          } else {
            resolve((rows || []) as T[]);
          }
        }
      });
    });
  });
}

export async function describeTable(tableName: string): Promise<any[]> {
  const sql = `DESCRIBE TABLE ${tableName}`;
  return executeQuery<any>(sql);
}

export async function sampleAccountInfo(zipCode: string): Promise<any[]> {
  const sql = `
    SELECT * 
    FROM DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO
    WHERE PROPERTY_ZIPCODE LIKE '${zipCode}%'
    LIMIT 1
  `;
  return executeQuery<any>(sql);
}

export async function countCommercialPropertiesByZip(zipCode: string): Promise<number> {
  const sptdCodesList = INCLUDED_SPTD_CODES.map(c => `'${c}'`).join(', ');
  
  const sql = `
    SELECT COUNT(*) as CNT 
    FROM ${COMMERCIAL_PROPERTIES_TABLE} cp
    JOIN ${ACCOUNT_APPRL_TABLE} aa ON cp.ACCOUNT_NUM = aa.ACCOUNT_NUM AND aa.APPRAISAL_YR = 2025
    WHERE cp.ZIP LIKE '${zipCode}%'
      AND aa.SPTD_CODE IN (${sptdCodesList})
  `;
  const rows = await executeQuery<any>(sql);
  return rows[0]?.CNT || 0;
}

export async function getCommercialPropertiesByZip(
  zipCode: string,
  limit: number = 1000,
  offset: number = 0
): Promise<DCadCommercialProperty[]> {
  const sptdCodesList = INCLUDED_SPTD_CODES.map(c => `'${c}'`).join(', ');
  
  const sql = `
    SELECT 
      cp.PARCEL_ID,
      cp."address",
      cp.CITY,
      cp.ZIP,
      cp."lat",
      cp."lon",
      cp."usedesc",
      cp."usecode",
      cp.REGRID_YEAR_BUILT,
      cp.REGRID_NUM_STORIES,
      cp.REGRID_IMPROV_VAL,
      cp.REGRID_LAND_VAL,
      cp.REGRID_TOTAL_VAL,
      cp.LOT_ACRES,
      cp.LOT_SQFT,
      cp.BLDG_FOOTPRINT_SQFT,
      cp.ACCOUNT_NUM,
      cp.DIVISION_CD,
      cp.DCAD_IMPROV_VAL,
      cp.DCAD_LAND_VAL,
      cp.DCAD_TOTAL_VAL,
      cp.BLDG_CLASS_CD,
      cp.CITY_JURIS_DESC,
      cp.ISD_JURIS_DESC,
      cp.BIZ_NAME,
      cp.OWNER_NAME1,
      cp.OWNER_NAME2,
      cp.OWNER_ADDRESS_LINE1,
      cp.OWNER_CITY,
      cp.OWNER_STATE,
      cp.OWNER_ZIPCODE,
      cp.OWNER_PHONE,
      cp.DEED_TXFR_DATE,
      cp.DCAD_ZONING,
      cp.FRONT_DIM,
      cp.DEPTH_DIM,
      cp.LAND_AREA,
      cp.LAND_AREA_UOM,
      cp.LAND_COST_PER_UOM,
      cp.TAX_OBJ_ID,
      cp.PROPERTY_NAME,
      cp.BLDG_CLASS_DESC,
      cp.DCAD_YEAR_BUILT,
      cp.REMODEL_YR,
      cp.GROSS_BLDG_AREA,
      cp.DCAD_NUM_STORIES,
      cp.NUM_UNITS,
      cp.NET_LEASE_AREA,
      cp.CONSTRUCTION_TYPE,
      cp.FOUNDATION_TYPE,
      cp.HEATING_TYPE,
      cp.AC_TYPE,
      cp.QUALITY_GRADE,
      cp.CONDITION_GRADE,
      aa.SPTD_CODE
    FROM ${COMMERCIAL_PROPERTIES_TABLE} cp
    JOIN ${ACCOUNT_APPRL_TABLE} aa ON cp.ACCOUNT_NUM = aa.ACCOUNT_NUM AND aa.APPRAISAL_YR = 2025
    WHERE cp.ZIP LIKE '${zipCode}%'
      AND aa.SPTD_CODE IN (${sptdCodesList})
    ORDER BY cp.DCAD_TOTAL_VAL DESC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  
  const rows = await executeQuery<any>(sql);
  return rows.map(mapRowToProperty);
}

function mapRowToProperty(row: any): DCadCommercialProperty {
  return {
    parcelId: row.PARCEL_ID || '',
    address: row.address || '',
    city: row.CITY || '',
    zip: (row.ZIP || '').trim(),
    lat: parseFloat(row.lat) || 0,
    lon: parseFloat(row.lon) || 0,
    usedesc: row.usedesc || null,
    usecode: row.usecode || null,
    stateClass: row.SPTD_CODE || null,
    
    regridYearBuilt: row.REGRID_YEAR_BUILT || null,
    regridNumStories: row.REGRID_NUM_STORIES || null,
    regridImprovVal: row.REGRID_IMPROV_VAL || null,
    regridLandVal: row.REGRID_LAND_VAL || null,
    regridTotalVal: row.REGRID_TOTAL_VAL || null,
    lotAcres: row.LOT_ACRES || null,
    lotSqft: row.LOT_SQFT || null,
    bldgFootprintSqft: row.BLDG_FOOTPRINT_SQFT || null,
    
    accountNum: row.ACCOUNT_NUM || '',
    divisionCd: row.DIVISION_CD || '',
    dcadImprovVal: row.DCAD_IMPROV_VAL || null,
    dcadLandVal: row.DCAD_LAND_VAL || null,
    dcadTotalVal: row.DCAD_TOTAL_VAL || null,
    bldgClassCd: row.BLDG_CLASS_CD || null,
    cityJurisDesc: row.CITY_JURIS_DESC || null,
    isdJurisDesc: row.ISD_JURIS_DESC || null,
    
    bizName: row.BIZ_NAME || null,
    ownerName1: row.OWNER_NAME1 || null,
    ownerName2: row.OWNER_NAME2 || null,
    ownerAddressLine1: row.OWNER_ADDRESS_LINE1 || null,
    ownerCity: row.OWNER_CITY || null,
    ownerState: row.OWNER_STATE || null,
    ownerZipcode: row.OWNER_ZIPCODE || null,
    ownerPhone: row.OWNER_PHONE || null,
    deedTxfrDate: row.DEED_TXFR_DATE || null,
    
    dcadZoning: row.DCAD_ZONING || null,
    frontDim: row.FRONT_DIM || null,
    depthDim: row.DEPTH_DIM || null,
    landArea: row.LAND_AREA || null,
    landAreaUom: row.LAND_AREA_UOM || null,
    landCostPerUom: row.LAND_COST_PER_UOM || null,
    
    taxObjId: row.TAX_OBJ_ID || null,
    propertyName: row.PROPERTY_NAME || null,
    bldgClassDesc: row.BLDG_CLASS_DESC || null,
    dcadYearBuilt: row.DCAD_YEAR_BUILT || null,
    remodelYr: row.REMODEL_YR || null,
    grossBldgArea: row.GROSS_BLDG_AREA || null,
    dcadNumStories: row.DCAD_NUM_STORIES || null,
    numUnits: row.NUM_UNITS || null,
    netLeaseArea: row.NET_LEASE_AREA || null,
    constructionType: row.CONSTRUCTION_TYPE || null,
    foundationType: row.FOUNDATION_TYPE || null,
    heatingType: row.HEATING_TYPE || null,
    acType: row.AC_TYPE || null,
    qualityGrade: row.QUALITY_GRADE || null,
    conditionGrade: row.CONDITION_GRADE || null,
  };
}

export function aggregatePropertiesByParcel(rows: DCadCommercialProperty[]): AggregatedProperty[] {
  const groupedByAccount = new Map<string, DCadCommercialProperty[]>();
  
  for (const row of rows) {
    const key = row.accountNum;
    if (!groupedByAccount.has(key)) {
      groupedByAccount.set(key, []);
    }
    groupedByAccount.get(key)!.push(row);
  }
  
  const aggregated: AggregatedProperty[] = [];
  
  for (const [accountNum, accountRows] of groupedByAccount) {
    const firstRow = accountRows[0];
    
    const buildings: DCadBuildingRow[] = accountRows
      .filter(r => r.taxObjId)
      .map(r => ({
        taxObjId: r.taxObjId,
        propertyName: r.propertyName,
        bldgClassDesc: r.bldgClassDesc,
        yearBuilt: r.dcadYearBuilt,
        remodelYear: r.remodelYr,
        grossBldgArea: r.grossBldgArea,
        numStories: r.dcadNumStories,
        numUnits: r.numUnits,
        netLeaseArea: r.netLeaseArea,
        constructionType: r.constructionType,
        foundationType: r.foundationType,
        heatingType: r.heatingType,
        acType: r.acType,
        qualityGrade: r.qualityGrade,
        conditionGrade: r.conditionGrade,
      }));
    
    const uniqueBuildings = buildings.filter((b, i, arr) => 
      arr.findIndex(x => x.taxObjId === b.taxObjId) === i
    );
    
    const yearsBuilt = uniqueBuildings
      .map(b => b.yearBuilt)
      .filter((y): y is number => y !== null && y > 0);
    const remodelYears = uniqueBuildings
      .map(b => b.remodelYear)
      .filter((y): y is number => y !== null && y > 0);
    const allYears = [...yearsBuilt, ...remodelYears];
    
    const totalGrossBldgArea = uniqueBuildings
      .reduce((sum, b) => sum + (b.grossBldgArea || 0), 0) || null;
    const totalUnits = uniqueBuildings
      .reduce((sum, b) => sum + (b.numUnits || 0), 0) || null;
    
    // Calculate parking sqft (buildings with PARKING in name)
    const parkingSqft = uniqueBuildings
      .filter(b => b.propertyName?.toUpperCase().includes('PARKING'))
      .reduce((sum, b) => sum + (b.grossBldgArea || 0), 0) || null;
    
    // Calculate rentable area with priority:
    // 1. Sum of NET_LEASE_AREA when fully populated (all non-parking buildings have it)
    // 2. GROSS minus parking sqft
    // 3. If no parking and no net lease, use GROSS
    const nonParkingBuildings = uniqueBuildings.filter(
      b => !b.propertyName?.toUpperCase().includes('PARKING')
    );
    const buildingsWithNetLease = nonParkingBuildings.filter(b => b.netLeaseArea && b.netLeaseArea > 0);
    const netLeaseFullyPopulated = nonParkingBuildings.length > 0 && 
      buildingsWithNetLease.length >= nonParkingBuildings.length * 0.8; // 80% coverage threshold
    
    const totalNetLeaseArea = uniqueBuildings
      .reduce((sum, b) => sum + (b.netLeaseArea || 0), 0);
    
    let rentableArea: number | null = null;
    if (netLeaseFullyPopulated && totalNetLeaseArea > 0) {
      // Only use net lease if most buildings have it populated
      rentableArea = totalNetLeaseArea;
    } else if (parkingSqft && parkingSqft > 0 && totalGrossBldgArea) {
      // Fall back to gross minus parking
      rentableArea = totalGrossBldgArea - parkingSqft;
    } else {
      // No parking structures, use gross
      rentableArea = totalGrossBldgArea;
    }
    
    // Select best property name: prefer non-parking buildings, then shortest name
    const buildingsWithNames = uniqueBuildings.filter(b => b.propertyName);
    const nonParkingBuildings = buildingsWithNames.filter(b => 
      !b.propertyName?.toUpperCase().includes('PARKING') &&
      !b.propertyName?.toUpperCase().includes('GARAGE')
    );
    // Sort by name length (shorter = more likely to be the main building name)
    const sortedByLength = (nonParkingBuildings.length > 0 ? nonParkingBuildings : buildingsWithNames)
      .sort((a, b) => (a.propertyName?.length || 999) - (b.propertyName?.length || 999));
    const primaryName = sortedByLength[0]?.propertyName || firstRow.bizName || null;
    
    aggregated.push({
      parcelId: firstRow.parcelId,
      address: firstRow.address,
      city: firstRow.city,
      zip: firstRow.zip,
      lat: firstRow.lat,
      lon: firstRow.lon,
      usedesc: firstRow.usedesc,
      usecode: firstRow.usecode,
      
      regridYearBuilt: firstRow.regridYearBuilt,
      regridNumStories: firstRow.regridNumStories,
      regridImprovVal: firstRow.regridImprovVal,
      regridLandVal: firstRow.regridLandVal,
      regridTotalVal: firstRow.regridTotalVal,
      lotAcres: firstRow.lotAcres,
      lotSqft: firstRow.lotSqft,
      bldgFootprintSqft: firstRow.bldgFootprintSqft,
      
      accountNum: firstRow.accountNum,
      divisionCd: firstRow.divisionCd,
      dcadImprovVal: firstRow.dcadImprovVal,
      dcadLandVal: firstRow.dcadLandVal,
      dcadTotalVal: firstRow.dcadTotalVal,
      bldgClassCd: firstRow.bldgClassCd,
      cityJurisDesc: firstRow.cityJurisDesc,
      isdJurisDesc: firstRow.isdJurisDesc,
      
      bizName: firstRow.bizName,
      ownerName1: firstRow.ownerName1,
      ownerName2: firstRow.ownerName2,
      ownerAddressLine1: firstRow.ownerAddressLine1,
      ownerCity: firstRow.ownerCity,
      ownerState: firstRow.ownerState,
      ownerZipcode: firstRow.ownerZipcode,
      ownerPhone: firstRow.ownerPhone,
      deedTxfrDate: firstRow.deedTxfrDate,
      
      dcadZoning: firstRow.dcadZoning,
      frontDim: firstRow.frontDim,
      depthDim: firstRow.depthDim,
      landArea: firstRow.landArea,
      landAreaUom: firstRow.landAreaUom,
      landCostPerUom: firstRow.landCostPerUom,
      
      buildings: uniqueBuildings,
      buildingCount: uniqueBuildings.length || 1,
      oldestYearBuilt: yearsBuilt.length > 0 ? Math.min(...yearsBuilt) : null,
      newestYearBuilt: allYears.length > 0 ? Math.max(...allYears) : null,
      totalGrossBldgArea,
      totalUnits,
      rentableArea,
      parkingSqft,
      primaryPropertyName: primaryName,
    });
  }
  
  return aggregated;
}

// Identify parent property for a given parcel
// Parent = account that matches parcel ID, or ends with '0000'
function determineParentAccountNum(parcelId: string, accountNums: string[]): string | null {
  // First priority: account that exactly matches the parcel ID
  const matchesParcel = accountNums.find(acc => acc === parcelId);
  if (matchesParcel) return matchesParcel;
  
  // Second priority: account ending with '0000' (typically the parent)
  const endsWithZeros = accountNums.find(acc => acc.endsWith('0000'));
  if (endsWithZeros) return endsWithZeros;
  
  // Third priority: shortest account number (often the parent)
  const sorted = [...accountNums].sort((a, b) => a.length - b.length);
  return sorted[0] || null;
}

// Group aggregated properties by parcel ID and identify parent/constituent relationships
export function identifyParcelRelationships(properties: AggregatedProperty[]): Map<string, {
  parentAccountNum: string;
  constituentAccountNums: string[];
}> {
  // Group by parcel ID
  const byParcel = new Map<string, AggregatedProperty[]>();
  for (const prop of properties) {
    const parcelId = prop.parcelId;
    if (!byParcel.has(parcelId)) {
      byParcel.set(parcelId, []);
    }
    byParcel.get(parcelId)!.push(prop);
  }
  
  const relationships = new Map<string, { parentAccountNum: string; constituentAccountNums: string[] }>();
  
  for (const [parcelId, parcelProps] of byParcel) {
    const accountNums = parcelProps.map(p => p.accountNum);
    const parentAccountNum = determineParentAccountNum(parcelId, accountNums);
    
    if (parentAccountNum && accountNums.length > 1) {
      // Multiple accounts on same parcel - this is a complex
      const constituentAccountNums = accountNums.filter(acc => acc !== parentAccountNum);
      relationships.set(parcelId, { parentAccountNum, constituentAccountNums });
    }
  }
  
  return relationships;
}

export async function upsertAggregatedPropertyToPostgres(
  prop: AggregatedProperty,
  relationships?: Map<string, { parentAccountNum: string; constituentAccountNums: string[] }>
): Promise<{ created: boolean }> {
  const propertyKey = prop.accountNum;
  const parcelId = prop.parcelId;
  
  // Determine parent/constituent status
  // A property is a "parent" if:
  // 1. It's the main account for a complex (parcelRel.parentAccountNum matches), OR
  // 2. It's a standalone property (no entry in relationships map = single account for parcel)
  const parcelRel = relationships?.get(parcelId);
  const isParentProperty = !parcelRel || parcelRel.parentAccountNum === propertyKey;
  const parentPropertyKey = parcelRel && !isParentProperty ? parcelRel.parentAccountNum : null;
  const constituentAccountNums = isParentProperty && parcelRel ? parcelRel.constituentAccountNums : null;
  const constituentCount = isParentProperty && parcelRel ? (parcelRel.constituentAccountNums.length || 0) : 0;
  
  const existingProperty = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  const normalizedAddress = normalizeAddress(prop.address);
  const normalizedCity = normalizeCity(prop.city);
  const normalizedOwner = normalizeOwnerName(prop.ownerName1 || prop.bizName || '');
  const normalizedOwner2 = prop.ownerName2 ? normalizeOwnerName(prop.ownerName2) : null;

  const propertyData = {
    propertyKey,
    sourceLlUuid: prop.parcelId,
    llStackUuid: null,
    
    regridAddress: normalizedAddress,
    city: normalizedCity,
    state: 'TX',
    zip: prop.zip,
    county: 'DALLAS',
    
    lat: prop.lat,
    lon: prop.lon,
    
    lotSqft: prop.lotSqft ? Math.round(prop.lotSqft) : null,
    buildingSqft: prop.totalGrossBldgArea ? Math.round(prop.totalGrossBldgArea) : 
                  prop.bldgFootprintSqft ? Math.round(prop.bldgFootprintSqft) : null,
    yearBuilt: prop.oldestYearBuilt || prop.regridYearBuilt || null,
    numFloors: prop.regridNumStories || null,
    
    regridOwner: normalizedOwner,
    regridOwner2: normalizedOwner2,
    
    dcadAccountNum: prop.accountNum,
    dcadDivisionCd: prop.divisionCd,
    dcadImprovVal: prop.dcadImprovVal,
    dcadLandVal: prop.dcadLandVal,
    dcadTotalVal: prop.dcadTotalVal,
    dcadCityJuris: prop.cityJurisDesc,
    dcadIsdJuris: prop.isdJurisDesc,
    
    dcadBizName: prop.bizName,
    dcadOwnerName1: prop.ownerName1,
    dcadOwnerName2: prop.ownerName2,
    dcadOwnerAddress: prop.ownerAddressLine1,
    dcadOwnerCity: prop.ownerCity,
    dcadOwnerState: prop.ownerState,
    dcadOwnerZip: prop.ownerZipcode,
    dcadOwnerPhone: prop.ownerPhone,
    dcadDeedTransferDate: prop.deedTxfrDate,
    
    dcadZoning: prop.dcadZoning,
    dcadLandFrontDim: prop.frontDim,
    dcadLandDepthDim: prop.depthDim,
    dcadLandArea: prop.landArea,
    dcadLandAreaUom: prop.landAreaUom,
    
    dcadBuildingCount: prop.buildingCount,
    dcadOldestYearBuilt: prop.oldestYearBuilt,
    dcadNewestYearBuilt: prop.newestYearBuilt,
    dcadTotalGrossBldgArea: prop.totalGrossBldgArea,
    dcadTotalUnits: prop.totalUnits,
    dcadRentableArea: prop.rentableArea,
    dcadParkingSqft: prop.parkingSqft,
    dcadBuildings: prop.buildings,
    
    commonName: prop.primaryPropertyName || prop.bizName || null,
    
    // Parcel-level relationships
    isParentProperty: isParentProperty,
    parentPropertyKey: parentPropertyKey,
    constituentAccountNums: constituentAccountNums,
    constituentCount: constituentCount,
    
    enrichmentStatus: 'pending' as const,
    lastRegridUpdate: new Date(),
    updatedAt: new Date(),
  };

  if (existingProperty.length > 0) {
    await db
      .update(properties)
      .set(propertyData)
      .where(eq(properties.propertyKey, propertyKey));
    return { created: false };
  } else {
    await db.insert(properties).values({
      ...propertyData,
      createdAt: new Date(),
      isActive: true,
    });
    return { created: true };
  }
}

export async function upsertPropertyToPostgres(
  prop: DCadCommercialProperty
): Promise<{ created: boolean }> {
  const aggregated = aggregatePropertiesByParcel([prop]);
  if (aggregated.length > 0) {
    return upsertAggregatedPropertyToPostgres(aggregated[0]);
  }
  return { created: false };
}

export interface IngestionStats {
  totalFromSnowflake: number;
  propertiesSaved: number;
  propertiesUpdated: number;
  errors: number;
  durationMs: number;
}

export async function runIngestion(
  zipCode: string,
  limit: number = 500
): Promise<IngestionStats> {
  console.log(`[Ingestion] Starting ingestion for ZIP ${zipCode}`);
  
  const startTime = Date.now();
  const stats: IngestionStats = {
    totalFromSnowflake: 0,
    propertiesSaved: 0,
    propertiesUpdated: 0,
    errors: 0,
    durationMs: 0,
  };
  
  const count = await countCommercialPropertiesByZip(zipCode);
  console.log(`[Ingestion] Found ${count} commercial properties (rows) in ZIP ${zipCode}`);
  
  const commercialProperties = await getCommercialPropertiesByZip(zipCode, limit);
  stats.totalFromSnowflake = commercialProperties.length;
  console.log(`[Ingestion] Fetched ${commercialProperties.length} rows from Snowflake`);
  
  const aggregatedProperties = aggregatePropertiesByParcel(commercialProperties);
  console.log(`[Ingestion] Aggregated into ${aggregatedProperties.length} unique properties`);
  
  // Identify parent/constituent relationships based on parcel ID
  const relationships = identifyParcelRelationships(aggregatedProperties);
  const complexCount = relationships.size;
  if (complexCount > 0) {
    console.log(`[Ingestion] Found ${complexCount} property complexes with multiple accounts:`);
    for (const [parcelId, rel] of [...relationships.entries()].slice(0, 5)) {
      const parent = aggregatedProperties.find(p => p.accountNum === rel.parentAccountNum);
      console.log(`  - ${parent?.primaryPropertyName || parcelId}: ${rel.constituentAccountNums.length + 1} accounts`);
    }
  }
  
  const multiBuilding = aggregatedProperties.filter(p => p.buildingCount > 1);
  if (multiBuilding.length > 0) {
    console.log(`[Ingestion] ${multiBuilding.length} properties have multiple buildings:`);
    for (const p of multiBuilding.slice(0, 5)) {
      console.log(`  - ${p.primaryPropertyName || p.parcelId}: ${p.buildingCount} buildings, ${p.totalGrossBldgArea?.toLocaleString()} sqft`);
    }
  }
  
  for (let i = 0; i < aggregatedProperties.length; i++) {
    const prop = aggregatedProperties[i];
    
    try {
      const result = await upsertAggregatedPropertyToPostgres(prop, relationships);
      
      if (result.created) {
        stats.propertiesSaved++;
      } else {
        stats.propertiesUpdated++;
      }
      
      if ((i + 1) % 50 === 0) {
        console.log(`[Ingestion] Progress: ${i + 1}/${aggregatedProperties.length}`);
      }
    } catch (error) {
      stats.errors++;
      console.error(`[Ingestion] Error saving property ${prop.parcelId}:`, error instanceof Error ? error.message : error);
    }
  }
  
  stats.durationMs = Date.now() - startTime;
  console.log(`[Ingestion] Complete in ${Math.round(stats.durationMs / 1000)}s: ${stats.propertiesSaved} new, ${stats.propertiesUpdated} updated, ${stats.errors} errors`);
  
  return stats;
}
