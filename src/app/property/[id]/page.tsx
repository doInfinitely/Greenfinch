'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AlertTriangle, Flag, X, Search, Check, Plus, Wrench, Maximize2, Loader2, MoreVertical, ListPlus, Upload, User, UserCircle, Sparkles, Phone, XCircle } from 'lucide-react';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/schema';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLORS, ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import AddToListModal from '@/components/AddToListModal';
import AddContactModal from '@/components/AddContactModal';
import StreetView from '@/components/StreetView';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import PipelineStatus from '@/components/PipelineStatus';
import CustomerToggle from '@/components/CustomerToggle';
import PropertyNotes from '@/components/PropertyNotes';
import PropertyActivity from '@/components/PropertyActivity';
import { normalizeCommonName, toTitleCase } from '@/lib/normalization';

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
  calculatedBuildingClass: string | null;
  totalParval: number;
  totalImprovval: number;
  landval: number;
  accountOwner: string | null;  // Primary owner at the account level
  constituentOwners: string[];  // Other owners from sub-parcels/buildings if different
  allOwners: string[];
  primaryOwner: string | null;
  usedesc: string[];
  usecode: string[];
  parcelCount: number;
  // Parcel relationship fields
  isParentProperty: boolean;
  parentPropertyKey: string | null;
  constituentAccountNums: string[] | null;
  constituentCount: number;
}

interface ConstituentProperty {
  propertyKey: string;
  commonName: string | null;
  buildingSqft: number | null;
  dcadBizName: string | null;
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
  photoUrl?: string | null;
}

interface Organization {
  id: string;
  name: string;
  domain: string | null;
  orgType: string | null;
  role: string | null; // Single role for backward compatibility
  roles?: string[]; // Array of roles for multi-role organizations
  description?: string | null;
  industry?: string | null;
  employees?: number | null;
  employeesRange?: string | null;
  linkedinHandle?: string | null; // LinkedIn company handle from database
  city?: string | null;
  state?: string | null;
  pdlEnriched?: boolean;
}

type EnrichmentStatusType = 'not_enriched' | 'pending' | 'completed' | 'failed';


// Priority order for contact sorting (lower = higher priority)
const ROLE_PRIORITY: Record<string, number> = {
  property_manager: 1,
  facilities_manager: 2,
  owner: 3,
  leasing: 4,
  other: 5,
};

function sortContactsByRelevance(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const priorityA = ROLE_PRIORITY[a.role] || 99;
    const priorityB = ROLE_PRIORITY[b.role] || 99;
    return priorityA - priorityB;
  });
}



// Low confidence marker - only shows for items under 70% confidence
function LowConfidenceMarker({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined || confidence >= 0.70) return null;
  
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 ml-1" title={`${Math.round(confidence * 100)}% confidence`}>
      <AlertTriangle className="w-3 h-3 mr-0.5" />
      Unsure
    </span>
  );
}

