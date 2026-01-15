import snowflake from 'snowflake-sdk';
import { db } from './db';
import { properties, parcelToProperty } from './schema';
import { eq } from 'drizzle-orm';
import type { RegridParcel, AggregatedProperty } from './snowflake';
import { normalizeAddress, normalizeOwnerName, normalizeCity, normalizeCounty } from './normalization';
import { classifyPropertyType, isCommercialOrMultifamily, type PropertyClassification } from './zoning-classification';
import { getCommonNameFromGooglePlaces } from './google-places';

snowflake.configure({ logLevel: 'ERROR' });

const TABLE_NAME = 'nationwide_parcel_data__premium_schema__free_sample.premium_parcels.tx_dallas';

export const MVP_ZIP_CODE = process.env.MVP_ZIP_CODE || '75225';


function createConnection() {
  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USERNAME!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    database: process.env.SNOWFLAKE_DATABASE!,
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

export function aggregateParcelsToProperties(parcels: RegridParcel[]): Map<string, AggregatedProperty> {
  const propertyMap = new Map<string, AggregatedProperty>();

  for (const parcel of parcels) {
    const propertyKey = parcel.ll_stack_uuid || parcel.ll_uuid;

    const lotSqftFromAcres = (parcel.ll_gisacre || 0) * 43560;
    const lotSqft = lotSqftFromAcres > 0 ? lotSqftFromAcres : (parcel.sqft || 0);
    
    if (!propertyMap.has(propertyKey)) {
      propertyMap.set(propertyKey, {
        propertyKey,
        sourceLlUuid: parcel.ll_uuid,
        llStackUuid: parcel.ll_stack_uuid,
        address: parcel.address || '',
        city: parcel.scity || '',
        state: parcel.state2 || 'TX',
        zip: parcel.szip || '',
        county: parcel.county || '',
        lat: parseFloat(parcel.lat) || 0,
        lon: parseFloat(parcel.lon) || 0,
        lotSqft: lotSqft,
        buildingSqft: parcel.area_building || null,
        yearBuilt: parcel.yearbuilt,
        numFloors: parcel.numstories,
        totalParval: parcel.parval || 0,
        totalImprovval: parcel.improvval || 0,
        landval: parcel.landval || 0,
        allOwners: [parcel.owner, parcel.owner2].filter(Boolean) as string[],
        primaryOwner: parcel.owner,
        usedesc: parcel.usedesc ? [parcel.usedesc] : [],
        usecode: parcel.usecode ? [parcel.usecode] : [],
        zoning: parcel.zoning ? [parcel.zoning] : [],
        zoningDescription: parcel.zoningDescription ? [parcel.zoningDescription] : [],
        parcelCount: 1,
        rawParcelsJson: [parcel],
      });
    } else {
      const existing = propertyMap.get(propertyKey)!;
      existing.totalParval += parcel.parval || 0;
      existing.totalImprovval += parcel.improvval || 0;
      existing.lotSqft = Math.max(existing.lotSqft, lotSqft);
      existing.buildingSqft = Math.max(existing.buildingSqft || 0, parcel.area_building || 0) || null;
      existing.landval = Math.max(existing.landval, parcel.landval || 0);
      
      if (parcel.yearbuilt && (!existing.yearBuilt || parcel.yearbuilt < existing.yearBuilt)) {
        existing.yearBuilt = parcel.yearbuilt;
      }
      if (parcel.numstories && (!existing.numFloors || parcel.numstories > existing.numFloors)) {
        existing.numFloors = parcel.numstories;
      }
      
      if (parcel.owner && !existing.allOwners.includes(parcel.owner)) {
        existing.allOwners.push(parcel.owner);
      }
      if (parcel.owner2 && !existing.allOwners.includes(parcel.owner2)) {
        existing.allOwners.push(parcel.owner2);
      }
      
      if (parcel.usedesc && !existing.usedesc.includes(parcel.usedesc)) {
        existing.usedesc.push(parcel.usedesc);
      }
      if (parcel.usecode && !existing.usecode.includes(parcel.usecode)) {
        existing.usecode.push(parcel.usecode);
      }
      if (parcel.zoning && !existing.zoning.includes(parcel.zoning)) {
        existing.zoning.push(parcel.zoning);
      }
      if (parcel.zoningDescription && !existing.zoningDescription.includes(parcel.zoningDescription)) {
        existing.zoningDescription.push(parcel.zoningDescription);
      }
      
      existing.parcelCount += 1;
      existing.rawParcelsJson.push(parcel);
    }
  }

  return propertyMap;
}

export async function upsertPropertyToPostgres(
  property: AggregatedProperty
): Promise<{ created: boolean }> {
  const existingProperty = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, property.propertyKey))
    .limit(1);

  const normalizedAddress = normalizeAddress(property.address);
  const normalizedCity = normalizeCity(property.city);
  const normalizedCounty = normalizeCounty(property.county);
  const normalizedOwner = normalizeOwnerName(property.primaryOwner);
  const normalizedOwner2 = property.allOwners.length > 1 
    ? normalizeOwnerName(property.allOwners[1]) 
    : null;

  const propertyData = {
    propertyKey: property.propertyKey,
    sourceLlUuid: property.sourceLlUuid,
    llStackUuid: property.llStackUuid,
    regridAddress: normalizedAddress,
    city: normalizedCity,
    state: property.state,
    zip: property.zip,
    county: normalizedCounty,
    lat: property.lat,
    lon: property.lon,
    lotSqft: property.lotSqft ? Math.round(property.lotSqft) : null,
    buildingSqft: property.buildingSqft ? Math.round(property.buildingSqft) : null,
    yearBuilt: property.yearBuilt ? Math.round(property.yearBuilt) : null,
    numFloors: property.numFloors ? Math.round(property.numFloors) : null,
    regridOwner: normalizedOwner,
    regridOwner2: normalizedOwner2,
    rawParcelsJson: property.rawParcelsJson,
    lastRegridUpdate: new Date(),
    updatedAt: new Date(),
  };

  if (existingProperty.length > 0) {
    await db
      .update(properties)
      .set(propertyData)
      .where(eq(properties.propertyKey, property.propertyKey));
    return { created: false };
  } else {
    await db.insert(properties).values({
      ...propertyData,
      createdAt: new Date(),
      enrichmentStatus: 'pending',
      isActive: true,
    });
    return { created: true };
  }
}

