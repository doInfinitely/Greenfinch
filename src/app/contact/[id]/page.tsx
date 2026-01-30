'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Flag, Check, X, ExternalLink, Mail, Phone, Linkedin, CheckCircle, HelpCircle, XCircle, Search, Loader2 } from 'lucide-react';
import Header from '@/components/Header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import { formatPhoneNumber } from '@/lib/phone-format';

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
  phoneSource: string | null;
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
  facilities_manager: 'Facilities Manager',
  leasing: 'Leasing',
  other: 'Other',
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  property_manager: 'bg-blue-100 text-blue-700',
  asset_manager: 'bg-indigo-100 text-indigo-700',
  facilities: 'bg-orange-100 text-orange-700',
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

// Validation status icon for email - shows whether email exists and is validated
function EmailValidationIcon({ hasEmail, status }: { hasEmail: boolean; status: string | null }) {
  if (!hasEmail) {
    // No email - X icon
    return (
      <span title="No email" className="inline-flex items-center text-gray-400">
        <span className="relative">
          <Mail className="w-4 h-4" />
          <XCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-gray-400 bg-white rounded-full" />
        </span>
      </span>
    );
  }
  
  const normalizedStatus = status?.toLowerCase();
  
  if (normalizedStatus === 'valid') {
    // Validated email - checkmark
    return (
      <span title="Email validated" className="inline-flex items-center text-green-600">
        <span className="relative">
          <Mail className="w-4 h-4" />
          <CheckCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-green-600 bg-white rounded-full" />
        </span>
      </span>
    );
  }
  
  if (normalizedStatus === 'pending') {
    // Email validation in progress - spinner
    return (
      <span title="Validating email..." className="inline-flex items-center text-amber-500">
        <span className="relative">
          <Mail className="w-4 h-4" />
          <div className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 border border-amber-500 border-t-transparent rounded-full animate-spin bg-white" />
        </span>
      </span>
    );
  }
  
  // Has email but not validated - question mark
  return (
    <span title="Email not validated" className="inline-flex items-center text-amber-500">
      <span className="relative">
        <Mail className="w-4 h-4" />
        <HelpCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-amber-500 bg-white rounded-full" />
      </span>
    </span>
  );
}

// Validation status icon for phone
function PhoneValidationIcon({ hasPhone }: { hasPhone: boolean }) {
  if (!hasPhone) {
    return (
      <span title="No phone" className="inline-flex items-center text-gray-400">
        <span className="relative">
          <Phone className="w-4 h-4" />
          <XCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-gray-400 bg-white rounded-full" />
        </span>
      </span>
    );
  }
  
  // Has phone - show checkmark (phones from enrichment are considered validated)
  return (
    <span title="Phone available" className="inline-flex items-center text-green-600">
      <span className="relative">
        <Phone className="w-4 h-4" />
        <CheckCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-green-600 bg-white rounded-full" />
      </span>
    </span>
  );
}

// Validation status icon for LinkedIn
function LinkedInValidationIcon({ hasLinkedIn, confidence }: { hasLinkedIn: boolean; confidence: number | null }) {
  if (!hasLinkedIn) {
    return (
      <span title="No LinkedIn" className="inline-flex items-center text-gray-400">
        <span className="relative">
          <Linkedin className="w-4 h-4" />
          <XCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-gray-400 bg-white rounded-full" />
        </span>
      </span>
    );
  }
  
  // High confidence (>= 0.7) or any LinkedIn URL present
  const isValidated = confidence !== null && confidence >= 0.7;
  
  if (isValidated) {
    return (
      <span title={`LinkedIn validated (${Math.round((confidence || 0) * 100)}% confidence)`} className="inline-flex items-center text-green-600">
        <span className="relative">
          <Linkedin className="w-4 h-4" />
          <CheckCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-green-600 bg-white rounded-full" />
        </span>
      </span>
    );
  }
  
  // Has LinkedIn but low confidence
  return (
    <span title={`LinkedIn needs review (${Math.round((confidence || 0) * 100)}% confidence)`} className="inline-flex items-center text-amber-500">
      <span className="relative">
        <Linkedin className="w-4 h-4" />
        <HelpCircle className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-amber-500 bg-white rounded-full" />
      </span>
    </span>
  );
}

