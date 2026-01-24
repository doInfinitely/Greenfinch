import snowflake from 'snowflake-sdk';

snowflake.configure({ logLevel: 'ERROR' });

const TABLE_NAME = 'nationwide_parcel_data__premium_schema__free_sample.premium_parcels.tx_dallas';

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
