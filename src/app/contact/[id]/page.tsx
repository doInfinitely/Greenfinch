'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Flag, Check, X, ExternalLink } from 'lucide-react';
import Header from '@/components/Header';

interface LinkedInSearchResult {
  name: string;
  title: string;
  url: string;
  company?: string;
  location?: string;
  confidence: number;
}

interface PropertyRelation {
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

interface OrgRelation {
  id: string;
  name: string | null;
  domain: string | null;
  orgType: string | null;
  title: string | null;
  isCurrent: boolean | null;
}

interface Contact {
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
  title: string | null;
  titleConfidence: number | null;
  companyDomain: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinConfidence: number | null;
  linkedinStatus: string | null;
  linkedinSearchResults: LinkedInSearchResult[] | null;
  linkedinFlagged: boolean | null;
  source: string | null;
  needsReview: boolean | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  property_manager: 'Property Manager',
  asset_manager: 'Asset Manager',
  facilities: 'Facilities',
  leasing: 'Leasing',
  other: 'Other',
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  property_manager: 'bg-blue-100 text-blue-700',
  asset_manager: 'bg-indigo-100 text-indigo-700',
  facilities: 'bg-orange-100 text-orange-700',
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

function EmailStatusBadge({ status }: { status: string | null }) {
  const config: Record<string, { color: string; label: string }> = {
    valid: { color: 'bg-green-100 text-green-700', label: 'Valid' },
    invalid: { color: 'bg-red-100 text-red-700', label: 'Invalid' },
    pending: { color: 'bg-yellow-100 text-yellow-700', label: 'Pending' },
    unverified: { color: 'bg-gray-100 text-gray-600', label: 'Unverified' },
  };
  
  const { color, label } = config[status?.toLowerCase() || ''] || config.unverified;
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contactId = params?.id as string;

  const [contact, setContact] = useState<Contact | null>(null);
  const [properties, setProperties] = useState<PropertyRelation[]>([]);
  const [organizations, setOrganizations] = useState<OrgRelation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFindingLinkedIn, setIsFindingLinkedIn] = useState(false);
  const [linkedInMessage, setLinkedInMessage] = useState<string | null>(null);
  const [showLinkedInAlternatives, setShowLinkedInAlternatives] = useState(false);
  const [selectingAlternative, setSelectingAlternative] = useState(false);

