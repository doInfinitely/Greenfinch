'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { BulkActionBar } from '@/components/BulkActionBar';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, Mail, Phone, MoreHorizontal, ChevronRight, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, LinkedInLink, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
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
  const queryClient = useQueryClient();
  
  const [removingItem, setRemovingItem] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isResearchingAll, setIsResearchingAll] = useState(false);
  const [isFindingEmails, setIsFindingEmails] = useState(false);
  const [isFindingPhones, setIsFindingPhones] = useState(false);
  const [isRemovingBulk, setIsRemovingBulk] = useState(false);
  const [showRemoveConfirmation, setShowRemoveConfirmation] = useState(false);

  // Fetch list metadata
  const { data: listData, isLoading: isListLoading, error: listError } = useQuery({
    queryKey: ['/api/lists', id],
    queryFn: async () => {
      const response = await fetch(`/api/lists/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('List not found');
        }
        throw new Error('Failed to load list');
      }
      return response.json();
    },
    enabled: !!id,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Fetch list items with embedded details (single batched request)
  const { data: itemsData, isLoading: isItemsLoading } = useQuery({
    queryKey: ['/api/lists', id, 'items'],
    queryFn: async () => {
      const response = await fetch(`/api/lists/${id}/items`);
      if (!response.ok) {
        throw new Error('Failed to load list items');
      }
      return response.json();
    },
    enabled: !!id && !!listData?.list,
    staleTime: 30000,
  });

  // Derived state from queries
  const list = listData?.list as ListDetail | undefined;
  const items = useMemo(() => (itemsData?.items || []) as ListItem[], [itemsData]);
  const propertyDetails = useMemo(() => 
    (list?.listType === 'properties' ? (itemsData?.details || {}) : {}) as Record<string, PropertyInfo>,
    [itemsData, list?.listType]
  );
  const contactDetails = useMemo(() => 
    (list?.listType === 'contacts' ? (itemsData?.details || {}) : {}) as Record<string, ContactInfo>,
    [itemsData, list?.listType]
  );

  const isLoading = isListLoading || (!!listData && isItemsLoading);
  const error = listError?.message || null;

  // Helper to refetch list data
  const refetchListItems = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/lists', id, 'items'] });
    queryClient.invalidateQueries({ queryKey: ['/api/lists', id] });
  };

  const handleRemoveItem = async (itemId: string) => {
    setRemovingItem(itemId);
    try {
      const response = await fetch(`/api/lists/${id}/items?itemId=${itemId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to remove item');

      setSelectedItems(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      refetchListItems();
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

  const handleBulkRemoveClick = () => {
    if (selectedItems.size === 0) return;
    setShowRemoveConfirmation(true);
  };

  const handleBulkRemove = async () => {
    if (selectedItems.size === 0) return;
    
    setIsRemovingBulk(true);
    setShowRemoveConfirmation(false);
    const itemsToRemove = Array.from(selectedItems);
    let successCount = 0;
    let errorCount = 0;
    
    for (const itemId of itemsToRemove) {
      try {
        const response = await fetch(`/api/lists/${id}/items?itemId=${itemId}`, {
          method: 'DELETE',
        });
        if (response.ok) successCount++;
        else errorCount++;
      } catch {
        errorCount++;
      }
    }
    
    setSelectedItems(new Set());
    setIsRemovingBulk(false);
    refetchListItems();
    
    if (successCount > 0) {
      toast({
        title: 'Items removed',
        description: `${successCount} item${successCount !== 1 ? 's' : ''} removed from list.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      });
    } else {
      toast({
        title: 'Error',
        description: 'Failed to remove items from list.',
        variant: 'destructive',
      });
    }
  };

  const handleCancelRemove = () => {
    setShowRemoveConfirmation(false);
  };

  const handleResearchSelected = async () => {
    if (selectedItems.size === 0) return;

    const selectedIds = Array.from(selectedItems);
    const unresearchedSelected = selectedIds.filter(itemId => {
      const prop = propertyDetails[itemId];
      return prop && (!prop.enrichmentStatus || prop.enrichmentStatus === 'pending');
    });

    if (unresearchedSelected.length === 0) {
      toast({
        title: 'All researched',
        description: 'All selected properties have already been researched.',
      });
      return;
    }

    setIsResearchingAll(true);
    let queuedCount = 0;
    let errorCount = 0;

    for (const itemId of unresearchedSelected) {
      const prop = propertyDetails[itemId];
      if (!prop) continue;
      
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
    setSelectedItems(new Set());
    
    if (queuedCount > 0) {
      toast({
        title: 'Research started',
        description: `${queuedCount} propert${queuedCount !== 1 ? 'ies' : 'y'} queued for research.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      });
      setTimeout(() => refetchListItems(), 5000);
    } else if (errorCount > 0) {
      toast({
        title: 'Research failed',
        description: `Failed to queue properties for research.`,
        variant: 'destructive',
      });
    }
  };

  const handleFindEmailsSelected = async () => {
    if (selectedItems.size === 0) return;

    const selectedIds = Array.from(selectedItems);
    const contactsNeedingEmail = selectedIds.filter(itemId => {
      const contact = contactDetails[itemId];
      return contact && (!contact.email || contact.emailValidationStatus !== 'valid');
    });

    if (contactsNeedingEmail.length === 0) {
      toast({
        title: 'All emails found',
        description: 'All selected contacts already have valid emails.',
      });
      return;
    }

    setIsFindingEmails(true);
    let queuedCount = 0;

    for (const itemId of contactsNeedingEmail) {
      try {
        const response = await fetch(`/api/contacts/${itemId}/waterfall-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) queuedCount++;
      } catch {
        // Continue with other contacts
      }
    }

    setIsFindingEmails(false);
    setSelectedItems(new Set());
    toast({
      title: 'Email search started',
      description: `Searching for emails for ${queuedCount} contact${queuedCount !== 1 ? 's' : ''}.`,
    });
    
    setTimeout(() => refetchListItems(), 5000);
  };

  const handleFindPhonesSelected = async () => {
    if (selectedItems.size === 0) return;

    const selectedIds = Array.from(selectedItems);
    const contactsNeedingPhone = selectedIds.filter(itemId => {
      const contact = contactDetails[itemId];
      if (!contact) return false;
      const hasDirectPhone = contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal || 
        (contact.phoneLabel && ['mobile', 'direct_work', 'personal'].includes(contact.phoneLabel));
      return !hasDirectPhone;
    });

    if (contactsNeedingPhone.length === 0) {
      toast({
        title: 'All phones found',
        description: 'All selected contacts already have direct phone numbers.',
      });
      return;
    }

    setIsFindingPhones(true);
    let queuedCount = 0;

    for (const itemId of contactsNeedingPhone) {
      try {
        const response = await fetch(`/api/contacts/${itemId}/waterfall-phone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) queuedCount++;
      } catch {
        // Continue with other contacts
      }
    }

    setIsFindingPhones(false);
    setSelectedItems(new Set());
    toast({
      title: 'Phone search started',
      description: `Searching for phones for ${queuedCount} contact${queuedCount !== 1 ? 's' : ''}.`,
    });
    
    setTimeout(() => refetchListItems(), 5000);
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
      // Refresh list items after a delay
      setTimeout(() => refetchListItems(), 5000);
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
    
    // Refresh list items after a delay
    setTimeout(() => refetchListItems(), 5000);
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
    
    // Refresh list items after a delay
    setTimeout(() => refetchListItems(), 5000);
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

  // Table skeleton loading component
  const TableSkeleton = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 w-10"><Skeleton className="h-4 w-4" /></th>
            <th className="px-4 py-3"><Skeleton className="h-4 w-32" /></th>
            <th className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-24" /></th>
            <th className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></th>
            <th className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-16" /></th>
            <th className="px-4 py-3 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {[1, 2, 3, 4, 5].map((i) => (
            <tr key={i} className="animate-pulse">
              <td className="px-4 py-3"><Skeleton className="h-4 w-4" /></td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </td>
              <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-24" /></td>
              <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
              <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></td>
              <td className="px-4 py-3"><Skeleton className="h-6 w-6 rounded" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 max-w-6xl mx-auto">
            <div className="flex items-center space-x-2 sm:space-x-4">
              <Link href="/lists" className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>My Lists</span>
              </Link>
              <span className="text-gray-300 hidden sm:inline">/</span>
              <Skeleton className="h-5 w-32" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="bg-white rounded-lg border border-gray-200 mb-6 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
          <TableSkeleton />
        </main>
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
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-900 font-medium group-hover:text-green-600 truncate">
                                      {contactDetail.fullName || 'Unknown'}
                                    </span>
                                    <LinkedInLink linkedinUrl={contactDetail.linkedinUrl} size="sm" />
                                  </div>
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
                                  size="sm"
                                />
                                <PhoneStatusIcon
                                  hasPhone={contactHasPhone(contactDetail)}
                                  isOfficeOnly={contactHasOnlyOfficeLine(contactDetail)}
                                  size="sm"
                                />
                                <LinkedInStatusIcon
                                  hasLinkedIn={!!contactDetail.linkedinUrl}
                                  size="sm"
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
        {list?.listType === 'properties' && (
          <Button
            onClick={handleResearchSelected}
            disabled={isResearchingAll}
            size="sm"
            className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
            data-testid="button-bulk-research"
          >
            {isResearchingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GreenfinchAgentIcon className="h-4 w-4" />
            )}
            {isResearchingAll ? 'Researching...' : 'Research'}
          </Button>
        )}
        {list?.listType === 'contacts' && (
          <>
            <Button
              onClick={handleFindEmailsSelected}
              disabled={isFindingEmails}
              size="sm"
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-bulk-find-emails"
            >
              {isFindingEmails ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              {isFindingEmails ? 'Finding...' : 'Find Emails'}
            </Button>
            <Button
              onClick={handleFindPhonesSelected}
              disabled={isFindingPhones}
              size="sm"
              className="gap-2 bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-bulk-find-phones"
            >
              {isFindingPhones ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Phone className="h-4 w-4" />
              )}
              {isFindingPhones ? 'Finding...' : 'Find Phones'}
            </Button>
          </>
        )}
        <Button
          onClick={handleBulkRemoveClick}
          disabled={isRemovingBulk}
          size="sm"
          variant="destructive"
          className="gap-2"
          data-testid="button-bulk-remove"
        >
          <Trash2 className="h-4 w-4" />
          {isRemovingBulk ? 'Removing...' : 'Remove'}
        </Button>
      </BulkActionBar>

      {/* Confirmation Dialog */}
      <Dialog open={showRemoveConfirmation} onOpenChange={(open) => !isRemovingBulk && (open ? null : handleCancelRemove())}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-remove-confirmation">
          <DialogHeader>
            <DialogTitle>Remove from List?</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''} from this list? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleCancelRemove}
              disabled={isRemovingBulk}
              data-testid="button-cancel-remove"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkRemove}
              disabled={isRemovingBulk}
              className="gap-2"
              data-testid="button-confirm-remove"
            >
              {isRemovingBulk ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Remove Items
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
