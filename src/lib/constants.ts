export const ASSET_CATEGORIES: Record<string, string[]> = {
  "Single-Family Residential": ["Single Family Home", "Townhouse", "Condominium", "Mobile Home", "Other Residential"],
  "Multifamily": ["Apartment Complex", "Duplex/Triplex/Quadplex", "Mobile Home Park", "Senior Living", "Other Multifamily"],
  "Office": ["Office Building", "Medical Office", "Business Park", "Flex Office", "Other Office"],
  "Retail": ["Shopping Center", "Restaurant/Food Service", "Convenience/Gas Station", "Standalone Retail", "Other Retail"],
  "Industrial": ["Warehouse/Distribution", "Manufacturing", "Flex/Light Industrial", "Self-Storage", "Other Industrial"],
  "Hospitality": ["Hotel", "Motel", "Resort", "Extended Stay", "Other Hospitality"],
  "Healthcare": ["Hospital", "Medical Center", "Assisted Living", "Outpatient Clinic", "Other Healthcare"],
  "Public & Institutional": ["Government", "School/University", "Religious", "Recreation/Parks", "Other Institutional"],
  "Mixed Use": ["Retail/Residential", "Office/Retail", "Office/Residential", "Commercial/Industrial", "Other Mixed Use"],
  "Vacant Land": ["Commercial Land", "Industrial Land", "Residential Land", "Agricultural Land", "Other Vacant Land"],
  "Agricultural": ["Farm/Ranch", "Vineyard/Orchard", "Greenhouse/Nursery", "Livestock", "Other Agricultural"],
  "Special Purpose": ["Parking", "Sports/Fitness", "Entertainment", "Auto Service", "Other Special Purpose"]
};

// Category color configuration for consistent visual hierarchy across the app
// Each category has a primary (category badge) and secondary (subcategory badge) color scheme
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; subBg: string; subText: string }> = {
  "Retail": { bg: "bg-blue-100", text: "text-blue-800", subBg: "bg-blue-50", subText: "text-blue-600" },
  "Multifamily": { bg: "bg-purple-100", text: "text-purple-800", subBg: "bg-purple-50", subText: "text-purple-600" },
  "Office": { bg: "bg-emerald-100", text: "text-emerald-800", subBg: "bg-emerald-50", subText: "text-emerald-600" },
  "Industrial": { bg: "bg-amber-100", text: "text-amber-800", subBg: "bg-amber-50", subText: "text-amber-600" },
  "Hospitality": { bg: "bg-rose-100", text: "text-rose-800", subBg: "bg-rose-50", subText: "text-rose-600" },
  "Healthcare": { bg: "bg-cyan-100", text: "text-cyan-800", subBg: "bg-cyan-50", subText: "text-cyan-600" },
  "Mixed Use": { bg: "bg-indigo-100", text: "text-indigo-800", subBg: "bg-indigo-50", subText: "text-indigo-600" },
  "Special Purpose": { bg: "bg-orange-100", text: "text-orange-800", subBg: "bg-orange-50", subText: "text-orange-600" },
  "Public & Institutional": { bg: "bg-slate-100", text: "text-slate-800", subBg: "bg-slate-50", subText: "text-slate-600" },
  "Vacant Land": { bg: "bg-stone-100", text: "text-stone-800", subBg: "bg-stone-50", subText: "text-stone-600" },
  "Agricultural": { bg: "bg-lime-100", text: "text-lime-800", subBg: "bg-lime-50", subText: "text-lime-600" },
  "Single-Family Residential": { bg: "bg-teal-100", text: "text-teal-800", subBg: "bg-teal-50", subText: "text-teal-600" },
};

// Default colors for unknown categories
export const DEFAULT_CATEGORY_COLORS = { bg: "bg-gray-100", text: "text-gray-800", subBg: "bg-gray-50", subText: "text-gray-600" };

export const CONFIDENCE = {
  HIGH: 0.90,
  MEDIUM: 0.75,
  LOW: 0.50,
  EMAIL_THRESHOLD: 0.80,
  PHONE_THRESHOLD: 0.80,
  LINKEDIN_THRESHOLD: 0.60,
  ADDRESS_THRESHOLD: 0.80,
  GEOCODE_THRESHOLD: 0.90,
  CATEGORY_THRESHOLD: 0.75,
  COMMON_NAME_THRESHOLD: 0.70,
  BENEFICIAL_OWNER_THRESHOLD: 0.50,
  MANAGEMENT_THRESHOLD: 0.75
};

/**
 * GEMINI MODEL CONFIGURATION
 * 
 * DO NOT CHANGE THIS MODEL without explicit user approval.
 * gemini-3-flash-preview with search grounding is the only model that works reliably.
 * 
 * If you encounter empty responses, investigate the root cause rather than switching models.
 * Other models have been tested and failed for this use case.
 */
export const GEMINI_MODEL = "gemini-3-flash-preview" as const;

// Concurrency limits for parallel API calls
// Gemini Flash can handle hundreds of requests per minute
// SERP API, Hunter, NeverBounce have lower limits
export const CONCURRENCY = {
  GEMINI: 50,           // Main AI enrichment - Gemini Flash is fast
  SERP: 10,             // SERP API for LinkedIn lookups
  HUNTER: 3,            // Hunter.io email discovery - very low rate limit
  NEVERBOUNCE: 5,       // NeverBounce email validation
  PROPERTIES: 20,       // Concurrent property enrichments
};

const mvpZipEnv = process.env.MVP_ZIP || '75225';
export const MVP_ZIP_CODES = mvpZipEnv.split(',').map(z => z.trim()).filter(z => z.length > 0);
export const MVP_ZIP_CODE = MVP_ZIP_CODES[0];

// Role labels for displaying snake_case role names in Title Case
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  beneficial_owner: 'Beneficial Owner',
  property_manager: 'Property Manager',
  facilities_manager: 'Facilities Manager',
  asset_manager: 'Asset Manager',
  leasing: 'Leasing',
  leasing_agent: 'Leasing Agent',
  developer: 'Developer',
  investor: 'Investor',
  broker: 'Broker',
  tenant: 'Tenant',
  facilities: 'Facilities',
  other: 'Other',
};

// Role-specific colors for badges and tags
export const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  beneficial_owner: 'bg-purple-100 text-purple-700',
  property_manager: 'bg-blue-100 text-blue-700',
  facilities_manager: 'bg-orange-100 text-orange-700',
  asset_manager: 'bg-indigo-100 text-indigo-700',
  facilities: 'bg-orange-100 text-orange-700',
  leasing: 'bg-emerald-100 text-emerald-700',
  leasing_agent: 'bg-emerald-100 text-emerald-700',
  developer: 'bg-cyan-100 text-cyan-700',
  investor: 'bg-amber-100 text-amber-700',
  broker: 'bg-teal-100 text-teal-700',
  tenant: 'bg-gray-100 text-gray-700',
  other: 'bg-gray-100 text-gray-600',
};

// Helper function to format role label with fallback
export function formatRoleLabel(role: string): string {
  return role.split(',').map(r => {
    const trimmed = r.trim();
    return ROLE_LABELS[trimmed] || trimmed.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }).join(', ');
}
