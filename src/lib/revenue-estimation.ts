/**
 * Revenue estimation — rule-based annual contract value per service type.
 * Pure functions, no DB/API calls. Follows the building-class.ts pattern.
 */

import { SERVICE_CATEGORIES } from './schema';

// ── Types ──────────────────────────────────────────────────────────

export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

export interface RevenueEstimationInput {
  lotSqft: number | null;
  buildingSqft: number | null;
  dcadParkingSqft: number | null;
  dcadRentableArea: number | null;
  dcadTotalUnits: number | null;
  yearBuilt: number | null;
  calculatedBuildingClass: string | null;
  assetCategory: string | null;
  assetSubcategory: string | null;
  numFloors: number | null;
  dcadTotalVal: number | null;
}

export interface ServiceEstimate {
  annualValue: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface RevenueEstimationResult {
  estimates: Partial<Record<ServiceCategory, ServiceEstimate>>;
  totalAllServices: number;
  permeableAreaRatio: number | null;
  inputQuality: 'good' | 'fair' | 'poor';
}

// ── Helpers ────────────────────────────────────────────────────────

const SQFT_PER_ACRE = 43_560;

/** Building class → quality multiplier (higher class = higher rates). */
function classMultiplier(buildingClass: string | null): number {
  switch (buildingClass) {
    case 'A+': return 1.35;
    case 'A':  return 1.20;
    case 'B':  return 1.00;
    case 'C':  return 0.80;
    case 'D':  return 0.65;
    default:   return 0.90; // unknown
  }
}

/** Category-specific modifier for certain services. */
function categoryModifier(category: string | null, service: ServiceCategory): number {
  if (!category) return 1.0;
  const cat = category.toLowerCase();

  // Healthcare/hospitality need more janitorial, HVAC, fire protection
  if (service === 'janitorial' && (cat.includes('healthcare') || cat.includes('hospitality'))) return 1.25;
  if (service === 'hvac' && cat.includes('healthcare')) return 1.20;
  if (service === 'fire_protection' && cat.includes('healthcare')) return 1.15;

  // Retail has higher window cleaning needs
  if (service === 'window_cleaning' && cat.includes('retail')) return 1.20;

  // Industrial has lower janitorial but higher electrical/plumbing
  if (service === 'janitorial' && cat.includes('industrial')) return 0.60;
  if (service === 'electrical' && cat.includes('industrial')) return 1.20;

  // Multifamily has higher pest control, elevator, landscaping
  if (service === 'pest_control' && cat.includes('multifamily')) return 1.30;
  if (service === 'elevator' && cat.includes('multifamily')) return 1.15;
  if (service === 'landscaping' && cat.includes('multifamily')) return 1.10;

  return 1.0;
}

/** Derive permeable (landscape-able) area. */
export function derivePermeableArea(input: RevenueEstimationInput): {
  permeableSqft: number;
  permeableRatio: number;
} {
  const lotSqft = input.lotSqft || 0;
  if (lotSqft <= 0) return { permeableSqft: 0, permeableRatio: 0 };

  const buildingSqft = input.buildingSqft || 0;
  const parkingSqft = input.dcadParkingSqft || 0;
  const impervious = buildingSqft + parkingSqft;
  const permeableSqft = Math.max(0, lotSqft - impervious);
  const permeableRatio = permeableSqft / lotSqft;

  return { permeableSqft, permeableRatio };
}

function confidence(hasKey: boolean, hasSecondary: boolean): 'high' | 'medium' | 'low' {
  if (hasKey && hasSecondary) return 'high';
  if (hasKey) return 'medium';
  return 'low';
}

function round(n: number): number {
  return Math.round(n / 100) * 100; // round to nearest $100
}

function acres(sqft: number): string {
  return (sqft / SQFT_PER_ACRE).toFixed(1);
}

function kSqft(sqft: number): string {
  return sqft >= 1000 ? `${(sqft / 1000).toFixed(0)}k` : String(sqft);
}

// ── Per-Service Estimators ─────────────────────────────────────────

// Lot-based: landscaping
function estimateLandscaping(input: RevenueEstimationInput): ServiceEstimate | null {
  const { permeableSqft, permeableRatio } = derivePermeableArea(input);
  if (permeableSqft <= 0) return null;

  // Base rate: $0.12-0.20/sqft permeable area per year
  const baseRate = 0.15;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'landscaping');
  const annualValue = round(permeableSqft * baseRate * classMult * catMult);

