import { db } from './db';
import { properties, parcelToProperty, parcelnumbMapping, cadAccountInfo } from './schema';
import { eq, sql, inArray, and } from 'drizzle-orm';
import { normalizeAddress, normalizeOwnerName, normalizeCity } from './normalization';
import { INCLUDED_SPTD_CODES } from './property-classifications';
import { calculateBuildingClass, extractPrimaryHvacTypes, extractPrimaryQualityGrade } from './building-class';
import { queryCommercialProperties, countCommercialProperties, getAccountsByAccountNums } from './cad/query';
import type { CountyCode } from './cad/types';
import { getCountyName } from './cad/county-codes';

export interface IngestionFilters {
  lotSqftMin?: number | null;
  lotSqftMax?: number | null;
  buildingSqftMin?: number | null;
  buildingSqftMax?: number | null;
  buildingClassCodes?: string[];
  conditionGrades?: string[];
}


// County code for the ingestion pipeline (default: DCAD for backwards compatibility)

export interface CadBuildingRow {
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

export interface CadCommercialProperty {
  parcelId: string;
  gisParcelId: string;
  llUuid: string | null;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  usedesc: string | null;
  usecode: string | null;
  stateClass: string | null;
  sptdCode: string | null;
  
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
  
  // From LAND table (parent account)
  dcadLandSqft: number | null;
  
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

/** @deprecated Use CadBuildingRow */
export type DCadBuildingRow = CadBuildingRow;
/** @deprecated Use CadCommercialProperty */
export type DCadCommercialProperty = CadCommercialProperty;

export interface AggregatedProperty {
  parcelId: string;
  gisParcelId: string;
  llUuid: string | null;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  usedesc: string | null;
  usecode: string | null;
  sptdCode: string | null;
  
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
  
  // From LAND table (parent account)
  dcadLandSqft: number | null;
  
  // Computed lot/building with source tracking
  computedLotSqft: number | null;
  computedLotSqftSource: string | null;
  computedBuildingSqft: number | null;
  computedBuildingSqftSource: string | null;
  
