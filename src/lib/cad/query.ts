import { db } from '../db';
import { cadAccountInfo, cadAppraisalValues, cadBuildings, cadLand } from '../schema';
import { eq, and, like, inArray, sql, desc } from 'drizzle-orm';
import type { CountyCode } from './types';
import { INCLUDED_PTAD_CODES } from './county-codes';
import type { IngestionFilters, CadCommercialProperty } from '../cad-ingestion';

interface QueryOptions {
  zipCode?: string;
  countyCode?: CountyCode;
  appraisalYear?: number;
  limit?: number;
  offset?: number;
  filters?: IngestionFilters;
  accountNums?: string[];
}

export async function queryCommercialProperties(options: QueryOptions): Promise<CadCommercialProperty[]> {
  const {
    zipCode,
    countyCode,
    appraisalYear = 2025,
    limit = 1000,
    offset = 0,
    filters,
    accountNums,
  } = options;

  // Build WHERE conditions
  const conditions: any[] = [
    inArray(cadAppraisalValues.ptadCode, INCLUDED_PTAD_CODES),
  ];

  if (zipCode) {
    conditions.push(like(cadAccountInfo.propertyZipcode, `${zipCode}%`));
  }

  if (countyCode) {
    conditions.push(eq(cadAccountInfo.countyCode, countyCode));
  }

  if (accountNums && accountNums.length > 0) {
    conditions.push(inArray(cadAccountInfo.accountNum, accountNums));
  }

  // Apply ingestion filters
  if (filters?.lotSqftMin != null && filters.lotSqftMin > 0) {
    conditions.push(sql`${cadLand.landArea} >= ${filters.lotSqftMin}`);
  }
  if (filters?.lotSqftMax != null && filters.lotSqftMax > 0) {
    conditions.push(sql`${cadLand.landArea} <= ${filters.lotSqftMax}`);
  }
  if (filters?.buildingSqftMin != null && filters.buildingSqftMin > 0) {
    conditions.push(sql`${cadBuildings.grossBldgArea} >= ${filters.buildingSqftMin}`);
  }
  if (filters?.buildingSqftMax != null && filters.buildingSqftMax > 0) {
    conditions.push(sql`${cadBuildings.grossBldgArea} <= ${filters.buildingSqftMax}`);
  }
  if (filters?.buildingClassCodes && filters.buildingClassCodes.length > 0) {
    conditions.push(inArray(cadBuildings.bldgClassCd, filters.buildingClassCodes));
  }
  if (filters?.conditionGrades && filters.conditionGrades.length > 0) {
    conditions.push(inArray(cadBuildings.conditionGrade, filters.conditionGrades));
  }

  const rows = await db
    .select({
      // Account info
      accountNum: cadAccountInfo.accountNum,
      countyCode: cadAccountInfo.countyCode,
      gisParcelId: cadAccountInfo.gisParcelId,
      divisionCd: cadAccountInfo.divisionCd,
      bizName: cadAccountInfo.bizName,
      ownerName1: cadAccountInfo.ownerName1,
      ownerName2: cadAccountInfo.ownerName2,
      ownerAddressLine1: cadAccountInfo.ownerAddressLine1,
      ownerCity: cadAccountInfo.ownerCity,
      ownerState: cadAccountInfo.ownerState,
      ownerZipcode: cadAccountInfo.ownerZipcode,
      ownerPhone: cadAccountInfo.phoneNum,
      deedTxfrDate: cadAccountInfo.deedTxfrDate,
      legal1: cadAccountInfo.legal1,
      legal2: cadAccountInfo.legal2,
      legal3: cadAccountInfo.legal3,
      legal4: cadAccountInfo.legal4,
      propertyAddress: cadAccountInfo.propertyAddress,
      propertyCity: cadAccountInfo.propertyCity,
      propertyZipcode: cadAccountInfo.propertyZipcode,
      // Appraisal values
      sptdCode: cadAppraisalValues.sptdCode,
      ptadCode: cadAppraisalValues.ptadCode,
      improvVal: cadAppraisalValues.improvVal,
      landVal: cadAppraisalValues.landVal,
      totalVal: cadAppraisalValues.totalVal,
      cityJurisDesc: cadAppraisalValues.cityJurisDesc,
      isdJurisDesc: cadAppraisalValues.isdJurisDesc,
      // Building (first row, individual buildings aggregated in caller)
      taxObjId: cadBuildings.taxObjId,
      propertyName: cadBuildings.propertyName,
      bldgClassDesc: cadBuildings.bldgClassDesc,
      bldgClassCd: cadBuildings.bldgClassCd,
      yearBuilt: cadBuildings.yearBuilt,
      remodelYear: cadBuildings.remodelYear,
      grossBldgArea: cadBuildings.grossBldgArea,
      numStories: cadBuildings.numStories,
      numUnits: cadBuildings.numUnits,
      netLeaseArea: cadBuildings.netLeaseArea,
      constructionType: cadBuildings.constructionType,
      foundationType: cadBuildings.foundationType,
      heatingType: cadBuildings.heatingType,
      acType: cadBuildings.acType,
      qualityGrade: cadBuildings.qualityGrade,
      conditionGrade: cadBuildings.conditionGrade,
      // Land
      zoningDesc: cadLand.zoningDesc,
      frontDim: cadLand.frontDim,
      depthDim: cadLand.depthDim,
      landArea: cadLand.landArea,
      landAreaUom: cadLand.landAreaUom,
      costPerUom: cadLand.costPerUom,
    })
    .from(cadAccountInfo)
    .innerJoin(cadAppraisalValues, and(
      eq(cadAccountInfo.countyCode, cadAppraisalValues.countyCode),
      eq(cadAccountInfo.accountNum, cadAppraisalValues.accountNum),
      eq(cadAccountInfo.appraisalYear, cadAppraisalValues.appraisalYear),
    ))
    .leftJoin(cadBuildings, and(
      eq(cadAccountInfo.countyCode, cadBuildings.countyCode),
      eq(cadAccountInfo.accountNum, cadBuildings.accountNum),
    ))
    .leftJoin(cadLand, and(
      eq(cadAccountInfo.countyCode, cadLand.countyCode),
      eq(cadAccountInfo.accountNum, cadLand.accountNum),
      eq(cadLand.landTypeCd, 'L'),
    ))
    .where(and(...conditions))
    .orderBy(desc(cadAppraisalValues.totalVal))
    .limit(limit)
    .offset(offset);

  return rows.map(mapRowToProperty);
}

