import snowflake from 'snowflake-sdk';

snowflake.configure({ logLevel: 'ERROR' });

// Regrid parcel data table (correct schema path)
const REGRID_TABLE = 'NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE.PREMIUM_PARCELS.TX_DALLAS';

// Individual building details from DCAD COM_DETAIL
export interface DCADBuilding {
  taxObjId: string;
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

export interface CommercialProperty {
  // Regrid parcel data
  parcelId: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  usedesc: string;
  usecode: string;
  regridYearBuilt: number | null;
  regridNumStories: number | null;
  regridImprovVal: number | null;
  regridLandVal: number | null;
  regridTotalVal: number | null;
  lotAcres: number | null;
  lotSqft: number | null;
  bldgFootprintSqft: number | null;
  
  // DCAD Core appraisal data
  accountNum: string;
  divisionCd: string; // COM, RES
  dcadImprovVal: number | null;
  dcadLandVal: number | null;
  dcadTotalVal: number | null;
  cityJurisDesc: string | null;
  isdJurisDesc: string | null;
  
  // DCAD Account info (owner details)
  bizName: string | null;
  ownerName1: string | null;
  ownerName2: string | null;
  ownerAddressLine1: string | null;
  ownerCity: string | null;
  ownerState: string | null;
  ownerZipcode: string | null;
  ownerPhone: string | null;
  deedTxfrDate: string | null;
  
  // DCAD Land details
  dcadZoning: string | null;
  frontDim: number | null;
  depthDim: number | null;
  landArea: number | null;
  landAreaUom: string | null;
  landCostPerUom: number | null;
  
  // Aggregated building summary
  buildingCount: number;
  oldestYearBuilt: number | null;
  newestYearBuilt: number | null;
  totalGrossBldgArea: number | null;
  totalUnits: number | null;
  
  // Array of all buildings on this parcel
  buildings: DCADBuilding[];
}

// Legacy interface for backwards compatibility
export interface RegridParcel {
  ll_uuid: string;
  ll_stack_uuid: string | null;
  address: string;
  scity: string;
  state2: string;
  szip: string;
  county: string;
  lat: string;
  lon: string;
  owner: string;
  owner2: string | null;
  usedesc: string;
  usecode: string;
  yearbuilt: number | null;
  parval: number;
  landval: number;
  improvval: number;
  ll_gisacre: number;
  sqft: number;
  area_building: number | null;
  numstories: number | null;
  struct: boolean;
  structno: number | null;
  mailadd: string;
  mail_city: string;
  mail_state2: string;
  mail_zip: string;
  parcelnumb: string;
  sunit: string | null;
  zoning?: string | null;
  zoningDescription?: string | null;
}

export interface AggregatedProperty {
  propertyKey: string;
  sourceLlUuid: string;
  llStackUuid: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  lat: number;
  lon: number;
  lotSqft: number;
  buildingSqft: number | null;
  yearBuilt: number | null;
  numFloors: number | null;
  totalParval: number;
  totalImprovval: number;
  landval: number;
  allOwners: string[];
  primaryOwner: string | null;
  usedesc: string[];
  usecode: string[];
  zoning: string[];
  zoningDescription: string[];
  parcelCount: number;
  rawParcelsJson: RegridParcel[];
  