  buildings: CadBuildingRow[];
  buildingCount: number;
  oldestYearBuilt: number | null;
  newestYearBuilt: number | null;
  totalGrossBldgArea: number | null;
  totalUnits: number | null;
  rentableArea: number | null;
  parkingSqft: number | null;
  primaryPropertyName: string | null;
}


export async function countCommercialPropertiesByZip(zipCode: string, countyCode?: CountyCode): Promise<number> {
  return countCommercialProperties({ zipCode, countyCode });
}

export async function countAllCommercialProperties(countyCode?: CountyCode): Promise<number> {
  return countCommercialProperties({ countyCode });
}

export async function getCommercialPropertiesByZip(
  zipCode: string,
  limit: number = 1000,
  offset: number = 0,
  filters?: IngestionFilters,
  countyCode?: CountyCode,
): Promise<CadCommercialProperty[]> {
  return queryCommercialProperties({ zipCode, limit, offset, filters, countyCode });
}

async function getAllCommercialProperties(
  limit: number = 50000,
  offset: number = 0,
  filters?: IngestionFilters,
  countyCode?: CountyCode,
): Promise<CadCommercialProperty[]> {
  return queryCommercialProperties({ limit, offset, filters, countyCode });
}


function aggregatePropertiesByParcel(rows: CadCommercialProperty[]): AggregatedProperty[] {
  const groupedByAccount = new Map<string, CadCommercialProperty[]>();
  
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
    
    const buildings: CadBuildingRow[] = accountRows
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
    
    // Select primary property name: use PROPERTY_NAME from building where TAX_OBJ_ID = ACCOUNT_NUM
    // This is the parent taxable object row in COM_DETAIL
    const parentTaxableObject = uniqueBuildings.find(b => b.taxObjId === accountNum);
    const primaryName = parentTaxableObject?.propertyName || firstRow.bizName || null;
    
    aggregated.push({
      parcelId: firstRow.parcelId,
      gisParcelId: firstRow.gisParcelId,
      llUuid: firstRow.llUuid,
      address: firstRow.address,
      city: firstRow.city,
      zip: firstRow.zip,
      lat: firstRow.lat,
      lon: firstRow.lon,
      usedesc: firstRow.usedesc,
      usecode: firstRow.usecode,
      sptdCode: firstRow.sptdCode,
      
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
      
      // Use LAND table data for lot size
      dcadLandSqft: firstRow.dcadLandSqft,
      
      // Computed values with source tracking: DCAD LAND > regrid
      computedLotSqft: firstRow.dcadLandSqft ? Math.round(firstRow.dcadLandSqft) : 
                       firstRow.lotSqft ? Math.round(firstRow.lotSqft) : null,
      computedLotSqftSource: firstRow.dcadLandSqft ? 'dcad_land' : 
                              firstRow.lotSqft ? 'regrid' : null,
      // Computed building sqft: rentable area (gross minus parking) from DCAD > regrid
      computedBuildingSqft: rentableArea ? Math.round(rentableArea) : 
                            firstRow.bldgFootprintSqft ? Math.round(firstRow.bldgFootprintSqft) : null,
      computedBuildingSqftSource: rentableArea ? 'dcad_com_detail' : 
                                   firstRow.bldgFootprintSqft ? 'regrid' : null,
      
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

// Identify parent/constituent relationships using GIS_PARCEL_ID from DCAD
// Parent = account where ACCOUNT_NUM equals GIS_PARCEL_ID
// Constituents = other accounts that share the same GIS_PARCEL_ID
function identifyParcelRelationships(properties: AggregatedProperty[]): Map<string, {
  parentAccountNum: string;
  constituentAccountNums: string[];
  llUuid: string | null;
}> {
  // Group by GIS_PARCEL_ID (from DCAD ACCOUNT_INFO)
  const byGisParcel = new Map<string, AggregatedProperty[]>();
  for (const prop of properties) {
    const gisParcelId = prop.gisParcelId;
    if (!gisParcelId) continue;
    
    if (!byGisParcel.has(gisParcelId)) {
      byGisParcel.set(gisParcelId, []);
    }
    byGisParcel.get(gisParcelId)!.push(prop);
  }
  
  const relationships = new Map<string, { parentAccountNum: string; constituentAccountNums: string[]; llUuid: string | null }>();
  
  for (const [gisParcelId, parcelProps] of byGisParcel) {
    // Parent is where ACCOUNT_NUM = GIS_PARCEL_ID
    const parentProp = parcelProps.find(p => p.accountNum === gisParcelId);
    const parentAccountNum = parentProp?.accountNum || null;
    const llUuid = parentProp?.llUuid || parcelProps[0]?.llUuid || null;
    
    if (parentAccountNum && parcelProps.length > 1) {
      // Multiple accounts on same GIS_PARCEL_ID - this is a complex
      const constituentAccountNums = parcelProps
        .filter(p => p.accountNum !== parentAccountNum)
        .map(p => p.accountNum);
      relationships.set(gisParcelId, { parentAccountNum, constituentAccountNums, llUuid });
    } else if (parentAccountNum && parcelProps.length === 1) {
      // Standalone property - parent with no constituents
      relationships.set(gisParcelId, { parentAccountNum, constituentAccountNums: [], llUuid });
    }
  }
  
  return relationships;
}

function buildPropertyData(
  prop: AggregatedProperty,
  relationships?: Map<string, { parentAccountNum: string; constituentAccountNums: string[]; llUuid?: string | null }>,
  countyCode?: CountyCode,
) {
  const prefix = countyCode || 'DCAD';
  const propertyKey = `${prefix}-${prop.accountNum}`;
  const gisParcelId = prop.gisParcelId;
  const isParentProperty = prop.accountNum === prop.gisParcelId;
  const parcelRel = gisParcelId ? relationships?.get(gisParcelId) : undefined;
  const parentPropertyKey = !isParentProperty && parcelRel ? `${prefix}-${parcelRel.parentAccountNum}` : null;
  const constituentAccountNums = isParentProperty && parcelRel ? parcelRel.constituentAccountNums : null;
  const constituentCount = isParentProperty && parcelRel ? (parcelRel.constituentAccountNums.length || 0) : 0;

  const normalizedAddress = normalizeAddress(prop.address);
  const normalizedCity = normalizeCity(prop.city);
  const normalizedOwner = normalizeOwnerName(prop.ownerName1 || prop.bizName || '');
  const normalizedOwner2 = prop.ownerName2 ? normalizeOwnerName(prop.ownerName2) : null;

  const hvac = extractPrimaryHvacTypes(prop.buildings);
  const quality = extractPrimaryQualityGrade(prop.buildings);
  const buildingClassResult = calculateBuildingClass({
    qualityGrade: quality.qualityGrade,
    conditionGrade: quality.conditionGrade,
    yearBuilt: prop.oldestYearBuilt,
    totalValue: prop.dcadTotalVal,
    buildingSqft: prop.rentableArea || prop.totalGrossBldgArea,
  });

  return {
    propertyKey,
    cadCountyCode: prefix,
    sourceLlUuid: prop.llUuid || prop.parcelId,
    llStackUuid: null,
    dcadGisParcelId: gisParcelId,
    dcadSptdCode: prop.sptdCode,
    regridAddress: normalizedAddress,
    city: normalizedCity,
    state: 'TX',
    zip: prop.zip,
    county: countyCode ? getCountyName(countyCode) : 'DALLAS',
    lat: prop.lat,
    lon: prop.lon,
    lotSqft: prop.computedLotSqft,
    lotSqftSource: prop.computedLotSqftSource,
    buildingSqft: prop.computedBuildingSqft,
    buildingSqftSource: prop.computedBuildingSqftSource,
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
    dcadPrimaryAcType: hvac.acType,
    dcadPrimaryHeatingType: hvac.heatingType,
    dcadQualityGrade: quality.qualityGrade,
    dcadConditionGrade: quality.conditionGrade,
    calculatedBuildingClass: buildingClassResult.buildingClass,
    buildingClassRationale: buildingClassResult.rationale,
    commonName: prop.primaryPropertyName || prop.bizName || null,
    isParentProperty: isParentProperty,
    parentPropertyKey: parentPropertyKey,
    constituentAccountNums: constituentAccountNums,
    constituentCount: constituentCount,
    enrichmentStatus: 'pending' as const,
    lastRegridUpdate: new Date(),
    updatedAt: new Date(),
  };
}

const UPSERT_BATCH_SIZE = 50;

async function batchUpsertPropertiesToPostgres(
  props: AggregatedProperty[],
  relationships?: Map<string, { parentAccountNum: string; constituentAccountNums: string[]; llUuid?: string | null }>,
  countyCode?: CountyCode,
): Promise<{ created: number; updated: number; errors: number }> {
  const result = { created: 0, updated: 0, errors: 0 };
  if (props.length === 0) return result;

  for (let i = 0; i < props.length; i += UPSERT_BATCH_SIZE) {
    const batch = props.slice(i, i + UPSERT_BATCH_SIZE);

    try {
      const rows = batch.map(prop => ({
        ...buildPropertyData(prop, relationships, countyCode),
        createdAt: new Date(),
        isActive: true,
      }));

      const batchPrefix = countyCode || 'DCAD';
      const prefixedKeys = batch.map(p => `${batchPrefix}-${p.accountNum}`);
      const existingKeys = new Set(
        (await db
          .select({ pk: properties.propertyKey })
          .from(properties)
          .where(inArray(properties.propertyKey, prefixedKeys))
        ).map(r => r.pk)
      );

      await db
        .insert(properties)
        .values(rows)
        .onConflictDoUpdate({
          target: properties.propertyKey,
          set: {
            cadCountyCode: sql`EXCLUDED.cad_county_code`,
            sourceLlUuid: sql`EXCLUDED.source_ll_uuid`,
            llStackUuid: sql`EXCLUDED.ll_stack_uuid`,
            dcadGisParcelId: sql`EXCLUDED.dcad_gis_parcel_id`,
            dcadSptdCode: sql`EXCLUDED.dcad_sptd_code`,
            regridAddress: sql`EXCLUDED.regrid_address`,
            city: sql`EXCLUDED.city`,
            state: sql`EXCLUDED.state`,
            zip: sql`EXCLUDED.zip`,
            county: sql`EXCLUDED.county`,
            lat: sql`EXCLUDED.lat`,
            lon: sql`EXCLUDED.lon`,
            lotSqft: sql`EXCLUDED.lot_sqft`,
            lotSqftSource: sql`EXCLUDED.lot_sqft_source`,
            buildingSqft: sql`EXCLUDED.building_sqft`,
            buildingSqftSource: sql`EXCLUDED.building_sqft_source`,
            yearBuilt: sql`EXCLUDED.year_built`,
            numFloors: sql`EXCLUDED.num_floors`,
            regridOwner: sql`EXCLUDED.regrid_owner`,
            regridOwner2: sql`EXCLUDED.regrid_owner2`,
            dcadAccountNum: sql`EXCLUDED.dcad_account_num`,
            dcadDivisionCd: sql`EXCLUDED.dcad_division_cd`,
            dcadImprovVal: sql`EXCLUDED.dcad_improv_val`,
            dcadLandVal: sql`EXCLUDED.dcad_land_val`,
            dcadTotalVal: sql`EXCLUDED.dcad_total_val`,
            dcadCityJuris: sql`EXCLUDED.dcad_city_juris`,
            dcadIsdJuris: sql`EXCLUDED.dcad_isd_juris`,
            dcadBizName: sql`EXCLUDED.dcad_biz_name`,
            dcadOwnerName1: sql`EXCLUDED.dcad_owner_name1`,
            dcadOwnerName2: sql`EXCLUDED.dcad_owner_name2`,
            dcadOwnerAddress: sql`EXCLUDED.dcad_owner_address`,
            dcadOwnerCity: sql`EXCLUDED.dcad_owner_city`,
            dcadOwnerState: sql`EXCLUDED.dcad_owner_state`,
            dcadOwnerZip: sql`EXCLUDED.dcad_owner_zip`,
            dcadOwnerPhone: sql`EXCLUDED.dcad_owner_phone`,
            dcadDeedTransferDate: sql`EXCLUDED.dcad_deed_transfer_date`,
            dcadZoning: sql`EXCLUDED.dcad_zoning`,
            dcadLandFrontDim: sql`EXCLUDED.dcad_land_front_dim`,
            dcadLandDepthDim: sql`EXCLUDED.dcad_land_depth_dim`,
            dcadLandArea: sql`EXCLUDED.dcad_land_area`,
            dcadLandAreaUom: sql`EXCLUDED.dcad_land_area_uom`,
            dcadBuildingCount: sql`EXCLUDED.dcad_building_count`,
            dcadOldestYearBuilt: sql`EXCLUDED.dcad_oldest_year_built`,
            dcadNewestYearBuilt: sql`EXCLUDED.dcad_newest_year_built`,
            dcadTotalGrossBldgArea: sql`EXCLUDED.dcad_total_gross_bldg_area`,
            dcadTotalUnits: sql`EXCLUDED.dcad_total_units`,
            dcadRentableArea: sql`EXCLUDED.dcad_rentable_area`,
            dcadParkingSqft: sql`EXCLUDED.dcad_parking_sqft`,
            dcadBuildings: sql`EXCLUDED.dcad_buildings`,
            dcadPrimaryAcType: sql`EXCLUDED.dcad_primary_ac_type`,
            dcadPrimaryHeatingType: sql`EXCLUDED.dcad_primary_heating_type`,
            dcadQualityGrade: sql`EXCLUDED.dcad_quality_grade`,
            dcadConditionGrade: sql`EXCLUDED.dcad_condition_grade`,
            calculatedBuildingClass: sql`EXCLUDED.calculated_building_class`,
            buildingClassRationale: sql`EXCLUDED.building_class_rationale`,
            commonName: sql`EXCLUDED.common_name`,
            isParentProperty: sql`EXCLUDED.is_parent_property`,
            parentPropertyKey: sql`EXCLUDED.parent_property_key`,
            constituentAccountNums: sql`EXCLUDED.constituent_account_nums`,
            constituentCount: sql`EXCLUDED.constituent_count`,
            lastRegridUpdate: sql`EXCLUDED.last_regrid_update`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
        });

      const newCount = batch.filter(p => !existingKeys.has(`${batchPrefix}-${p.accountNum}`)).length;
      result.created += newCount;
      result.updated += batch.length - newCount;

      // Resolve propertyKeys to UUIDs for parcel mappings
      const targetPropertyKeys = batch
        .filter(prop => prop.llUuid)
        .map(prop => {
          const isParent = prop.accountNum === prop.gisParcelId;
          const gisParcelId = prop.gisParcelId;
          const parcelRel = gisParcelId ? relationships?.get(gisParcelId) : undefined;
          const parentPK = !isParent && parcelRel ? `${batchPrefix}-${parcelRel.parentAccountNum}` : null;
          return {
            llUuid: prop.llUuid!,
            targetPropertyKey: isParent ? `${batchPrefix}-${prop.accountNum}` : (parentPK || `${batchPrefix}-${prop.accountNum}`),
          };
        });

      if (targetPropertyKeys.length > 0) {
        const uniqueKeys = [...new Set(targetPropertyKeys.map(t => t.targetPropertyKey))];
        const keyToId = new Map(
          (await db.select({ propertyKey: properties.propertyKey, id: properties.id })
            .from(properties)
            .where(inArray(properties.propertyKey, uniqueKeys)))
            .map(r => [r.propertyKey, r.id])
        );

        const parcelMappings = targetPropertyKeys
          .filter(t => keyToId.has(t.targetPropertyKey))
          .map(t => ({
            llUuid: t.llUuid,
            propertyId: keyToId.get(t.targetPropertyKey)!,
          }));

        if (parcelMappings.length > 0) {
          await db
            .insert(parcelToProperty)
            .values(parcelMappings)
            .onConflictDoUpdate({
              target: parcelToProperty.llUuid,
              set: { propertyId: sql`EXCLUDED.property_id` },
            });
        }
      }
    } catch (error) {
      console.error(`[Ingestion] Batch upsert error (batch starting at ${i}), falling back to individual inserts:`, error instanceof Error ? error.message : error);
      for (const prop of batch) {
        try {
          await upsertAggregatedPropertyToPostgres(prop, relationships, countyCode);
          result.created++;
        } catch (innerError) {
          result.errors++;
          console.error(`[Ingestion] Error saving property ${prop.parcelId}:`, innerError instanceof Error ? innerError.message : innerError);
        }
      }
    }

    if ((i + UPSERT_BATCH_SIZE) % 200 === 0 || i + UPSERT_BATCH_SIZE >= props.length) {
      console.log(`[Ingestion] Batch progress: ${Math.min(i + UPSERT_BATCH_SIZE, props.length)}/${props.length}`);
    }
  }

  return result;
}

async function upsertAggregatedPropertyToPostgres(
  prop: AggregatedProperty,
  relationships?: Map<string, { parentAccountNum: string; constituentAccountNums: string[]; llUuid?: string | null }>,
  countyCode?: CountyCode,
): Promise<{ created: boolean }> {
  const propertyData = buildPropertyData(prop, relationships, countyCode);
  const propertyKey = propertyData.propertyKey;
  const isParentProperty = propertyData.isParentProperty;
  const parentPropertyKey = propertyData.parentPropertyKey;

  const existingProperty = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  if (existingProperty.length > 0) {
    await db
      .update(properties)
      .set(propertyData)
      .where(eq(properties.propertyKey, propertyKey));
  } else {
    await db.insert(properties).values({
      ...propertyData,
      createdAt: new Date(),
      isActive: true,
    });
  }

  if (prop.llUuid) {
    const targetPropertyKey = isParentProperty ? propertyKey : (parentPropertyKey || propertyKey);
    // Resolve target property key to UUID
    const [targetProp] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.propertyKey, targetPropertyKey))
      .limit(1);

    if (targetProp) {
      await db
        .insert(parcelToProperty)
        .values({
          llUuid: prop.llUuid,
          propertyId: targetProp.id,
        })
        .onConflictDoUpdate({
          target: parcelToProperty.llUuid,
          set: { propertyId: targetProp.id },
        });
    }
  }

  return { created: existingProperty.length === 0 };
}

async function upsertPropertyToPostgres(
  prop: CadCommercialProperty
): Promise<{ created: boolean }> {
  const aggregated = aggregatePropertiesByParcel([prop]);
  if (aggregated.length > 0) {
    return upsertAggregatedPropertyToPostgres(aggregated[0]);
  }
  return { created: false };
}

export interface IngestionStats {
  totalFromStaging: number;
  propertiesSaved: number;
  propertiesUpdated: number;
  errors: number;
  durationMs: number;
}

export async function runIngestion(
  zipCode: string,
  limit: number = 500,
  filters?: IngestionFilters,
  countyCode?: CountyCode,
): Promise<IngestionStats> {
  console.log(`[Ingestion] Starting ingestion for ZIP ${zipCode}${countyCode ? ` (county: ${countyCode})` : ''}`);
  if (filters) console.log(`[Ingestion] Filters applied:`, JSON.stringify(filters));

  const startTime = Date.now();
  const stats: IngestionStats = {
    totalFromStaging: 0,
    propertiesSaved: 0,
    propertiesUpdated: 0,
    errors: 0,
    durationMs: 0,
  };

  const count = await countCommercialPropertiesByZip(zipCode, countyCode);
  console.log(`[Ingestion] Found ${count} commercial properties (rows) in ZIP ${zipCode}`);

  const commercialProperties = await getCommercialPropertiesByZip(zipCode, limit, 0, filters, countyCode);
  stats.totalFromStaging = commercialProperties.length;
  console.log(`[Ingestion] Fetched ${commercialProperties.length} rows from staging tables`);

  const aggregatedProperties = aggregatePropertiesByParcel(commercialProperties);
  console.log(`[Ingestion] Aggregated into ${aggregatedProperties.length} unique properties`);

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

  const batchResult = await batchUpsertPropertiesToPostgres(aggregatedProperties, relationships, countyCode);
  stats.propertiesSaved += batchResult.created;
  stats.propertiesUpdated += batchResult.updated;
  stats.errors += batchResult.errors;

  const parentResult = await ingestParentAccounts(countyCode);
  stats.propertiesSaved += parentResult.ingested;
  stats.errors += parentResult.errors;

  const mappingResult = await buildParcelnumbMapping(countyCode);
  if (mappingResult.errors > 0) stats.errors += mappingResult.errors;

  stats.durationMs = Date.now() - startTime;
  console.log(`[Ingestion] Complete in ${Math.round(stats.durationMs / 1000)}s: ${stats.propertiesSaved} new, ${stats.propertiesUpdated} updated, ${stats.errors} errors`);

  return stats;
}

async function getParentAccountsByAccountNums(
  accountNums: string[],
  countyCode?: CountyCode,
): Promise<CadCommercialProperty[]> {
  if (accountNums.length === 0) return [];
  return getAccountsByAccountNums(accountNums, countyCode);
}

export async function buildParcelnumbMapping(countyCode?: CountyCode): Promise<{ mapped: number; errors: number }> {
  const result = { mapped: 0, errors: 0 };

  const allGisIds = await db
    .selectDistinct({ gisParcelId: properties.dcadGisParcelId })
    .from(properties);

  const gisParcelIds = allGisIds
    .map(r => r.gisParcelId)
    .filter((id): id is string => !!id && id.length > 0);

  if (gisParcelIds.length === 0) {
    console.log(`[Ingestion] No GIS parcel IDs found, skipping parcelnumb mapping`);
    return result;
  }

  console.log(`[Ingestion] Building parcelnumb mapping for ${gisParcelIds.length} distinct GIS parcel IDs...`);

  // Build propertyKey → UUID map and a set of existing keys
  const propertyRows = await db.select({ pk: properties.propertyKey, id: properties.id }).from(properties);
  const existingKeys = new Set(propertyRows.map(r => r.pk));
  const keyToUuid = new Map(propertyRows.map(r => [r.pk, r.id]));

  const batchSize = 500;
  let totalFromStaging = 0;
  let alreadyInProperties = 0;

  async function upsertMappings(mappings: { accountNum: string; gisParcelId: string; parentPropertyId: string | null; county: string }[]) {
    if (mappings.length === 0) return;
    const insertBatchSize = 1000;
    for (let j = 0; j < mappings.length; j += insertBatchSize) {
      const insertBatch = mappings.slice(j, j + insertBatchSize);
      await db.insert(parcelnumbMapping)
        .values(insertBatch)
        .onConflictDoUpdate({
          target: [parcelnumbMapping.county, parcelnumbMapping.accountNum],
          set: {
            gisParcelId: sql`EXCLUDED.gis_parcel_id`,
            parentPropertyId: sql`EXCLUDED.parent_property_id`,
          },
        });
    }
    result.mapped += mappings.length;
  }

  const mappingPrefix = countyCode || 'DCAD';

  function processRows(rows: { accountNum: string; gisParcelId: string | null }[]) {
    const mappings: { accountNum: string; gisParcelId: string; parentPropertyId: string | null; county: string }[] = [];
    for (const row of rows) {
      if (!row.accountNum || !row.gisParcelId) continue;
      const prefixedAccountNum = `${mappingPrefix}-${row.accountNum}`;
      if (existingKeys.has(prefixedAccountNum)) {
        alreadyInProperties++;
        continue;
      }
      const prefixedGisParcelId = `${mappingPrefix}-${row.gisParcelId}`;
      const parentUuid = keyToUuid.get(prefixedGisParcelId) ?? null;
      mappings.push({
        accountNum: row.accountNum,
        gisParcelId: row.gisParcelId,
        parentPropertyId: parentUuid,
        county: mappingPrefix,
      });
    }
    return mappings;
  }

  // Query cad_account_info staging table
  for (let i = 0; i < gisParcelIds.length; i += batchSize) {
    const batch = gisParcelIds.slice(i, i + batchSize);

    try {
      const conditions: any[] = [inArray(cadAccountInfo.gisParcelId, batch)];
      if (countyCode) {
        conditions.push(eq(cadAccountInfo.countyCode, countyCode));
      }

      const rows = await db
        .selectDistinct({
          accountNum: cadAccountInfo.accountNum,
          gisParcelId: cadAccountInfo.gisParcelId,
        })
        .from(cadAccountInfo)
        .where(and(...conditions));

      totalFromStaging += rows.length;
      const mappings = processRows(rows);
      await upsertMappings(mappings);

      console.log(`[Ingestion] Parcelnumb mapping batch ${Math.floor(i / batchSize) + 1}: ${rows.length} accounts, ${mappings.length} new mappings`);
    } catch (error) {
      result.errors++;
      console.error(`[Ingestion] Error in parcelnumb mapping:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`[Ingestion] Parcelnumb mapping complete: ${totalFromStaging} total accounts, ${alreadyInProperties} already in properties, ${result.mapped} new mappings, ${result.errors} errors`);
  return result;
}

async function ingestParentAccounts(countyCode?: CountyCode): Promise<{ ingested: number; errors: number }> {
  const result = { ingested: 0, errors: 0 };

  const allProps = await db
    .select({
      propertyKey: properties.propertyKey,
      gisParcelId: properties.dcadGisParcelId,
    })
    .from(properties);

  const parentPrefix = countyCode || 'DCAD';
  const existingKeys = new Set(allProps.map(p => p.propertyKey));

  const missingParentAccountNums = new Set<string>();
  for (const prop of allProps) {
    if (prop.gisParcelId) {
      const expectedKey = `${parentPrefix}-${prop.gisParcelId}`;
      if (expectedKey !== prop.propertyKey && !existingKeys.has(expectedKey)) {
        missingParentAccountNums.add(prop.gisParcelId);
      }
    }
  }

  if (missingParentAccountNums.size === 0) {
    console.log(`[Ingestion] No missing parent accounts to ingest`);
    return result;
  }

  console.log(`[Ingestion] Found ${missingParentAccountNums.size} missing parent accounts, fetching from staging tables...`);

  const batchSize = 100;
  const accountNumsArray = Array.from(missingParentAccountNums);
  let notFoundCount = 0;

  for (let i = 0; i < accountNumsArray.length; i += batchSize) {
    const batch = accountNumsArray.slice(i, i + batchSize);

    try {
      const parentProperties = await getParentAccountsByAccountNums(batch, countyCode);
      const batchNotFound = batch.length - parentProperties.length;
      notFoundCount += batchNotFound;
      console.log(`[Ingestion] Fetched ${parentProperties.length}/${batch.length} parent accounts (batch ${Math.floor(i / batchSize) + 1})${batchNotFound > 0 ? ` - ${batchNotFound} not found in staging` : ''}`);

      const aggregated = aggregatePropertiesByParcel(parentProperties);

      const batchUpsertResult = await batchUpsertPropertiesToPostgres(aggregated, undefined, countyCode);
      result.ingested += batchUpsertResult.created;
      result.errors += batchUpsertResult.errors;
    } catch (error) {
      result.errors += batch.length;
      console.error(`[Ingestion] Error fetching parent accounts batch:`, error instanceof Error ? error.message : error);
    }
  }

  if (notFoundCount > 0) {
    console.warn(`[Ingestion] ${notFoundCount} parent accounts not found in staging tables`);
  }

  console.log(`[Ingestion] Parent account ingestion: ${result.ingested} ingested, ${result.errors} errors`);
  return result;
}

export interface MultiZipIngestionStats {
  totalFromStaging: number;
  propertiesSaved: number;
  propertiesUpdated: number;
  errors: number;
  durationMs: number;
  zipCodeStats: Record<string, IngestionStats>;
}

export async function runMultiZipIngestion(
  zipCodes: string[],
  limitPerZip: number = 500,
  filters?: IngestionFilters,
  countyCode?: CountyCode,
): Promise<MultiZipIngestionStats> {
  console.log(`[Ingestion] Starting multi-ZIP ingestion for ${zipCodes.length} ZIP codes: ${zipCodes.join(', ')}`);

  const startTime = Date.now();
  const stats: MultiZipIngestionStats = {
    totalFromStaging: 0,
    propertiesSaved: 0,
    propertiesUpdated: 0,
    errors: 0,
    durationMs: 0,
    zipCodeStats: {},
  };

  for (const zipCode of zipCodes) {
    console.log(`\n[Ingestion] --- Processing ZIP ${zipCode} ---`);
    const zipStats = await runIngestion(zipCode, limitPerZip, filters, countyCode);

    stats.totalFromStaging += zipStats.totalFromStaging;
    stats.propertiesSaved += zipStats.propertiesSaved;
    stats.propertiesUpdated += zipStats.propertiesUpdated;
    stats.errors += zipStats.errors;
    stats.zipCodeStats[zipCode] = zipStats;
  }

  const parentResult = await ingestParentAccounts(countyCode);
  stats.propertiesSaved += parentResult.ingested;
  stats.errors += parentResult.errors;

  const mappingResult = await buildParcelnumbMapping(countyCode);
  if (mappingResult.errors > 0) stats.errors += mappingResult.errors;

  stats.durationMs = Date.now() - startTime;
  console.log(`\n[Ingestion] Multi-ZIP ingestion complete in ${Math.round(stats.durationMs / 1000)}s`);
  console.log(`[Ingestion] Total: ${stats.propertiesSaved} new, ${stats.propertiesUpdated} updated, ${stats.errors} errors across ${zipCodes.length} ZIPs`);

  return stats;
}

export async function runAllZipsIngestion(
  limit: number = 50000,
  filters?: IngestionFilters,
  countyCode?: CountyCode,
): Promise<IngestionStats> {
  console.log(`[Ingestion] Starting ALL ZIP codes ingestion with limit ${limit}`);
  if (filters) console.log(`[Ingestion] Filters applied:`, JSON.stringify(filters));

  const startTime = Date.now();
  const stats: IngestionStats = {
    totalFromStaging: 0,
    propertiesSaved: 0,
    propertiesUpdated: 0,
    errors: 0,
    durationMs: 0,
  };

  const count = await countAllCommercialProperties(countyCode);
  console.log(`[Ingestion] Found ${count} total commercial properties (rows) across all ZIP codes`);

  const commercialProperties = await getAllCommercialProperties(limit, 0, filters, countyCode);
  stats.totalFromStaging = commercialProperties.length;
  console.log(`[Ingestion] Fetched ${commercialProperties.length} rows from staging tables`);

  const aggregatedProperties = aggregatePropertiesByParcel(commercialProperties);
  console.log(`[Ingestion] Aggregated into ${aggregatedProperties.length} unique properties`);

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

  const batchResult = await batchUpsertPropertiesToPostgres(aggregatedProperties, relationships, countyCode);
  stats.propertiesSaved += batchResult.created;
  stats.propertiesUpdated += batchResult.updated;
  stats.errors += batchResult.errors;

  const parentResult = await ingestParentAccounts(countyCode);
  stats.propertiesSaved += parentResult.ingested;
  stats.errors += parentResult.errors;

  const mappingResult = await buildParcelnumbMapping(countyCode);
  if (mappingResult.errors > 0) stats.errors += mappingResult.errors;

  stats.durationMs = Date.now() - startTime;
  console.log(`[Ingestion] All-ZIP ingestion complete in ${Math.round(stats.durationMs / 1000)}s: ${stats.propertiesSaved} new, ${stats.propertiesUpdated} updated, ${stats.errors} errors`);

  return stats;
}
