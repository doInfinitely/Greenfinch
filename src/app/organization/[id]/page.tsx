'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import { Loader2, XCircle, MoreVertical, FileJson, Users, Building2 } from 'lucide-react';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
import linkedinLogo from '@/assets/linkedin-logo.png';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, ROLE_COLORS, formatRoleLabel } from '@/lib/constants';

interface PropertyRelation {
  id: string;
  propertyKey: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  commonName: string | null;
  assetCategory: string | null;
  assetSubcategory: string | null;
  role: string | null;
}

interface ContactRelation {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  emailStatus: string | null;
  emailValidationStatus: string | null;
  linkedinUrl: string | null;
  isCurrent: boolean | null;
  contactTitle: string | null;
}

interface Organization {
  id: string;
  name: string | null;
  legalName: string | null;
  domain: string | null;
  orgType: string | null;
  description: string | null;
  foundedYear: number | null;
  
  // Industry classification
  sector: string | null;
  industryGroup: string | null;
  industry: string | null;
  subIndustry: string | null;
  
  // Company size
  employees: number | null;
  employeesRange: string | null;
  estimatedAnnualRevenue: string | null;
  
  // Location
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  
  // Social profiles
  linkedinHandle: string | null;
  twitterHandle: string | null;
  facebookHandle: string | null;
  crunchbaseHandle: string | null;
  
  // Logo
  logoUrl: string | null;
  
  // Parent companies
  parentDomain: string | null;
  parentOrgId: string | null;
  ultimateParentDomain: string | null;
  ultimateParentOrgId: string | null;
  
  // Enrichment status
  enrichmentStatus: string | null;
  enrichmentSource: string | null;
  lastEnrichedAt: string | null;
  providerId: string | null;
  
  createdAt: string;
  updatedAt: string;
}

const ORG_TYPE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  management: 'bg-blue-100 text-blue-700',
  tenant: 'bg-green-100 text-green-700',
  developer: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

function getEmailStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'valid':
      return 'bg-green-100 text-green-700';
    case 'invalid':
      return 'bg-red-100 text-red-700';
    case 'pending':
    case 'unverified':
      return 'bg-yellow-100 text-yellow-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.id as string;

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [properties, setProperties] = useState<PropertyRelation[]>([]);
  const [contacts, setContacts] = useState<ContactRelation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);
  const { startEnrichment } = useEnrichment();
  const { getEnrichmentStatus } = useEnrichmentQueue();

  const handleEnrichOrganization = async () => {
    if (!organization) return;
    
    setEnrichMessage('greenfinch.ai is researching - check the queue for progress');
    
    startEnrichment({
      type: 'organization',
      entityId: orgId as string,
      entityName: organization.name || organization.domain || 'Unknown Organization',
      apiEndpoint: `/api/organizations/${orgId}/enrich`,
      onSuccess: (data: unknown) => {
        const result = data as { organization: Organization };
        if (result.organization) {
          setOrganization(result.organization);
          setEnrichMessage('Research complete');
          setTimeout(() => setEnrichMessage(null), 5000);
        } else {
          setEnrichMessage(null);
        }
      },
      onError: () => {
        setEnrichMessage(null);
      },
    });
  };

  useEffect(() => {
    if (!orgId) return;

    const fetchOrganization = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/organizations/${orgId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch organization');
        }

        setOrganization(data.organization);
        setProperties(data.properties || []);
        setContacts(data.contacts || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    fetchOrganization();
  }, [orgId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
          <div className="text-center py-16">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {error || 'Organization not found'}
            </h2>
            <button
              onClick={() => router.back()}
              className="text-green-600 hover:text-green-700"
            >
              Go back
            </button>
          </div>
        </main>
      </div>
    );
  }

  const linkedinUrl = organization.linkedinHandle 
    ? `https://www.linkedin.com/company/${organization.linkedinHandle}` 
    : null;
  const twitterUrl = organization.twitterHandle 
    ? `https://twitter.com/${organization.twitterHandle}` 
    : null;
  const facebookUrl = organization.facebookHandle 
    ? `https://facebook.com/${organization.facebookHandle}` 
    : null;
  const crunchbaseUrl = organization.crunchbaseHandle 
    ? `https://www.crunchbase.com/organization/${organization.crunchbaseHandle}` 
    : null;
  
  const industryDisplay = [organization.industry, organization.subIndustry].filter(Boolean).join(' - ');

  const handleExportOrganizationData = () => {
    // Prepare organization data for export
    const exportData = {
      organization: {
        id: organization.id,
        name: organization.name,
        legalName: organization.legalName,
        domain: organization.domain,
        orgType: organization.orgType,
        description: organization.description,
        sector: organization.sector,
        industry: organization.industry,
        subIndustry: organization.subIndustry,
        employees: organization.employees,
        employeesRange: organization.employeesRange,
        location: organization.location,
        city: organization.city,
        state: organization.state,
        country: organization.country,
        linkedinHandle: organization.linkedinHandle,
        twitterHandle: organization.twitterHandle,
        logoUrl: organization.logoUrl,
      },
      properties: properties,
      contacts: contacts,
    };

    // Create and trigger download
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2)));
    element.setAttribute('download', `${organization.name || 'organization'}-export.json`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
            data-testid="button-back"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className="flex items-start gap-4">
            {organization.logoUrl && (
              <img 
                src={organization.logoUrl} 
                alt={`${organization.name} logo`}
                className="w-16 h-16 rounded-lg object-contain bg-white border border-gray-200 p-1"
                data-testid="img-org-logo"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900" data-testid="text-org-name">
                {organization.name || 'Unnamed Organization'}
              </h1>
              {organization.legalName && organization.legalName !== organization.name && (
                <p className="text-sm text-gray-500">{organization.legalName}</p>
              )}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {organization.orgType && (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ORG_TYPE_COLORS[organization.orgType] || ORG_TYPE_COLORS.other}`}>
                    {organization.orgType}
                  </span>
                )}
                {organization.domain && (
                  <a
                    href={`https://${organization.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-600 hover:text-green-700 hover:underline text-sm"
                    data-testid="link-org-domain"
                  >
                    {organization.domain}
                  </a>
                )}
                {linkedinUrl && (
                  <a
                    href={linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity"
                    title="LinkedIn"
                    data-testid="link-org-linkedin"
                  >
                    <img src={linkedinLogo.src} alt="LinkedIn" className="w-4 h-4" />
                  </a>
                )}
                {twitterUrl && (
                  <a
                    href={twitterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-500 hover:text-sky-600"
                    title="Twitter/X"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </a>
                )}
                {(() => {
                  const queueStatus = getEnrichmentStatus(orgId as string, 'organization');
                  const isEnrichmentActive = queueStatus.isActive;
                  const enrichmentHasFailed = queueStatus.status === 'failed';
                  
                  // Hide button if enrichment already completed successfully
                  if (!organization.domain || organization.enrichmentStatus === 'complete') return null;
                  
                  return (
                    <AdminOnly>
                      <button
                        onClick={handleEnrichOrganization}
                        disabled={isEnrichmentActive || enrichmentHasFailed}
                        className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded disabled:cursor-not-allowed ${
                          enrichmentHasFailed 
                            ? 'bg-gray-100 text-gray-500' 
                            : 'bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50'
                        }`}
                        title={enrichmentHasFailed ? `Failed: ${queueStatus.error || 'Unknown error'}` : undefined}
                        data-testid="button-enrich-org"
                      >
                        {isEnrichmentActive ? (
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        ) : enrichmentHasFailed ? (
                          <XCircle className="w-3 h-3 mr-1.5" />
                        ) : (
                          <GreenfinchAgentIcon size={12} className="mr-1.5" />
                        )}
                        {isEnrichmentActive ? 'Researching...' : enrichmentHasFailed ? 'Failed' : 'Research Company'}
                      </button>
                    </AdminOnly>
                  );
                })()}
                {enrichMessage && (
                  <span className="text-xs text-green-600">
                    {enrichMessage}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="icon"
                      className="h-9 w-9"
                      data-testid="button-org-actions"
                      title="Organization actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem 
                      onClick={() => {
                        // Scroll to properties section
                        const propertiesSection = document.getElementById('properties-section');
                        if (propertiesSection) {
                          propertiesSection.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                      data-testid="menu-item-view-properties"
                    >
                      <Building2 className="w-4 h-4 mr-2" />
                      View all properties ({properties.length})
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => {
                        // Scroll to contacts section
                        const contactsSection = document.getElementById('contacts-section');
                        if (contactsSection) {
                          contactsSection.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                      data-testid="menu-item-view-contacts"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      View all contacts ({contacts.length})
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={handleExportOrganizationData}
                      data-testid="menu-item-export"
                    >
                      <FileJson className="w-4 h-4 mr-2" />
                      Export organization data
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        {organization.description && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <p className="text-gray-700 text-sm leading-relaxed" data-testid="text-org-description">
              {organization.description}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {industryDisplay && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Industry</p>
              <p className="text-sm font-medium text-gray-900" data-testid="text-org-industry">{industryDisplay}</p>
              {organization.sector && (
                <p className="text-xs text-gray-500 mt-1">Sector: {organization.sector}</p>
              )}
            </div>
          )}
          
          {(organization.employees || organization.employeesRange) && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Company Size</p>
              <p className="text-sm font-medium text-gray-900" data-testid="text-org-employees">
                {organization.employees?.toLocaleString() || organization.employeesRange} employees
              </p>
              {organization.estimatedAnnualRevenue && (
                <p className="text-xs text-gray-500 mt-1">Revenue: {organization.estimatedAnnualRevenue}</p>
              )}
            </div>
          )}
          
          {organization.location && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Location</p>
              <p className="text-sm font-medium text-gray-900" data-testid="text-org-location">{organization.location}</p>
              {organization.foundedYear && (
                <p className="text-xs text-gray-500 mt-1">Founded: {organization.foundedYear}</p>
              )}
            </div>
          )}
        </div>

        {(organization.parentDomain || organization.ultimateParentDomain) && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Parent Companies</p>
            <div className="flex flex-wrap gap-4">
              {organization.parentDomain && (
                <div>
                  <p className="text-xs text-gray-500">Parent</p>
                  {organization.parentOrgId ? (
                    <Link
                      href={`/organization/${organization.parentOrgId}`}
                      className="text-sm text-green-600 hover:text-green-700 hover:underline"
                      data-testid="link-parent-org"
                    >
                      {organization.parentDomain}
                    </Link>
                  ) : (
                    <a
                      href={`https://${organization.parentDomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-600 hover:text-green-700 hover:underline"
                    >
                      {organization.parentDomain}
                    </a>
                  )}
                </div>
              )}
              {organization.ultimateParentDomain && organization.ultimateParentDomain !== organization.parentDomain && (
                <div>
                  <p className="text-xs text-gray-500">Ultimate Parent</p>
                  {organization.ultimateParentOrgId ? (
                    <Link
                      href={`/organization/${organization.ultimateParentOrgId}`}
                      className="text-sm text-green-600 hover:text-green-700 hover:underline"
                      data-testid="link-ultimate-parent-org"
                    >
                      {organization.ultimateParentDomain}
                    </Link>
                  ) : (
                    <a
                      href={`https://${organization.ultimateParentDomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-600 hover:text-green-700 hover:underline"
                    >
                      {organization.ultimateParentDomain}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div id="properties-section" className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">
                Properties ({properties.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {properties.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No properties associated with this organization
                </div>
              ) : (
                properties.map((property) => (
                  <Link
                    key={property.id}
                    href={`/property/${property.id}`}
                    className="block px-6 py-4 hover:bg-gray-50"
                    data-testid={`link-property-${property.id}`}
                    aria-label={`View property ${property.commonName || property.address || 'details'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {property.commonName && (
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {property.commonName}
                          </p>
                        )}
                        <p className="text-sm text-gray-600 truncate">
                          {property.address || 'No address'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
                        </p>
                      </div>
                      <div className="ml-4 flex flex-col items-end gap-1">
                        {property.role && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[property.role.split(',')[0].trim()] || ROLE_COLORS.other}`}>
                            {formatRoleLabel(property.role)}
                          </span>
                        )}
                        {property.assetCategory && (
                          <span className="text-xs text-gray-400">
                            {property.assetCategory}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div id="contacts-section" className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">
                Contacts ({contacts.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {contacts.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No contacts associated with this organization
                </div>
              ) : (
                contacts.map((contact) => (
                  <Link
                    key={contact.id}
                    href={`/contact/${contact.id}`}
                    className="block px-6 py-4 hover:bg-gray-50"
                    data-testid={`link-contact-${contact.id}`}
                    aria-label={`View contact ${contact.fullName || 'details'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {contact.fullName || 'Unnamed Contact'}
                        </p>
                        {contact.title && (
                          <p className="text-sm text-gray-600 truncate">
                            {contact.title}
                          </p>
                        )}
                        {contact.email && (
                          <p className="text-xs text-gray-400 truncate">
                            {contact.email}
                          </p>
                        )}
                      </div>
                      <div className="ml-4 flex items-center gap-1.5">
                        <EmailStatusIcon 
                          hasEmail={!!contact.email} 
                          status={contact.emailValidationStatus || contact.emailStatus}
                          size="sm"
                        />
                        <PhoneStatusIcon 
                          hasPhone={!!contact.phone}
                          size="sm"
                        />
                        <LinkedInStatusIcon 
                          hasLinkedIn={!!contact.linkedinUrl}
                          size="sm"
                        />
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
