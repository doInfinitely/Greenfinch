'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { BulkActionBar } from '@/components/BulkActionBar';
import { Trash2, Mail, Phone, MoreHorizontal, ChevronRight, Loader2 } from 'lucide-react';
import { GreenfinchAgentIcon } from '@/components/icons/GreenfinchAgentIcon';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
import linkedinLogo from '@/assets/linkedin-logo.png';
import Image from 'next/image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from '@/hooks/use-toast';

interface ListDetail {
  id: string;
  userId: string | null;
  listName: string;
  listType: string;
  createdAt: string;
  itemCount: number;
}

interface ListItem {
  id: string;
  itemId: string;
  addedAt: string;
}

interface PropertyInfo {
  id: string;
  propertyKey?: string;
  address?: string;
  validatedAddress?: string;
  regridAddress?: string;
  city?: string;
  state?: string;
  assetCategory?: string;
  assetSubcategory?: string;
  commonName?: string;
  enrichmentStatus?: string;
  contactCount?: number;
}

interface ContactInfo {
  id: string;
  fullName?: string;
  email?: string;
  emailStatus?: string;
  emailValidationStatus?: string;
  title?: string;
  employerName?: string;
  phone?: string;
  phoneLabel?: string;
  enrichmentPhoneWork?: string;
  enrichmentPhonePersonal?: string;
  aiPhone?: string;
  aiPhoneLabel?: string;
  linkedinUrl?: string;
}

