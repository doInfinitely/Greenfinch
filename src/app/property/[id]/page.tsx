'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Header from '@/components/Header';
import AddToListModal from '@/components/AddToListModal';
import EnrichmentModal from '@/components/EnrichmentModal';

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

const MapCanvas = dynamic(() => import('@/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center rounded-lg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
    </div>
  ),
});

interface Property {
  propertyKey: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  lat: number;
  lon: number;
  lotAcres: number;
  yearBuilt: number | null;
  numFloors: number | null;
  buildingSqft: number | null;
  totalParval: number;
  totalImprovval: number;
  landval: number;
  allOwners: string[];
  primaryOwner: string | null;
  usedesc: string[];
  usecode: string[];
  parcelCount: number;
}

interface EnrichedPropertyData {
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
  propertyManagerWebsite: string | null;
  aiRationale: string | null;
  lastEnrichedAt: string | null;
}

interface Contact {
  id: string;
  fullName: string;
  normalizedName?: string;
  nameConfidence: number;
  email: string | null;
  normalizedEmail?: string | null;
  emailConfidence: number | null;
  phone: string | null;
  phoneConfidence: number | null;
  title: string | null;
  titleConfidence: number | null;
  companyDomain: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinConfidence: number | null;
  role: string;
  roleConfidence: number;
  source?: string;
  needsReview?: boolean;
  reviewReason?: string | null;
  emailValidationStatus?: 'valid' | 'invalid' | 'pending' | 'not_validated';
}

interface Organization {
  id: string;
  name: string;
  domain: string | null;
  orgType: string;
  role: string;
}

type EnrichmentStatusType = 'not_enriched' | 'pending' | 'completed' | 'failed';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  property_manager: 'Property Manager',
  facilities_manager: 'Facilities Manager',
  leasing: 'Leasing',
  other: 'Other',
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  property_manager: 'bg-blue-100 text-blue-700',
  facilities_manager: 'bg-orange-100 text-orange-700',
  leasing: 'bg-teal-100 text-teal-700',
  other: 'bg-gray-100 text-gray-700',
};

const ORG_TYPE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  management: 'bg-blue-100 text-blue-700',
  tenant: 'bg-green-100 text-green-700',
  developer: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

function getConfidenceColor(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) return 'bg-gray-100 text-gray-500';
  if (confidence > 0.9) return 'bg-green-100 text-green-700';
  if (confidence >= 0.75) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

function getConfidenceLabel(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) return 'N/A';
  if (confidence > 0.9) return 'High';
  if (confidence >= 0.75) return 'Medium';
  return 'Low';
}

function ConfidenceBadge({ confidence, label }: { confidence: number | null | undefined; label?: string }) {
  const colorClass = getConfidenceColor(confidence);
  const displayLabel = label || getConfidenceLabel(confidence);
  const percentage = confidence !== null && confidence !== undefined ? Math.round(confidence * 100) : null;
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {displayLabel}{percentage !== null && ` (${percentage}%)`}
    </span>
  );
}