// Contact info summary row with validation icons
function ContactInfoSummary({ contact }: { contact: Contact }) {
  return (
    <div className="flex items-center gap-3" data-testid="contact-info-summary">
      <EmailValidationIcon 
        hasEmail={!!contact.email} 
        status={contact.emailValidationStatus} 
      />
      <PhoneValidationIcon 
        hasPhone={!!(contact.phone || contact.normalizedPhone)} 
      />
      <LinkedInValidationIcon 
        hasLinkedIn={!!contact.linkedinUrl} 
        confidence={contact.linkedinConfidence} 
      />
    </div>
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
  const [showLinkedInAlternatives, setShowLinkedInAlternatives] = useState(false);
  const [selectingAlternative, setSelectingAlternative] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const { startEnrichment } = useEnrichment();
  const { items: enrichmentItems, getEnrichmentStatus } = useEnrichmentQueue();
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);
  const [isFindingPhone, setIsFindingPhone] = useState(false);
  const [isFindingEmail, setIsFindingEmail] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    
    try {
      const response = await fetch(`/api/contacts/${contactId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch contact');
      }

      setContact(data.contact);
      setProperties(data.properties || []);
      setOrganizations(data.organizations || []);
      setIsFindingPhone(false);
      setIsFindingEmail(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, [contactId]);

  useEffect(() => {
    if (!contactId) return;

    setIsLoading(true);
    setError(null);
    fetchContact().finally(() => setIsLoading(false));
  }, [contactId, fetchContact]);

  // Refetch contact when enrichment completes for this contact
  useEffect(() => {
    const completedItem = enrichmentItems.find(
      item => 
        item.entityId === contactId && 
        item.status === 'completed' &&
        (item.type === 'contact_phone' || item.type === 'contact_email' || item.type === 'contact')
    );
    
    if (completedItem) {
      fetchContact();
    }
  }, [enrichmentItems, contactId, fetchContact]);

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

  const handleFlagLinkedIn = () => {
    setShowLinkedInAlternatives(true);
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

  const handleFindPhone = async () => {
    if (!contact) return;

    setIsFindingPhone(true);
    setPhoneMessage(null);

    // Track the original enrichedAt timestamp to detect when webhook updates the contact
    const originalEnrichedAt = contact.enrichedAt;

    // Start enrichment - polling runs in background via context even if user navigates away
    startEnrichment({
      type: 'contact_phone',
      entityId: contactId,
      entityName: `${contact.fullName || 'Contact'} - Phone`,
      apiEndpoint: `/api/contacts/${contactId}/waterfall-phone`,
      pollForCompletion: {
        checkEndpoint: `/api/contacts/${contactId}`,
        checkField: 'contact.enrichedAt',
        originalValue: originalEnrichedAt,
        compareMode: 'changed',
        maxAttempts: 20,
        intervalMs: 3000,
      },
    });
  };

  const handleFindEmail = async () => {
    if (!contact) return;

    setIsFindingEmail(true);
    setEmailMessage(null);

    // Track the original enrichedAt timestamp to detect when webhook updates the contact
    const originalEnrichedAt = contact.enrichedAt;

    // Start enrichment - polling runs in background via context even if user navigates away
    startEnrichment({
      type: 'contact_email',
      entityId: contactId,
      entityName: `${contact.fullName || 'Contact'} - Email`,
      apiEndpoint: `/api/contacts/${contactId}/waterfall-email`,
      pollForCompletion: {
        checkEndpoint: `/api/contacts/${contactId}`,
        checkField: 'contact.enrichedAt',
        originalValue: originalEnrichedAt,
        compareMode: 'changed',
        maxAttempts: 20,
        intervalMs: 3000,
      },
    });
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
                  {contact.linkedinUrl && (
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#0A66C2] hover:text-[#004182] transition-colors"
                      title="View LinkedIn Profile"
                      data-testid="link-linkedin-header"
                    >
                      <Linkedin className="w-5 h-5" />
                    </a>
                  )}
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
                {/* Contact info validation summary icons */}
                <div className="mt-2">
                  <ContactInfoSummary contact={contact} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Find Phone button - show if no phone or only office phone */}
              {(() => {
                const phoneStatus = getEnrichmentStatus(contactId as string, 'contact_phone');
                const needsPhone = (!contact.phone && !contact.normalizedPhone) || contact.phoneLabel === 'office';
                const isPhoneActive = phoneStatus.isActive || isFindingPhone;
                const phoneHasFailed = phoneStatus.status === 'failed';
                
                if (!needsPhone) return null;
                
                return (
                  <AdminOnly>
                    <button
                      onClick={handleFindPhone}
                      disabled={isPhoneActive || phoneHasFailed}
                      className={`inline-flex items-center px-3 py-2 text-white text-sm font-medium rounded-lg disabled:cursor-not-allowed ${
                        phoneHasFailed 
                          ? 'bg-gray-400 hover:bg-gray-400' 
                          : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                      }`}
                      title={phoneHasFailed ? `Failed: ${phoneStatus.error || 'Unknown error'}` : undefined}
                      data-testid="button-find-phone"
                    >
                      {isPhoneActive ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : phoneHasFailed ? (
                        <XCircle className="w-4 h-4 mr-2" />
                      ) : (
                        <Phone className="w-4 h-4 mr-2" />
                      )}
                      {isPhoneActive ? 'Looking up...' : phoneHasFailed ? 'Lookup Failed' : 'Find Phone'}
                    </button>
                  </AdminOnly>
                );
              })()}
              
              {/* Find Email button - show if no email or email not validated (including null/undefined status) */}
              {(() => {
                const emailStatus = getEnrichmentStatus(contactId as string, 'contact_email');
                const needsEmail = !contact.email || contact.emailValidationStatus !== 'valid';
                const isEmailActive = emailStatus.isActive || isFindingEmail;
                const emailHasFailed = emailStatus.status === 'failed';
                
                if (!needsEmail) return null;
                
                return (
                  <AdminOnly>
                    <button
                      onClick={handleFindEmail}
                      disabled={isEmailActive || emailHasFailed}
                      className={`inline-flex items-center px-3 py-2 text-white text-sm font-medium rounded-lg disabled:cursor-not-allowed ${
                        emailHasFailed 
                          ? 'bg-gray-400 hover:bg-gray-400' 
                          : 'bg-purple-600 hover:bg-purple-700 disabled:opacity-50'
                      }`}
                      title={emailHasFailed ? `Failed: ${emailStatus.error || 'Unknown error'}` : undefined}
                      data-testid="button-find-email"
                    >
                      {isEmailActive ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : emailHasFailed ? (
                        <XCircle className="w-4 h-4 mr-2" />
                      ) : (
                        <Mail className="w-4 h-4 mr-2" />
                      )}
                      {isEmailActive ? 'Looking up...' : emailHasFailed ? 'Lookup Failed' : 'Find Email'}
                    </button>
                  </AdminOnly>
                );
              })()}
              
              {phoneMessage && (
                <span className="text-sm text-blue-600">
                  {phoneMessage}
                </span>
              )}
              {emailMessage && (
                <span className="text-sm text-purple-600">
                  {emailMessage}
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
                    <EmailValidationIcon hasEmail={!!contact.email} status={contact.emailValidationStatus} />
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className="text-green-600 hover:text-green-700 hover:underline">
                        {contact.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                    <LowConfidenceMarker confidence={contact.emailConfidence} />
                  </div>
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-500 mb-1">Phone Numbers</label>
                  <div className="space-y-2">
                    {/* Primary phone */}
                    {(contact.phone || contact.normalizedPhone) && (
                      <div className="flex items-center gap-2">
                        <PhoneValidationIcon hasPhone={true} />
                        <a href={`tel:${contact.normalizedPhone || contact.phone}`} className="text-gray-900 hover:text-green-600">
                          {formatPhoneNumber(contact.phone || contact.normalizedPhone)}
                        </a>
                        {contact.phoneLabel && PHONE_LABEL_CONFIG[contact.phoneLabel] && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PHONE_LABEL_CONFIG[contact.phoneLabel].color}`}>
                            {PHONE_LABEL_CONFIG[contact.phoneLabel].label}
                          </span>
                        )}
                        <LowConfidenceMarker confidence={contact.phoneConfidence} />
                      </div>
                    )}
                    {/* Work phone from enrichment */}
                    {contact.enrichmentPhoneWork && contact.enrichmentPhoneWork !== contact.phone && (
                      <div className="flex items-center gap-2">
                        <PhoneValidationIcon hasPhone={true} />
                        <a href={`tel:${contact.enrichmentPhoneWork}`} className="text-gray-900 hover:text-green-600">
                          {formatPhoneNumber(contact.enrichmentPhoneWork)}
                        </a>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                          Work
                        </span>
                      </div>
                    )}
                    {/* Personal/mobile phone from enrichment */}
                    {contact.enrichmentPhonePersonal && contact.enrichmentPhonePersonal !== contact.phone && (
                      <div className="flex items-center gap-2">
                        <PhoneValidationIcon hasPhone={true} />
                        <a href={`tel:${contact.enrichmentPhonePersonal}`} className="text-gray-900 hover:text-green-600">
                          {formatPhoneNumber(contact.enrichmentPhonePersonal)}
                        </a>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-100 text-teal-700">
                          Mobile
                        </span>
                      </div>
                    )}
                    {/* AI-discovered phone */}
                    {contact.aiPhone && contact.aiPhone !== contact.phone && contact.aiPhone !== contact.enrichmentPhoneWork && contact.aiPhone !== contact.enrichmentPhonePersonal && (
                      <div className="flex items-center gap-2">
                        <PhoneValidationIcon hasPhone={true} />
                        <a href={`tel:${contact.aiPhone}`} className="text-gray-900 hover:text-green-600">
                          {formatPhoneNumber(contact.aiPhone)}
                        </a>
                        {contact.aiPhoneLabel && PHONE_LABEL_CONFIG[contact.aiPhoneLabel] ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PHONE_LABEL_CONFIG[contact.aiPhoneLabel].color}`}>
                            {PHONE_LABEL_CONFIG[contact.aiPhoneLabel].label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                            {contact.aiPhoneLabel || 'Other'}
                          </span>
                        )}
                      </div>
                    )}
                    {/* No phones */}
                    {!contact.phone && !contact.normalizedPhone && !contact.enrichmentPhoneWork && !contact.enrichmentPhonePersonal && !contact.aiPhone && (
                      <div className="flex items-center gap-2">
                        <PhoneValidationIcon hasPhone={false} />
                        <span className="text-gray-400">—</span>
                      </div>
                    )}
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