  if (annualValue < 500) return null;

  return {
    annualValue,
    confidence: confidence(permeableSqft > 0, input.calculatedBuildingClass !== null),
    rationale: `${acres(permeableSqft)}ac permeable (${(permeableRatio * 100).toFixed(0)}% of lot) @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Lot-based: snow & ice removal
function estimateSnowIce(input: RevenueEstimationInput): ServiceEstimate | null {
  const lotSqft = input.lotSqft || 0;
  if (lotSqft <= 0) return null;

  // Impervious area (parking + building footprint approximation)
  const buildingFootprint = input.numFloors && input.numFloors > 0
    ? (input.buildingSqft || 0) / input.numFloors
    : (input.buildingSqft || 0) * 0.5;
  const parkingSqft = input.dcadParkingSqft || 0;
  const plowableArea = parkingSqft + buildingFootprint * 0.3; // driveways/walks around building
  if (plowableArea <= 0) return null;

  // $0.08/sqft per year (assumes ~15 events)
  const baseRate = 0.08;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const annualValue = round(plowableArea * baseRate * classMult);

  if (annualValue < 500) return null;

  return {
    annualValue,
    confidence: confidence(parkingSqft > 0, true),
    rationale: `${kSqft(Math.round(plowableArea))} sqft plowable area @ $${(baseRate * classMult).toFixed(2)}/sqft`,
  };
}

// Lot-based: parking & pavement
function estimateParkingPavement(input: RevenueEstimationInput): ServiceEstimate | null {
  const parkingSqft = input.dcadParkingSqft || 0;
  const lotSqft = input.lotSqft || 0;

  // Estimate parking if not available (30% of lot minus building)
  const buildingSqft = input.buildingSqft || 0;
  const estimated = parkingSqft > 0 ? parkingSqft : Math.max(0, (lotSqft - buildingSqft) * 0.3);
  if (estimated <= 0) return null;

  // $0.04/sqft annual maintenance (striping, seal coating, patching)
  const baseRate = 0.04;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const annualValue = round(estimated * baseRate * classMult);

  if (annualValue < 400) return null;

  return {
    annualValue,
    confidence: confidence(parkingSqft > 0, true),
    rationale: `${kSqft(Math.round(estimated))} sqft parking area @ $${(baseRate * classMult).toFixed(2)}/sqft`,
  };
}

// Area-based: janitorial
function estimateJanitorial(input: RevenueEstimationInput): ServiceEstimate | null {
  const sqft = input.dcadRentableArea || input.buildingSqft;
  if (!sqft || sqft <= 0) return null;

  // $1.50-$4.00/sqft/year depending on class and type
  const baseRate = 2.50;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'janitorial');
  const annualValue = round(sqft * baseRate * classMult * catMult);

  if (annualValue < 1000) return null;

  return {
    annualValue,
    confidence: confidence(true, input.calculatedBuildingClass !== null),
    rationale: `${kSqft(sqft)} sqft rentable @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Area-based: HVAC
function estimateHvac(input: RevenueEstimationInput): ServiceEstimate | null {
  const sqft = input.buildingSqft;
  if (!sqft || sqft <= 0) return null;

  // $0.80-$2.00/sqft/year for maintenance contracts
  const baseRate = 1.20;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'hvac');
  const annualValue = round(sqft * baseRate * classMult * catMult);

  if (annualValue < 800) return null;

  return {
    annualValue,
    confidence: confidence(true, input.calculatedBuildingClass !== null),
    rationale: `${kSqft(sqft)} sqft building @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Area-based: pest control
function estimatePestControl(input: RevenueEstimationInput): ServiceEstimate | null {
  const sqft = input.buildingSqft;
  if (!sqft || sqft <= 0) return null;

  // $0.08-$0.20/sqft/year
  const baseRate = 0.12;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'pest_control');
  const annualValue = round(sqft * baseRate * classMult * catMult);

  if (annualValue < 300) return null;

  return {
    annualValue,
    confidence: confidence(true, true),
    rationale: `${kSqft(sqft)} sqft building @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Area-based: fire protection
function estimateFireProtection(input: RevenueEstimationInput): ServiceEstimate | null {
  const sqft = input.buildingSqft;
  if (!sqft || sqft <= 0) return null;

  // $0.15-$0.40/sqft/year (inspections, sprinkler maintenance, fire alarm)
  const baseRate = 0.25;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'fire_protection');
  const annualValue = round(sqft * baseRate * classMult * catMult);

  if (annualValue < 500) return null;

  return {
    annualValue,
    confidence: confidence(true, true),
    rationale: `${kSqft(sqft)} sqft building @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Area-based: electrical
function estimateElectrical(input: RevenueEstimationInput): ServiceEstimate | null {
  const sqft = input.buildingSqft;
  if (!sqft || sqft <= 0) return null;

  // $0.15-$0.35/sqft/year
  const baseRate = 0.22;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'electrical');
  const annualValue = round(sqft * baseRate * classMult * catMult);

  if (annualValue < 500) return null;

  return {
    annualValue,
    confidence: confidence(true, true),
    rationale: `${kSqft(sqft)} sqft building @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Area-based: plumbing
function estimatePlumbing(input: RevenueEstimationInput): ServiceEstimate | null {
  const sqft = input.buildingSqft;
  if (!sqft || sqft <= 0) return null;

  // $0.12-$0.30/sqft/year
  const baseRate = 0.18;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const annualValue = round(sqft * baseRate * classMult);

  if (annualValue < 400) return null;

  return {
    annualValue,
    confidence: confidence(true, true),
    rationale: `${kSqft(sqft)} sqft building @ $${(baseRate * classMult).toFixed(2)}/sqft`,
  };
}

// Unit-based: elevator
function estimateElevator(input: RevenueEstimationInput): ServiceEstimate | null {
  const floors = input.numFloors;
  if (!floors || floors < 2) return null;

  // Estimate elevator count: 1 per 3 floors, min 1
  const units = input.dcadTotalUnits || 0;
  const elevatorCount = Math.max(1, Math.ceil(floors / 3) + (units > 100 ? 1 : 0));
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'elevator');

  // $3,000-$8,000 per elevator per year
  const perElevator = 5000;
  const annualValue = round(elevatorCount * perElevator * classMult * catMult);

  if (annualValue < 2000) return null;

  return {
    annualValue,
    confidence: confidence(floors > 0, units > 0),
    rationale: `~${elevatorCount} elevator(s), ${floors} floors @ $${Math.round(perElevator * classMult * catMult).toLocaleString()}/elevator`,
  };
}

// Facade-based: window cleaning
function estimateWindowCleaning(input: RevenueEstimationInput): ServiceEstimate | null {
  const floors = input.numFloors || 1;
  const buildingSqft = input.buildingSqft;
  if (!buildingSqft || buildingSqft <= 0) return null;

  // Estimate facade area from building footprint & floors
  const footprint = floors > 0 ? buildingSqft / floors : buildingSqft;
  const perimeter = Math.sqrt(footprint) * 4; // assume square-ish footprint
  const facadeHeight = floors * 12; // 12ft per floor
  const facadeSqft = perimeter * facadeHeight * 0.4; // 40% glass assumption

  // $0.30-$0.80/sqft facade glass per year (4x cleanings)
  const baseRate = 0.50;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const catMult = categoryModifier(input.assetCategory, 'window_cleaning');
  const annualValue = round(facadeSqft * baseRate * classMult * catMult);

  if (annualValue < 400) return null;

  return {
    annualValue,
    confidence: confidence(true, floors > 1),
    rationale: `~${kSqft(Math.round(facadeSqft))} sqft glass facade, ${floors} floors @ $${(baseRate * classMult * catMult).toFixed(2)}/sqft`,
  };
}

// Facade-based: roofing
function estimateRoofing(input: RevenueEstimationInput): ServiceEstimate | null {
  const buildingSqft = input.buildingSqft;
  if (!buildingSqft || buildingSqft <= 0) return null;

  const floors = input.numFloors || 1;
  const roofArea = floors > 0 ? buildingSqft / floors : buildingSqft;

  // $0.10-$0.25/sqft/year (maintenance, inspections, minor repairs)
  const baseRate = 0.15;
  const classMult = classMultiplier(input.calculatedBuildingClass);
  const annualValue = round(roofArea * baseRate * classMult);

  if (annualValue < 400) return null;

  return {
    annualValue,
    confidence: confidence(true, floors > 0),
    rationale: `~${kSqft(Math.round(roofArea))} sqft roof @ $${(baseRate * classMult).toFixed(2)}/sqft`,
  };
}

// Flat-rate: security
function estimateSecurity(input: RevenueEstimationInput): ServiceEstimate | null {
  const buildingSqft = input.buildingSqft;
  if (!buildingSqft || buildingSqft <= 0) return null;

  // Security scales by building size but in tiers rather than linear
  const classMult = classMultiplier(input.calculatedBuildingClass);
  let base: number;
  if (buildingSqft >= 200000) base = 48000;
  else if (buildingSqft >= 100000) base = 36000;
  else if (buildingSqft >= 50000) base = 24000;
  else if (buildingSqft >= 20000) base = 15000;
  else base = 8000;

  const annualValue = round(base * classMult);

  return {
    annualValue,
    confidence: confidence(true, true),
    rationale: `${kSqft(buildingSqft)} sqft building, Class ${input.calculatedBuildingClass || '?'} tier`,
  };
}

// Flat-rate: waste management
function estimateWasteManagement(input: RevenueEstimationInput): ServiceEstimate | null {
  const buildingSqft = input.buildingSqft;
  if (!buildingSqft || buildingSqft <= 0) return null;

  // Tiered by building size
  let base: number;
  if (buildingSqft >= 200000) base = 18000;
  else if (buildingSqft >= 100000) base = 12000;
  else if (buildingSqft >= 50000) base = 8000;
  else if (buildingSqft >= 20000) base = 5000;
  else base = 3000;

  const classMult = classMultiplier(input.calculatedBuildingClass);
  const annualValue = round(base * classMult);

  if (annualValue < 500) return null;

  return {
    annualValue,
    confidence: confidence(true, true),
    rationale: `${kSqft(buildingSqft)} sqft building, tier-based`,
  };
}

// Lot-based: tree trimming
function estimateTreeTrimming(input: RevenueEstimationInput): ServiceEstimate | null {
  const lotSqft = input.lotSqft || 0;
  if (lotSqft <= 0) return null;

  const lotAcres = lotSqft / SQFT_PER_ACRE;
  const cat = input.assetCategory?.toLowerCase() || '';

  // Estimated tree density per acre by property type
  let treesPerAcre: number;
  if (cat.includes('hospitality')) treesPerAcre = 15;
  else if (cat.includes('public') || cat.includes('institutional')) treesPerAcre = 15;
  else if (cat.includes('office')) treesPerAcre = 12;
  else if (cat.includes('healthcare')) treesPerAcre = 10;
  else if (cat.includes('multifamily')) treesPerAcre = 10;
  else if (cat.includes('retail')) treesPerAcre = 8;
  else if (cat.includes('special')) treesPerAcre = 5;
  else if (cat.includes('industrial')) treesPerAcre = 3;
  else treesPerAcre = 8;

  const estimatedTrees = Math.round(lotAcres * treesPerAcre);
  if (estimatedTrees <= 0) return null;

  const costPerTree = 300; // $/tree per service visit
  const visitsPerYear = 1.5; // 1-2 visits/year average
  const annualValue = round(estimatedTrees * costPerTree * visitsPerYear);

  if (annualValue < 500) return null;

  return {
    annualValue,
    confidence: confidence(lotSqft > 0, input.assetCategory !== null),
    rationale: `~${estimatedTrees} trees (${treesPerAcre}/ac × ${acres(lotSqft)}ac) × $${costPerTree}/tree × ${visitsPerYear} visits/yr`,
  };
}

// Lot-based: irrigation systems
function estimateIrrigation(input: RevenueEstimationInput): ServiceEstimate | null {
  const lotSqft = input.lotSqft || 0;
  if (lotSqft <= 0) return null;

  const lotAcres = lotSqft / SQFT_PER_ACRE;
  const cat = input.assetCategory?.toLowerCase() || '';

  // Irrigable percentage of lot by property type
  let irrigablePct: number;
  if (cat.includes('multifamily')) irrigablePct = 0.60;
  else if (cat.includes('hospitality')) irrigablePct = 0.50;
  else if (cat.includes('public') || cat.includes('institutional')) irrigablePct = 0.50;
  else if (cat.includes('office')) irrigablePct = 0.40;
  else if (cat.includes('healthcare')) irrigablePct = 0.35;
  else if (cat.includes('special')) irrigablePct = 0.30;
  else if (cat.includes('retail')) irrigablePct = 0.25;
  else if (cat.includes('industrial')) irrigablePct = 0.15;
  else irrigablePct = 0.30;

  const irrigableAcres = lotAcres * irrigablePct;
  if (irrigableAcres <= 0) return null;

  // $2,400/irrigable acre/year for system maintenance
  const maintenanceRate = 2400;
  const annualValue = round(irrigableAcres * maintenanceRate);

  if (annualValue < 400) return null;

  return {
    annualValue,
    confidence: confidence(lotSqft > 0, input.assetCategory !== null),
    rationale: `${irrigableAcres.toFixed(1)}ac irrigable (${Math.round(irrigablePct * 100)}% of ${acres(lotSqft)}ac) × $${maintenanceRate.toLocaleString()}/ac`,
  };
}

// Conditional: pool & water features
function estimatePoolWaterFeatures(input: RevenueEstimationInput): ServiceEstimate | null {
  // Only estimate for hospitality, multifamily, and special purpose
  const cat = input.assetCategory?.toLowerCase() || '';
  if (!cat.includes('hospitality') && !cat.includes('multifamily') && !cat.includes('special')) {
    return null;
  }

  const classMult = classMultiplier(input.calculatedBuildingClass);
  const base = 6000; // typical annual pool maintenance contract
  const annualValue = round(base * classMult);

  return {
    annualValue,
    confidence: 'low',
    rationale: `${input.assetCategory} property — pool likely present`,
  };
}

// ── Main Estimator ─────────────────────────────────────────────────

const ESTIMATORS: Record<ServiceCategory, (input: RevenueEstimationInput) => ServiceEstimate | null> = {
  landscaping: estimateLandscaping,
  tree_trimming: estimateTreeTrimming,
  irrigation: estimateIrrigation,
  janitorial: estimateJanitorial,
  hvac: estimateHvac,
  security: estimateSecurity,
  waste_management: estimateWasteManagement,
  elevator: estimateElevator,
  roofing: estimateRoofing,
  plumbing: estimatePlumbing,
  electrical: estimateElectrical,
  fire_protection: estimateFireProtection,
  parking_pavement: estimateParkingPavement,
  pest_control: estimatePestControl,
  window_cleaning: estimateWindowCleaning,
  snow_ice_removal: estimateSnowIce,
  pool_water_features: estimatePoolWaterFeatures,
};

function assessInputQuality(input: RevenueEstimationInput): 'good' | 'fair' | 'poor' {
  let score = 0;
  if (input.lotSqft && input.lotSqft > 0) score++;
  if (input.buildingSqft && input.buildingSqft > 0) score++;
  if (input.calculatedBuildingClass) score++;
  if (input.assetCategory) score++;
  if (input.numFloors && input.numFloors > 0) score++;

  if (score >= 4) return 'good';
  if (score >= 2) return 'fair';
  return 'poor';
}

export function estimateRevenue(input: RevenueEstimationInput): RevenueEstimationResult {
  const estimates: Partial<Record<ServiceCategory, ServiceEstimate>> = {};
  let totalAllServices = 0;

  for (const service of SERVICE_CATEGORIES) {
    const estimator = ESTIMATORS[service];
    if (!estimator) continue;
    const result = estimator(input);
    if (result) {
      estimates[service] = result;
      totalAllServices += result.annualValue;
    }
  }

  const { permeableRatio } = derivePermeableArea(input);

  return {
    estimates,
    totalAllServices,
    permeableAreaRatio: input.lotSqft && input.lotSqft > 0 ? permeableRatio : null,
    inputQuality: assessInputQuality(input),
  };
}

/**
 * Sum only the estimates for services the user has selected.
 * Handles both DB format ({ landscaping: 18500, ... }) and
 * in-memory format ({ landscaping: { annualValue: 18500, ... }, ... }).
 */
// ── Property Suitability (Epic 19) ──────────────────────────────

const UNSUITABLE_SUBCATEGORIES: Record<string, string[]> = {
  tree_trimming: [
    'Parking Garage', 'Warehouse', 'Data Center', 'Self Storage',
    'Cold Storage', 'Manufacturing', 'Distribution Center',
  ],
  irrigation: [
    'Parking Garage', 'Warehouse', 'Data Center', 'Self Storage',
    'Cold Storage', 'Manufacturing', 'Distribution Center',
  ],
};

export interface SuitabilityResult {
  suitable: boolean;
  reason?: string;
}

export function checkPropertySuitability(
  service: string,
  assetCategory: string | null,
  assetSubcategory: string | null,
  lotSqft: number | null,
): SuitabilityResult {
  const unsuitableSubs = UNSUITABLE_SUBCATEGORIES[service];
  if (unsuitableSubs && assetSubcategory && unsuitableSubs.includes(assetSubcategory)) {
    return { suitable: false, reason: `${assetSubcategory} properties typically don't require ${service.replace(/_/g, ' ')}` };
  }

  // Outdoor services need meaningful lot area
  if (['tree_trimming', 'irrigation', 'landscaping'].includes(service)) {
    if (lotSqft != null && lotSqft < 2000) {
      return { suitable: false, reason: 'Lot size too small for outdoor services' };
    }
  }

  return { suitable: true };
}

// ── Residential Estimation (Epic 14) ────────────────────────────

const RESIDENTIAL_SERVICES: ServiceCategory[] = [
  'landscaping', 'tree_trimming', 'irrigation', 'pest_control',
] as ServiceCategory[];

export function estimateResidentialRevenue(input: RevenueEstimationInput): RevenueEstimationResult {
  const estimates: Partial<Record<ServiceCategory, ServiceEstimate>> = {};
  let totalAllServices = 0;

  for (const service of RESIDENTIAL_SERVICES) {
    const estimator = ESTIMATORS[service];
    if (!estimator) continue;
    const result = estimator(input);
    if (result) {
      estimates[service] = result;
      totalAllServices += result.annualValue;
    }
  }

  const { permeableRatio } = derivePermeableArea(input);

  return {
    estimates,
    totalAllServices,
    permeableAreaRatio: input.lotSqft && input.lotSqft > 0 ? permeableRatio : null,
    inputQuality: assessInputQuality(input),
  };
}

export function computeUserRevenueTotal(
  estimates: Record<string, number | { annualValue: number }> | null | undefined,
  selectedServices: string[] | null | undefined,
): number {
  if (!estimates || !selectedServices || selectedServices.length === 0) return 0;
  let total = 0;
  for (const svc of selectedServices) {
    const est = estimates[svc];
    if (est == null) continue;
    total += typeof est === 'number' ? est : est.annualValue;
  }
  return total;
}
