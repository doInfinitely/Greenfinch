'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { X, ExternalLink, Phone, XCircle, Search, Loader2, Pencil, Save, CheckCircle2 } from 'lucide-react';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import AddToListModal from '@/components/AddToListModal';
import ContactDetailSkeleton from '@/components/ContactDetailSkeleton';
import { List } from 'lucide-react';
import ContactHeader from '@/components/contact/ContactHeader';
import ContactInfo from '@/components/contact/ContactInfo';
import AssociatedProperties from '@/components/contact/AssociatedProperties';
import ContactOrganizations from '@/components/contact/ContactOrganizations';
import DataIssueDialog from '@/components/DataIssueDialog';
import type { Contact, LinkedInSearchResult, PropertyRelation, OrgRelation } from '@/components/contact/types';

function hasHighQualityPhone(contact: Contact): boolean {
  if (contact.enrichmentPhonePersonal) return true;
  if (contact.enrichmentPhoneWork) return true;
  if (contact.phoneLabel === 'mobile' || contact.phoneLabel === 'direct_work' || contact.phoneLabel === 'personal') return true;
  if (contact.aiPhone && contact.aiPhoneLabel) {
    const aiLabel = contact.aiPhoneLabel.toLowerCase();
    if (aiLabel === 'mobile' || aiLabel === 'direct_work' || aiLabel === 'personal' || aiLabel === 'direct') return true;
  }
  return false;
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
  const { startEnrichment } = useEnrichment();
  const { items: enrichmentItems, getEnrichmentStatus } = useEnrichmentQueue();
  const [isFindingPhone, setIsFindingPhone] = useState(false);
  const [isFindingEmail, setIsFindingEmail] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [linkedInMessage, setLinkedInMessage] = useState<string | null>(null);
  const [showDataIssueDialog, setShowDataIssueDialog] = useState(false);
  
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

    const failedItem = enrichmentItems.find(
      item => 
        item.entityId === contactId && 
        item.status === 'failed' &&
        (item.type === 'contact_phone' || item.type === 'contact_email' || item.type === 'contact')
    );
    
    if (failedItem) {
      if (failedItem.type === 'contact_phone') {
        setIsFindingPhone(false);
      } else {
        setIsFindingEmail(false);
      }
    }
  }, [enrichmentItems, contactId, fetchContact]);

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
    setEditForm({ fullName: '', title: '', email: '', phone: '', linkedinUrl: '' });
  };

  const validateEmail = (email: string): boolean => {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validateLinkedIn = (url: string): boolean => {
    if (!url) return true;
    return /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i.test(url);
  };

  const validatePhone = (phone: string): boolean => {
    if (!phone) return true;
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
  };

  const handleSaveEdit = async () => {
    if (!contact) return;
    
    if (editForm.email && !validateEmail(editForm.email)) {
      alert('Please enter a valid email address');
      return;
    }
    if (editForm.linkedinUrl && !validateLinkedIn(editForm.linkedinUrl)) {
      alert('Please enter a valid LinkedIn URL (e.g., https://linkedin.com/in/username)');
      return;
    }
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

    startEnrichment({
      type: 'contact_phone',
      entityId: contactId,
      entityName: `${contact.fullName || 'Contact'} - Phone`,
      apiEndpoint: `/api/contacts/${contactId}/waterfall-phone`,
      onSuccess: (data: any) => {
        if (data?.data?.phone) {
          setPhoneMessage(`Found: ${data.data.phone}`);
        } else {
          setPhoneMessage('No phone number found');
        }
        fetchContact();
        setIsFindingPhone(false);
      },
      onError: (errorMsg: string) => {
        setPhoneMessage(`Error: ${errorMsg}`);
        setIsFindingPhone(false);
      },
    });
  };

  const handleResearchContact = async () => {
    if (!contact) return;

    setIsFindingEmail(true);
    setEmailMessage(null);

    const originalEnrichedAt = contact.enrichedAt;

    startEnrichment({
      type: 'contact',
      entityId: contactId,
      entityName: `${contact.fullName || 'Contact'} - Research`,
      apiEndpoint: `/api/contacts/${contactId}/enrich`,
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
    return <ContactDetailSkeleton />;
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
            data-testid="button-back"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          
          <div className="flex flex-col gap-4">
            <ContactHeader contact={contact} onFlagLinkedIn={handleFlagLinkedIn} onReportDataIssue={() => setShowDataIssueDialog(true)} />
            
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
            
            {showDataIssueDialog && contact && (
              <DataIssueDialog
                entityType="contact"
                entityId={contact.id}
                entityLabel={contact.fullName || 'Unknown Contact'}
                onClose={() => setShowDataIssueDialog(false)}
              />
            )}

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
            
            <div className="flex flex-wrap items-center gap-2">
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
              
              {(() => {
                const phoneStatus = getEnrichmentStatus(contactId as string, 'contact_phone');
                const needsPhone = !hasHighQualityPhone(contact);
                const isPhoneActive = phoneStatus.isActive || isFindingPhone;
                const phoneHasFailed = phoneStatus.status === 'failed';
                
                if (!needsPhone) return null;
                
                return (
                  <AdminOnly>
                    <button
                      onClick={handleFindPhone}
                      disabled={isPhoneActive}
                      className={`inline-flex items-center px-3 py-2 text-white text-sm font-medium rounded-lg disabled:cursor-not-allowed ${
                        phoneHasFailed 
                          ? 'bg-red-500 hover:bg-red-600' 
                          : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                      }`}
                      title={phoneHasFailed ? `Failed: ${phoneStatus.error || 'Unknown error'} - Click to retry` : undefined}
                      data-testid="button-find-phone"
                    >
                      {isPhoneActive ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : phoneHasFailed ? (
                        <XCircle className="w-4 h-4 mr-2" />
                      ) : (
                        <Phone className="w-4 h-4 mr-2" />
                      )}
                      {isPhoneActive ? 'Looking up...' : phoneHasFailed ? 'Retry Phone' : 'Find Phone'}
                    </button>
                  </AdminOnly>
                );
              })()}
              
              {(() => {
                const hasValidatedEmail = !!contact.email && (
                  contact.emailValidationStatus === 'valid' || 
                  contact.emailValidationStatus === 'catch-all'
                );
                const hasLinkedIn = !!contact.linkedinUrl;
                const isFullyResearched = hasValidatedEmail && hasLinkedIn;

                if (isFullyResearched) {
                  return (
                    <span 
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg"
                      title="This contact has been researched with AI"
                      data-testid="badge-ai-researched"
                    >
                      <GreenfinchAgentIcon size={16} className="text-green-600" />
                      AI Researched
                    </span>
                  );
                }

                const enrichStatus = getEnrichmentStatus(contactId as string, 'contact');
                const isActive = enrichStatus.isActive || isFindingEmail;
                const hasFailed = enrichStatus.status === 'failed';
                
                return (
                  <AdminOnly>
                    <button
                      onClick={handleResearchContact}
                      disabled={isActive}
                      className={`inline-flex items-center px-3 py-2 text-white text-sm font-medium rounded-lg disabled:cursor-not-allowed ${
                        hasFailed 
                          ? 'bg-red-500 hover:bg-red-600' 
                          : 'bg-purple-600 hover:bg-purple-700 disabled:opacity-50'
                      }`}
                      title={hasFailed ? `Failed: ${enrichStatus.error || 'Unknown error'} - Click to retry` : undefined}
                      data-testid="button-research-contact"
                    >
                      {isActive ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : hasFailed ? (
                        <XCircle className="w-4 h-4 mr-2" />
                      ) : (
                        <Search className="w-4 h-4 mr-2" />
                      )}
                      {isActive ? 'Researching...' : hasFailed ? 'Retry Research' : 'Research Contact'}
                    </button>
                  </AdminOnly>
                );
              })()}
              
              {phoneMessage && (
                <span className="text-sm text-blue-600">{phoneMessage}</span>
              )}
              {emailMessage && (
                <span className="text-sm text-purple-600">{emailMessage}</span>
              )}
              
              <button
                onClick={() => setShowAddToListModal(true)}
                className="inline-flex items-center px-3 py-2 text-gray-700 bg-white border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
                data-testid="button-add-to-list"
              >
                <List className="w-4 h-4 mr-2" />
                Add to List
              </button>
              
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
            <ContactInfo contact={contact} />
            <AssociatedProperties properties={properties} />
          </div>

          <div className="lg:col-span-1 space-y-6">
            <ContactOrganizations organizations={organizations} />
            
            {contact.enrichedAt && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Enrichment Details</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Source</span>
                    <span className="text-gray-900">{contact.enrichmentSource || 'Manual'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last Enriched</span>
                    <span className="text-gray-900">
                      {new Date(contact.enrichedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Created</span>
                    <span className="text-gray-900">
                      {new Date(contact.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <AddToListModal
        isOpen={showAddToListModal}
        onClose={() => setShowAddToListModal(false)}
        itemId={contactId}
        itemType="contacts"
      />
    </div>
  );
}
