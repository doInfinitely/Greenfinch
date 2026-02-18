export interface LinkedInSearchResult {
  name: string;
  title: string;
  url: string;
  company?: string;
  location?: string;
  confidence: number;
}

export interface PropertyRelation {
  id: string;
  propertyKey: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  commonName: string | null;
  assetCategory: string | null;
  role: string | null;
  confidenceScore: number | null;
}

export interface OrgRelation {
  id: string;
  name: string | null;
  domain: string | null;
  orgType: string | null;
  title: string | null;
  isCurrent: boolean | null;
}

export interface Contact {
  id: string;
  fullName: string | null;
  normalizedName: string | null;
  nameConfidence: number | null;
  email: string | null;
  normalizedEmail: string | null;
  emailConfidence: number | null;
  emailStatus: string | null;
  emailValidationStatus: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  phoneConfidence: number | null;
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
  phoneSource: string | null;
  phoneExtension: string | null;
  aiPhone: string | null;
  aiPhoneLabel: string | null;
  enrichmentPhoneWork: string | null;
  enrichmentPhonePersonal: string | null;
  title: string | null;
  titleConfidence: number | null;
  companyDomain: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinConfidence: number | null;
  linkedinStatus: string | null;
  linkedinSearchResults: LinkedInSearchResult[] | null;
  linkedinFlagged: boolean | null;
  contactType: 'individual' | 'general' | null;
  source: string | null;
  needsReview: boolean | null;
  reviewReason: string | null;
  photoUrl: string | null;
  location: string | null;
  providerId: string | null;
  enrichmentSource: string | null;
  enrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