  // DCAD enriched fields
  dcad?: CommercialProperty;
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

export async function getPropertyByKey(propertyKey: string): Promise<AggregatedProperty | null> {
  const sql = `
    SELECT
      COALESCE("ll_stack_uuid", "ll_uuid") AS property_key,
      "ll_uuid" AS source_ll_uuid,
      "ll_stack_uuid",
      "address",
      "scity" AS city,
      "state2" AS state,
      "szip" AS zip,
      "county",
      CAST("lat" AS FLOAT) AS lat,
      CAST("lon" AS FLOAT) AS lon,
      "ll_gisacre",
      "sqft" AS lot_sqft,
      "ll_bldg_footprint_sqft",
      "recrdareano",
      "yearbuilt" AS year_built,
      "numstories" AS num_floors,
      "parval" AS total_parval,
      "improvval" AS total_improvval,
      "landval",
      "owner" AS primary_owner,
      "owner2",
      "usedesc",
      "usecode",
      "parcelnumb",
      "sunit",
      "mailadd",
      "mail_city",
      "mail_state2",
      "mail_zip"
    FROM ${REGRID_TABLE}
    WHERE "ll_uuid" = '${propertyKey.replace(/'/g, "''")}'
       OR "ll_stack_uuid" = '${propertyKey.replace(/'/g, "''")}'
    LIMIT 100
  `;
  
  const rows = await executeQuery<any>(sql);
  
  if (rows.length === 0) return null;
  
  const first = rows[0];
  const allOwners = [...new Set(rows.flatMap(r => [r.PRIMARY_OWNER, r.OWNER2].filter(Boolean)))];
  
  const lotSqftFromAcres = (first.LL_GISACRE || 0) * 43560;
  const lotSqft = lotSqftFromAcres > 0 ? lotSqftFromAcres : (first.LOT_SQFT || 0);
  const buildingSqft = rows.reduce((max, r) => Math.max(max, r.RECRDAREANO || r.LL_BLDG_FOOTPRINT_SQFT || 0), 0) || null;
  
  return {
    propertyKey: first.PROPERTY_KEY,
    sourceLlUuid: first.SOURCE_LL_UUID,
    llStackUuid: first.LL_STACK_UUID,
    address: first.ADDRESS || '',
    city: first.CITY || '',
    state: first.STATE || 'TX',
    zip: first.ZIP || '',
    county: first.COUNTY || '',
    lat: parseFloat(first.LAT) || 0,
    lon: parseFloat(first.LON) || 0,
    lotSqft: lotSqft,
    buildingSqft: buildingSqft,
    yearBuilt: first.YEAR_BUILT,
    numFloors: first.NUM_FLOORS,
    totalParval: rows.reduce((sum, r) => sum + (r.TOTAL_PARVAL || 0), 0),
    totalImprovval: rows.reduce((sum, r) => sum + (r.TOTAL_IMPROVVAL || 0), 0),
    landval: first.LANDVAL || 0,
    allOwners,
    primaryOwner: first.PRIMARY_OWNER,
    usedesc: [...new Set(rows.map(r => r.USEDESC).filter(Boolean))],
    usecode: [...new Set(rows.map(r => r.USECODE).filter(Boolean))],
    zoning: [],
    zoningDescription: [],
    parcelCount: rows.length,
    rawParcelsJson: rows.map(r => ({
      ll_uuid: r.SOURCE_LL_UUID,
      ll_stack_uuid: r.LL_STACK_UUID,
      address: r.ADDRESS,
      scity: r.CITY,
      state2: r.STATE,
      szip: r.ZIP,
      county: r.COUNTY,
      lat: r.LAT,
      lon: r.LON,
      owner: r.PRIMARY_OWNER,
      owner2: r.OWNER2,
      usedesc: r.USEDESC,
      usecode: r.USECODE,
      yearbuilt: r.YEAR_BUILT,
      parval: r.TOTAL_PARVAL,
      landval: r.LANDVAL,
      improvval: r.TOTAL_IMPROVVAL,
      ll_gisacre: r.LL_GISACRE || 0,
      sqft: r.LOT_SQFT || 0,
      area_building: r.AREA_BUILDING || null,
      numstories: r.NUM_FLOORS,
      struct: true,
      structno: null,
      mailadd: r.MAILADD,
      mail_city: r.MAIL_CITY,
      mail_state2: r.MAIL_STATE2,
      mail_zip: r.MAIL_ZIP,
      parcelnumb: r.PARCELNUMB,
      sunit: r.SUNIT,
    })),
  };
}

// Fetch commercial properties with aggregated building data from DCAD+Regrid
export async function getCommercialPropertiesByZip(
  zipCode: string,
  divisionCd: 'COM' | 'RES' | 'ALL' = 'COM',
  limit: number = 1000
): Promise<CommercialProperty[]> {
  const divisionFilter = divisionCd === 'ALL' 
    ? '' 
    : `AND ai.DIVISION_CD = '${divisionCd}'`;
    
  const sql = `
    WITH building_data AS (
      SELECT 
        ai.ACCOUNT_NUM,
        cd.TAX_OBJ_ID,
        cd.PROPERTY_NAME,
        cd.BLDG_CLASS_DESC,
        cd.YEAR_BUILT,
        cd.REMODEL_YR,
        cd.GROSS_BLDG_AREA,
        cd.NUM_STORIES,
        cd.NUM_UNITS,
        cd.NET_LEASE_AREA,
        cd.CONSTR_TYP_DESC as CONSTRUCTION_TYPE,
        cd.FOUNDATION_TYP_DESC as FOUNDATION_TYPE,
        cd.HEATING_TYP_DESC as HEATING_TYPE,
        cd.AC_TYP_DESC as AC_TYPE,
        cd.PROPERTY_QUAL_DESC as QUALITY_GRADE,
        cd.PROPERTY_COND_DESC as CONDITION_GRADE
      FROM DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO ai
      JOIN DCAD_LAND_2025.PUBLIC.TAXABLE_OBJECT tob ON ai.ACCOUNT_NUM = tob.ACCOUNT_NUM
      JOIN DCAD_LAND_2025.PUBLIC.COM_DETAIL cd ON tob.TAX_OBJ_ID = cd.TAX_OBJ_ID
      WHERE ai.APPRAISAL_YR = 2025
        AND ai.PROPERTY_ZIPCODE LIKE '${zipCode.replace(/'/g, "''")}%'
    ),
    building_agg AS (
      SELECT 
        ACCOUNT_NUM,
        COUNT(*) as BUILDING_COUNT,
        MIN(YEAR_BUILT) as OLDEST_YEAR_BUILT,
        MAX(YEAR_BUILT) as NEWEST_YEAR_BUILT,
        SUM(GROSS_BLDG_AREA) as TOTAL_GROSS_BLDG_AREA,
        SUM(NUM_UNITS) as TOTAL_UNITS,
        ARRAY_AGG(
          OBJECT_CONSTRUCT(
            'taxObjId', TAX_OBJ_ID,
            'propertyName', PROPERTY_NAME,
            'bldgClassDesc', BLDG_CLASS_DESC,
            'yearBuilt', YEAR_BUILT,
            'remodelYear', REMODEL_YR,
            'grossBldgArea', GROSS_BLDG_AREA,
            'numStories', NUM_STORIES,
            'numUnits', NUM_UNITS,
            'netLeaseArea', NET_LEASE_AREA,
            'constructionType', CONSTRUCTION_TYPE,
            'foundationType', FOUNDATION_TYPE,
            'heatingType', HEATING_TYPE,
            'acType', AC_TYPE,
            'qualityGrade', QUALITY_GRADE,
            'conditionGrade', CONDITION_GRADE
          )
        ) as BUILDINGS
      FROM building_data
      GROUP BY ACCOUNT_NUM
    )
    SELECT 
      r.parcelnumb as PARCEL_ID,
      r.address,
      r.scity as CITY,
      r.szip as ZIP,
      r.lat,
      r.lon,
      r.usedesc,
      r.usecode,
      r.yearbuilt as REGRID_YEAR_BUILT,
      r.numstories as REGRID_NUM_STORIES,
      r.improvval as REGRID_IMPROV_VAL,
      r.landval as REGRID_LAND_VAL,
      r.parval as REGRID_TOTAL_VAL,
      r.ll_gisacre as LOT_ACRES,
      r.sqft as LOT_SQFT,
      r.ll_bldg_footprint_sqft as BLDG_FOOTPRINT_SQFT,
      
      ai.ACCOUNT_NUM,
      ai.DIVISION_CD,
      aa.IMPR_VAL as DCAD_IMPROV_VAL,
      aa.LAND_VAL as DCAD_LAND_VAL,
      aa.TOT_VAL as DCAD_TOTAL_VAL,
      aa.CITY_JURIS_DESC,
      aa.ISD_JURIS_DESC,
      ai.BIZ_NAME,
      ai.OWNER_NAME1,
      ai.OWNER_NAME2,
      ai.OWNER_ADDRESS_LINE1,
      ai.OWNER_CITY,
      ai.OWNER_STATE,
      ai.OWNER_ZIPCODE,
      ai.PHONE_NUM as OWNER_PHONE,
      ai.DEED_TXFR_DATE,
      
      l.ZONING_DESC as DCAD_ZONING,
      l.FRONT_DIM,
      l.DEPTH_DIM,
      l.LAND_AREA,
      l.LAND_AREA_UOM,
      l.COST_PER_UOM as LAND_COST_PER_UOM,
      
      COALESCE(ba.BUILDING_COUNT, 0) as BUILDING_COUNT,
      ba.OLDEST_YEAR_BUILT,
      ba.NEWEST_YEAR_BUILT,
      ba.TOTAL_GROSS_BLDG_AREA,
      ba.TOTAL_UNITS,
      ba.BUILDINGS
      
    FROM NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE.PREMIUM.DEED r
    JOIN DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO ai ON r.parcelnumb = ai.GIS_PARCEL_ID AND ai.APPRAISAL_YR = 2025
    JOIN DCAD_LAND_2025.PUBLIC.ACCOUNT_APPRL_YEAR aa ON ai.ACCOUNT_NUM = aa.ACCOUNT_NUM AND aa.APPRAISAL_YR = 2025
    LEFT JOIN DCAD_LAND_2025.PUBLIC.LAND l ON ai.ACCOUNT_NUM = l.ACCOUNT_NUM AND l.LAND_TYPE_CD = 'L'
    LEFT JOIN building_agg ba ON ai.ACCOUNT_NUM = ba.ACCOUNT_NUM
    WHERE ai.PROPERTY_ZIPCODE LIKE '${zipCode.replace(/'/g, "''")}%'
    ${divisionFilter}
    LIMIT ${limit}
  `;
  
  const rows = await executeQuery<any>(sql);
  
  return rows.map(r => mapRowToCommercialProperty(r));
}

// Helper function to map Snowflake row to CommercialProperty
function mapRowToCommercialProperty(r: any): CommercialProperty {
  // Parse the BUILDINGS array from Snowflake (comes as JSON string or array)
  let buildings: DCADBuilding[] = [];
  if (r.BUILDINGS) {
    try {
      const rawBuildings = typeof r.BUILDINGS === 'string' 
        ? JSON.parse(r.BUILDINGS) 
        : r.BUILDINGS;
      buildings = rawBuildings.map((b: any) => ({
        taxObjId: b.taxObjId || '',
        propertyName: b.propertyName || null,
        bldgClassDesc: b.bldgClassDesc || null,
        yearBuilt: b.yearBuilt || null,
        remodelYear: b.remodelYear || null,
        grossBldgArea: b.grossBldgArea || null,
        numStories: b.numStories || null,
        numUnits: b.numUnits || null,
        netLeaseArea: b.netLeaseArea || null,
        constructionType: b.constructionType || null,
        foundationType: b.foundationType || null,
        heatingType: b.heatingType || null,
        acType: b.acType || null,
        qualityGrade: b.qualityGrade || null,
        conditionGrade: b.conditionGrade || null,
      }));
    } catch (e) {
      console.error('Error parsing buildings array:', e);
    }
  }

  return {
    parcelId: r.PARCEL_ID,
    address: r.address || '',  // lowercase in Snowflake
    city: r.CITY || '',
    zip: (r.ZIP || '').trim(),
    lat: parseFloat(r.lat) || 0,  // lowercase
    lon: parseFloat(r.lon) || 0,  // lowercase
    usedesc: r.usedesc || '',  // lowercase
    usecode: r.usecode || '',  // lowercase
    regridYearBuilt: r.REGRID_YEAR_BUILT,
    regridNumStories: r.REGRID_NUM_STORIES,
    regridImprovVal: r.REGRID_IMPROV_VAL,
    regridLandVal: r.REGRID_LAND_VAL,
    regridTotalVal: r.REGRID_TOTAL_VAL,
    lotAcres: r.LOT_ACRES,
    lotSqft: r.LOT_SQFT,
    bldgFootprintSqft: r.BLDG_FOOTPRINT_SQFT,
    
    accountNum: r.ACCOUNT_NUM || '',
    divisionCd: r.DIVISION_CD || '',
    dcadImprovVal: r.DCAD_IMPROV_VAL,
    dcadLandVal: r.DCAD_LAND_VAL,
    dcadTotalVal: r.DCAD_TOTAL_VAL,
    cityJurisDesc: r.CITY_JURIS_DESC,
    isdJurisDesc: r.ISD_JURIS_DESC,
    
    bizName: r.BIZ_NAME,
    ownerName1: r.OWNER_NAME1,
    ownerName2: r.OWNER_NAME2,
    ownerAddressLine1: r.OWNER_ADDRESS_LINE1,
    ownerCity: r.OWNER_CITY,
    ownerState: r.OWNER_STATE,
    ownerZipcode: r.OWNER_ZIPCODE,
    ownerPhone: r.OWNER_PHONE,
    deedTxfrDate: r.DEED_TXFR_DATE,
    
    dcadZoning: r.DCAD_ZONING,
    frontDim: r.FRONT_DIM,
    depthDim: r.DEPTH_DIM,
    landArea: r.LAND_AREA,
    landAreaUom: r.LAND_AREA_UOM,
    landCostPerUom: r.LAND_COST_PER_UOM,
    
    buildingCount: r.BUILDING_COUNT || 0,
    oldestYearBuilt: r.OLDEST_YEAR_BUILT,
    newestYearBuilt: r.NEWEST_YEAR_BUILT,
    totalGrossBldgArea: r.TOTAL_GROSS_BLDG_AREA,
    totalUnits: r.TOTAL_UNITS,
    buildings: buildings,
  };
}

// Get a single commercial property by parcel ID with aggregated building data
export async function getCommercialPropertyByParcelId(
  parcelId: string
): Promise<CommercialProperty | null> {
  const sql = `
    WITH building_data AS (
      SELECT 
        ai.ACCOUNT_NUM,
        cd.TAX_OBJ_ID,
        cd.PROPERTY_NAME,
        cd.BLDG_CLASS_DESC,
        cd.YEAR_BUILT,
        cd.REMODEL_YR,
        cd.GROSS_BLDG_AREA,
        cd.NUM_STORIES,
        cd.NUM_UNITS,
        cd.NET_LEASE_AREA,
        cd.CONSTR_TYP_DESC as CONSTRUCTION_TYPE,
        cd.FOUNDATION_TYP_DESC as FOUNDATION_TYPE,
        cd.HEATING_TYP_DESC as HEATING_TYPE,
        cd.AC_TYP_DESC as AC_TYPE,
        cd.PROPERTY_QUAL_DESC as QUALITY_GRADE,
        cd.PROPERTY_COND_DESC as CONDITION_GRADE
      FROM DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO ai
      JOIN DCAD_LAND_2025.PUBLIC.TAXABLE_OBJECT tob ON ai.ACCOUNT_NUM = tob.ACCOUNT_NUM
      JOIN DCAD_LAND_2025.PUBLIC.COM_DETAIL cd ON tob.TAX_OBJ_ID = cd.TAX_OBJ_ID
      WHERE ai.APPRAISAL_YR = 2025
        AND ai.GIS_PARCEL_ID = '${parcelId.replace(/'/g, "''")}'
    ),
    building_agg AS (
      SELECT 
        ACCOUNT_NUM,
        COUNT(*) as BUILDING_COUNT,
        MIN(YEAR_BUILT) as OLDEST_YEAR_BUILT,
        MAX(YEAR_BUILT) as NEWEST_YEAR_BUILT,
        SUM(GROSS_BLDG_AREA) as TOTAL_GROSS_BLDG_AREA,
        SUM(NUM_UNITS) as TOTAL_UNITS,
        ARRAY_AGG(
          OBJECT_CONSTRUCT(
            'taxObjId', TAX_OBJ_ID,
            'propertyName', PROPERTY_NAME,
            'bldgClassDesc', BLDG_CLASS_DESC,
            'yearBuilt', YEAR_BUILT,
            'remodelYear', REMODEL_YR,
            'grossBldgArea', GROSS_BLDG_AREA,
            'numStories', NUM_STORIES,
            'numUnits', NUM_UNITS,
            'netLeaseArea', NET_LEASE_AREA,
            'constructionType', CONSTRUCTION_TYPE,
            'foundationType', FOUNDATION_TYPE,
            'heatingType', HEATING_TYPE,
            'acType', AC_TYPE,
            'qualityGrade', QUALITY_GRADE,
            'conditionGrade', CONDITION_GRADE
          )
        ) as BUILDINGS
      FROM building_data
      GROUP BY ACCOUNT_NUM
    )
    SELECT 
      r.parcelnumb as PARCEL_ID,
      r.address,
      r.scity as CITY,
      r.szip as ZIP,
      r.lat,
      r.lon,
      r.usedesc,
      r.usecode,
      r.yearbuilt as REGRID_YEAR_BUILT,
      r.numstories as REGRID_NUM_STORIES,
      r.improvval as REGRID_IMPROV_VAL,
      r.landval as REGRID_LAND_VAL,
      r.parval as REGRID_TOTAL_VAL,
      r.ll_gisacre as LOT_ACRES,
      r.sqft as LOT_SQFT,
      r.ll_bldg_footprint_sqft as BLDG_FOOTPRINT_SQFT,
      
      ai.ACCOUNT_NUM,
      ai.DIVISION_CD,
      aa.IMPR_VAL as DCAD_IMPROV_VAL,
      aa.LAND_VAL as DCAD_LAND_VAL,
      aa.TOT_VAL as DCAD_TOTAL_VAL,
      aa.CITY_JURIS_DESC,
      aa.ISD_JURIS_DESC,
      ai.BIZ_NAME,
      ai.OWNER_NAME1,
      ai.OWNER_NAME2,
      ai.OWNER_ADDRESS_LINE1,
      ai.OWNER_CITY,
      ai.OWNER_STATE,
      ai.OWNER_ZIPCODE,
      ai.PHONE_NUM as OWNER_PHONE,
      ai.DEED_TXFR_DATE,
      
      l.ZONING_DESC as DCAD_ZONING,
      l.FRONT_DIM,
      l.DEPTH_DIM,
      l.LAND_AREA,
      l.LAND_AREA_UOM,
      l.COST_PER_UOM as LAND_COST_PER_UOM,
      
      COALESCE(ba.BUILDING_COUNT, 0) as BUILDING_COUNT,
      ba.OLDEST_YEAR_BUILT,
      ba.NEWEST_YEAR_BUILT,
      ba.TOTAL_GROSS_BLDG_AREA,
      ba.TOTAL_UNITS,
      ba.BUILDINGS
      
    FROM NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE.PREMIUM.DEED r
    JOIN DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO ai ON r.parcelnumb = ai.GIS_PARCEL_ID AND ai.APPRAISAL_YR = 2025
    JOIN DCAD_LAND_2025.PUBLIC.ACCOUNT_APPRL_YEAR aa ON ai.ACCOUNT_NUM = aa.ACCOUNT_NUM AND aa.APPRAISAL_YR = 2025
    LEFT JOIN DCAD_LAND_2025.PUBLIC.LAND l ON ai.ACCOUNT_NUM = l.ACCOUNT_NUM AND l.LAND_TYPE_CD = 'L'
    LEFT JOIN building_agg ba ON ai.ACCOUNT_NUM = ba.ACCOUNT_NUM
    WHERE r.parcelnumb = '${parcelId.replace(/'/g, "''")}'
    LIMIT 1
  `;
  
  const rows = await executeQuery<any>(sql);
  
  if (rows.length === 0) return null;
  
  return mapRowToCommercialProperty(rows[0]);
}

// Count commercial properties by ZIP (queries source tables)
export async function countCommercialPropertiesByZip(
  zipCode: string,
  divisionCd: 'COM' | 'RES' | 'ALL' = 'COM'
): Promise<number> {
  const divisionFilter = divisionCd === 'ALL' 
    ? '' 
    : `AND ai.DIVISION_CD = '${divisionCd}'`;
    
  const sql = `
    SELECT COUNT(DISTINCT r.parcelnumb) as CNT
    FROM ${REGRID_TABLE} r
    JOIN DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO ai 
      ON r.parcelnumb = ai.GIS_PARCEL_ID 
      AND ai.APPRAISAL_YR = 2025
    WHERE ai.PROPERTY_ZIPCODE LIKE '${zipCode.replace(/'/g, "''")}%'
    ${divisionFilter}
  `;
  
  const rows = await executeQuery<any>(sql);
  return rows[0]?.CNT || 0;
}
