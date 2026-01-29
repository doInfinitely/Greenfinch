'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Flag, Check, X, ExternalLink } from 'lucide-react';
import Header from '@/components/Header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AdminOnly } from '@/components/PermissionGate';

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
  phoneLabel: 'direct_work' | 'office' | 'personal' | 'mobile' | null;
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
  providerId: string | null;
  enrichmentSource: string | null;
  enrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const PHONE_LABEL_CONFIG: Record<string, { label: string; color: string }> = {
  direct_work: { label: 'Direct', color: 'bg-green-100 text-green-700' },
  office: { label: 'Office', color: 'bg-blue-100 text-blue-700' },
  personal: { label: 'Personal', color: 'bg-purple-100 text-purple-700' },
  mobile: { label: 'Mobile', color: 'bg-teal-100 text-teal-700' },
};

const CONTACT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  individual: { label: 'Individual', color: 'bg-green-100 text-green-700' },
  general: { label: 'Office Line', color: 'bg-blue-100 text-blue-700' },
};

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
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);

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

  // Auto-fetch profile photo if contact has LinkedIn URL but no photo
  useEffect(() => {
    let isMounted = true;
    
    if (!contact) {
      setProfilePhotoUrl(null);
      setIsLoadingPhoto(false);
      return;
    }
    
    // Use cached photo from the database if available
    if (contact.photoUrl) {
      setProfilePhotoUrl(contact.photoUrl);
      setIsLoadingPhoto(false);
      return;
    }
    
    // Auto-fetch if we have a LinkedIn URL but no photo, and not already loading
    if (contact.linkedinUrl && !contact.photoUrl && !isLoadingPhoto) {
      setIsLoadingPhoto(true);
      
      fetch(`/api/contacts/${contact.id}/profile-photo`)
        .then(res => res.json())
        .then(data => {
          if (!isMounted) return;
          if (data.success && data.url) {
            setProfilePhotoUrl(data.url);
            // Also update local contact state so UI reflects the change
            setContact(prev => prev ? { ...prev, photoUrl: data.url } : null);
          }
          // If no photo available, the avatar fallback will show initials
        })
        .catch(err => {
          if (!isMounted) return;
          console.error('Failed to auto-fetch profile photo:', err);
          // Silent failure - avatar fallback will show initials
        })
        .finally(() => {
          if (isMounted) {
            setIsLoadingPhoto(false);
          }
        });
    }
    
    return () => {
      isMounted = false;
    };
  }, [contact?.id, contact?.photoUrl, contact?.linkedinUrl]);

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

  const handleMarkLinkedInIncorrect = async () => {
    if (!contact) return;
    
    setSelectingAlternative(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}/linkedin/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalUrl: contact.linkedinUrl,
          markAsIncorrect: true,
        }),
      });

      if (response.ok) {
        setContact(prev => prev ? { 
          ...prev, 
          linkedinUrl: null,
          linkedinConfidence: null,
          linkedinFlagged: true,
        } : null);
        setShowLinkedInAlternatives(false);
        setLinkedInMessage('Profile marked as incorrect');
      } else {
        setLinkedInMessage('Failed to update');
      }
    } catch (err) {
      setLinkedInMessage('Failed to update');
    } finally {
      setSelectingAlternative(false);
    }
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

  const handleEnrichContact = async () => {
    if (!contact) return;

    setIsEnriching(true);
    setEnrichMessage(null);

    try {
      const response = await fetch(`/api/contacts/${contactId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success) {
        setContact(prev => prev ? {
          ...prev,
          linkedinUrl: data.contact.linkedinUrl || prev.linkedinUrl,
          linkedinConfidence: data.contact.linkedinConfidence || prev.linkedinConfidence,
          linkedinStatus: data.contact.linkedinStatus || prev.linkedinStatus,
          email: data.contact.email || prev.email,
          emailConfidence: data.contact.emailConfidence || prev.emailConfidence,
          phone: data.contact.phone || prev.phone,
          phoneConfidence: data.contact.phoneConfidence || prev.phoneConfidence,
          title: data.contact.title || prev.title,
          employerName: data.contact.employerName || prev.employerName,
        } : null);
        
        const updates = [];
        if (data.enrichmentResult.linkedinUrl) updates.push('LinkedIn');
        if (data.enrichmentResult.email) updates.push('Email');
        if (data.enrichmentResult.phone) updates.push('Phone');
        
        setEnrichMessage(updates.length > 0 
          ? `Found: ${updates.join(', ')}` 
          : 'No additional information found');
      } else {
        setEnrichMessage(data.error || 'Enrichment failed');
      }
    } catch (err) {
      setEnrichMessage('Failed to enrich contact');
    } finally {
      setIsEnriching(false);
    }
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
            <div className="flex items-start gap-4">
              {/* Profile Photo Avatar */}
              <div className="relative flex-shrink-0" data-testid="contact-avatar-container">
                <Avatar className="w-20 h-20" data-testid="contact-avatar">
                  {isLoadingPhoto ? (
                    <AvatarFallback className="bg-muted" data-testid="avatar-loading">
                      <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin"></div>
                    </AvatarFallback>
                  ) : (
                    <>
                      {profilePhotoUrl && (
                        <AvatarImage 
                          src={profilePhotoUrl} 
                          alt={contact.fullName || 'Contact'}
                          onError={() => setProfilePhotoUrl(null)}
                          data-testid="avatar-image"
                        />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-semibold" data-testid="avatar-fallback">
                        {contact.fullName
                          ? contact.fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                          : '?'}
                      </AvatarFallback>
                    </>
                  )}
                </Avatar>
              </div>
              
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-gray-900">{contact.fullName || 'Unknown Contact'}</h1>
                  {contact.contactType && CONTACT_TYPE_CONFIG[contact.contactType] && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CONTACT_TYPE_CONFIG[contact.contactType].color}`}>
                      {CONTACT_TYPE_CONFIG[contact.contactType].label}
                    </span>
                  )}
                </div>
                {contact.title && (
                  <p className="text-lg text-gray-600 mt-1">{contact.title}</p>
                )}
                {contact.employerName && (
                  <p className="text-gray-500">{contact.employerName}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <AdminOnly>
                <button
                  onClick={handleEnrichContact}
                  disabled={isEnriching}
                  className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="button-enrich-contact"
                >
                  {isEnriching ? (
                    <>
                      <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Enriching...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Enrich Contact
                    </>
                  )}
                </button>
              </AdminOnly>
              {enrichMessage && (
                <span className={`text-sm ${enrichMessage.includes('Found') ? 'text-green-600' : 'text-amber-600'}`}>
                  {enrichMessage}
                </span>
              )}
              {contact.needsReview && (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full">
                  Needs Review
                </span>
              )}
            </div>
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
                  <div className="flex items-center gap-2">
                    <span className="text-gray-900">
                      {contact.phone || contact.normalizedPhone || '—'}
                    </span>
                    {contact.phoneLabel && PHONE_LABEL_CONFIG[contact.phoneLabel] && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PHONE_LABEL_CONFIG[contact.phoneLabel].color}`}>
                        {PHONE_LABEL_CONFIG[contact.phoneLabel].label}
                      </span>
                    )}
                    <LowConfidenceMarker confidence={contact.phoneConfidence} />
                  </div>
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
                          {!showLinkedInAlternatives && (
                            <button
                              onClick={handleFlagLinkedIn}
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                              title="Something doesn't look right? Flag for review"
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
                          <div className="space-y-3">
                            <p className="text-sm text-amber-700">
                              No alternative profiles available.
                            </p>
                            <button
                              onClick={handleMarkLinkedInIncorrect}
                              disabled={selectingAlternative}
                              className="inline-flex items-center px-3 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
                              data-testid="button-mark-incorrect"
                            >
                              <Flag className="w-4 h-4 mr-2" />
                              {selectingAlternative ? 'Updating...' : 'Mark as Incorrect'}
                            </button>
                          </div>
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
                    <div 
                      key={org.id} 
                      className="p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 hover:shadow-sm transition-all"
                      onClick={() => router.push(`/organization/${org.id}`)}
                      data-testid={`org-card-${org.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900">{org.name || 'Unknown'}</p>
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                          {org.title && (
                            <p className="text-sm text-gray-600">{org.title}</p>
                          )}
                          {org.domain && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`https://${org.domain}`, '_blank');
                              }}
                              className="text-sm text-green-600 hover:underline cursor-pointer"
                            >
                              {org.domain}
                            </span>
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

            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Contact data last refreshed:</span>
                <span className="text-gray-700 font-medium">
                  {new Date(contact.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>

            <AdminOnly>
              {(contact.enrichmentSource || contact.providerId || contact.enrichedAt) && (
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-blue-700">Enrichment Metadata</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    {contact.enrichmentSource && (
                      <div>
                        <span className="text-blue-600">Source:</span>
                        <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-medium uppercase" data-testid="text-contact-enrichment-source">
                          {contact.enrichmentSource}
                        </span>
                      </div>
                    )}
                    {contact.providerId && (
                      <div>
                        <span className="text-blue-600">Provider ID:</span>
                        <span className="ml-2 font-mono text-xs text-gray-600" data-testid="text-contact-provider-id">
                          {contact.providerId.length > 20 ? `${contact.providerId.substring(0, 20)}...` : contact.providerId}
                        </span>
                      </div>
                    )}
                    {contact.enrichedAt && (
                      <div>
                        <span className="text-blue-600">Enriched:</span>
                        <span className="ml-2 text-gray-700" data-testid="text-contact-enriched-at">
                          {new Date(contact.enrichedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </AdminOnly>
          </div>
        </div>
      </main>
    </div>
  );
}