export async function linkParcelsToProperty(
  parcels: RegridParcel[],
  propertyKey: string
): Promise<number> {
  let linked = 0;

  for (const parcel of parcels) {
    try {
      await db
        .insert(parcelToProperty)
        .values({
          llUuid: parcel.ll_uuid,
          propertyKey: propertyKey,
          llStackUuid: parcel.ll_stack_uuid,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: parcelToProperty.llUuid,
          set: {
            propertyKey: propertyKey,
            llStackUuid: parcel.ll_stack_uuid,
          },
        });
      linked++;
    } catch (error) {
      console.error(`Failed to link parcel ${parcel.ll_uuid}:`, error);
    }
  }

  return linked;
}

export async function fetchRandomParcelsFromSnowflake(
  limit: number = 50
): Promise<RegridParcel[]> {
  const sql = `
    SELECT
      "ll_uuid",
      "ll_stack_uuid",
      "address",
      "scity",
      "state2",
      "szip",
      "county",
      "lat",
      "lon",
      "owner",
      "owner2",
      "usedesc",
      "usecode",
      "yearbuilt",
      "parval",
      "landval",
      "improvval",
      "ll_gisacre",
      "sqft",
      "recrdareano",
      "ll_bldg_footprint_sqft",
      "numstories",
      "struct",
      "structno",
      "mailadd",
      "mail_city",
      "mail_state2",
      "mail_zip",
      "parcelnumb",
      "sunit",
      "zoning",
      "zoning_description"
    FROM ${TABLE_NAME}
    ORDER BY RANDOM()
    LIMIT ${limit}
  `;

  const rows = await executeQuery<any>(sql);

  return rows.map(row => ({
    ll_uuid: row.ll_uuid,
    ll_stack_uuid: row.ll_stack_uuid,
    address: row.address,
    scity: row.scity,
    state2: row.state2,
    szip: row.szip,
    county: row.county,
    lat: row.lat,
    lon: row.lon,
    owner: row.owner,
    owner2: row.owner2,
    usedesc: row.usedesc,
    usecode: row.usecode,
    yearbuilt: row.yearbuilt ? Number(row.yearbuilt) : null,
    parval: row.parval || 0,
    landval: row.landval || 0,
    improvval: row.improvval || 0,
    ll_gisacre: row.ll_gisacre || 0,
    sqft: row.sqft || 0,
    area_building: Number(row.recrdareano) || Number(row.ll_bldg_footprint_sqft) || null,
    numstories: row.numstories ? Number(row.numstories) : null,
    struct: row.struct,
    structno: row.structno,
    mailadd: row.mailadd,
    mail_city: row.mail_city,
    mail_state2: row.mail_state2,
    mail_zip: row.mail_zip,
    parcelnumb: row.parcelnumb,
    sunit: row.sunit,
    zoning: row.zoning,
    zoningDescription: row.zoning_description,
  }));
}

