'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Flag, Check, X, ExternalLink, Mail, Phone, CheckCircle, HelpCircle, XCircle, Search, Loader2, Pencil, Save } from 'lucide-react';
// Note: Linkedin icon replaced with canonical logo image
import { 
  EmailStatusIcon as SharedEmailStatusIcon, 
  PhoneStatusIcon as SharedPhoneStatusIcon, 
  LinkedInStatusIcon as SharedLinkedInStatusIcon,
  hasAnyPhone as sharedHasAnyPhone, 
  hasOnlyOfficeLine as sharedHasOnlyOfficeLine,
  ContactStatusSummary
} from '@/components/ContactStatusIcons';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import { formatPhoneNumber } from '@/lib/phone-format';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';

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
  location: string | null;
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

// Helper to check if contact has a high-quality phone (mobile or direct)
function hasHighQualityPhone(contact: Contact): boolean {
  // Check if any phone is mobile or direct (not just office)
  if (contact.enrichmentPhonePersonal) return true; // Mobile from enrichment
  if (contact.enrichmentPhoneWork) return true; // Work direct line from enrichment
  if (contact.phoneLabel === 'mobile' || contact.phoneLabel === 'direct_work' || contact.phoneLabel === 'personal') return true;
  // Check AI-discovered phone with quality labels
  if (contact.aiPhone && contact.aiPhoneLabel) {
    const aiLabel = contact.aiPhoneLabel.toLowerCase();
    if (aiLabel === 'mobile' || aiLabel === 'direct_work' || aiLabel === 'personal' || aiLabel === 'direct') return true;
  }
  return false;
}

// Helper to check if contact only has office line
function hasOnlyOfficeLine(contact: Contact): boolean {
  const hasAnyPhone = !!(contact.phone || contact.normalizedPhone || contact.aiPhone || contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal);
  if (!hasAnyPhone) return false;
  // Has phone but not high quality = office only
  return !hasHighQualityPhone(contact);
}

