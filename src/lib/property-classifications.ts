export interface PTADClassification {
  legacyCode: string;
  dcadDescription: string;
  ptadCode: string;
  ptadDescription: string;
  category: 'commercial' | 'industrial' | 'multifamily' | 'single_family' | 'vacant_land' | 'agricultural' | 'rural' | 'minerals' | 'utilities' | 'personal_property' | 'mobile_home' | 'inventory' | 'exempt' | 'other';
  include: boolean;
}

export const PROPERTY_CLASSIFICATIONS: PTADClassification[] = [
  // MULTIFAMILY - INCLUDE
  { legacyCode: 'B11', dcadDescription: 'MFR - APARTMENTS', ptadCode: 'B', ptadDescription: 'REAL PROPERTY: MULTIFAMILY RESIDENTIAL', category: 'multifamily', include: true },
  { legacyCode: 'B12', dcadDescription: 'MFR - DUPLEXES', ptadCode: 'B', ptadDescription: 'REAL PROPERTY: MULTIFAMILY RESIDENTIAL', category: 'multifamily', include: true },
  
  // COMMERCIAL - INCLUDE
  { legacyCode: 'F10', dcadDescription: 'COMMERCIAL IMPROVEMENTS', ptadCode: 'F1', ptadDescription: 'REAL PROPERTY: COMMERCIAL', category: 'commercial', include: true },
  
  // INDUSTRIAL - INCLUDE
  { legacyCode: 'F20', dcadDescription: 'INDUSTRIAL IMPROVEMENTS', ptadCode: 'F2', ptadDescription: 'REAL PROPERTY: INDUSTRIAL AND MANUFACTURING', category: 'industrial', include: true },
  
  // SINGLE FAMILY RESIDENTIAL - EXCLUDE
  { legacyCode: 'A11', dcadDescription: 'SINGLE FAMILY RESIDENCES', ptadCode: 'A', ptadDescription: 'REAL PROPERTY: SINGLE-FAMILY RESIDENTIAL', category: 'single_family', include: false },
  { legacyCode: 'A12', dcadDescription: 'SFR - TOWNHOUSES', ptadCode: 'A', ptadDescription: 'REAL PROPERTY: SINGLE-FAMILY RESIDENTIAL', category: 'single_family', include: false },
  { legacyCode: 'A13', dcadDescription: 'SFR - CONDOMINIUMS', ptadCode: 'A', ptadDescription: 'REAL PROPERTY: SINGLE-FAMILY RESIDENTIAL', category: 'single_family', include: false },
  { legacyCode: 'A20', dcadDescription: 'MOBILE HOME ON OWNERS LAND', ptadCode: 'A', ptadDescription: 'REAL PROPERTY: SINGLE-FAMILY RESIDENTIAL', category: 'single_family', include: false },
  
  // VACANT LAND - EXCLUDE
  { legacyCode: 'C11', dcadDescription: 'SFR - VACANT LOTS/TRACTS', ptadCode: 'C1', ptadDescription: 'REAL PROPERTY: VACANT LOTS AND LAND TRACTS', category: 'vacant_land', include: false },
  { legacyCode: 'C12', dcadDescription: 'COMMERCIAL - VACANT PLOTTED LOTS/TRACTS', ptadCode: 'C1', ptadDescription: 'REAL PROPERTY: VACANT LOTS AND LAND TRACTS', category: 'vacant_land', include: false },
  { legacyCode: 'C13', dcadDescription: 'INDUSTRIAL - VACANT PLOTTED LOTS/TRACTS', ptadCode: 'C1', ptadDescription: 'REAL PROPERTY: VACANT LOTS AND LAND TRACTS', category: 'vacant_land', include: false },
  { legacyCode: 'C14', dcadDescription: 'RURAL VACANT - LESS THAN 5 ACRES', ptadCode: 'C1', ptadDescription: 'REAL PROPERTY: VACANT LOTS AND LAND TRACTS', category: 'vacant_land', include: false },
  
  // AGRICULTURAL - EXCLUDE
  { legacyCode: 'D10', dcadDescription: 'QUALIFIED AGRICULTURAL LAND', ptadCode: 'D1', ptadDescription: 'REAL PROPERTY: QUALIFIED OPEN-SPACE LAND', category: 'agricultural', include: false },
  { legacyCode: 'D20', dcadDescription: 'FARM AND RANCH IMPROVEMENTS', ptadCode: 'D2', ptadDescription: 'REAL PROPERTY: FARM AND RANCH IMPROVEMENTS ON QUALIFIED OPEN-SPACE LAND', category: 'agricultural', include: false },
  
  // RURAL - EXCLUDE
  { legacyCode: 'E11', dcadDescription: 'RURAL LAND AND IMPROVEMENTS NON-QUALIFIED', ptadCode: 'E', ptadDescription: 'REAL PROPERTY: RURAL LAND, NOT QUALIFIED FOR OPEN-SPACE APPRAISAL AND IMPROVEMENTS', category: 'rural', include: false },
  
  // MINERALS - EXCLUDE
  { legacyCode: 'G10', dcadDescription: 'OIL, GAS AND MINERAL RESERVES', ptadCode: 'G1', ptadDescription: 'REAL PROPERTY: OIL AND GAS', category: 'minerals', include: false },
  { legacyCode: 'G20', dcadDescription: 'OTHER MINERALS', ptadCode: 'G2', ptadDescription: 'REAL PROPERTY: MINERALS', category: 'minerals', include: false },
  { legacyCode: 'G30', dcadDescription: 'MINERALS, NON-PRODUCING', ptadCode: 'G3', ptadDescription: 'REAL PROPERTY: OTHER SUBSURFACE INTERESTS', category: 'minerals', include: false },
  
  // UTILITIES - EXCLUDE
  { legacyCode: 'J10', dcadDescription: 'PRIVATE WATER SYSTEMS', ptadCode: 'J1', ptadDescription: 'UTILITIES - WATER SYSTEMS', category: 'utilities', include: false },
  { legacyCode: 'J20', dcadDescription: 'GAS COMPANIES', ptadCode: 'J2', ptadDescription: 'UTILITIES - GAS DISTRIBUTION SYSTEMS', category: 'utilities', include: false },
  { legacyCode: 'J30', dcadDescription: 'ELECTRIC COMPANIES', ptadCode: 'J3', ptadDescription: 'UTILITIES - ELECTRIC COMPANY', category: 'utilities', include: false },
  { legacyCode: 'J40', dcadDescription: 'TELEPHONE COMPANIES', ptadCode: 'J4', ptadDescription: 'UTILITIES - TELEPHONE COMPANY', category: 'utilities', include: false },
  { legacyCode: 'J51', dcadDescription: 'RAILROAD CORRIDOR', ptadCode: 'J5', ptadDescription: 'UTILITIES - RAILROADS', category: 'utilities', include: false },
  { legacyCode: 'J52', dcadDescription: 'RAILROAD ROLLING STOCK', ptadCode: 'J9', ptadDescription: 'UTILITIES - RAILROAD ROLLING STOCK', category: 'utilities', include: false },
  { legacyCode: 'J60', dcadDescription: 'PIPELINES', ptadCode: 'J6', ptadDescription: 'UTILITIES - PIPELINES', category: 'utilities', include: false },
  { legacyCode: 'J70', dcadDescription: 'CABLE COMPANIES', ptadCode: 'J7', ptadDescription: 'UTILITIES - CABLE COMPANIES', category: 'utilities', include: false },
  { legacyCode: 'J80', dcadDescription: 'OTHER UTILITIES', ptadCode: 'J8', ptadDescription: 'UTILITIES - OTHER TYPE OF UTILITY', category: 'utilities', include: false },
  
  // PERSONAL PROPERTY - EXCLUDE
  { legacyCode: 'L10', dcadDescription: 'COMMERCIAL BPP', ptadCode: 'L1', ptadDescription: 'PERSONAL PROPERTY: COMMERCIAL', category: 'personal_property', include: false },
  { legacyCode: 'L20', dcadDescription: 'INDUSTRIAL BPP', ptadCode: 'L2', ptadDescription: 'PERSONAL PROPERTY: INDUSTRIAL & MANUFACTURING', category: 'personal_property', include: false },
  { legacyCode: 'M10', dcadDescription: 'WATERCRAFT', ptadCode: 'L1', ptadDescription: 'PERSONAL PROPERTY: COMMERCIAL', category: 'personal_property', include: false },
  { legacyCode: 'M20', dcadDescription: 'AIRCRAFT', ptadCode: 'L1', ptadDescription: 'PERSONAL PROPERTY: COMMERCIAL', category: 'personal_property', include: false },
  
  // MOBILE HOMES - EXCLUDE
  { legacyCode: 'M31', dcadDescription: 'MOBILE HOMES ON LEASED SPACES', ptadCode: 'M1', ptadDescription: 'MOBILE HOMES', category: 'mobile_home', include: false },
  { legacyCode: 'M32', dcadDescription: 'MOBILE HOMES FOR SALE (ON LOTS)', ptadCode: 'M1', ptadDescription: 'MOBILE HOMES', category: 'mobile_home', include: false },
  
  // INTANGIBLES - EXCLUDE
  { legacyCode: 'N10', dcadDescription: 'INTANGIBLES', ptadCode: 'N', ptadDescription: 'INTANGIBLE PERSONAL PROPERTY', category: 'other', include: false },
  
  // INVENTORY - EXCLUDE
  { legacyCode: 'O10', dcadDescription: 'RESIDENTIAL - VACANT LOTS AS INVENTORY', ptadCode: 'O', ptadDescription: 'REAL PROPERTY: RESIDENTIAL INVENTORY', category: 'inventory', include: false },
  { legacyCode: 'O11', dcadDescription: 'RESIDENTIAL - IMPROVEMENTS AS INVENTORY', ptadCode: 'O', ptadDescription: 'REAL PROPERTY: RESIDENTIAL INVENTORY', category: 'inventory', include: false },
  
  // SPECIAL INVENTORY - EXCLUDE
  { legacyCode: 'S10', dcadDescription: 'SPECIAL INVENTORY', ptadCode: 'S', ptadDescription: 'SPECIAL INVENTORY TAX', category: 'inventory', include: false },
  
  // EXEMPT - EXCLUDE
  { legacyCode: 'CE', dcadDescription: 'CEMETERY', ptadCode: 'XV', ptadDescription: 'CEMETARIES', category: 'exempt', include: false },
  { legacyCode: 'CH', dcadDescription: 'CHARITY', ptadCode: 'XV', ptadDescription: 'CHARITABLE ORGANIZATIONS', category: 'exempt', include: false },
  { legacyCode: 'CI', dcadDescription: 'CITY PROPERTY', ptadCode: 'XV', ptadDescription: 'PUBLIC PROPERTY (CITY)', category: 'exempt', include: false },
  { legacyCode: 'CO', dcadDescription: 'COUNTY PROPERTY', ptadCode: 'XV', ptadDescription: 'PUBLIC PROPERTY (COUNTY)', category: 'exempt', include: false },
  { legacyCode: 'FE', dcadDescription: 'FEDERAL PROPERTY', ptadCode: 'XV', ptadDescription: 'FEDERAL GOVERNMENT', category: 'exempt', include: false },
  { legacyCode: 'OE', dcadDescription: 'OTHER PUBLIC PROPERTY', ptadCode: 'XV', ptadDescription: 'PUBLIC PROPERTY (OTHER GOVT)', category: 'exempt', include: false },
  { legacyCode: 'RE', dcadDescription: 'RELIGIOUS', ptadCode: 'XV', ptadDescription: 'RELIGIOUS ORGANIZATIONS', category: 'exempt', include: false },
  { legacyCode: 'SC', dcadDescription: 'SCHOOL PROPERTY', ptadCode: 'XV', ptadDescription: 'PUBLIC PROPERTY (SCHOOL)', category: 'exempt', include: false },
  { legacyCode: 'ST', dcadDescription: 'STATE PROPERTY', ptadCode: 'XV', ptadDescription: 'PUBLIC PROPERTY (STATE)', category: 'exempt', include: false },
  { legacyCode: 'MI', dcadDescription: 'MISCELLANEOUS', ptadCode: 'XU', ptadDescription: 'MISCELLANEOUS EXEMPT', category: 'exempt', include: false },
  { legacyCode: 'U5', dcadDescription: 'UNDER $2,500', ptadCode: 'XB', ptadDescription: 'INCOME PRODUCING TANGIBLE PERSONAL PROPERTY HAVING VALUE LESS THAN $2,500', category: 'exempt', include: false },
  { legacyCode: 'MR', dcadDescription: 'MINERALS', ptadCode: 'XC', ptadDescription: 'MINERAL INTEREST HAVING VALUE LESS THAN $500', category: 'exempt', include: false },
  { legacyCode: 'N2', dcadDescription: 'PRIMARILY CHARITABLE', ptadCode: 'XG', ptadDescription: 'ORGANIZATION ENGAGED PRIMARILY IN PERFORMING CHARITABLE FUNCTIONS', category: 'exempt', include: false },
  { legacyCode: 'YO', dcadDescription: 'YOUTH DEVELOPMENT ASSOCIATION', ptadCode: 'XI', ptadDescription: 'YOUTH SPIRITUAL, MENTAL AND PHYSICAL DEVELOPMENT ORGANIZATIONS', category: 'exempt', include: false },
  { legacyCode: 'PR', dcadDescription: 'PRIVATE SCHOOL', ptadCode: 'XJ', ptadDescription: 'ORGANIZATIONS SCHOOLS (PRIVATE)', category: 'exempt', include: false },
  { legacyCode: 'NC', dcadDescription: 'NONPROFIT COMMUNITY ORG', ptadCode: 'XL', ptadDescription: 'ORGANIZATIONS PROVIDING ECONOMIC DEVELOPMENT SERVICES TO LOCAL COMMUNITY', category: 'exempt', include: false },
  { legacyCode: 'WS', dcadDescription: 'WASTE OR WASTEWATER SEWER', ptadCode: 'XR', ptadDescription: 'NONPROFIT WATER SUPPLY OR WASTEWATER SERVICE', category: 'exempt', include: false },
];

export const INCLUDED_SPTD_CODES = PROPERTY_CLASSIFICATIONS
  .filter(c => c.include)
  .map(c => c.legacyCode);

export const INCLUDED_CATEGORIES = ['commercial', 'industrial', 'multifamily'] as const;

export function isIncludedPropertyCode(sptdCode: string | null): boolean {
  if (!sptdCode) return false;
  return INCLUDED_SPTD_CODES.includes(sptdCode.trim());
}

export function getPropertyCategory(sptdCode: string | null): string | null {
  if (!sptdCode) return null;
  const classification = PROPERTY_CLASSIFICATIONS.find(c => c.legacyCode === sptdCode.trim());
  return classification?.category || null;
}

export function getPtadCode(sptdCode: string | null): string | null {
  if (!sptdCode) return null;
  const classification = PROPERTY_CLASSIFICATIONS.find(c => c.legacyCode === sptdCode.trim());
  return classification?.ptadCode || null;
}
