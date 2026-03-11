import type { FilterState } from '@/components/PropertyFilters';
import { emptyFilters } from '@/components/PropertyFilters';
import type { ServiceCategory } from '@/lib/schema';

/**
 * Maps each service category to recommended default filter values.
 * Only non-empty/non-null fields are specified — they get merged onto emptyFilters.
 */
const SEGMENT_FILTER_DEFAULTS: Record<ServiceCategory, Partial<FilterState>> = {
  landscaping: {
    categories: ['Office', 'Retail', 'Multifamily', 'Hospitality', 'Public & Institutional', 'Healthcare'],
    minLotAcres: 0.5,
  },
  tree_trimming: {
    categories: ['Office', 'Retail', 'Multifamily', 'Hospitality', 'Public & Institutional', 'Healthcare'],
    minLotAcres: 0.5,
  },
  irrigation: {
    categories: ['Office', 'Retail', 'Multifamily', 'Hospitality', 'Public & Institutional', 'Healthcare'],
    minLotAcres: 0.25,
  },
  janitorial: {
    categories: ['Office', 'Retail', 'Healthcare', 'Hospitality', 'Public & Institutional'],
    minNetSqft: 5000,
  },
  hvac: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily'],
    minNetSqft: 5000,
  },
  security: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  waste_management: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  elevator: {
    categories: ['Office', 'Retail', 'Healthcare', 'Hospitality', 'Multifamily'],
    buildingClasses: ['A+', 'A', 'B'],
  },
  roofing: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  plumbing: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  electrical: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  fire_protection: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  parking_pavement: {
    categories: ['Office', 'Retail', 'Industrial', 'Multifamily', 'Hospitality'],
    minLotAcres: 0.5,
  },
  pest_control: {
    categories: ['Office', 'Retail', 'Industrial', 'Healthcare', 'Hospitality', 'Multifamily', 'Public & Institutional'],
  },
  window_cleaning: {
    categories: ['Office', 'Retail', 'Healthcare', 'Hospitality'],
    buildingClasses: ['A+', 'A', 'B'],
  },
  snow_ice_removal: {
    categories: ['Office', 'Retail', 'Industrial', 'Public & Institutional', 'Multifamily'],
    minLotAcres: 0.25,
  },
  pool_water_features: {
    categories: ['Hospitality', 'Multifamily', 'Special Purpose'],
  },
};

/**
 * Merge segment defaults for one or more selected services.
 * - Array fields (categories, buildingClasses): union of all unique values
 * - Numeric minimums (minLotAcres, minNetSqft): smallest non-null value wins
 * - Everything else falls back to emptyFilters
 */
export function mergeSegmentDefaults(services: string[]): FilterState {
  const validServices = services.filter(
    (s): s is ServiceCategory => s in SEGMENT_FILTER_DEFAULTS
  );

  if (validServices.length === 0) {
    return { ...emptyFilters };
  }

  const allCategories = new Set<string>();
  const allBuildingClasses = new Set<string>();
  let minLotAcres: number | null = null;
  let minNetSqft: number | null = null;

  for (const service of validServices) {
    const defaults = SEGMENT_FILTER_DEFAULTS[service];

    if (defaults.categories) {
      for (const c of defaults.categories) allCategories.add(c);
    }
    if (defaults.buildingClasses) {
      for (const b of defaults.buildingClasses) allBuildingClasses.add(b);
    }
    if (defaults.minLotAcres != null) {
      minLotAcres = minLotAcres == null
        ? defaults.minLotAcres
        : Math.min(minLotAcres, defaults.minLotAcres);
    }
    if (defaults.minNetSqft != null) {
      minNetSqft = minNetSqft == null
        ? defaults.minNetSqft
        : Math.min(minNetSqft, defaults.minNetSqft);
    }
  }

  return {
    ...emptyFilters,
    categories: Array.from(allCategories),
    buildingClasses: Array.from(allBuildingClasses),
    minLotAcres,
    minNetSqft,
    minLotSqft: minLotAcres != null ? Math.round(minLotAcres * 43560) : null,
  };
}