  useEffect(() => {
    if (!contactId) return;

    const fetchContact = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/contacts/${contactId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch contact');
        }

        setContact(data.contact);
        setProperties(data.properties || []);
        setOrganizations(data.organizations || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    fetchContact();
  }, [contactId]);

  const handleFindLinkedIn = async () => {
    if (!contact) return;

    setIsFindingLinkedIn(true);
    setLinkedInMessage(null);

    try {
      const response = await fetch(`/api/contacts/${contactId}/linkedin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success) {
        setContact(prev => prev ? { ...prev, linkedinUrl: data.linkedinUrl } : null);
        setLinkedInMessage(data.alreadyExists ? 'LinkedIn profile already on file' : 'LinkedIn profile found!');
      } else {
        setLinkedInMessage(data.message || 'Could not find LinkedIn profile');
      }
    } catch (err) {
      setLinkedInMessage('Failed to search for LinkedIn profile');
    } finally {
      setIsFindingLinkedIn(false);
    }
  };

  const handleFlagLinkedIn = () => {
    setShowLinkedInAlternatives(true);
    setLinkedInMessage(null);
  };

  const handleSelectAlternative = async (alternative: LinkedInSearchResult, index: number) => {
    if (!contact) return;
    
    setSelectingAlternative(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}/linkedin/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalUrl: contact.linkedinUrl,
          selectedUrl: alternative.url,
          selectedIndex: index,
        }),
      });

      if (response.ok) {
        setContact(prev => prev ? { 
          ...prev, 
          linkedinUrl: alternative.url,
          linkedinConfidence: alternative.confidence,
          linkedinFlagged: true,
        } : null);
        setShowLinkedInAlternatives(false);
        setLinkedInMessage('Profile updated successfully');
      } else {
        setLinkedInMessage('Failed to update profile');
      }
    } catch (err) {
      setLinkedInMessage('Failed to update profile');
    } finally {
      setSelectingAlternative(false);
    }
  };

  const getAlternativeProfiles = () => {
    if (!contact?.linkedinSearchResults) return [];
    return contact.linkedinSearchResults.filter(r => r.url !== contact.linkedinUrl).slice(0, 3);
  };

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

  if (error || !contact) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-center py-16">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Contact Not Found</h2>
            <p className="text-gray-500 mb-4">{error || 'The requested contact could not be found.'}</p>
            <button
              onClick={() => router.push('/contacts')}
              className="text-green-600 hover:text-green-700 font-medium"
            >
              Back to Contacts
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{contact.fullName || 'Unknown Contact'}</h1>
              {contact.title && (
                <p className="text-lg text-gray-600 mt-1">{contact.title}</p>
              )}
              {contact.employerName && (
                <p className="text-gray-500">{contact.employerName}</p>
              )}
            </div>
            {contact.needsReview && (
              <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full">
                Needs Review
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Full Name</label>
                  <p className="text-gray-900">
                    {contact.fullName || '—'}
                    <LowConfidenceMarker confidence={contact.nameConfidence} />
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Title</label>
                  <p className="text-gray-900">
                    {contact.title || '—'}
                    <LowConfidenceMarker confidence={contact.titleConfidence} />
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Email</label>
                  <div className="flex items-center gap-2">
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className="text-green-600 hover:text-green-700 hover:underline">
                        {contact.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                    {contact.emailStatus && <EmailStatusBadge status={contact.emailStatus} />}
                    <LowConfidenceMarker confidence={contact.emailConfidence} />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Phone</label>
                  <p className="text-gray-900">
                    {contact.phone || contact.normalizedPhone || '—'}
                    <LowConfidenceMarker confidence={contact.phoneConfidence} />
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Employer</label>
                  <p className="text-gray-900">{contact.employerName || '—'}</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Company Domain</label>
                  {contact.companyDomain ? (
                    <a 
                      href={`https://${contact.companyDomain}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-green-600 hover:text-green-700 hover:underline"
                    >
                      {contact.companyDomain}
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-500 mb-1">LinkedIn</label>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      {contact.linkedinUrl ? (
                        <>
                          <a 
                            href={contact.linkedinUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-green-600 hover:text-green-700 hover:underline flex items-center gap-1"
                            data-testid="link-linkedin-profile"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                            </svg>
                            View Profile
                            <LowConfidenceMarker confidence={contact.linkedinConfidence} />
                          </a>
                          {contact.linkedinSearchResults && contact.linkedinSearchResults.length > 1 && !showLinkedInAlternatives && (
                            <button
                              onClick={handleFlagLinkedIn}
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                              title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                              data-testid="button-flag-linkedin"
                            >
                              <Flag className="w-4 h-4" />
                            </button>
                          )}
                          {contact.linkedinFlagged && (
                            <span className="text-xs text-gray-500">(Updated by user)</span>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={handleFindLinkedIn}
                          disabled={isFindingLinkedIn}
                          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          data-testid="button-find-linkedin"
                        >
                          {isFindingLinkedIn ? (
                            <>
                              <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              Searching...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                              </svg>
                              Find LinkedIn
                            </>
                          )}
                        </button>
                      )}
                      {linkedInMessage && (
                        <span className={`text-sm ${linkedInMessage.includes('success') || linkedInMessage.includes('found') ? 'text-green-600' : 'text-gray-500'}`}>
                          {linkedInMessage}
                        </span>
                      )}
                    </div>

                    {showLinkedInAlternatives && (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-medium text-amber-800">Select the correct profile:</h4>
                          <button
                            onClick={() => setShowLinkedInAlternatives(false)}
                            className="text-amber-600 hover:text-amber-800"
                            data-testid="button-close-alternatives"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        
                        {getAlternativeProfiles().length > 0 ? (
                          <div className="space-y-2">
                            {getAlternativeProfiles().map((alt, index) => (
                              <div 
                                key={alt.url}
                                className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-green-300"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 truncate">{alt.name}</p>
                                  {alt.title && (
                                    <p className="text-sm text-gray-600 truncate">{alt.title}</p>
                                  )}
                                  {alt.company && (
                                    <p className="text-xs text-gray-500 truncate">{alt.company}</p>
                                  )}
                                  <span className="text-xs text-gray-400">
                                    {Math.round(alt.confidence * 100)}% match
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 ml-3">
                                  <a
                                    href={alt.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 text-gray-400 hover:text-blue-600"
                                    title="View profile"
                                    data-testid={`link-alternative-${index}`}
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </a>
                                  <button
                                    onClick={() => handleSelectAlternative(alt, index)}
                                    disabled={selectingAlternative}
                                    className="inline-flex items-center px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50"
                                    data-testid={`button-select-alternative-${index}`}
                                  >
                                    <Check className="w-3 h-3 mr-1" />
                                    Select
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-amber-700">
                            No alternative profiles available. The search only found one matching profile.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Source</label>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                    {contact.source || 'Unknown'}
                  </span>
                </div>
                
                {contact.reviewReason && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-500 mb-1">Review Reason</label>
                    <p className="text-yellow-700 bg-yellow-50 px-3 py-2 rounded">{contact.reviewReason}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Associated Properties
                <span className="ml-2 text-sm font-normal text-gray-500">({properties.length})</span>
              </h2>
              
              {properties.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No properties associated with this contact.</p>
              ) : (
                <div className="space-y-3">
                  {properties.map((prop) => (
                    <Link
                      key={prop.id}
                      href={`/property/${prop.id}`}
                      className="block p-4 border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            {prop.address || 'Unknown Address'}
                          </p>
                          {prop.commonName && (
                            <p className="text-sm text-gray-600">{prop.commonName}</p>
                          )}
                          <p className="text-sm text-gray-500">
                            {[prop.city, prop.state, prop.zip].filter(Boolean).join(', ')}
                          </p>
                          {prop.assetCategory && (
                            <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                              {prop.assetCategory}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          {prop.role && (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[prop.role] || ROLE_COLORS.other}`}>
                              {ROLE_LABELS[prop.role] || prop.role}
                            </span>
                          )}
                          <LowConfidenceMarker confidence={prop.confidenceScore} />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Organizations
                <span className="ml-2 text-sm font-normal text-gray-500">({organizations.length})</span>
              </h2>
              
              {organizations.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No organizations linked.</p>
              ) : (
                <div className="space-y-3">
                  {organizations.map((org) => (
                    <div key={org.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{org.name || 'Unknown'}</p>
                          {org.title && (
                            <p className="text-sm text-gray-600">{org.title}</p>
                          )}
                          {org.domain && (
                            <a 
                              href={`https://${org.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-green-600 hover:underline"
                            >
                              {org.domain}
                            </a>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {org.orgType && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORG_TYPE_COLORS[org.orgType] || ORG_TYPE_COLORS.other}`}>
                              {org.orgType}
                            </span>
                          )}
                          {org.isCurrent !== null && (
                            <span className={`text-xs ${org.isCurrent ? 'text-green-600' : 'text-gray-400'}`}>
                              {org.isCurrent ? 'Current' : 'Former'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Metadata</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="text-gray-900">
                    {new Date(contact.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Updated</span>
                  <span className="text-gray-900">
                    {new Date(contact.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Contact ID</span>
                  <span className="text-gray-500 text-xs font-mono truncate max-w-[150px]" title={contact.id}>
                    {contact.id}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
