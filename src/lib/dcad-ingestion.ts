import snowflake from 'snowflake-sdk';
import { db } from './db';
import { properties } from './schema';
import { eq } from 'drizzle-orm';
import { normalizeAddress, normalizeOwnerName, normalizeCity } from './normalization';

snowflake.configure({ logLevel: 'ERROR' });

const COMMERCIAL_PROPERTIES_TABLE = 'DCAD_LAND_2025.PUBLIC.COMMERCIAL_PROPERTIES';

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

export async function countCommercialPropertiesByZip(zipCode: string): Promise<number> {
  const sql = `
    SELECT COUNT(*) as CNT 
    FROM ${COMMERCIAL_PROPERTIES_TABLE} 
    WHERE ZIP LIKE '${zipCode}%'
  `;
  const rows = await executeQuery<any>(sql);
  return rows[0]?.CNT || 0;
}

export async function getCommercialPropertiesByZip(
  zipCode: string,
  limit: number = 1000,
  offset: number = 0
): Promise<DCadCommercialProperty[]> {
  const sql = `
    SELECT 
      PARCEL_ID,
      "address",
      CITY,
      ZIP,
      "lat",
      "lon",
      "usedesc",
      "usecode",
      REGRID_YEAR_BUILT,
      REGRID_NUM_STORIES,
      REGRID_IMPROV_VAL,
      REGRID_LAND_VAL,
      REGRID_TOTAL_VAL,
      LOT_ACRES,
      LOT_SQFT,
      BLDG_FOOTPRINT_SQFT,
      ACCOUNT_NUM,
      DIVISION_CD,
      DCAD_IMPROV_VAL,
      DCAD_LAND_VAL,
      DCAD_TOTAL_VAL,
      BLDG_CLASS_CD,
      CITY_JURIS_DESC,
      ISD_JURIS_DESC,
      BIZ_NAME,
      OWNER_NAME1,
      OWNER_NAME2,
      OWNER_ADDRESS_LINE1,
      OWNER_CITY,
      OWNER_STATE,
      OWNER_ZIPCODE,
      OWNER_PHONE,
      DEED_TXFR_DATE,
      DCAD_ZONING,
      FRONT_DIM,
      DEPTH_DIM,
      LAND_AREA,
      LAND_AREA_UOM,
      LAND_COST_PER_UOM,
      TAX_OBJ_ID,
      PROPERTY_NAME,
      BLDG_CLASS_DESC,
      DCAD_YEAR_BUILT,
      REMODEL_YR,
      GROSS_BLDG_AREA,
      DCAD_NUM_STORIES,
      NUM_UNITS,
      NET_LEASE_AREA,
      CONSTRUCTION_TYPE,
      FOUNDATION_TYPE,
      HEATING_TYPE,
      AC_TYPE,
      QUALITY_GRADE,
      CONDITION_GRADE
    FROM ${COMMERCIAL_PROPERTIES_TABLE}
    WHERE ZIP LIKE '${zipCode}%'
    ORDER BY DCAD_TOTAL_VAL DESC NULLS LAST
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
    
    const primaryName = uniqueBuildings.find(b => b.propertyName)?.propertyName 
      || firstRow.bizName 
      || null;
    
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

export async function upsertAggregatedPropertyToPostgres(
  prop: AggregatedProperty
): Promise<{ created: boolean }> {
  const propertyKey = prop.accountNum;
  
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
      const result = await upsertAggregatedPropertyToPostgres(prop);
      
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
