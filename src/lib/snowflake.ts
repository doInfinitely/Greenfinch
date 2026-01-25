import snowflake from 'snowflake-sdk';

snowflake.configure({ logLevel: 'ERROR' });

// Use the joined COMMERCIAL_PROPERTIES table from DCAD
const TABLE_NAME = 'DCAD_LAND_2025.PUBLIC.COMMERCIAL_PROPERTIES';

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
  bldgClassCd: string | null;
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
  
  // DCAD Commercial building details
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
    FROM ${TABLE_NAME}
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

// Fetch commercial properties from the joined DCAD+Regrid table
export async function getCommercialPropertiesByZip(
  zipCode: string,
  divisionCd: 'COM' | 'RES' | 'ALL' = 'COM',
  limit: number = 1000
): Promise<CommercialProperty[]> {
  const divisionFilter = divisionCd === 'ALL' 
    ? '' 
    : `AND DIVISION_CD = '${divisionCd}'`;
    
  const sql = `
    SELECT *
    FROM ${TABLE_NAME}
    WHERE ZIP LIKE '${zipCode.replace(/'/g, "''")}%'
    ${divisionFilter}
    LIMIT ${limit}
  `;
  
  const rows = await executeQuery<any>(sql);
  
  return rows.map(r => ({
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
    bldgClassCd: r.BLDG_CLASS_CD,
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
    
    taxObjId: r.TAX_OBJ_ID,
    propertyName: r.PROPERTY_NAME,
    bldgClassDesc: r.BLDG_CLASS_DESC,
    dcadYearBuilt: r.DCAD_YEAR_BUILT,
    remodelYr: r.REMODEL_YR,
    grossBldgArea: r.GROSS_BLDG_AREA,
    dcadNumStories: r.DCAD_NUM_STORIES,
    numUnits: r.NUM_UNITS,
    netLeaseArea: r.NET_LEASE_AREA,
    constructionType: r.CONSTRUCTION_TYPE,
    foundationType: r.FOUNDATION_TYPE,
    heatingType: r.HEATING_TYPE,
    acType: r.AC_TYPE,
    qualityGrade: r.QUALITY_GRADE,
    conditionGrade: r.CONDITION_GRADE,
  }));
}

// Get a single commercial property by parcel ID
export async function getCommercialPropertyByParcelId(
  parcelId: string
): Promise<CommercialProperty | null> {
  const sql = `
    SELECT *
    FROM ${TABLE_NAME}
    WHERE PARCEL_ID = '${parcelId.replace(/'/g, "''")}'
    LIMIT 1
  `;
  
  const rows = await executeQuery<any>(sql);
  
  if (rows.length === 0) return null;
  
  const r = rows[0];
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
    bldgClassCd: r.BLDG_CLASS_CD,
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
    
    taxObjId: r.TAX_OBJ_ID,
    propertyName: r.PROPERTY_NAME,
    bldgClassDesc: r.BLDG_CLASS_DESC,
    dcadYearBuilt: r.DCAD_YEAR_BUILT,
    remodelYr: r.REMODEL_YR,
    grossBldgArea: r.GROSS_BLDG_AREA,
    dcadNumStories: r.DCAD_NUM_STORIES,
    numUnits: r.NUM_UNITS,
    netLeaseArea: r.NET_LEASE_AREA,
    constructionType: r.CONSTRUCTION_TYPE,
    foundationType: r.FOUNDATION_TYPE,
    heatingType: r.HEATING_TYPE,
    acType: r.AC_TYPE,
    qualityGrade: r.QUALITY_GRADE,
    conditionGrade: r.CONDITION_GRADE,
  };
}

// Count commercial properties by ZIP
export async function countCommercialPropertiesByZip(
  zipCode: string,
  divisionCd: 'COM' | 'RES' | 'ALL' = 'COM'
): Promise<number> {
  const divisionFilter = divisionCd === 'ALL' 
    ? '' 
    : `AND DIVISION_CD = '${divisionCd}'`;
    
  const sql = `
    SELECT COUNT(*) as CNT
    FROM ${TABLE_NAME}
    WHERE ZIP LIKE '${zipCode.replace(/'/g, "''")}%'
    ${divisionFilter}
  `;
  
  const rows = await executeQuery<any>(sql);
  return rows[0]?.CNT || 0;
}