// Contact info summary row with validation icons
function ContactInfoSummary({ contact }: { contact: Contact }) {
  return (
    <ContactStatusSummary 
      contact={{
        email: contact.email,
        emailValidationStatus: contact.emailValidationStatus,
        phone: contact.phone,
        aiPhone: contact.aiPhone,
        enrichmentPhoneWork: contact.enrichmentPhoneWork,
        enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
        phoneLabel: contact.phoneLabel,
        aiPhoneLabel: contact.aiPhoneLabel,
        linkedinUrl: contact.linkedinUrl,
        linkedinConfidence: contact.linkedinConfidence,
      }}
    />
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
  const [linkedInMessage, setLinkedInMessage] = useState<string | null>(null);
  
  // Admin edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: '',
    title: '',
    email: '',
    phone: '',
    linkedinUrl: '',
  });

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

  // Track which contact ID we've already tried to fetch a photo for
  const photoFetchAttemptedRef = useRef<string | null>(null);
  
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
    
    // Auto-fetch if we have a LinkedIn URL but no photo, and haven't already tried for this contact
    if (contact.linkedinUrl && !contact.photoUrl && photoFetchAttemptedRef.current !== contact.id) {
      photoFetchAttemptedRef.current = contact.id;
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

  const handleStartEdit = () => {
    if (!contact) return;
    setEditForm({
      fullName: contact.fullName || '',
      title: contact.title || '',
      email: contact.email || '',
      phone: contact.phone || '',
      linkedinUrl: contact.linkedinUrl || '',
    });
    setIsEditMode(true);
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditForm({
      fullName: '',
      title: '',
      email: '',
      phone: '',
      linkedinUrl: '',
    });
  };

  const validateEmail = (email: string): boolean => {
    if (!email) return true; // Empty is ok (clears the field)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateLinkedIn = (url: string): boolean => {
    if (!url) return true; // Empty is ok (clears the field)
    const linkedinRegex = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;
    return linkedinRegex.test(url);
  };

  const validatePhone = (phone: string): boolean => {
    if (!phone) return true; // Empty is ok (clears the field)
    // Basic phone validation - must have at least 10 digits
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
  };

  const handleSaveEdit = async () => {
    if (!contact) return;
    
    // Validate email
    if (editForm.email && !validateEmail(editForm.email)) {
      alert('Please enter a valid email address');
      return;
    }
    
    // Validate LinkedIn URL
    if (editForm.linkedinUrl && !validateLinkedIn(editForm.linkedinUrl)) {
      alert('Please enter a valid LinkedIn URL (e.g., https://linkedin.com/in/username)');
      return;
    }
    
    // Validate phone
    if (editForm.phone && !validatePhone(editForm.phone)) {
      alert('Please enter a valid phone number (10-15 digits)');
      return;
    }
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        const data = await response.json();
        // Update local state with server-normalized values
        setContact(prev => prev ? {
          ...prev,
          fullName: data.contact?.fullName ?? (editForm.fullName || null),
          title: data.contact?.title ?? (editForm.title || null),
          email: data.contact?.email ?? (editForm.email || null),
          phone: data.contact?.phone ?? (editForm.phone || null),
          linkedinUrl: data.contact?.linkedinUrl ?? (editForm.linkedinUrl || null),
        } : null);
        setIsEditMode(false);
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save changes');
      }
    } catch (err) {
      alert('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
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
        <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
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
        <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
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
      <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
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
          
          <div className="flex flex-col gap-4">
            {/* Header row with avatar, name, and action buttons */}
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
                      <AvatarFallback className="bg-green-100 text-green-700 text-2xl font-semibold" data-testid="avatar-fallback">
                        {contact.fullName
                          ? contact.fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                          : '?'}
                      </AvatarFallback>
                    </>
                  )}
                </Avatar>
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-gray-900">{contact.fullName || 'Unknown Contact'}</h1>
                  {contact.linkedinUrl && (
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:opacity-80 transition-opacity"
                      title="View LinkedIn Profile"
                      data-testid="link-linkedin-header"
                    >
                      <img src={linkedinLogo.src} alt="LinkedIn" className="w-5 h-5" />
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
                {contact.location && (
                  <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {contact.location}
                  </p>
                )}
                {/* Employer and domain in header area */}
                {(contact.employerName || contact.companyDomain) && (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {contact.employerName && (
                      <span className="text-gray-600">{contact.employerName}</span>
                    )}
                    {contact.employerName && contact.companyDomain && (
                      <span className="text-gray-400">•</span>
                    )}
                    {contact.companyDomain && (
                      <a 
                        href={`https://${contact.companyDomain}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-green-600 hover:text-green-700 hover:underline"
                      >
                        {contact.companyDomain}
                      </a>
                    )}
                  </div>
                )}
                {/* Contact info validation summary icons */}
                <div className="mt-2 flex items-center gap-3">
                  <ContactInfoSummary contact={contact} />
                  {/* LinkedIn flag button - show if contact has a LinkedIn URL */}
                  {contact.linkedinUrl && (
                    <button
                      onClick={handleFlagLinkedIn}
                      className="text-xs text-gray-500 hover:text-amber-600 hover:underline flex items-center gap-1"
                      title="Report incorrect LinkedIn profile"
                      data-testid="button-flag-linkedin"
                    >
                      <Flag className="w-3 h-3" />
                      Wrong profile?
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* LinkedIn Alternatives Modal */}
            {showLinkedInAlternatives && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLinkedInAlternatives(false)}>
                <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">LinkedIn Profile Issue</h3>
                    <button onClick={() => setShowLinkedInAlternatives(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <p className="text-sm text-gray-600 mb-4">
                    Is the current LinkedIn profile incorrect? You can mark it as wrong or select an alternative.
                  </p>
                  
                  {contact.linkedinUrl && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg border">
                      <p className="text-xs text-gray-500 mb-1">Current profile:</p>
                      <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        {contact.linkedinUrl.replace('https://www.linkedin.com/in/', '').replace('/', '')}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  
                  {/* Alternative profiles */}
                  {getAlternativeProfiles().length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-700 mb-2">Alternative profiles found:</p>
                      <div className="space-y-2">
                        {getAlternativeProfiles().map((alt, index) => (
                          <button
                            key={alt.url}
                            onClick={() => handleSelectAlternative(alt, index)}
                            disabled={selectingAlternative}
                            className="w-full text-left p-3 border rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors disabled:opacity-50"
                          >
                            <p className="font-medium text-gray-900">{alt.name}</p>
                            <p className="text-sm text-gray-600">{alt.title}</p>
                            {alt.company && <p className="text-xs text-gray-500">{alt.company}</p>}
                            <p className="text-xs text-blue-600 mt-1">{alt.url.replace('https://www.linkedin.com/in/', '')}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-3">
                    <button
                      onClick={handleMarkLinkedInIncorrect}
                      disabled={selectingAlternative}
                      className="flex-1 px-4 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 disabled:opacity-50 text-sm font-medium"
                    >
                      {selectingAlternative ? 'Updating...' : 'Mark as Incorrect'}
                    </button>
                    <button
                      onClick={() => setShowLinkedInAlternatives(false)}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                  
                  {linkedInMessage && (
                    <p className="mt-3 text-sm text-center text-green-600">{linkedInMessage}</p>
                  )}
                </div>
              </div>
            )}
            
            {/* Edit Contact Modal - Admin Only */}
            {isEditMode && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleCancelEdit}>
                <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Edit Contact</h3>
                    <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={editForm.fullName}
                        onChange={(e) => setEditForm(prev => ({ ...prev, fullName: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="John Smith"
                        data-testid="input-edit-fullname"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="General Manager"
                        data-testid="input-edit-title"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="john.smith@company.com"
                        data-testid="input-edit-email"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="(214) 555-1234"
                        data-testid="input-edit-phone"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn URL</label>
                      <input
                        type="url"
                        value={editForm.linkedinUrl}
                        onChange={(e) => setEditForm(prev => ({ ...prev, linkedinUrl: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="https://www.linkedin.com/in/johnsmith"
                        data-testid="input-edit-linkedin"
                      />
                    </div>
                  </div>
                  
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                      className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                      data-testid="button-save-edit"
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Action buttons row - full width on mobile */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Edit Contact button - admin only */}
              <AdminOnly>
                <button
                  onClick={handleStartEdit}
                  className="inline-flex items-center px-3 py-2 text-gray-700 bg-gray-100 text-sm font-medium rounded-lg hover:bg-gray-200"
                  data-testid="button-edit-contact"
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Contact
                </button>
              </AdminOnly>
              
              {/* Find Phone button - hide once mobile or direct line has been identified */}
              {(() => {
                const phoneStatus = getEnrichmentStatus(contactId as string, 'contact_phone');
                // Show button only if we don't have a high-quality phone (mobile/direct)
                const needsPhone = !hasHighQualityPhone(contact);
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
                  <p className="text-gray-900">{contact.fullName || '—'}</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Title</label>
                  <p className="text-gray-900">{contact.title || '—'}</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Email</label>
                  <div className="flex items-center gap-2">
                    <SharedEmailStatusIcon hasEmail={!!contact.email} status={contact.emailValidationStatus} />
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className="text-green-600 hover:text-green-700 hover:underline">
                        {contact.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </div>
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-500 mb-1">Phone Numbers</label>
                  <div className="space-y-2">
                    {/* Primary phone */}
                    {(contact.phone || contact.normalizedPhone) && (
                      <div className="flex items-center gap-2">
                        <SharedPhoneStatusIcon hasPhone={true} isOfficeOnly={contact.phoneLabel === 'office'} />
                        <a href={`tel:${contact.normalizedPhone || contact.phone}`} className="text-gray-900 hover:text-green-600">
                          {formatPhoneNumber(contact.phone || contact.normalizedPhone)}
                        </a>
                        {contact.phoneLabel && PHONE_LABEL_CONFIG[contact.phoneLabel] && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PHONE_LABEL_CONFIG[contact.phoneLabel].color}`}>
                            {PHONE_LABEL_CONFIG[contact.phoneLabel].label}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Work phone from enrichment */}
                    {contact.enrichmentPhoneWork && contact.enrichmentPhoneWork !== contact.phone && (
                      <div className="flex items-center gap-2">
                        <SharedPhoneStatusIcon hasPhone={true} />
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
                        <SharedPhoneStatusIcon hasPhone={true} />
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
                        <SharedPhoneStatusIcon hasPhone={true} />
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
                        <SharedPhoneStatusIcon hasPhone={false} />
                        <span className="text-gray-400">—</span>
                      </div>
                    )}
                  </div>
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
                  {properties.map((prop, index) => (
                    <Link
                      key={`${prop.id}-${prop.role || index}`}
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

          </div>
        </div>
      </main>
    </div>
  );
}