export async function fetchParcelsFromZipCode(
  zipCode: string = MVP_ZIP_CODE,
  limit: number = 5000,
  offset: number = 0
): Promise<RegridParcel[]> {
  const sql = `
    SELECT
      "ll_uuid",
      "ll_stack_uuid",
      "address",
      "scity",
      "state2",
      "szip5" as "szip",
      "county",
      "lat",
      "lon",
      "owner",
      "owner2",
      "usedesc",
      "usecode",
      "yearbuilt",
      "parval",
      "landval",
      "improvval",
      "ll_gisacre",
      "sqft",
      "ll_bldg_footprint_sqft",
      "recrdareano",
      "numstories",
      "struct",
      "structno",
      "mailadd",
      "mail_city",
      "mail_state2",
      "mail_zip",
      "parcelnumb",
      "sunit",
      "zoning",
      "zoning_description"
    FROM ${TABLE_NAME}
    WHERE "szip5" = '${zipCode}'
      AND "ll_gisacre" > 0.5
      AND "zoning" NOT ILIKE '%SF%'
      AND "zoning" NOT ILIKE '%R-%'
    ORDER BY "ll_uuid"
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const rows = await executeQuery<any>(sql);

  return rows.map(row => ({
    ll_uuid: row.ll_uuid,
    ll_stack_uuid: row.ll_stack_uuid,
    address: row.address,
    scity: row.scity,
    state2: row.state2,
    szip: row.szip,
    county: row.county,
    lat: row.lat,
    lon: row.lon,
    owner: row.owner,
    owner2: row.owner2,
    usedesc: row.usedesc,
    usecode: row.usecode,
    yearbuilt: row.yearbuilt ? Number(row.yearbuilt) : null,
    parval: row.parval || 0,
    landval: row.landval || 0,
    improvval: row.improvval || 0,
    ll_gisacre: row.ll_gisacre || 0,
    sqft: row.sqft || 0,
    area_building: Number(row.recrdareano) || Number(row.ll_bldg_footprint_sqft) || null,
    numstories: row.numstories ? Number(row.numstories) : null,
    struct: row.struct,
    structno: row.structno,
    mailadd: row.mailadd,
    mail_city: row.mail_city,
    mail_state2: row.mail_state2,
    mail_zip: row.mail_zip,
    parcelnumb: row.parcelnumb,
    sunit: row.sunit,
    zoning: row.zoning,
    zoningDescription: row.zoning_description,
  }));
}

export async function countParcelsInZipCode(zipCode: string = MVP_ZIP_CODE): Promise<number> {
  const sql = `SELECT COUNT(*) as count FROM ${TABLE_NAME} WHERE "szip5" = '${zipCode}' AND "ll_gisacre" > 0.5 AND "zoning" NOT ILIKE '%SF%' AND "zoning" NOT ILIKE '%R-%'`;
  const rows = await executeQuery<any>(sql);
  return rows[0]?.COUNT || rows[0]?.count || 0;
}

export async function countAllParcels(): Promise<number> {
  const sql = `SELECT COUNT(*) as count FROM ${TABLE_NAME}`;
  const rows = await executeQuery<any>(sql);
  return rows[0]?.COUNT || rows[0]?.count || 0;
}

export interface MVPIngestionStats {
  totalParcelsFromSnowflake: number;
  totalPropertiesAfterAggregation: number;
  commercialPropertiesIdentified: number;
  propertiesEnrichedWithPOI: number;
  propertiesSaved: number;
  parcelsLinked: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

export async function runMVPIngestion(
  zipCode: string = MVP_ZIP_CODE
): Promise<MVPIngestionStats> {
  const startTime = new Date();
  
  console.log(`[MVP Ingestion] Starting MVP ingestion for ZIP ${zipCode} at ${startTime.toISOString()}`);
  
  const stats: MVPIngestionStats = {
    totalParcelsFromSnowflake: 0,
    totalPropertiesAfterAggregation: 0,
    commercialPropertiesIdentified: 0,
    propertiesEnrichedWithPOI: 0,
    propertiesSaved: 0,
    parcelsLinked: 0,
    errors: 0,
    startTime,
  };

  console.log(`[MVP Ingestion] Step 1: Fetching ALL parcels from ZIP ${zipCode}...`);
  const parcels = await fetchParcelsFromZipCode(zipCode, 10000, 0);
  stats.totalParcelsFromSnowflake = parcels.length;
  console.log(`[MVP Ingestion] Fetched ${parcels.length} parcels from Snowflake`);

  console.log(`[MVP Ingestion] Step 2: Aggregating parcels by ll_stack_uuid into properties...`);
  const propertyMap = aggregateParcelsToProperties(parcels);
  stats.totalPropertiesAfterAggregation = propertyMap.size;
  console.log(`[MVP Ingestion] Aggregated into ${propertyMap.size} unique properties`);

  console.log(`[MVP Ingestion] Step 3: Classifying properties using zoning descriptions...`);
  const commercialProperties: AggregatedProperty[] = [];
  
  for (const [, property] of propertyMap) {
    const usedesc = property.usedesc.join(' ');
    const zoningDescription = property.zoningDescription.join(' ');
    
    if (isCommercialOrMultifamily(usedesc, zoningDescription)) {
      commercialProperties.push(property);
    }
  }
  
  stats.commercialPropertiesIdentified = commercialProperties.length;
  console.log(`[MVP Ingestion] Identified ${commercialProperties.length} commercial/multifamily properties`);

  console.log(`[MVP Ingestion] Step 4: Saving commercial properties and looking up common names via Google Places...`);
  
  for (let i = 0; i < commercialProperties.length; i++) {
    const property = commercialProperties[i];
    
    try {
      console.log(`[MVP Ingestion] Processing property ${i + 1}/${commercialProperties.length}: ${property.address}`);
      
      const placesResult = await getCommonNameFromGooglePlaces(property.lat, property.lon);
      
      const usedesc = property.usedesc.join(' ');
      const zoningDescription = property.zoningDescription.join(' ');
      const classification = classifyPropertyType(usedesc, zoningDescription);
      
      const normalizedAddress = normalizeAddress(property.address);
      const normalizedCity = normalizeCity(property.city);
      const normalizedCounty = normalizeCounty(property.county);
      const normalizedOwner = normalizeOwnerName(property.primaryOwner);
      const normalizedOwner2 = property.allOwners.length > 1 
        ? normalizeOwnerName(property.allOwners[1]) 
        : null;

      const existingProperty = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.propertyKey, property.propertyKey))
        .limit(1);

      const assetCategory = mapClassificationToCategory(classification.classification);

      const propertyData = {
        propertyKey: property.propertyKey,
        sourceLlUuid: property.sourceLlUuid,
        llStackUuid: property.llStackUuid,
        regridAddress: normalizedAddress,
        city: normalizedCity,
        state: property.state,
        zip: property.zip,
        county: normalizedCounty,
        lat: property.lat,
        lon: property.lon,
        lotSqft: property.lotSqft ? Math.round(property.lotSqft) : null,
        buildingSqft: property.buildingSqft ? Math.round(property.buildingSqft) : null,
        yearBuilt: property.yearBuilt ? Math.round(property.yearBuilt) : null,
        numFloors: property.numFloors ? Math.round(property.numFloors) : null,
        regridOwner: normalizedOwner,
        regridOwner2: normalizedOwner2,
        rawParcelsJson: property.rawParcelsJson,
        assetCategory,
        assetSubcategory: null,
        categoryConfidence: null,
        commonName: placesResult.commonName,
        commonNameConfidence: placesResult.commonName ? 0.9 : null,
        operationalStatus: null,
        mapboxPoiJson: placesResult.rawResponse,
        lastRegridUpdate: new Date(),
        lastEnrichedAt: new Date(),
        enrichmentStatus: 'enriched',
        updatedAt: new Date(),
      };

      if (existingProperty.length > 0) {
        await db
          .update(properties)
          .set(propertyData)
          .where(eq(properties.propertyKey, property.propertyKey));
      } else {
        await db.insert(properties).values({
          ...propertyData,
          createdAt: new Date(),
          isActive: true,
        });
      }
      
      stats.propertiesSaved++;
      if (placesResult.commonName) {
        stats.propertiesEnrichedWithPOI++;
      }

      const linked = await linkParcelsToProperty(property.rawParcelsJson, property.propertyKey);
      stats.parcelsLinked += linked;

      if (placesResult.commonName) {
        console.log(`  -> Common name: "${placesResult.commonName}" (${assetCategory})`);
      } else {
        console.log(`  -> No common name found, category: ${assetCategory}`);
      }
      
    } catch (error) {
      stats.errors++;
      console.error(`[MVP Ingestion] Error processing property ${property.propertyKey}:`, error);
    }
  }

  const endTime = new Date();
  stats.endTime = endTime;
  stats.durationMs = endTime.getTime() - startTime.getTime();
  
  const durationSeconds = Math.round(stats.durationMs / 1000);
  
  console.log(`[MVP Ingestion] Complete!`);
  console.log(`  - Duration: ${durationSeconds} seconds`);
  console.log(`  - Parcels from Snowflake: ${stats.totalParcelsFromSnowflake}`);
  console.log(`  - Properties after aggregation: ${stats.totalPropertiesAfterAggregation}`);
  console.log(`  - Commercial properties identified: ${stats.commercialPropertiesIdentified}`);
  console.log(`  - Properties enriched with POI: ${stats.propertiesEnrichedWithPOI}`);
  console.log(`  - Properties saved: ${stats.propertiesSaved}`);
  console.log(`  - Parcels linked: ${stats.parcelsLinked}`);
  console.log(`  - Errors: ${stats.errors}`);
  
  return stats;
}

function mapClassificationToCategory(classification: PropertyClassification): string {
  switch (classification) {
    case 'commercial':
      return 'Retail';
    case 'multifamily':
      return 'Multifamily';
    case 'single_family':
      return 'Single Family';
    case 'public':
      return 'Public/Institutional';
    default:
      return 'Unknown';
  }
}
