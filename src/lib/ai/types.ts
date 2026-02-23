// ============================================================================
// AI Enrichment — Shared Types
//
// All interfaces and type aliases used across the AI enrichment pipeline.
// Every stage, the pipeline orchestrator, and external consumers reference
// these types — keep them stable and document any changes carefully.
// ============================================================================

/** Raw response shape returned by streamGeminiResponse after consuming a stream. */
export interface StreamedGeminiResponse {
  text: string;
  candidates?: any[];
}

/** A single web source cited by Gemini's search grounding metadata. */
export interface GroundedSource {
  url: string;
  title: string;
}

/** Wrapper that pairs stage output data with a human-readable summary and sources. */
export interface StageResult<T> {
  data: T;
  summary: string;
  sources: GroundedSource[];
}

/** Physical measurements extracted or confirmed during Stage 1. */
export interface PropertyPhysicalData {
  lotAcres: number | null;
  lotAcresConfidence: number | null;
  netSqft: number | null;
  netSqftConfidence: number | null;
}

/** Category, class, and naming info determined during Stage 1. */
export interface PropertyClassification {
  propertyName: string;
  canonicalAddress: string;
  category: string;
  subcategory: string;
  confidence: number;
  propertyClass: string | null;
  propertyClassConfidence: number | null;
}

/** Combined Stage 1 output: both physical data and classification in one object. */
export interface PropertyDataAndClassification {
  physical: PropertyPhysicalData;
  classification: PropertyClassification;
}

/** Stage 2 output: beneficial owner, management company, and property web presence. */
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

/** Final merged contact record returned after Stage 3a + 3b + post-processing. */
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

/** A grounded source annotated with a trust tier for downstream ranking. */
export interface ScoredSource extends GroundedSource {
  trustTier: 'high' | 'medium' | 'low';
}

/** Raw contact record from Stage 3a before email/phone enrichment. */
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

/** Per-contact result from Stage 3b (email/phone lookup). */
export interface ContactEnrichmentResult {
  email: string | null;
  emailSource: 'ai_discovered' | null;
  phone: string | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneConfidence: number | null;
  location: string | null;
  enrichmentSources: GroundedSource[];
}

/** Full pipeline output returned by runFocusedEnrichment. */
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

/** Which pipeline stage is currently active or last completed. */
export type EnrichmentStage = 'classification' | 'ownership' | 'contacts' | 'cascade_orgs' | 'cascade_contacts' | 'complete';

/** Snapshot of pipeline progress — used to resume after partial failures. */
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