export default function ListDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { toast } = useToast();
  const [list, setList] = useState<ListDetail | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [propertyDetails, setPropertyDetails] = useState<Record<string, PropertyInfo>>({});
  const [contactDetails, setContactDetails] = useState<Record<string, ContactInfo>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingItem, setRemovingItem] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isResearchingAll, setIsResearchingAll] = useState(false);
  const [isFindingEmails, setIsFindingEmails] = useState(false);
  const [isFindingPhones, setIsFindingPhones] = useState(false);
  const [isRemovingBulk, setIsRemovingBulk] = useState(false);

  useEffect(() => {
    fetchList();
  }, [id]);

  const fetchList = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/lists/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('List not found');
        } else {
          setError('Failed to load list');
        }
        return;
      }
      const data = await response.json();
      setList(data.list);
      setItems(data.items || []);
      
      if (data.items && data.items.length > 0) {
        if (data.list.listType === 'properties') {
          fetchPropertyDetails(data.items);
        } else if (data.list.listType === 'contacts') {
          fetchContactDetails(data.items);
        }
      }
    } catch (err) {
      setError('Failed to load list');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPropertyDetails = async (listItems: ListItem[]) => {
    const details: Record<string, PropertyInfo> = {};
    for (const item of listItems) {
      try {
        const res = await fetch(`/api/properties/${item.itemId}`);
        if (res.ok) {
          const data = await res.json();
          details[item.itemId] = data.property;
        }
      } catch {
        // Property might not exist
      }
    }
    setPropertyDetails(details);
  };

  const fetchContactDetails = async (listItems: ListItem[]) => {
    const details: Record<string, ContactInfo> = {};
    try {
      const res = await fetch('/api/contacts?limit=1000');
      if (res.ok) {
        const data = await res.json();
        const contactsById: Record<string, ContactInfo> = {};
        for (const contact of data.contacts || []) {
          contactsById[contact.id] = contact;
        }
        for (const item of listItems) {
          if (contactsById[item.itemId]) {
            details[item.itemId] = contactsById[item.itemId];
          }
        }
      }
    } catch {
      // Contacts might not load
    }
    setContactDetails(details);
  };

  const handleRemoveItem = async (itemId: string) => {
    setRemovingItem(itemId);
    try {
      const response = await fetch(`/api/lists/${id}/items?itemId=${itemId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to remove item');

      setItems(items.filter(item => item.itemId !== itemId));
      if (list) {
        setList({ ...list, itemCount: list.itemCount - 1 });
      }
      setSelectedItems(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      toast({
        title: 'Item removed',
        description: 'The item has been removed from the list.',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to remove item from list.',
        variant: 'destructive',
      });
    } finally {
      setRemovingItem(null);
    }
  };

  const handleBulkRemove = async () => {
    if (selectedItems.size === 0) return;
    
    setIsRemovingBulk(true);
    const itemsToRemove = Array.from(selectedItems);
    let successCount = 0;
    
    for (const itemId of itemsToRemove) {
      try {
        const response = await fetch(`/api/lists/${id}/items?itemId=${itemId}`, {
          method: 'DELETE',
        });
        if (response.ok) successCount++;
      } catch {
        // Continue with other items
      }
    }
    
    setItems(items.filter(item => !selectedItems.has(item.itemId)));
    if (list) {
      setList({ ...list, itemCount: list.itemCount - successCount });
    }
    setSelectedItems(new Set());
    setIsRemovingBulk(false);
    
    toast({
      title: 'Items removed',
      description: `${successCount} item${successCount !== 1 ? 's' : ''} removed from list.`,
    });
  };

  const handleResearchAll = async () => {
    const unresearchedProperties = items.filter(item => {
      const prop = propertyDetails[item.itemId];
      return prop && (!prop.enrichmentStatus || prop.enrichmentStatus === 'pending');
    });

    if (unresearchedProperties.length === 0) {
      toast({
        title: 'All researched',
        description: 'All properties on this list have already been researched.',
      });
      return;
    }

    setIsResearchingAll(true);
    let queuedCount = 0;
    let errorCount = 0;

    for (const item of unresearchedProperties) {
      const prop = propertyDetails[item.itemId];
      if (!prop) continue;
      
      // Use propertyKey if available, otherwise fall back to id
      const keyToUse = prop.propertyKey || prop.id;
      
      try {
        const response = await fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyKey: keyToUse }),
        });
        if (response.ok) {
          queuedCount++;
        } else if (response.status === 429) {
          // Rate limited - stop and inform user
          toast({
            title: 'Rate limited',
            description: `Queued ${queuedCount} properties. Please wait before continuing.`,
            variant: 'destructive',
          });
          break;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setIsResearchingAll(false);
    
    if (queuedCount > 0) {
      toast({
        title: 'Research started',
        description: `${queuedCount} propert${queuedCount !== 1 ? 'ies' : 'y'} queued for research.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      });
      // Refresh property details after a delay
      setTimeout(() => fetchPropertyDetails(items), 5000);
    } else if (errorCount > 0) {
      toast({
        title: 'Research failed',
        description: `Failed to queue properties for research.`,
        variant: 'destructive',
      });
    }
  };

  const handleFindEmails = async () => {
    const contactsNeedingEmail = items.filter(item => {
      const contact = contactDetails[item.itemId];
      return contact && (!contact.email || contact.emailValidationStatus !== 'valid');
    });

    if (contactsNeedingEmail.length === 0) {
      toast({
        title: 'All emails found',
        description: 'All contacts on this list already have valid emails.',
      });
      return;
    }

    setIsFindingEmails(true);
    let queuedCount = 0;

    for (const item of contactsNeedingEmail) {
      try {
        const response = await fetch(`/api/contacts/${item.itemId}/waterfall-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) queuedCount++;
      } catch {
        // Continue with other contacts
      }
    }

    setIsFindingEmails(false);
    toast({
      title: 'Email search started',
      description: `Searching for emails for ${queuedCount} contact${queuedCount !== 1 ? 's' : ''}.`,
    });
    
    // Refresh contact details after a delay
    setTimeout(() => fetchContactDetails(items), 5000);
  };

  const handleFindPhones = async () => {
    const contactsNeedingPhone = items.filter(item => {
      const contact = contactDetails[item.itemId];
      if (!contact) return false;
      // Need phone if no direct/personal line
      const hasDirectPhone = contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal || 
        (contact.phoneLabel && ['mobile', 'direct_work', 'personal'].includes(contact.phoneLabel));
      return !hasDirectPhone;
    });

    if (contactsNeedingPhone.length === 0) {
      toast({
        title: 'All phones found',
        description: 'All contacts on this list already have direct phone numbers.',
      });
      return;
    }

    setIsFindingPhones(true);
    let queuedCount = 0;

    for (const item of contactsNeedingPhone) {
      try {
        const response = await fetch(`/api/contacts/${item.itemId}/waterfall-phone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) queuedCount++;
      } catch {
        // Continue with other contacts
      }
    }

    setIsFindingPhones(false);
    toast({
      title: 'Phone search started',
      description: `Searching for phones for ${queuedCount} contact${queuedCount !== 1 ? 's' : ''}.`,
    });
    
    // Refresh contact details after a delay
    setTimeout(() => fetchContactDetails(items), 5000);
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item.itemId)));
    }
  };

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Helper for contact phone status
  const contactHasPhone = (contact: ContactInfo): boolean => {
    return !!(contact.phone || contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal || contact.aiPhone);
  };

  const contactHasOnlyOfficeLine = (contact: ContactInfo): boolean => {
    if (!contactHasPhone(contact)) return false;
    // Has phone but only office line
    if (contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal) return false;
    if (contact.phoneLabel === 'mobile' || contact.phoneLabel === 'direct_work' || contact.phoneLabel === 'personal') return false;
    return contact.phoneLabel === 'office';
  };

  // Count unresearched properties
  const unresearchedCount = items.filter(item => {
    const prop = propertyDetails[item.itemId];
    return prop && (!prop.enrichmentStatus || prop.enrichmentStatus === 'pending');
  }).length;

  // Count contacts needing email
  const needsEmailCount = items.filter(item => {
    const contact = contactDetails[item.itemId];
    return contact && (!contact.email || contact.emailValidationStatus !== 'valid');
  }).length;

  // Count contacts needing direct phone
  const needsPhoneCount = items.filter(item => {
    const contact = contactDetails[item.itemId];
    if (!contact) return false;
    const hasDirectPhone = contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal || 
      (contact.phoneLabel && ['mobile', 'direct_work', 'personal'].includes(contact.phoneLabel));
    return !hasDirectPhone;
  }).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (error || !list) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
          <div className="max-w-6xl mx-auto">
            <Link href="/lists" className="flex items-center space-x-2 text-gray-600 hover:text-gray-900">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Lists</span>
            </Link>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{error || 'List not found'}</h2>
          <p className="text-gray-500 mb-4">The list you're looking for doesn't exist or has been deleted.</p>
          <Link
            href="/lists"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            Go to My Lists
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 max-w-6xl mx-auto">
          <div className="flex items-center space-x-2 sm:space-x-4 overflow-x-auto">
            <Link href="/lists" className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>My Lists</span>
            </Link>
            <span className="text-gray-300 hidden sm:inline">/</span>
            <span className="font-medium text-gray-900 truncate">{list.listName}</span>
          </div>
          <span className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-full w-fit">
            {list.listType}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* List Info Card */}
        <div className="bg-white rounded-lg border border-gray-200 mb-6 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{list.listName}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {list.itemCount} item{list.itemCount !== 1 ? 's' : ''} · Created {formatDate(list.createdAt)}
              </p>
            </div>
            
            {/* Bulk action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {list.listType === 'properties' && items.length > 0 && (
                <Button
                  onClick={handleResearchAll}
                  disabled={isResearchingAll || unresearchedCount === 0}
                  size="sm"
                  variant="outline"
                  className="gap-2 border-purple-500 text-purple-700 dark:text-purple-400"
                  data-testid="button-research-all"
                >
                  {isResearchingAll ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <GreenfinchAgentIcon className="h-4 w-4" />
                  )}
                  {isResearchingAll ? 'Researching...' : `Research All${unresearchedCount > 0 ? ` (${unresearchedCount})` : ''}`}
                </Button>
              )}
              
              {list.listType === 'contacts' && items.length > 0 && (
                <>
                  <Button
                    onClick={handleFindEmails}
                    disabled={isFindingEmails || needsEmailCount === 0}
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    data-testid="button-find-emails"
                  >
                    <Mail className="h-4 w-4" />
                    {isFindingEmails ? 'Finding...' : `Find Emails${needsEmailCount > 0 ? ` (${needsEmailCount})` : ''}`}
                  </Button>
                  <Button
                    onClick={handleFindPhones}
                    disabled={isFindingPhones || needsPhoneCount === 0}
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    data-testid="button-find-phones"
                  >
                    <Phone className="h-4 w-4" />
                    {isFindingPhones ? 'Finding...' : `Find Phones${needsPhoneCount > 0 ? ` (${needsPhoneCount})` : ''}`}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No items yet</h3>
            <p className="text-gray-500 mb-4">
              {list.listType === 'properties'
                ? 'Add properties to this list from the property detail page.'
                : 'Add contacts to this list from the contacts page.'}
            </p>
            <Link
              href={list.listType === 'properties' ? '/dashboard' : '/contacts'}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              {list.listType === 'properties' ? 'Browse Properties' : 'Browse Contacts'}
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <Checkbox
                      checked={selectedItems.size === items.length && items.length > 0}
                      onChange={toggleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  {list.listType === 'properties' ? (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Property
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                        Location
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                        Status
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Contact
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                        Info
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                        Company
                      </th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item) => {
                  const propDetail = propertyDetails[item.itemId];
                  const contactDetail = contactDetails[item.itemId];
                  const isSelected = selectedItems.has(item.itemId);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-gray-50 ${isSelected ? 'bg-green-50' : ''}`}
                      data-testid={`row-list-item-${item.itemId}`}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleSelectItem(item.itemId)}
                          data-testid={`checkbox-item-${item.itemId}`}
                        />
                      </td>
                      {list.listType === 'properties' ? (
                        <>
                          <td className="px-4 py-3">
                            {propDetail ? (
                              <Link
                                href={`/property/${item.itemId}`}
                                className="group flex items-center gap-2"
                              >
                                <div className="flex flex-col min-w-0">
                                  {propDetail.commonName && (
                                    <span className="text-gray-900 font-semibold text-sm truncate">
                                      {propDetail.commonName}
                                    </span>
                                  )}
                                  <span className="text-green-600 group-hover:text-green-700 group-hover:underline font-medium truncate">
                                    {propDetail.address || propDetail.validatedAddress || propDetail.regridAddress || 'Unknown Address'}
                                  </span>
                                </div>
                                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </Link>
                            ) : (
                              <span className="text-gray-400">Loading...</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                            {propDetail ? `${propDetail.city || ''}${propDetail.city && propDetail.state ? ', ' : ''}${propDetail.state || ''}` : '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                            <span className="text-sm">{propDetail?.assetCategory || '-'}</span>
                            {propDetail?.assetSubcategory && (
                              <span className="text-xs text-gray-400 block">{propDetail.assetSubcategory}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {propDetail?.enrichmentStatus === 'complete' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                Researched
                              </span>
                            ) : propDetail?.enrichmentStatus === 'in_progress' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                                In Progress
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                Not Researched
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3">
                            {contactDetail ? (
                              <Link
                                href={`/contact/${item.itemId}`}
                                className="group flex items-center gap-2"
                              >
                                <div className="flex flex-col min-w-0">
                                  <span className="text-gray-900 font-medium group-hover:text-green-600 truncate">
                                    {contactDetail.fullName || 'Unknown'}
                                  </span>
                                  {contactDetail.title && (
                                    <span className="text-xs text-gray-500 truncate">{contactDetail.title}</span>
                                  )}
                                </div>
                                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </Link>
                            ) : (
                              <span className="text-gray-400">Loading...</span>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            {contactDetail && (
                              <div className="flex items-center gap-2">
                                <EmailStatusIcon
                                  hasEmail={!!contactDetail.email}
                                  status={contactDetail.emailValidationStatus || contactDetail.emailStatus}
                                />
                                <PhoneStatusIcon
                                  hasPhone={contactHasPhone(contactDetail)}
                                  isOfficeOnly={contactHasOnlyOfficeLine(contactDetail)}
                                />
                                <LinkedInStatusIcon
                                  hasLinkedIn={!!contactDetail.linkedinUrl}
                                />
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                            <span className="text-sm truncate block max-w-[200px]">
                              {contactDetail?.employerName || '-'}
                            </span>
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-400 hover:text-gray-600"
                              data-testid={`button-item-menu-${item.itemId}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-white">
                            <DropdownMenuItem
                              onClick={() => handleRemoveItem(item.itemId)}
                              disabled={removingItem === item.itemId}
                              className="text-red-600 focus:text-red-700 focus:bg-red-50"
                              data-testid={`button-remove-item-${item.itemId}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {removingItem === item.itemId ? 'Removing...' : 'Remove from list'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedItems.size}
        itemLabel={list?.listType === 'properties' ? 'property' : 'contact'}
        onDeselectAll={() => setSelectedItems(new Set())}
      >
        <Button
          onClick={handleBulkRemove}
          disabled={isRemovingBulk}
          size="sm"
          variant="destructive"
          className="gap-2"
          data-testid="button-bulk-remove"
        >
          <Trash2 className="h-4 w-4" />
          {isRemovingBulk ? 'Removing...' : 'Remove Selected'}
        </Button>
      </BulkActionBar>
    </div>
  );
}
