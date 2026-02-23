// ============================================================================
// AI Enrichment — Shared Types
// All interfaces and type aliases used across the AI enrichment pipeline.
// ============================================================================

export interface StreamedGeminiResponse {
  text: string;
  candidates?: any[];
}

export interface GroundedSource {
  url: string;
  title: string;
}

export interface StageResult<T> {
  data: T;
  summary: string;
  sources: GroundedSource[];
}

export interface PropertyPhysicalData {
  lotAcres: number | null;
  lotAcresConfidence: number | null;
  netSqft: number | null;
  netSqftConfidence: number | null;
}

export interface PropertyClassification {
  propertyName: string;
  canonicalAddress: string;
  category: string;
  subcategory: string;
  confidence: number;
  propertyClass: string | null;
  propertyClassConfidence: number | null;
}

export interface PropertyDataAndClassification {
  physical: PropertyPhysicalData;
  classification: PropertyClassification;
}

export interface OwnershipInfo {
  beneficialOwner: {
    name: string | null;
    type: "REIT" | "Private Equity" | "Family Office" | "Individual" | "Corporation" | "Institutional" | "Syndicator" | null;
    domain: string | null;
    confidence: number;
  };
  managementCompany: {
    name: string | null;
    domain: string | null;
    confidence: number;
  };
  propertyWebsite: string | null;
  propertyPhone: string | null;
}

export interface DiscoveredContact {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  email: string | null;
  emailSource: 'ai_discovered' | 'hunter' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  location: string | null;
  role: string;
  roleConfidence: number;
  priorityRank: number;
  contactType: 'individual' | 'general';
}

export interface ScoredSource extends GroundedSource {
  trustTier: 'high' | 'medium' | 'low';
}

export interface IdentifiedDecisionMaker {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  role: string;
  roleConfidence: number;
  connectionEvidence: string;
  sourceUrl: string | null;
  contactType: 'individual' | 'general';
}

export interface ContactEnrichmentResult {
  email: string | null;
  emailSource: 'ai_discovered' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  location: string | null;
  enrichmentSources: GroundedSource[];
}

export interface FocusedEnrichmentResult {
  propertyKey: string;
  physical: StageResult<PropertyPhysicalData>;
  classification: StageResult<PropertyClassification>;
  ownership: StageResult<OwnershipInfo>;
  contacts: StageResult<{ contacts: DiscoveredContact[] }>;
  timing: {
    physicalMs: number;
    classificationMs: number;
    ownershipMs: number;
    contactsMs: number;
    contactIdentificationMs: number;
    contactEnrichmentMs: number;
    totalMs: number;
  };
}

export type EnrichmentStage = 'classification' | 'ownership' | 'contacts' | 'cascade_orgs' | 'cascade_contacts' | 'complete';

export interface EnrichmentStageCheckpoint {
  lastCompletedStage: EnrichmentStage | null;
  classification?: StageResult<PropertyClassification>;
  physical?: StageResult<PropertyPhysicalData>;
  ownership?: StageResult<OwnershipInfo>;
  contacts?: StageResult<{ contacts: DiscoveredContact[] }>;
  timing: Record<string, number>;
  failedStage?: string;
  failureError?: string;
  failureCount?: number;
}
