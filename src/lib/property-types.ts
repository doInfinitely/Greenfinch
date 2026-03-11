// Individual building details from CAD COM_DETAIL
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
  state?: string;
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
  gisParcelId: string | null;
  sptdCode: string | null;
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

  // Legal description fields
  legal1: string | null;
  legal2: string | null;
  legal3: string | null;
  legal4: string | null;

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

  // Computed lot/building with source tracking
  computedLotSqft?: number | null;
  computedLotSqftSource?: string | null;
  computedBuildingSqft?: number | null;
  computedBuildingSqftSource?: string | null;

  // DCAD enriched fields
  dcad?: CommercialProperty;
}
