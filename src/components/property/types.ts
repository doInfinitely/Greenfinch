export interface Property {
  propertyKey: string;
  address: string;
  regridAddress: string | null;
  validatedAddress: string | null;
  commonName: string | null;
  city: string;
  state: string;
  zip: string;
  county: string;
  lat: number;
  lon: number;
  geocodedLat?: number | null;
  geocodedLon?: number | null;
  streetviewPanoId?: string | null;
  lotAcres: number;
  yearBuilt: number | null;
  numFloors: number | null;
  buildingSqft: number | null;
  calculatedBuildingClass: string | null;
  totalParval: number;
  totalImprovval: number;
  landval: number;
  accountOwner: string | null;
  constituentOwners: string[];
  allOwners: string[];
  primaryOwner: string | null;
  usedesc: string[];
  usecode: string[];
  parcelCount: number;
  isParentProperty: boolean;
  parentPropertyKey: string | null;
  constituentAccountNums: string[] | null;
  constituentCount: number;
}

export interface ConstituentProperty {
  propertyKey: string;
  commonName: string | null;
  buildingSqft: number | null;
  dcadBizName: string | null;
}

export interface EnrichedPropertyData {
  assetCategory: string | null;
  assetSubcategory: string | null;
  categoryConfidence: number | null;
  commonName: string | null;
  commonNameConfidence: number | null;
  beneficialOwner: string | null;
  beneficialOwnerConfidence: number | null;
  beneficialOwnerType: string | null;
  managementType: string | null;
  managementCompany: string | null;
  managementCompanyDomain: string | null;
  managementConfidence: number | null;
  propertyWebsite: string | null;
  propertyPhone: string | null;
  propertyManagerWebsite: string | null;
  aiRationale: string | null;
  enrichmentSources: Array<{
    id: number;
    title: string;
    url: string;
    type: string;
  }> | null;
  lastEnrichedAt: string | null;
}

export interface Contact {
  id: string;
  fullName: string;
  normalizedName?: string;
  nameConfidence: number;
  email: string | null;
  normalizedEmail?: string | null;
  emailConfidence: number | null;
  phone: string | null;
  normalizedPhone?: string | null;
  phoneConfidence: number | null;
  phoneLabel?: string | null;
  phoneExtension?: string | null;
  aiPhone?: string | null;
  aiPhoneLabel?: string | null;
  enrichmentPhoneWork?: string | null;
  enrichmentPhonePersonal?: string | null;
  title: string | null;
  titleConfidence: number | null;
  companyDomain: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinConfidence: number | null;
  location: string | null;
  role: string;
  roleConfidence: number;
  source?: string;
  needsReview?: boolean;
  reviewReason?: string | null;
  emailValidationStatus?: 'valid' | 'invalid' | 'pending' | 'not_validated' | 'unknown' | 'catch-all';
  photoUrl?: string | null;
  relationshipStatus?: 'active' | 'former' | 'job_change_detected' | null;
  relationshipStatusReason?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  domain: string | null;
  orgType: string | null;
  role: string | null;
  roles?: string[];
  description?: string | null;
  industry?: string | null;
  employees?: number | null;
  employeesRange?: string | null;
  linkedinHandle?: string | null;
  twitterHandle?: string | null;
  facebookHandle?: string | null;
  crunchbaseHandle?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  foundedYear?: number | null;
  tags?: string[] | null;
  phoneNumbers?: string[] | null;
  emailAddresses?: string[] | null;
  logoUrl?: string | null;
  pdlEnriched?: boolean;
}

export type EnrichmentStatusType = 'not_enriched' | 'pending' | 'completed' | 'enriched' | 'failed';