function EnrichmentStatusBadge({ status }: { status: EnrichmentStatusType }) {
  const config: Record<EnrichmentStatusType, { color: string; label: string }> = {
    not_enriched: { color: 'bg-gray-100 text-gray-600', label: 'Not Researched' },
    pending: { color: 'bg-yellow-100 text-yellow-700', label: 'Researching...' },
    completed: { color: 'bg-green-100 text-green-700', label: 'Researched with AI' },
    failed: { color: 'bg-red-100 text-red-700', label: 'Research Failed' },
  };
  
  const { color, label } = config[status];
  
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      {status === 'completed' && (
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {status === 'pending' && (
        <div className="w-3 h-3 mr-1 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin"></div>
      )}
      {label}
    </span>
  );
}

function EmailValidationBadge({ status }: { status: Contact['emailValidationStatus'] }) {
  const config: Record<NonNullable<Contact['emailValidationStatus']>, { color: string; label: string }> = {
    valid: { color: 'bg-green-100 text-green-700', label: 'Valid' },
    invalid: { color: 'bg-red-100 text-red-700', label: 'Invalid' },
    pending: { color: 'bg-yellow-100 text-yellow-700', label: 'Validating...' },
    not_validated: { color: 'bg-gray-100 text-gray-500', label: 'Not Validated' },
  };
  
  const { color, label } = config[status || 'not_validated'];
  
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${color}`}>
      {label}
    </span>
  );
}

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params?.id as string;

  const [property, setProperty] = useState<Property | null>(null);
  const [enrichedProperty, setEnrichedProperty] = useState<EnrichedPropertyData | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatusType>('not_enriched');
  const [enrichmentMessage, setEnrichmentMessage] = useState<string>('');
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [validatingEmails, setValidatingEmails] = useState<Set<string>>(new Set());
  const [mapToken, setMapToken] = useState<string>('');
  const [regridToken, setRegridToken] = useState<string>('');

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  const formatLotSize = (acres: number) => {
    return acres.toFixed(1);
  };

  const formatBuildingSqft = (sqft: number) => {
    if (sqft >= 1000) {
      const k = sqft / 1000;
      return sqft < 19000 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
    }
    return sqft.toString();
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/user');
        const data = await response.json();
        if (data.user?.id) {
          setUserId(data.user.id);
        }
      } catch (err) {
        console.error('Failed to fetch user:', err);
      }
    };
    fetchUser();
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.mapboxToken) setMapToken(data.mapboxToken);
        if (data.regridToken) setRegridToken(data.regridToken);
      })
      .catch(err => console.error('Failed to load map config:', err));
  }, []);

  useEffect(() => {
    if (!propertyId) return;

    const fetchProperty = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/properties/${propertyId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch property');
        }

        // Handle Postgres response structure (with enrichment data)
        if (data.source === 'postgres') {
          const prop = data.property;
          const rawParcels = Array.isArray(prop.rawParcelsJson) ? prop.rawParcelsJson : [];
          
          // Collect owners from raw parcels for display (deduplicated, uppercase normalized)
          const ownersSet = new Set<string>();
          const usedescSet = new Set<string>();
          for (const parcel of rawParcels) {
            if (parcel.owner) ownersSet.add(parcel.owner.toUpperCase());
            if (parcel.owner2) ownersSet.add(parcel.owner2.toUpperCase());
            if (parcel.usedesc) usedescSet.add(parcel.usedesc);
          }
          
          // Also include property-level owners (normalized to uppercase for deduplication)
          if (prop.regridOwner) ownersSet.add(prop.regridOwner.toUpperCase());
          if (prop.regridOwner2) ownersSet.add(prop.regridOwner2.toUpperCase());
          
          // Use pre-aggregated values from properties table (source of truth)
          const lotAcres = prop.lotSqft ? prop.lotSqft / 43560 : 0;
          
          setProperty({
            propertyKey: prop.propertyKey,
            address: prop.address || prop.validatedAddress || prop.regridAddress || '',
            city: prop.city || '',
            state: prop.state || 'TX',
            zip: prop.zip || '',
            county: prop.county || '',
            lat: prop.lat || 0,
            lon: prop.lon || 0,
            lotAcres: lotAcres,
            yearBuilt: prop.yearBuilt || null,
            numFloors: prop.numFloors || null,
            buildingSqft: prop.buildingSqft || null,
            totalParval: 0,
            totalImprovval: 0,
            landval: 0,
            allOwners: Array.from(ownersSet),
            primaryOwner: prop.regridOwner || null,
            usedesc: Array.from(usedescSet),
            usecode: [],
            parcelCount: rawParcels.length || 1,
          });

          // Set enriched data if any enrichment fields are present
          const hasEnrichedData = prop.assetCategory || prop.commonName || prop.beneficialOwner || prop.managementCompany;
          if (hasEnrichedData) {
            setEnrichedProperty({
              assetCategory: prop.assetCategory,
              assetSubcategory: prop.assetSubcategory,
              categoryConfidence: prop.categoryConfidence,
              commonName: prop.commonName,
              commonNameConfidence: prop.commonNameConfidence,
              beneficialOwner: prop.beneficialOwner,
              beneficialOwnerConfidence: prop.beneficialOwnerConfidence,
              beneficialOwnerType: prop.beneficialOwnerType,
              managementType: prop.managementType,
              managementCompany: prop.managementCompany,
              managementCompanyDomain: prop.managementCompanyDomain,
              managementConfidence: prop.managementConfidence,
              propertyWebsite: prop.propertyWebsite,
              propertyManagerWebsite: prop.propertyManagerWebsite,
              aiRationale: prop.aiRationale,
              lastEnrichedAt: prop.lastEnrichedAt,
            });
          }
          if (prop.enrichmentStatus === 'completed') {
            setEnrichmentStatus('completed');
          }

          // Set contacts and organizations if available
          if (data.contacts && data.contacts.length > 0) {
            setContacts(data.contacts.map((c: any) => ({
              ...c,
              emailValidationStatus: c.emailValidationStatus || 'not_validated',
            })));
          }
          if (data.organizations && data.organizations.length > 0) {
            setOrganizations(data.organizations);
          }
        } else {
          // Snowflake response (original format) - convert lotSqft to lotAcres
          const snowflakeProp = data.property;
          setProperty({
            ...snowflakeProp,
            lotAcres: snowflakeProp.lotSqft ? snowflakeProp.lotSqft / 43560 : 0,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProperty();
  }, [propertyId]);

  const handleEnrichment = async () => {
    if (!property) return;

    setIsEnriching(true);
    setEnrichmentStatus('pending');
    setEnrichmentMessage('');

    try {
      const response = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyKey: property.propertyKey,
          storeResults: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Enrichment failed');
      }

      if (data.enrichment) {
        setEnrichedProperty(data.enrichment.property || null);
        setContacts((data.enrichment.contacts || []).map((c: Contact) => ({
          ...c,
          emailValidationStatus: 'not_validated' as const,
        })));
        setOrganizations(data.enrichment.organizations || []);
        setEnrichmentStatus('completed');
        setEnrichmentMessage(`Found ${data.enrichment.contacts?.length || 0} contacts and ${data.enrichment.organizations?.length || 0} organizations`);
      }
    } catch (err) {
      setEnrichmentStatus('failed');
      setEnrichmentMessage(err instanceof Error ? err.message : 'Enrichment failed');
    } finally {
      setIsEnriching(false);
    }
  };

  const handleValidateEmail = async (contact: Contact) => {
    if (!contact.email || !contact.id) return;

    setValidatingEmails(prev => new Set(prev).add(contact.id));
    setContacts(prev => prev.map(c => 
      c.id === contact.id ? { ...c, emailValidationStatus: 'pending' as const } : c
    ));

    try {
      const response = await fetch('/api/validate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contact.email }),
      });

      const data = await response.json();

      if (response.ok && data.result) {
        setContacts(prev => prev.map(c => 
          c.id === contact.id 
            ? { ...c, emailValidationStatus: data.result.isValid ? 'valid' as const : 'invalid' as const }
            : c
        ));
      } else {
        setContacts(prev => prev.map(c => 
          c.id === contact.id ? { ...c, emailValidationStatus: 'not_validated' as const } : c
        ));
      }
    } catch (err) {
      console.error('Email validation failed:', err);
      setContacts(prev => prev.map(c => 
        c.id === contact.id ? { ...c, emailValidationStatus: 'not_validated' as const } : c
      ));
    } finally {
      setValidatingEmails(prev => {
        const next = new Set(prev);
        next.delete(contact.id);
        return next;
      });
    }
  };

  const handleAddToList = () => {
    setShowAddToListModal(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading property details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Property</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Property Not Found</h2>
          <p className="text-gray-600 mb-6">The property you're looking for doesn't exist.</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showBackButton onBack={() => router.back()} />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div>
                  {enrichedProperty?.commonName && (
                    <div className="mb-1">
                      <h1 className="text-2xl font-bold text-gray-900">
                        {enrichedProperty.commonName}
                      </h1>
                    </div>
                  )}
                  <p className={`${enrichedProperty?.commonName ? 'text-lg text-gray-600' : 'text-2xl font-bold text-gray-900'} mb-1`}>
                    {property.address || 'No Address'}
                  </p>
                  <p className="text-gray-600">
                    {property.city}, {property.state} {property.zip}
                  </p>
                  {property.county && (
                    <p className="text-sm text-gray-500">{property.county} County</p>
                  )}
                  
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <EnrichmentStatusBadge status={enrichmentStatus} />
                    {enrichedProperty?.assetCategory && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {enrichedProperty.assetCategory}
                      </span>
                    )}
                    {enrichedProperty?.assetSubcategory && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                        {enrichedProperty.assetSubcategory}
                      </span>
                    )}
                    {enrichedProperty?.categoryConfidence !== null && enrichedProperty?.categoryConfidence !== undefined && enrichedProperty.categoryConfidence < 0.70 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                        Low Confidence
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {enrichmentStatus !== 'completed' && (
                    <button
                      onClick={handleEnrichment}
                      disabled={isEnriching}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
                      data-testid="button-find-decision-makers"
                    >
                      {isEnriching ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Finding...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          Find Decision Makers
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleAddToList}
                    disabled={!userId}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add to List
                  </button>
                </div>
              </div>

              {enrichmentMessage && (
                <div className={`mb-6 p-3 rounded-lg ${enrichmentStatus === 'completed' ? 'bg-green-50 text-green-700' : enrichmentStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                  <p className="text-sm">{enrichmentMessage}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Lot Size</p>
                  <p className="text-xl font-semibold text-green-700">
                    {property.lotAcres && property.lotAcres > 0 ? `${formatLotSize(property.lotAcres)} acres` : 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Year Built</p>
                  <p className="text-xl font-semibold text-gray-800">
                    {property.yearBuilt || 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Building Size</p>
                  <p className="text-xl font-semibold text-gray-800">
                    {property.buildingSqft && property.buildingSqft > 0 ? `${formatBuildingSqft(property.buildingSqft)} sq ft` : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                {property.numFloors && property.numFloors > 1 && (
                  <span><span className="font-medium">{property.numFloors}</span> floors</span>
                )}
                {!enrichedProperty?.assetCategory && property.usedesc && property.usedesc.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {property.usedesc.slice(0, 3).map((desc, i) => (
                      <span key={i} className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                        {desc}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Ownership & Management</h2>
              
              {enrichedProperty?.beneficialOwner && (
                <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-purple-700 mb-1">Beneficial Owner</p>
                      <p className="font-medium text-gray-900">{enrichedProperty.beneficialOwner}</p>
                      {enrichedProperty.beneficialOwnerType && (
                        <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                          {enrichedProperty.beneficialOwnerType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {enrichedProperty?.managementCompany && (
                <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-700 mb-1">Management Company</p>
                      <p className="font-medium text-gray-900">{enrichedProperty.managementCompany}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {enrichedProperty.managementType && (
                          <span className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                            {enrichedProperty.managementType.replace('_', ' ')}
                          </span>
                        )}
                        {enrichedProperty.managementCompanyDomain && (
                          <a 
                            href={`https://${enrichedProperty.managementCompanyDomain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {enrichedProperty.managementCompanyDomain}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {property.allOwners && property.allOwners.length > 0 && (
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer py-2 text-sm text-gray-600 hover:text-gray-800">
                    <span className="font-medium">Registered Owners ({property.allOwners.length})</span>
                    <svg className="w-4 h-4 transform transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {property.allOwners.map((owner, i) => (
                      <div key={i} className="flex items-center space-x-2 p-2 bg-gray-50 rounded text-sm">
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-gray-700">{toTitleCase(owner)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {!enrichedProperty?.beneficialOwner && !enrichedProperty?.managementCompany && (!property.allOwners || property.allOwners.length === 0) && (
                <p className="text-gray-500">No ownership information available</p>
              )}
            </div>

            {enrichmentStatus === 'completed' && enrichedProperty && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Enrichment Details</h2>
                
                <div className="space-y-4">
                  {enrichedProperty.lastEnrichedAt && (
                    <div className="flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-gray-500">Last Researched:</span>
                      <span className="text-gray-900">{new Date(enrichedProperty.lastEnrichedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                    </div>
                  )}

                  {(enrichedProperty.propertyWebsite || enrichedProperty.propertyManagerWebsite) && (
                    <div className="flex flex-wrap gap-3">
                      {enrichedProperty.propertyWebsite && (
                        <a
                          href={enrichedProperty.propertyWebsite.startsWith('http') ? enrichedProperty.propertyWebsite : `https://${enrichedProperty.propertyWebsite}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                          </svg>
                          Property Website
                        </a>
                      )}
                      {enrichedProperty.propertyManagerWebsite && (
                        <a
                          href={enrichedProperty.propertyManagerWebsite.startsWith('http') ? enrichedProperty.propertyManagerWebsite : `https://${enrichedProperty.propertyManagerWebsite}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          Manager Website
                        </a>
                      )}
                    </div>
                  )}

                  {enrichedProperty.aiRationale && (
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-sm font-medium text-gray-700 mb-2">Classification Rationale</p>
                      <p className="text-sm text-gray-600">{enrichedProperty.aiRationale}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Contacts ({contacts.length})
              </h2>
              {contacts.length > 0 ? (
                <div className="space-y-3">
                  {contacts.map((contact, i) => (
                    <div key={`${contact.id || contact.email}-${i}`} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-green-700 font-medium text-sm">
                            {contact.fullName?.charAt(0) || '?'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center flex-wrap gap-2 mb-1">
                            <p className="font-medium text-gray-900">{contact.fullName}</p>
                            {contact.role && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[contact.role] || ROLE_COLORS.other}`}>
                                {ROLE_LABELS[contact.role] || contact.role}
                              </span>
                            )}
                          </div>
                          
                          {contact.title && (
                            <p className="text-sm text-gray-600 mb-1">{contact.title}</p>
                          )}
                          
                          <div className="flex flex-wrap items-center gap-3 mt-2">
                            {contact.email ? (
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                <a href={`mailto:${contact.email}`} className="text-sm text-green-600 hover:text-green-700">
                                  {contact.email}
                                </a>
                                <EmailValidationBadge status={contact.emailValidationStatus} />
                                {contact.emailValidationStatus !== 'valid' && contact.emailValidationStatus !== 'pending' && (
                                  <button
                                    onClick={() => handleValidateEmail(contact)}
                                    disabled={validatingEmails.has(contact.id)}
                                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
                                  >
                                    Validate
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                No email
                              </span>
                            )}
                            
                            {contact.phone ? (
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                                <a href={`tel:${contact.phone}`} className="text-sm text-gray-600 hover:text-gray-800">
                                  {contact.phone}
                                </a>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                                No phone
                              </span>
                            )}
                            
                            {contact.linkedinUrl ? (
                              <a
                                href={contact.linkedinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                              >
                                <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                                </svg>
                                LinkedIn
                              </a>
                            ) : (
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                                </svg>
                                No LinkedIn
                              </span>
                            )}
                            
                            {contact.id && (
                              <Link
                                href={`/contact/${contact.id}`}
                                className="text-xs text-green-600 hover:text-green-700 hover:underline ml-auto"
                              >
                                View Details →
                              </Link>
                            )}
                          </div>
                          
                          {contact.employerName && (
                            <p className="text-xs text-gray-500 mt-2">
                              Works at: {contact.employerName}
                              {contact.companyDomain && (
                                <a 
                                  href={`https://${contact.companyDomain}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-1 text-blue-600 hover:underline"
                                >
                                  ({contact.companyDomain})
                                </a>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <p className="text-gray-500 mb-3">No contacts discovered yet</p>
                  <button
                    onClick={handleEnrichment}
                    disabled={isEnriching}
                    className="text-sm text-green-600 hover:text-green-700"
                  >
                    Click "Find Decision Makers" to discover contacts
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Organizations ({organizations.length})
              </h2>
              {organizations.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {organizations.map((org) => (
                    <div key={org.id || org.domain || org.name} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-medium text-gray-900">{org.name}</p>
                        {org.orgType && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ORG_TYPE_COLORS[org.orgType] || ORG_TYPE_COLORS.other}`}>
                            {org.orgType}
                          </span>
                        )}
                      </div>
                      {org.domain && (
                        <a 
                          href={`https://${org.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {org.domain}
                        </a>
                      )}
                      {org.role && (
                        <p className="text-sm text-gray-500 mt-1">{org.role}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <p className="text-gray-500">No organizations discovered yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden sticky top-20">
              <div className="h-64 lg:h-96">
                {property.lat && property.lon && mapToken ? (
                  <MapCanvas
                    accessToken={mapToken}
                    regridToken={regridToken}
                    initialCenter={{ lat: property.lat, lon: property.lon }}
                    initialZoom={16}
                    properties={[{
                      type: 'Feature',
                      geometry: {
                        type: 'Point',
                        coordinates: [property.lon, property.lat],
                      },
                      properties: {
                        propertyKey: property.propertyKey,
                        address: property.address,
                        commonName: enrichedProperty?.commonName || null,
                      },
                    }]}
                  />
                ) : property.lat && property.lon ? (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                  </div>
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <p className="text-gray-500">No location data available</p>
                  </div>
                )}
              </div>
              <div className="p-4 border-t border-gray-100">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Coordinates:</span>{' '}
                  {property.lat?.toFixed(6)}, {property.lon?.toFixed(6)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {property && (
        <AddToListModal
          isOpen={showAddToListModal}
          onClose={() => setShowAddToListModal(false)}
          itemId={propertyId}
          itemType="properties"
        />
      )}

      <EnrichmentModal
        isOpen={isEnriching}
        propertyName={enrichedProperty?.commonName || property?.address}
      />
    </div>
  );
}