// Render AI research summary as plain text (sources hidden but stored for future use)
function SummaryWithSources({ 
  summary, 
  sources 
}: { 
  summary: string; 
  sources: Array<{ id: number; title: string; url: string; type: string }> | null;
}) {
  // Sources are still stored in the database but not displayed in the UI
  // They can be re-enabled later when grounding source links work properly
  void sources;
  
  if (!summary) return null;
  
  // Strip any remaining citation numbers like [1], [2], [3, 4] as a UI safety guard
  const cleanSummary = summary.replace(/\[[\d,\s]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
  
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
        {cleanSummary}
      </p>
    </div>
  );
}

// Contact avatar with proper state-based fallback
function ContactAvatar({ photoUrl, name }: { photoUrl?: string | null; name: string }) {
  const [imageError, setImageError] = useState(false);
  const showImage = photoUrl && !imageError;
  
  if (showImage) {
    return (
      <img 
        src={photoUrl} 
        alt={name || 'Contact'} 
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        onError={() => setImageError(true)}
      />
    );
  }
  
  return (
    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
      <span className="text-green-700 font-medium text-sm">
        {name?.charAt(0) || '?'}
      </span>
    </div>
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

// Contact info summary with validation icons
function ContactInfoIcons({ contact }: { contact: Contact }) {
  return (
    <div className="flex items-center gap-2" data-testid={`contact-info-icons-${contact.id}`}>
      <EmailStatusIcon hasEmail={!!contact.email} status={contact.emailValidationStatus} />
      <PhoneStatusIcon hasPhone={hasAnyPhone(contact)} isOfficeOnly={hasOnlyOfficeLine(contact)} />
      <LinkedInStatusIcon hasLinkedIn={!!contact.linkedinUrl} />
    </div>
  );
}

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
  const [assignDialogTrigger, setAssignDialogTrigger] = useState(0);
  const [isCurrentCustomer, setIsCurrentCustomer] = useState(false);
  const { startEnrichment } = useEnrichment();
  const { getEnrichmentStatus } = useEnrichmentQueue();
  
  // Property flagging state
  const [showFlagDialog, setShowFlagDialog] = useState(false);
  const [flagType, setFlagType] = useState<'management_company' | 'owner' | 'property_info' | 'other'>('management_company');
  const [flagSearchQuery, setFlagSearchQuery] = useState('');
  const [flagSearchResults, setFlagSearchResults] = useState<Array<{id: string; name: string; domain: string | null}>>([]);
  const [selectedFlagOrg, setSelectedFlagOrg] = useState<{id: string; name: string} | null>(null);
  const [flagComments, setFlagComments] = useState('');
  const [isSubmittingFlag, setIsSubmittingFlag] = useState(false);
  const [flagMessage, setFlagMessage] = useState<string | null>(null);
  
  // Constituent properties state (for parent properties)
  const [constituentProperties, setConstituentProperties] = useState<ConstituentProperty[]>([]);
  const [parentProperty, setParentProperty] = useState<{ propertyKey: string; commonName: string | null } | null>(null);
  const [expandedMapType, setExpandedMapType] = useState<'satellite' | 'street' | null>(null);
  
  // Service providers state
  interface PropertyServiceProvider {
    id: string;
    serviceCategory: string;
    status: string;
    providerName: string | null;
    providerDomain: string | null;
    providerPhone: string | null;
  }
  const [serviceProvidersList, setServiceProvidersList] = useState<PropertyServiceProvider[]>([]);
  const [showAddServiceProvider, setShowAddServiceProvider] = useState(false);
  const [selectedServiceCategory, setSelectedServiceCategory] = useState('');
  const [serviceProviderSearch, setServiceProviderSearch] = useState('');
  const [serviceProviderResults, setServiceProviderResults] = useState<Array<{id: string; name: string; domain: string | null}>>([]);
  const [selectedServiceProvider, setSelectedServiceProvider] = useState<{id: string; name: string} | null>(null);
  const [isSubmittingServiceProvider, setIsSubmittingServiceProvider] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [validatingEmails, setValidatingEmails] = useState<Set<string>>(new Set());
  const [mapToken, setMapToken] = useState<string>('');
  const [regridToken, setRegridToken] = useState<string>('');
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string>('');
  
  // Pipeline owner state for header display
  const [pipelineOwner, setPipelineOwner] = useState<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    displayName: string;
  } | null>(null);

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
    if (sqft >= 1000000) {
      const m = sqft / 1000000;
      return `${m.toFixed(1)}M`;
    }
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

  // Fetch customer status
  useEffect(() => {
    if (!propertyId) return;
    fetch(`/api/properties/${propertyId}/customer`)
      .then(res => res.json())
      .then(data => setIsCurrentCustomer(data.isCurrentCustomer ?? false))
      .catch(err => console.error('Failed to fetch customer status:', err));
  }, [propertyId]);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.mapboxToken) setMapToken(data.mapboxToken);
        if (data.regridToken) setRegridToken(data.regridToken);
        if (data.googleMapsApiKey) setGoogleMapsApiKey(data.googleMapsApiKey);
      })
      .catch(err => console.error('Failed to load map config:', err));
  }, []);

  // Fetch service providers for the property - defined before use in useEffect
  const fetchServiceProviders = useCallback(async () => {
    if (!propertyId) return;
    try {
      const response = await fetch(`/api/properties/${propertyId}/service-providers`);
      if (response.ok) {
        const data = await response.json();
        setServiceProvidersList(data.providers || []);
      }
    } catch (err) {
      console.error('Failed to fetch service providers:', err);
    }
  }, [propertyId]);

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
          // Include DCAD owner fields
          if (prop.dcadBizName) ownersSet.add(prop.dcadBizName.toUpperCase());
          if (prop.dcadOwnerName1) ownersSet.add(prop.dcadOwnerName1.toUpperCase());
          if (prop.dcadOwnerName2) ownersSet.add(prop.dcadOwnerName2.toUpperCase());
          
          // Determine account owner (primary owner at account level)
          // Priority: dcadBizName > dcadOwnerName1 > regridOwner
          const accountOwner = (prop.dcadBizName || prop.dcadOwnerName1 || prop.regridOwner || '').toUpperCase() || null;
          
          // Constituent owners are all other owners that differ from account owner
          const allOwnersArray = Array.from(ownersSet);
          const constituentOwners = allOwnersArray.filter(o => 
            accountOwner && o.toUpperCase() !== accountOwner.toUpperCase()
          );
          
          // Use pre-aggregated values from properties table (source of truth)
          const lotAcres = prop.lotSqft ? prop.lotSqft / 43560 : 0;
          
          setPropertyDbId(prop.id);
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
            accountOwner: accountOwner,
            constituentOwners: constituentOwners,
            allOwners: allOwnersArray,
            primaryOwner: prop.regridOwner || null,
            usedesc: Array.from(usedescSet),
            usecode: [],
            parcelCount: rawParcels.length || 1,
            // Parcel relationship fields
            isParentProperty: prop.isParentProperty || false,
            parentPropertyKey: prop.parentPropertyKey || null,
            constituentAccountNums: prop.constituentAccountNums || null,
            constituentCount: prop.constituentCount || 0,
            calculatedBuildingClass: prop.calculatedBuildingClass || null,
          });
          
          // If this is a parent property, fetch constituent properties
          if (prop.isParentProperty && prop.constituentAccountNums?.length > 0) {
            const constituentRes = await fetch(`/api/properties?keys=${prop.constituentAccountNums.join(',')}`);
            if (constituentRes.ok) {
              const constituentData = await constituentRes.json();
              setConstituentProperties(constituentData.properties || []);
            }
          }
          
          // If this is a constituent property, fetch parent info
          if (prop.parentPropertyKey) {
            const parentRes = await fetch(`/api/properties/${prop.parentPropertyKey}`);
            if (parentRes.ok) {
              const parentData = await parentRes.json();
              setParentProperty({
                propertyKey: prop.parentPropertyKey,
                commonName: parentData.property?.commonName || normalizeCommonName(parentData.property?.dcadBizName) || null,
              });
            }
          }

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
              propertyPhone: prop.propertyPhone,
              propertyManagerWebsite: prop.propertyManagerWebsite,
              aiRationale: prop.aiRationale,
              enrichmentSources: prop.enrichmentSources,
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
    fetchServiceProviders();
  }, [propertyId, fetchServiceProviders]);

  // Fetch pipeline data for owner display in header
  useEffect(() => {
    if (!propertyId) return;
    
    const fetchPipeline = async () => {
      try {
        const response = await fetch(`/api/properties/${propertyId}/pipeline`);
        if (response.ok) {
          const data = await response.json();
          if (data.pipeline?.owner) {
            setPipelineOwner(data.pipeline.owner);
          }
        }
      } catch (err) {
        console.error('Failed to fetch pipeline:', err);
      }
    };
    
    fetchPipeline();
  }, [propertyId]);

  const handleEnrichment = async () => {
    if (!property) return;

    setEnrichmentStatus('pending');
    setEnrichmentMessage('greenfinch.ai is researching - check the queue for progress');

    // Build display name: prefer common name with address, or just address
    const displayName = enrichedProperty?.commonName 
      ? `${normalizeCommonName(enrichedProperty.commonName)} (${property.address || ''})`.trim()
      : property.address || 'Unknown Property';

    startEnrichment({
      type: 'property',
      entityId: property.propertyKey,
      entityName: displayName,
      apiEndpoint: '/api/enrich',
      requestBody: {
        propertyKey: property.propertyKey,
        storeResults: true,
      },
      onSuccess: (data: unknown) => {
        const result = data as { enrichment?: { property?: EnrichedPropertyData; contacts?: Contact[]; organizations?: Organization[] } };
        if (result.enrichment) {
          setEnrichedProperty(result.enrichment.property || null);
          // Preserve emailValidationStatus from the server - don't overwrite with 'not_validated'
          setContacts(result.enrichment.contacts || []);
          setOrganizations(result.enrichment.organizations || []);
          setEnrichmentStatus('completed');
          setEnrichmentMessage(`Found ${result.enrichment.contacts?.length || 0} contacts and ${result.enrichment.organizations?.length || 0} organizations`);
        }
      },
      onError: (error: string) => {
        setEnrichmentStatus('failed');
        setEnrichmentMessage(error);
      },
    });
  };

  // Search organizations for flagging
  const handleFlagSearch = async (query: string) => {
    setFlagSearchQuery(query);
    if (query.length < 2) {
      setFlagSearchResults([]);
      return;
    }
    
    try {
      const response = await fetch(`/api/organizations/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setFlagSearchResults(data.organizations || []);
    } catch (err) {
      console.error('Organization search error:', err);
    }
  };

  // Submit property flag
  const handleSubmitFlag = async () => {
    if (!property) return;
    
    setIsSubmittingFlag(true);
    setFlagMessage(null);
    
    try {
      const response = await fetch(`/api/properties/${property.propertyKey}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flagType,
          suggestedOrganizationId: selectedFlagOrg?.id || null,
          suggestedOrganizationName: selectedFlagOrg ? null : flagSearchQuery || null,
          comments: flagComments,
        }),
      });

      if (response.ok) {
        setFlagMessage('Thank you! Your feedback has been submitted for review.');
        setTimeout(() => {
          setShowFlagDialog(false);
          setFlagMessage(null);
          setFlagSearchQuery('');
          setSelectedFlagOrg(null);
          setFlagComments('');
        }, 2000);
      } else {
        setFlagMessage('Failed to submit feedback. Please try again.');
      }
    } catch (err) {
      setFlagMessage('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmittingFlag(false);
    }
  };

  const openFlagDialog = (type: 'management_company' | 'owner' | 'property_info' | 'other') => {
    setFlagType(type);
    setShowFlagDialog(true);
    setFlagSearchQuery('');
    setFlagSearchResults([]);
    setSelectedFlagOrg(null);
    setFlagComments('');
    setFlagMessage(null);
  };

  // Search service providers
  const handleServiceProviderSearch = async (query: string) => {
    setServiceProviderSearch(query);
    if (query.length < 2) {
      setServiceProviderResults([]);
      return;
    }
    
    try {
      const url = selectedServiceCategory 
        ? `/api/service-providers/search?q=${encodeURIComponent(query)}&category=${selectedServiceCategory}`
        : `/api/service-providers/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      const data = await response.json();
      setServiceProviderResults(data.providers || []);
    } catch (err) {
      console.error('Service provider search error:', err);
    }
  };

  // Submit service provider suggestion
  const handleSubmitServiceProvider = async () => {
    if (!property || !selectedServiceCategory || !selectedServiceProvider) return;
    
    setIsSubmittingServiceProvider(true);
    try {
      const response = await fetch(`/api/properties/${property.propertyKey}/service-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceCategory: selectedServiceCategory,
          serviceProviderId: selectedServiceProvider.id,
        }),
      });

      if (response.ok) {
        await fetchServiceProviders();
        setShowAddServiceProvider(false);
        setSelectedServiceCategory('');
        setServiceProviderSearch('');
        setSelectedServiceProvider(null);
      }
    } catch (err) {
      console.error('Failed to add service provider:', err);
    } finally {
      setIsSubmittingServiceProvider(false);
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
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <button
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back
        </button>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              {/* Header row: Property name + fixed ⋮ button */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0 flex-1">
                  {enrichedProperty?.commonName && (
                    <div className="mb-1">
                      <h1 className="text-2xl font-bold text-gray-900 break-words">
                        {normalizeCommonName(enrichedProperty.commonName)}
                      </h1>
                    </div>
                  )}
                  <p className={`${enrichedProperty?.commonName ? 'text-lg text-gray-600' : 'text-2xl font-bold text-gray-900'} mb-1 break-words`}>
                    {property.address || 'No Address'}
                  </p>
                  <p className="text-gray-600">
                    {property.city}, {property.state} {property.zip}
                  </p>
                  {property.county && (
                    <p className="text-sm text-gray-500">{property.county} County</p>
                  )}
                  
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {enrichedProperty?.assetCategory && (() => {
                      const colors = CATEGORY_COLORS[enrichedProperty.assetCategory] || DEFAULT_CATEGORY_COLORS;
                      return (
                        <span className="inline-flex items-center gap-1">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                            {enrichedProperty.assetCategory}
                          </span>
                          {enrichedProperty?.assetSubcategory && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${colors.subBg} ${colors.subText}`}>
                              {enrichedProperty.assetSubcategory}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                    <LowConfidenceMarker confidence={enrichedProperty?.categoryConfidence} />
                  </div>
                </div>
                
                {/* Owner avatar, Research button, Add to List, and More actions - never wraps */}
                <div className="flex-shrink-0 flex items-center gap-2">
                  {/* Owner avatar with tooltip */}
                  {pipelineOwner && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Avatar className="w-8 h-8 cursor-default" data-testid="avatar-pipeline-owner">
                            <AvatarImage src={pipelineOwner.profileImageUrl || ''} />
                            <AvatarFallback className="text-xs bg-green-100 text-green-700">
                              {pipelineOwner.displayName?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent className="z-[100] bg-white dark:bg-gray-900 border border-border px-3 py-1.5 text-sm text-popover-foreground shadow-md">
                          <p>Owner: {pipelineOwner.displayName}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  
                  {/* Research button or sparkle icon for completed */}
                  {(() => {
                    const queueStatus = property ? getEnrichmentStatus(property.propertyKey, 'property') : { isActive: false, status: null };
                    const isEnrichmentActive = queueStatus.isActive;
                    const enrichmentHasFailed = queueStatus.status === 'failed';
                    const isResearchComplete = enrichmentStatus === 'completed';
                    
                    if (isResearchComplete) {
                      return (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center justify-center w-8 h-8" role="img" aria-label="Researched with AI" data-testid="icon-researched">
                                <Sparkles className="w-5 h-5 text-purple-500" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="z-[100] bg-white dark:bg-gray-900 border border-border px-3 py-1.5 text-sm text-popover-foreground shadow-md">
                              <p>Researched with AI</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    }
                    
                    return (
                      <AdminOnly>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleEnrichment}
                          disabled={isEnrichmentActive}
                          className={
                            enrichmentHasFailed 
                              ? 'text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20' 
                              : 'border-purple-500 text-purple-700 dark:text-purple-400'
                          }
                          title={enrichmentHasFailed ? `Failed: ${queueStatus.error || 'Unknown error'} - Click to retry` : undefined}
                          data-testid="button-find-decision-makers"
                        >
                          {isEnrichmentActive ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          ) : enrichmentHasFailed ? (
                            <XCircle className="w-4 h-4 mr-1" />
                          ) : (
                            <GreenfinchAgentIcon className="w-4 h-4 mr-1" />
                          )}
                          {isEnrichmentActive ? 'Researching...' : enrichmentHasFailed ? 'Retry Research' : 'Research'}
                        </Button>
                      </AdminOnly>
                    );
                  })()}
                  
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowAddToListModal(true)}
                    title="Add to prospecting list"
                    disabled={!userId}
                    data-testid="button-add-to-list"
                  >
                    <ListPlus className="w-4 h-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" data-testid="button-more-actions">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                      <AdminOnly>
                        <DropdownMenuItem 
                          onClick={() => setAssignDialogTrigger(prev => prev + 1)}
                          data-testid="menu-item-assign-owner"
                        >
                          <User className="w-4 h-4 mr-2" />
                          Assign Owner
                        </DropdownMenuItem>
                      </AdminOnly>
                      <DropdownMenuItem 
                        disabled
                        className="opacity-50"
                        data-testid="menu-item-export-crm"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Export to CRM
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              
              {/* Action row: Qualify/Disqualify buttons and Customer toggle */}
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <PipelineStatus propertyId={property.propertyKey} inline autoAssignOnFirstStatus hideOwnerControls hideOwnerDisplay triggerAssignDialog={assignDialogTrigger} isCustomer={isCurrentCustomer} />
                <div className="border-l border-gray-200 dark:border-gray-700 h-6 mx-1" />
                <CustomerToggle propertyId={property.propertyKey} onToggle={setIsCurrentCustomer} />
              </div>

              {enrichmentMessage && enrichmentStatus !== 'pending' && (
                <div className={`mb-6 p-3 rounded-lg ${enrichmentStatus === 'completed' ? 'bg-green-50 text-green-700' : enrichmentStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                  <p className="text-sm">{enrichmentMessage}</p>
                </div>
              )}

              <div className={`grid grid-cols-1 gap-4 mb-6 ${property.calculatedBuildingClass ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4" data-testid="stat-lot-size">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Lot Size</p>
                  <p className="text-xl font-semibold text-gray-800 dark:text-gray-100" data-testid="text-lot-size-value">
                    {property.lotAcres && property.lotAcres > 0 ? `${formatLotSize(property.lotAcres)} acres` : 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4" data-testid="stat-building-area">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Building Area</p>
                  <p className="text-xl font-semibold text-gray-800 dark:text-gray-100" data-testid="text-building-area-value">
                    {property.buildingSqft && property.buildingSqft > 0 ? `${formatBuildingSqft(property.buildingSqft)} sq ft` : 'N/A'}
                  </p>
                </div>
                {property.calculatedBuildingClass && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4" data-testid="stat-building-class">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Building Class</p>
                    <Badge variant="outline" className={
                      property.calculatedBuildingClass === 'A+' || property.calculatedBuildingClass === 'A' 
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800' :
                      property.calculatedBuildingClass === 'B' 
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800' :
                      property.calculatedBuildingClass === 'C' 
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800' :
                      'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                    } data-testid="badge-building-class">
                      Class {property.calculatedBuildingClass}
                    </Badge>
                  </div>
                )}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4" data-testid="stat-year-built">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Year Built</p>
                  <p className="text-xl font-semibold text-gray-800 dark:text-gray-100" data-testid="text-year-built-value">
                    {property.yearBuilt || 'N/A'}
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

            {enrichmentStatus === 'completed' && enrichedProperty && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">About This Property</h2>
                
                <div className="space-y-4">
                  {enrichedProperty.lastEnrichedAt && (
                    <div className="flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-gray-500">Data last refreshed:</span>
                      <span className="text-gray-900">{new Date(enrichedProperty.lastEnrichedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    </div>
                  )}

                  {(enrichedProperty.propertyWebsite || enrichedProperty.propertyPhone) && (
                    <div className="flex flex-wrap gap-3">
                      {enrichedProperty.propertyWebsite && (
                        <a
                          href={enrichedProperty.propertyWebsite.startsWith('http') ? enrichedProperty.propertyWebsite : `https://${enrichedProperty.propertyWebsite}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                          data-testid="link-property-website"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                          </svg>
                          Property Website
                        </a>
                      )}
                      {enrichedProperty.propertyPhone && (
                        <a
                          href={`tel:${enrichedProperty.propertyPhone.replace(/[^\d+]/g, '')}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                          data-testid="link-property-phone"
                        >
                          <Phone className="w-4 h-4" />
                          {enrichedProperty.propertyPhone}
                        </a>
                      )}
                    </div>
                  )}

                  {enrichedProperty.aiRationale && (
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-sm font-medium text-gray-700 mb-2">AI Research Summary</p>
                      <SummaryWithSources 
                        summary={enrichedProperty.aiRationale} 
                        sources={enrichedProperty.enrichmentSources} 
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Ownership & Management</h2>
              
              {/* Show organizations with their roles - clickable to org records */}
              {organizations.length > 0 ? (
                <div className="space-y-3 mb-4">
                  {organizations.map((org) => {
                    const displayRoles = org.roles?.length ? org.roles : (org.role ? [org.role] : []);
                    const isOwner = displayRoles.includes('owner');
                    const isManager = displayRoles.includes('property_manager') || displayRoles.includes('facilities_manager');
                    const bgColor = isOwner ? 'bg-purple-50 border-purple-100' : isManager ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200';
                    const labelColor = isOwner ? 'text-purple-700' : isManager ? 'text-blue-700' : 'text-gray-700';
                    
                    return (
                      <div 
                        key={org.id || org.name}
                        className={`p-4 rounded-lg border ${bgColor} ${org.id ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                        onClick={() => org.id && router.push(`/organization/${org.id}`)}
                        data-testid={`ownership-org-${org.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap gap-1 mb-1">
                              {displayRoles.map((role, idx) => (
                                <span 
                                  key={role}
                                  className={`text-xs font-medium ${labelColor}`}
                                >
                                  {ROLE_LABELS[role] || role}{idx < displayRoles.length - 1 ? ' · ' : ''}
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900">{org.name}</p>
                              {org.id && (
                                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {org.orgType && (
                                <span className={`inline-block px-2 py-0.5 text-xs rounded ${isOwner ? 'bg-purple-100 text-purple-700' : isManager ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {org.orgType}
                                </span>
                              )}
                              {org.industry && (
                                <span className="inline-block px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700">
                                  {org.industry}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {org.domain && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(`https://${org.domain}`, '_blank');
                                  }}
                                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                >
                                  {org.domain}
                                </span>
                              )}
                              {org.linkedinHandle && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const linkedinUrl = org.linkedinHandle!.startsWith('http') 
                                      ? org.linkedinHandle! 
                                      : `https://linkedin.com/company/${org.linkedinHandle}`;
                                    window.open(linkedinUrl, '_blank');
                                  }}
                                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                  data-testid={`link-org-linkedin-${org.id}`}
                                >
                                  LinkedIn
                                </span>
                              )}
                              {(org.city || org.state) && (
                                <span className="text-sm text-gray-500">
                                  {[org.city, org.state].filter(Boolean).join(', ')}
                                </span>
                              )}
                            </div>
                            {org.description && (
                              <p className="text-sm text-gray-600 mt-2 line-clamp-2">{org.description}</p>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openFlagDialog(isOwner ? 'owner' : 'management_company');
                            }}
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                            title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                            data-testid={`button-flag-org-${org.id}`}
                          >
                            <Flag className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  {/* Fallback: Show enriched data if no organizations linked yet */}
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
                        <button
                          onClick={() => openFlagDialog('owner')}
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                          title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                          data-testid="button-flag-owner"
                        >
                          <Flag className="w-4 h-4" />
                        </button>
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
                        <button
                          onClick={() => openFlagDialog('management_company')}
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                          title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                          data-testid="button-flag-management"
                        >
                          <Flag className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Account Owner - Only show when no beneficial owner has been enriched */}
              {property.accountOwner && !enrichedProperty?.beneficialOwner && (
                <div className="py-2">
                  <span className="text-sm text-gray-500 block mb-1">Account Owner (DCAD)</span>
                  <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span className="text-gray-700">{toTitleCase(property.accountOwner)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Raw parcel data - run enrichment for beneficial owner details</p>
                </div>
              )}

              {/* Constituent Owners - Other registered owners if different from account owner */}
              {property.constituentOwners && property.constituentOwners.length > 0 && (
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer py-2 text-sm text-gray-600 hover:text-gray-800">
                    <span className="font-medium">Other Registered Owners ({property.constituentOwners.length})</span>
                    <svg className="w-4 h-4 transform transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {property.constituentOwners.map((owner, i) => (
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

              {!enrichedProperty?.beneficialOwner && !enrichedProperty?.managementCompany && !property.accountOwner && (!property.constituentOwners || property.constituentOwners.length === 0) && (
                <p className="text-gray-500">No ownership information available</p>
              )}
            </div>

            {/* Parent Property Link (for constituent properties) */}
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

            {/* Constituent Properties (for parent properties) */}
            {property.isParentProperty && constituentProperties.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <h2 className="text-lg font-semibold text-gray-900">Properties in Complex</h2>
                  <span className="ml-auto bg-emerald-100 text-emerald-800 text-xs font-medium px-2 py-0.5 rounded-full">
                    {constituentProperties.length} properties
                  </span>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  This property is a parent complex with multiple registered accounts on the same parcel.
                </p>
                <div className="space-y-2">
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
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Contacts ({contacts.length})
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddContactModal(true)}
                  data-testid="button-add-contact"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Contact
                </Button>
              </div>
              {contacts.length > 0 ? (
                <div className="space-y-3">
                  {sortContactsByRelevance(contacts).map((contact, i) => (
                    <div 
                      key={`${contact.id || contact.email}-${i}`} 
                      className={`p-4 bg-gray-50 rounded-lg transition-colors ${contact.id ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                      onClick={() => contact.id && router.push(`/contact/${contact.id}`)}
                      data-testid={`contact-row-${contact.id}`}
                    >
                      <div className="flex items-start space-x-3">
                        <ContactAvatar photoUrl={contact.photoUrl} name={contact.fullName || ''} />
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
                          
                          {/* Contact info validation summary icons */}
                          <div className="flex items-center gap-2 mt-2 mb-2">
                            <ContactInfoIcons contact={contact} />
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-3">
                            {contact.email ? (
                              <div className="flex items-center gap-2">
                                <a href={`mailto:${contact.email}`} className="text-sm text-green-600 hover:text-green-700">
                                  {contact.email}
                                </a>
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
                            ) : null}
                            
                            {contact.phone ? (
                              <a href={`tel:${contact.phone}`} className="text-sm text-gray-600 hover:text-gray-800">
                                {contact.phone}
                              </a>
                            ) : null}
                            
                            {contact.linkedinUrl && (
                              <a
                                href={contact.linkedinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center hover:opacity-80 transition-opacity"
                                title="View LinkedIn Profile"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <img src={linkedinLogo.src} alt="LinkedIn" className="w-4 h-4" />
                              </a>
                            )}
                            
                            {contact.id && (
                              <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </span>
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
                  <div className="w-12 h-12 text-gray-300 mx-auto mb-3 flex items-center justify-center">
                    <GreenfinchAgentIcon size={48} className="text-gray-300" />
                  </div>
                  <p className="text-gray-500 mb-3">No contacts discovered yet</p>
                  <AdminOnly>
                    <button
                      onClick={handleEnrichment}
                      className="text-sm text-green-600 hover:text-green-700"
                    >
                      Click "Research" to discover contacts
                    </button>
                  </AdminOnly>
                </div>
              )}
            </div>

            {/* Service Providers Section - Coming Soon */}
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

              {property.lat && property.lon && googleMapsApiKey && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="h-48 lg:h-56">
                    <StreetView
                      apiKey={googleMapsApiKey}
                      lat={property.lat}
                      lon={property.lon}
                    />
                  </div>
                  <div className="p-2 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      <span className="font-medium">Street View</span> - drag to explore
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setExpandedMapType('street')}
                      title="Expand street view"
                      data-testid="button-expand-street-view"
                      className="h-6 w-6"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
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
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowFlagDialog(false)} />
            
            <div className="relative inline-block w-full max-w-lg p-6 my-8 text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Flag {flagType === 'management_company' ? 'Management Company' : flagType === 'owner' ? 'Owner' : 'Information'} as Incorrect
                </h3>
                <button
                  onClick={() => setShowFlagDialog(false)}
                  className="text-gray-400 hover:text-gray-600"
                  data-testid="button-close-flag-dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Suggest correct organization (optional)
                  </label>
                  <div className="relative">
                    <div className="flex items-center">
                      <Search className="absolute left-3 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={selectedFlagOrg?.name || flagSearchQuery}
                        onChange={(e) => {
                          setSelectedFlagOrg(null);
                          handleFlagSearch(e.target.value);
                        }}
                        placeholder="Search organizations or type a new name..."
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                        data-testid="input-flag-search"
                      />
                    </div>
                    
                    {flagSearchResults.length > 0 && !selectedFlagOrg && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {flagSearchResults.map((org) => (
                          <button
                            key={org.id}
                            onClick={() => {
                              setSelectedFlagOrg({ id: org.id, name: org.name || '' });
                              setFlagSearchResults([]);
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                            data-testid={`button-select-org-${org.id}`}
                          >
                            <span className="font-medium text-gray-900">{org.name}</span>
                            {org.domain && (
                              <span className="text-xs text-gray-500">{org.domain}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {selectedFlagOrg && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-1 bg-green-100 text-green-800 text-sm rounded">
                          <Check className="w-3 h-3 mr-1" />
                          {selectedFlagOrg.name}
                        </span>
                        <button
                          onClick={() => setSelectedFlagOrg(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Search for an existing organization or type a new name
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Comments
                  </label>
                  <textarea
                    value={flagComments}
                    onChange={(e) => setFlagComments(e.target.value)}
                    placeholder="Why do you believe this is incorrect?"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                    data-testid="input-flag-comments"
                  />
                </div>

                {flagMessage && (
                  <div className={`p-3 rounded-md text-sm ${flagMessage.includes('Thank you') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {flagMessage}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowFlagDialog(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    data-testid="button-cancel-flag"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitFlag}
                    disabled={isSubmittingFlag}
                    className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
                    data-testid="button-submit-flag"
                  >
                    {isSubmittingFlag ? 'Submitting...' : 'Submit Flag'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Service Provider Dialog */}
      {showAddServiceProvider && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowAddServiceProvider(false)} />
            
            <div className="relative inline-block w-full max-w-lg p-6 my-8 text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Suggest a Service Provider
                </h3>
                <button
                  onClick={() => setShowAddServiceProvider(false)}
                  className="text-gray-400 hover:text-gray-600"
                  data-testid="button-close-service-provider-dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Service Category
                  </label>
                  <select
                    value={selectedServiceCategory}
                    onChange={(e) => setSelectedServiceCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                    data-testid="select-service-category"
                  >
                    <option value="">Select a service category...</option>
                    {SERVICE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {SERVICE_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Service Provider
                  </label>
                  <div className="relative">
                    <div className="flex items-center">
                      <Search className="absolute left-3 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={selectedServiceProvider?.name || serviceProviderSearch}
                        onChange={(e) => {
                          setSelectedServiceProvider(null);
                          handleServiceProviderSearch(e.target.value);
                        }}
                        placeholder="Search for a service provider..."
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                        data-testid="input-service-provider-search"
                      />
                    </div>
                    
                    {serviceProviderResults.length > 0 && !selectedServiceProvider && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {serviceProviderResults.map((provider) => (
                          <button
                            key={provider.id}
                            onClick={() => {
                              setSelectedServiceProvider({ id: provider.id, name: provider.name });
                              setServiceProviderResults([]);
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                            data-testid={`button-select-provider-${provider.id}`}
                          >
                            <span className="font-medium text-gray-900">{provider.name}</span>
                            {provider.domain && (
                              <span className="text-xs text-gray-500">{provider.domain}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {selectedServiceProvider && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-1 bg-green-100 text-green-800 text-sm rounded">
                          <Check className="w-3 h-3 mr-1" />
                          {selectedServiceProvider.name}
                        </span>
                        <button
                          onClick={() => setSelectedServiceProvider(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowAddServiceProvider(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    data-testid="button-cancel-service-provider"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitServiceProvider}
                    disabled={isSubmittingServiceProvider || !selectedServiceCategory || !selectedServiceProvider}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                    data-testid="button-submit-service-provider"
                  >
                    {isSubmittingServiceProvider ? 'Adding...' : 'Add Provider'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