export async function countCommercialProperties(options: {
  zipCode?: string;
  countyCode?: CountyCode;
  appraisalYear?: number;
}): Promise<number> {
  const { zipCode, countyCode } = options;

  const conditions: any[] = [
    inArray(cadAppraisalValues.ptadCode, INCLUDED_PTAD_CODES),
  ];

  if (zipCode) {
    conditions.push(like(cadAccountInfo.propertyZipcode, `${zipCode}%`));
  }

  if (countyCode) {
    conditions.push(eq(cadAccountInfo.countyCode, countyCode));
  }

  const result = await db
    .select({ count: sql<number>`count(distinct ${cadAccountInfo.accountNum})` })
    .from(cadAccountInfo)
    .innerJoin(cadAppraisalValues, and(
      eq(cadAccountInfo.countyCode, cadAppraisalValues.countyCode),
      eq(cadAccountInfo.accountNum, cadAppraisalValues.accountNum),
      eq(cadAccountInfo.appraisalYear, cadAppraisalValues.appraisalYear),
    ))
    .where(and(...conditions));

  return Number(result[0]?.count) || 0;
}

export async function getAccountsByAccountNums(
  accountNums: string[],
  countyCode?: CountyCode,
): Promise<CadCommercialProperty[]> {
  if (accountNums.length === 0) return [];
  return queryCommercialProperties({ accountNums, countyCode });
}

function mapRowToProperty(row: any): CadCommercialProperty {
  return {
    parcelId: row.gisParcelId || '',
    gisParcelId: row.gisParcelId || '',
    llUuid: null,
    address: row.propertyAddress || '',
    city: row.propertyCity || '',
    zip: (row.propertyZipcode || '').trim(),
    lat: 0, // Will be populated from Regrid
    lon: 0,
    usedesc: null,
    usecode: null,
    stateClass: row.sptdCode || null,
    sptdCode: row.sptdCode || null,

    regridYearBuilt: null,
    regridNumStories: null,
    regridImprovVal: null,
    regridLandVal: null,
    regridTotalVal: null,
    lotAcres: null,
    lotSqft: null,
    bldgFootprintSqft: null,

    accountNum: row.accountNum || '',
    divisionCd: row.divisionCd || '',
    dcadImprovVal: row.improvVal || null,
    dcadLandVal: row.landVal || null,
    dcadTotalVal: row.totalVal || null,
    bldgClassCd: row.bldgClassCd || null,
    cityJurisDesc: row.cityJurisDesc || null,
    isdJurisDesc: row.isdJurisDesc || null,

    bizName: row.bizName || null,
    ownerName1: row.ownerName1 || null,
    ownerName2: row.ownerName2 || null,
    ownerAddressLine1: row.ownerAddressLine1 || null,
    ownerCity: row.ownerCity || null,
    ownerState: row.ownerState || null,
    ownerZipcode: row.ownerZipcode || null,
    ownerPhone: row.ownerPhone || null,
    deedTxfrDate: row.deedTxfrDate || null,

    dcadZoning: row.zoningDesc || null,
    frontDim: row.frontDim || null,
    depthDim: row.depthDim || null,
    landArea: row.landArea || null,
    landAreaUom: row.landAreaUom || null,
    landCostPerUom: row.costPerUom || null,

    dcadLandSqft: row.landArea ? (
      row.landAreaUom === 'ACRES'
        ? Math.round(row.landArea * 43560)
        : Math.round(row.landArea)
    ) : null,

    taxObjId: row.taxObjId || null,
    propertyName: row.propertyName || null,
    bldgClassDesc: row.bldgClassDesc || null,
    dcadYearBuilt: row.yearBuilt || null,
    remodelYr: row.remodelYear || null,
    grossBldgArea: row.grossBldgArea || null,
    dcadNumStories: row.numStories || null,
    numUnits: row.numUnits || null,
    netLeaseArea: row.netLeaseArea || null,
    constructionType: row.constructionType || null,
    foundationType: row.foundationType || null,
    heatingType: row.heatingType || null,
    acType: row.acType || null,
    qualityGrade: row.qualityGrade || null,
    conditionGrade: row.conditionGrade || null,
  };
}
