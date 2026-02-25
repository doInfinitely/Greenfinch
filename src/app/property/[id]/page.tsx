'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { X, Wrench, Maximize2, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddToListModal from '@/components/AddToListModal';
import AddContactModal from '@/components/AddContactModal';
import StreetView from '@/components/StreetView';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import PropertyNotes from '@/components/PropertyNotes';
import PropertyActivity from '@/components/PropertyActivity';
import PropertyDetailSkeleton from '@/components/PropertyDetailSkeleton';
import { normalizeCommonName } from '@/lib/normalization';
import PropertyHeader from '@/components/property/PropertyHeader';
import PropertyStats from '@/components/property/PropertyStats';
import PropertyAbout from '@/components/property/PropertyAbout';
import OwnershipSection from '@/components/property/OwnershipSection';
import ContactsSection from '@/components/property/ContactsSection';
import FlagDialog from '@/components/property/FlagDialog';
import ServiceProviderDialog from '@/components/property/ServiceProviderDialog';
import DataIssueDialog from '@/components/DataIssueDialog';
import type { Property, ConstituentProperty, EnrichedPropertyData, Contact, Organization, EnrichmentStatusType } from '@/components/property/types';

const MapCanvas = dynamic(() => import('@/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center rounded-lg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
    </div>
  ),
});

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params?.id as string;

  const [property, setProperty] = useState<Property | null>(null);
  const [propertyDbId, setPropertyDbId] = useState<string | null>(null);
  const [enrichedProperty, setEnrichedProperty] = useState<EnrichedPropertyData | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatusType>('not_enriched');
  const [enrichmentMessage, setEnrichmentMessage] = useState<string>('');
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [contactForListModal, setContactForListModal] = useState<string | null>(null);
  const [assignDialogTrigger, setAssignDialogTrigger] = useState(0);
  const [isCurrentCustomer, setIsCurrentCustomer] = useState(false);
  const { startEnrichment } = useEnrichment();
  const { getEnrichmentStatus } = useEnrichmentQueue();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const [constituentProperties, setConstituentProperties] = useState<ConstituentProperty[]>([]);
  const [showConstituents, setShowConstituents] = useState(false);
  const [parentProperty, setParentProperty] = useState<{ propertyKey: string; commonName: string | null } | null>(null);
  const [expandedMapType, setExpandedMapType] = useState<'satellite' | 'street' | null>(null);
  
  const [showFlagDialog, setShowFlagDialog] = useState(false);
  const [flagType, setFlagType] = useState<'management_company' | 'owner' | 'property_info' | 'other'>('management_company');
  const [showDataIssueDialog, setShowDataIssueDialog] = useState(false);
  
  const [showAddServiceProvider, setShowAddServiceProvider] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapToken, setMapToken] = useState<string>('');
  const [regridToken, setRegridToken] = useState<string>('');
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string>('');
  
  const [pipelineOwner, setPipelineOwner] = useState<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    displayName: string;
  } | null>(null);
  const [pipelineData, setPipelineData] = useState<{
    id?: string;
    status: string;
    dealValue: number | null;
    ownerId: string | null;
    owner: any;
  } | null>(null);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [customerLoaded, setCustomerLoaded] = useState(false);

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
    if (!propertyId) return;
    const fetchCustomerStatus = async () => {
      try {
        const response = await fetch(`/api/properties/${propertyId}/customer`);
        if (response.ok) {
          const data = await response.json();
          setIsCurrentCustomer(data.isCurrentCustomer || false);
          setCustomerLoaded(true);
        }
      } catch (err) {
        console.error('Failed to fetch customer status:', err);
      }
    };
    fetchCustomerStatus();
  }, [propertyId]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config');
        const data = await response.json();
        if (data.mapboxToken) setMapToken(data.mapboxToken);
        if (data.regridToken) setRegridToken(data.regridToken);
        if (data.googleMapsApiKey) setGoogleMapsApiKey(data.googleMapsApiKey);
      } catch (err) {
        console.error('Failed to fetch config:', err);
      }
    };
    fetchConfig();
  }, []);

  const fetchServiceProviders = useCallback(async () => {
    if (!property) return;
    try {
      const response = await fetch(`/api/properties/${property.propertyKey}/service-providers`);
      if (response.ok) {
        const data = await response.json();
        void data;
      }
    } catch (err) {
      console.error('Failed to fetch service providers:', err);
    }
  }, [property]);

  const fetchProperty = useCallback(async (options?: { silent?: boolean }) => {
    if (!propertyId) return;
    
    if (!options?.silent) {
      setIsLoading(true);
    }
    
    try {
      const response = await fetch(`/api/properties/${propertyId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch property');
      }

      if (data.property && data.property.id) {
        const prop = data.property;
        const rawParcels = prop.rawParcels || [];
        
        const ownerSet = new Set<string>();
        rawParcels.forEach((p: any) => {
          if (p.owner) ownerSet.add(p.owner.toUpperCase());
        });
        
        if (prop.dcadOwnerName1) ownerSet.add(prop.dcadOwnerName1.toUpperCase());
        if (prop.dcadBizName) ownerSet.add(prop.dcadBizName.toUpperCase());
        if (prop.regridOwner) ownerSet.add(prop.regridOwner.toUpperCase());
        
        const accountOwner = prop.dcadBizName || prop.dcadOwnerName1 || prop.regridOwner || null;
        const constituentOwners = [...ownerSet].filter(
          o => accountOwner ? o !== accountOwner.toUpperCase() : true
        );

        setProperty({
          propertyKey: prop.propertyKey,
          address: prop.address || prop.siteAddress || '',
          regridAddress: prop.regridAddress || null,
          validatedAddress: prop.validatedAddress || null,
          commonName: prop.commonName || null,
          city: prop.city || prop.siteCity || '',
          state: prop.state || prop.siteState || 'TX',
          zip: prop.zip || prop.siteZip || '',
          county: prop.county || '',
          lat: Number(prop.lat ?? prop.latitude) || 0,
          lon: Number(prop.lon ?? prop.longitude) || 0,
          lotAcres: Number(prop.lotAcres) || 0,
          yearBuilt: prop.yearBuilt || null,
          numFloors: prop.numFloors || null,
          buildingSqft: prop.buildingSqft || null,
          calculatedBuildingClass: prop.calculatedBuildingClass || null,
          totalParval: Number(prop.totalParval) || 0,
          totalImprovval: Number(prop.totalImprovval) || 0,
          landval: Number(prop.landval) || 0,
          accountOwner,
          constituentOwners,
          allOwners: [...ownerSet],
          primaryOwner: prop.regridOwner || accountOwner,
          usedesc: prop.usedesc || [],
          usecode: prop.usecode || [],
          parcelCount: prop.parcelCount || 1,
          isParentProperty: prop.isParentProperty || false,
          parentPropertyKey: prop.parentPropertyKey || null,
          constituentAccountNums: prop.constituentAccountNums || null,
          constituentCount: prop.constituentCount || 0,
        });
        
        setPropertyDbId(prop.id);

        if (prop.isParentProperty && prop.constituentAccountNums?.length > 0) {
          try {
            const keys = prop.constituentAccountNums.join(',');
            const constResponse = await fetch(`/api/properties?keys=${encodeURIComponent(keys)}`);
            if (constResponse.ok) {
              const constData = await constResponse.json();
              setConstituentProperties((constData.properties || []).map((cp: any) => ({
                propertyKey: cp.propertyKey,
                commonName: cp.commonName || null,
                buildingSqft: cp.buildingSqft || null,
                dcadBizName: cp.dcadBizName || null,
              })));
            }
          } catch {}
        }

        if (prop.parentPropertyKey) {
          try {
            const parentResponse = await fetch(`/api/properties/${prop.parentPropertyKey}`);
            if (parentResponse.ok) {
              const parentData = await parentResponse.json();
              setParentProperty({
                propertyKey: parentData.property.propertyKey,
                commonName: parentData.property.commonName || null,
              });
            }
          } catch {}
        }

        if (prop.commonName || prop.assetCategory || prop.aiRationale) {
          setEnrichedProperty({
            assetCategory: prop.assetCategory || null,
            assetSubcategory: prop.assetSubcategory || null,
            categoryConfidence: prop.categoryConfidence ? Number(prop.categoryConfidence) : null,
            commonName: prop.commonName || null,
            commonNameConfidence: prop.commonNameConfidence ? Number(prop.commonNameConfidence) : null,
            beneficialOwner: prop.beneficialOwner || null,
            beneficialOwnerConfidence: prop.beneficialOwnerConfidence ? Number(prop.beneficialOwnerConfidence) : null,
            beneficialOwnerType: prop.beneficialOwnerType || null,
            managementType: prop.managementType || null,
            managementCompany: prop.managementCompany || null,
            managementCompanyDomain: prop.managementCompanyDomain || null,
            managementConfidence: prop.managementConfidence ? Number(prop.managementConfidence) : null,
            propertyWebsite: prop.propertyWebsite || null,
            propertyPhone: prop.propertyPhone || null,
            propertyManagerWebsite: prop.propertyManagerWebsite || null,
            aiRationale: prop.aiRationale || null,
            enrichmentSources: prop.enrichmentSources || null,
            lastEnrichedAt: prop.lastEnrichedAt || null,
          });
          const dbStatus = prop.enrichmentStatus || 'pending';
          setEnrichmentStatus(dbStatus === 'completed' || dbStatus === 'enriched' ? 'enriched' : dbStatus);
        }

        if (data.contacts) {
          const mappedContacts = data.contacts.map((c: any) => ({
            id: c.id,
            fullName: c.fullName || c.normalizedName || 'Unknown',
            normalizedName: c.normalizedName,
            nameConfidence: c.nameConfidence || 0,
            email: c.email || c.normalizedEmail || null,
            normalizedEmail: c.normalizedEmail,
            emailConfidence: c.emailConfidence,
            phone: c.phone || c.normalizedPhone || null,
            phoneConfidence: c.phoneConfidence,
            title: c.title || null,
            titleConfidence: c.titleConfidence,
            companyDomain: c.companyDomain || null,
            employerName: c.employerName || null,
            linkedinUrl: c.linkedinUrl || null,
            linkedinConfidence: c.linkedinConfidence,
            location: c.location || null,
            role: c.role || 'other',
            roleConfidence: c.roleConfidence || 0,
            source: c.source,
            needsReview: c.needsReview,
            reviewReason: c.reviewReason,
            emailValidationStatus: c.emailValidationStatus || 'not_validated',
            photoUrl: c.photoUrl || null,
            relationshipStatus: c.relationshipStatus || 'active',
            relationshipStatusReason: c.relationshipStatusReason || null,
          }));
          setContacts(mappedContacts);
          (window as any).__gf_contacts_snapshot = mappedContacts.map((c: any) => `${c.id}:${c.email}:${c.phone}:${c.linkedinUrl}:${c.emailValidationStatus}:${c.relationshipStatus}`).join('|');
        }

        if (data.organizations) {
          setOrganizations(data.organizations);
        }
      } else if (data.property) {
        const prop = data.property;
        setProperty({
          propertyKey: prop.propertyKey || prop.PROPERTY_KEY || propertyId,
          address: prop.address || prop.SITE_ADDRESS || '',
          regridAddress: prop.regridAddress || null,
          validatedAddress: prop.validatedAddress || null,
          commonName: prop.commonName || null,
          city: prop.city || prop.SITE_CITY || '',
          state: prop.state || 'TX',
          zip: prop.zip || prop.SITE_ZIP || '',
          county: prop.county || '',
          lat: Number(prop.lat || prop.LATITUDE) || 0,
          lon: Number(prop.lon || prop.LONGITUDE) || 0,
          lotAcres: prop.lotSqft ? Number(prop.lotSqft) / 43560 : Number(prop.lotAcres || 0),
          yearBuilt: prop.yearBuilt || prop.YEAR_BUILT || null,
          numFloors: prop.numFloors || prop.NUM_FLOORS || null,
          buildingSqft: prop.buildingSqft || prop.BUILDING_SQFT || null,
          calculatedBuildingClass: null,
          totalParval: Number(prop.totalParval || prop.TOTAL_PARVAL || 0),
          totalImprovval: Number(prop.totalImprovval || prop.TOTAL_IMPROVVAL || 0),
          landval: Number(prop.landval || prop.LANDVAL || 0),
          accountOwner: prop.owner || prop.OWNER || null,
          constituentOwners: [],
          allOwners: prop.owner ? [prop.owner] : [],
          primaryOwner: prop.owner || null,
          usedesc: prop.usedesc || [],
          usecode: prop.usecode || [],
          parcelCount: 1,
          isParentProperty: false,
          parentPropertyKey: null,
          constituentAccountNums: null,
          constituentCount: 0,
        });
      }
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }, [propertyId]);

  useEffect(() => {
    setProperty(null);
    setPropertyDbId(null);
    setEnrichedProperty(null);
    setContacts([]);
    setOrganizations([]);
    setConstituentProperties([]);
    setParentProperty(null);
    setEnrichmentStatus('not_enriched');
    setEnrichmentMessage('');
    setError(null);
    setPipelineData(null);
    setPipelineLoaded(false);
    setCustomerLoaded(false);
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, [propertyId]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    fetchProperty();
    fetchServiceProviders();
    
    fetch('/api/properties/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ propertyId }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useEffect(() => {
    const handler = () => {
      fetchProperty({ silent: true });
    };
    window.addEventListener('enrichment-complete', handler);
    return () => window.removeEventListener('enrichment-complete', handler);
  }, [fetchProperty]);

  useEffect(() => {
    if (!propertyId) return;
    
    const fetchPipelineData = async () => {
      try {
        const response = await fetch(`/api/properties/${propertyId}/pipeline`);
        if (response.ok) {
          const data = await response.json();
          setPipelineData(data.pipeline || null);
          if (data.pipeline?.owner) {
            const owner = data.pipeline.owner;
            const displayName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'Unknown';
            setPipelineOwner({
              id: owner.id,
              firstName: owner.firstName,
              lastName: owner.lastName,
              profileImageUrl: owner.profileImageUrl,
              displayName,
            });
          }
        }
        setPipelineLoaded(true);
      } catch {}
    };
    fetchPipelineData();
  }, [propertyId]);

  const handlePipelineChange = useCallback((pipelineUpdate: any) => {
    setPipelineData(pipelineUpdate || null);
    if (pipelineUpdate?.owner) {
      const owner = pipelineUpdate.owner;
      const displayName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'Unknown';
      setPipelineOwner({
        id: owner.id,
        firstName: owner.firstName,
        lastName: owner.lastName,
        profileImageUrl: owner.profileImageUrl,
        displayName,
      });
    } else {
      setPipelineOwner(null);
    }
  }, []);

  const handleEnrichment = async () => {
    if (!property) return;
    
    setEnrichmentStatus('pending');
    setEnrichmentMessage('Starting AI research...');
    
    startEnrichment({
      type: 'property',
      entityId: property.propertyKey,
      entityName: enrichedProperty?.commonName || property.address || 'Property',
      apiEndpoint: '/api/enrich',
      requestBody: {
        propertyKey: property.propertyKey,
        storeResults: true,
      },
      pollForCompletion: {
        checkEndpoint: `/api/properties/${property.propertyKey}`,
        checkField: 'property.enrichmentStatus',
        maxAttempts: 60,
        intervalMs: 5000,
        originalValue: 'pending',
        compareMode: 'changed',
      },
      onSuccess: async () => {
        await fetchProperty();
        const currentStatus = enrichmentStatus;
        if (currentStatus === 'enriched' || currentStatus === 'completed') {
          setEnrichmentMessage('Research complete');
          return;
        }
        setEnrichmentStatus('pending');
        setEnrichmentMessage('AI research in progress...');
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;

        let pollCount = 0;
        const maxDurationMs = 5 * 60 * 1000;
        const startTime = Date.now();
        let unchangedCount = 0;

        const getNextDelay = (n: number) => Math.min(5000 * Math.pow(1.4, n), 30000);

        const scheduleNextPoll = () => {
          if (Date.now() - startTime > maxDurationMs) {
            setEnrichmentMessage('Research complete - all data refreshed');
            return;
          }
          const delay = getNextDelay(pollCount);
          pollTimerRef.current = setTimeout(async () => {
            pollCount++;
            const prevData = JSON.stringify(
              (window as any).__gf_contacts_snapshot || ''
            );
            await fetchProperty({ silent: true });
            const newData = JSON.stringify(
              (window as any).__gf_contacts_snapshot || ''
            );

            if (enrichmentStatus === 'enriched' || enrichmentStatus === 'completed') {
              setEnrichmentMessage('Research complete - contact enrichment running in background...');
            }

            if (newData !== prevData && newData !== '""') {
              unchangedCount = 0;
            } else {
              unchangedCount++;
            }
            if (unchangedCount >= 3 && pollCount >= 6) {
              setEnrichmentMessage('Research complete - all data refreshed');
              pollTimerRef.current = null;
              return;
            }
            scheduleNextPoll();
          }, delay) as unknown as ReturnType<typeof setInterval>;
        };
        scheduleNextPoll();
      },
      onError: (error: string) => {
        setEnrichmentStatus('failed');
        setEnrichmentMessage(error);
      },
    });
  };

  const openFlagDialog = (type: 'management_company' | 'owner' | 'property_info' | 'other') => {
    setFlagType(type);
    setShowFlagDialog(true);
  };

  if (isLoading) {
    return <PropertyDetailSkeleton />;
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
      <PropertyHeader
        property={property}
        enrichedProperty={enrichedProperty}
        enrichmentStatus={enrichmentStatus}
        enrichmentMessage={enrichmentMessage}
        pipelineOwner={pipelineOwner}
        userId={userId}
        isCurrentCustomer={isCurrentCustomer}
        propertyId={propertyId}
        assignDialogTrigger={assignDialogTrigger}
        pipelineData={pipelineData}
        pipelineLoaded={pipelineLoaded}
        customerLoaded={customerLoaded}
        googleMapsApiKey={googleMapsApiKey}
        onEnrichment={handleEnrichment}
        onShowAddToList={() => setShowAddToListModal(true)}
        onSetAssignDialogTrigger={setAssignDialogTrigger}
        onSetIsCurrentCustomer={setIsCurrentCustomer}
        onExpandStreetView={() => setExpandedMapType('street')}
        onPipelineChange={handlePipelineChange}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setShowDataIssueDialog(true)}
            className="text-xs text-gray-500 hover:text-amber-600 hover:underline flex items-center gap-1"
            title="Report incorrect data for this property"
            data-testid="button-report-property-data-issue"
          >
            <Flag className="w-3 h-3" />
            Report data issue
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <PropertyStats property={property} enrichedProperty={enrichedProperty} />
            </div>

            {enrichedProperty && (
              <PropertyAbout enrichedProperty={enrichedProperty} enrichmentStatus={enrichmentStatus} />
            )}

            <ContactsSection
              contacts={contacts}
              onShowAddContactModal={() => setShowAddContactModal(true)}
              onEnrichment={handleEnrichment}
              onSetContactForListModal={setContactForListModal}
            />

            <OwnershipSection
              property={property}
              enrichedProperty={enrichedProperty}
              organizations={organizations}
              onOpenFlagDialog={openFlagDialog}
            />

            {parentProperty && (
              <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="text-sm font-medium text-blue-800">Part of Complex</span>
                </div>
                <a 
                  href={`/property/${parentProperty.propertyKey}`}
                  className="block hover:bg-blue-100 rounded p-2 -m-2 transition-colors"
                >
                  <p className="text-blue-900 font-semibold">{parentProperty.commonName ? normalizeCommonName(parentProperty.commonName) : 'Parent Property'}</p>
                  <p className="text-xs text-blue-600 mt-0.5">View parent property details</p>
                </a>
              </div>
            )}

            {property.isParentProperty && constituentProperties.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <button
                  onClick={() => setShowConstituents(!showConstituents)}
                  className="w-full flex items-center gap-2 p-4 text-left hover:bg-gray-50 transition-colors rounded-lg"
                  data-testid="button-toggle-constituents"
                >
                  <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Properties in Complex</span>
                  <span className="bg-emerald-100 text-emerald-800 text-xs font-medium px-2 py-0.5 rounded-full">
                    {constituentProperties.length}
                  </span>
                  <svg className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${showConstituents ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showConstituents && (
                  <div className="px-4 pb-4 space-y-2">
                    {constituentProperties.map((constituent) => (
                      <a
                        key={constituent.propertyKey}
                        href={`/property/${constituent.propertyKey}`}
                        className="block p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900">
                              {normalizeCommonName(constituent.commonName) || normalizeCommonName(constituent.dcadBizName) || 'Unnamed Property'}
                            </p>
                            {constituent.buildingSqft && (
                              <p className="text-sm text-gray-500">
                                {constituent.buildingSqft.toLocaleString()} sq ft
                              </p>
                            )}
                          </div>
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 opacity-60">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-400 flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-gray-400" />
                  Service Providers
                </h2>
                <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-gray-500 bg-gray-100 rounded-full">
                  Coming Soon
                </span>
              </div>
              
              <div className="text-center py-8">
                <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400 mb-2">Track HVAC, maintenance, and property services</p>
                <p className="text-xs text-gray-400">This feature will be available in a future release.</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="space-y-4">
              <PropertyNotes propertyId={property.propertyKey} />
              
              <PropertyActivity propertyId={property.propertyKey} />
              
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="h-48 lg:h-56">
                  {property.lat && property.lon && mapToken ? (
                    <MapCanvas
                      accessToken={mapToken}
                      regridToken={regridToken}
                      initialCenter={{ lat: property.lat, lon: property.lon }}
                      initialZoom={17}
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
                <div className="p-2 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">Map</span> with parcel boundaries
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-400">
                      {property.lat?.toFixed(5)}, {property.lon?.toFixed(5)}
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setExpandedMapType('satellite')}
                      title="Expand map"
                      data-testid="button-expand-satellite-map"
                      className="h-6 w-6"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>

      {property && propertyDbId && (
        <AddToListModal
          isOpen={showAddToListModal}
          onClose={() => setShowAddToListModal(false)}
          itemId={propertyDbId}
          itemType="properties"
        />
      )}

      {propertyDbId && (
        <AddContactModal
          propertyId={propertyDbId}
          isOpen={showAddContactModal}
          onClose={() => setShowAddContactModal(false)}
          onSuccess={fetchProperty}
        />
      )}

      {contactForListModal && (
        <AddToListModal
          isOpen={!!contactForListModal}
          onClose={() => setContactForListModal(null)}
          itemId={contactForListModal}
          itemType="contacts"
        />
      )}

      {expandedMapType && property?.lat && property?.lon && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div 
            className="fixed inset-0 bg-black bg-opacity-75 transition-opacity" 
            onClick={() => setExpandedMapType(null)} 
          />
          <div className="fixed inset-4 sm:inset-8 lg:inset-16 flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">
                {expandedMapType === 'satellite' ? 'Satellite Map' : 'Street View'}
              </h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setExpandedMapType(null)}
                data-testid="button-close-expanded-map"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex-1 relative">
              {expandedMapType === 'satellite' && mapToken ? (
                <MapCanvas
                  accessToken={mapToken}
                  regridToken={regridToken}
                  initialCenter={{ lat: property.lat, lon: property.lon }}
                  initialZoom={17}
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
              ) : expandedMapType === 'street' && googleMapsApiKey ? (
                <StreetView
                  apiKey={googleMapsApiKey}
                  lat={property.lat}
                  lon={property.lon}
                />
              ) : null}
            </div>
            <div className="p-2 border-t border-gray-100 bg-white">
              <p className="text-xs text-gray-500 text-center">
                {expandedMapType === 'satellite' 
                  ? `${property.lat?.toFixed(5)}, ${property.lon?.toFixed(5)} - Click and drag to pan, scroll to zoom`
                  : 'Drag to explore - Use controls to reposition view'
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {showFlagDialog && (
        <FlagDialog
          flagType={flagType}
          propertyKey={property.propertyKey}
          onClose={() => setShowFlagDialog(false)}
        />
      )}

      {showDataIssueDialog && (
        <DataIssueDialog
          entityType="property"
          entityId={property.propertyKey}
          entityLabel={property.commonName || property.validatedAddress || property.regridAddress || property.propertyKey}
          onClose={() => setShowDataIssueDialog(false)}
        />
      )}

      {showAddServiceProvider && (
        <ServiceProviderDialog
          propertyKey={property.propertyKey}
          onClose={() => setShowAddServiceProvider(false)}
          onSuccess={fetchServiceProviders}
        />
      )}
    </div>
  );
}
