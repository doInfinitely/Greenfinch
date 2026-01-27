'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';

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

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  property_manager: 'bg-blue-100 text-blue-700',
  facilities_manager: 'bg-indigo-100 text-indigo-700',
  leasing: 'bg-teal-100 text-teal-700',
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
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);

  const handleEnrichOrganization = async () => {
    if (!organization) return;
    
    setIsEnriching(true);
    setEnrichMessage(null);
    
    try {
      const response = await fetch(`/api/organizations/${orgId}/enrich`, {
        method: 'POST',
      });
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        if (response.redirected || response.status === 307) {
          throw new Error('Session expired - please refresh the page');
        }
        throw new Error('Server returned an invalid response');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Enrichment failed');
      }
      
      setOrganization(data.organization);
      setEnrichMessage('Organization enriched successfully');
    } catch (err) {
      setEnrichMessage(err instanceof Error ? err.message : 'Failed to enrich');
    } finally {
      setIsEnriching(false);
    }
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
        <Header />
        <main className="max-w-7xl mx-auto px-6 py-8">
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
        <Header />
        <main className="max-w-7xl mx-auto px-6 py-8">
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
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
                    className="text-blue-600 hover:text-blue-700"
                    title="LinkedIn"
                    data-testid="link-org-linkedin"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                    </svg>
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
                {organization.domain && organization.enrichmentStatus !== 'complete' && (
                  <button
                    onClick={handleEnrichOrganization}
                    disabled={isEnriching}
                    className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-enrich-org"
                  >
                    {isEnriching ? (
                      <>
                        <svg className="animate-spin -ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Enriching...
                      </>
                    ) : (
                      'Enrich Company'
                    )}
                  </button>
                )}
                {enrichMessage && (
                  <span className={`text-xs ${enrichMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                    {enrichMessage}
                  </span>
                )}
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
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
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
                            {property.role}
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

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
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
                      <div className="ml-4 flex flex-col items-end gap-1">
                        {contact.emailStatus && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getEmailStatusColor(contact.emailStatus)}`}>
                            {contact.emailStatus}
                          </span>
                        )}
                        {contact.linkedinUrl && (
                          <a
                            href={contact.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-700"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                            </svg>
                          </a>
                        )}
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
