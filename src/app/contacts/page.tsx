'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { BulkActionBar } from '@/components/BulkActionBar';
import { ListPlus, Filter, Mail, Phone, Loader2 } from 'lucide-react';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, LinkedInLink, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { useToast } from '@/hooks/use-toast';
import { useEnrichment } from '@/hooks/use-enrichment';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PropertyRelation {
  propertyId: string;
  role: string | null;
  propertyKey: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface OrgRelation {
  orgId: string;
  title: string | null;
  orgName: string | null;
  orgDomain: string | null;
}

interface Contact {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  phoneLabel: string | null;
  aiPhone: string | null;
  aiPhoneLabel: string | null;
  enrichmentPhoneWork: string | null;
  enrichmentPhonePersonal: string | null;
  title: string | null;
  employerName: string | null;
  emailStatus: string | null;
  emailValidationStatus: string | null;
  linkedinUrl: string | null;
  source: string | null;
  createdAt: string;
  propertyCount: number;
  properties: PropertyRelation[];
  organizationCount: number;
  organizations: OrgRelation[];
}

interface Organization {
  id: string;
  name: string | null;
  domain: string | null;
}

const PROPERTY_COUNT_BUCKETS = [
  { value: 'all', label: 'All' },
  { value: '1', label: '1' },
  { value: '2-5', label: '2-5' },
  { value: '6-10', label: '6-10' },
  { value: '10+', label: '10+' },
];

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface BulkEmailConfirmation {
  isOpen: boolean;
  contactsToProcess: Contact[];
  skippedCount: number;
  isProcessing: boolean;
}

export default function ContactsPage() {
  const { toast } = useToast();
  const { startEnrichment } = useEnrichment();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [titleFilter, setTitleFilter] = useState('all');
  const [sortBy, setSortBy] = useState('propertyCount');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [availableTitles, setAvailableTitles] = useState<string[]>([]);
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [organizationFilter, setOrganizationFilter] = useState<Organization | null>(null);
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [orgSearchResults, setOrgSearchResults] = useState<Organization[]>([]);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const orgSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const [propertyCountFilter, setPropertyCountFilter] = useState('all');
  const [hasValidEmail, setHasValidEmail] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [bulkEmailConfirmation, setBulkEmailConfirmation] = useState<BulkEmailConfirmation>({
    isOpen: false,
    contactsToProcess: [],
    skippedCount: 0,
    isProcessing: false,
  });

  const activeFilterCount = 
    (titleFilter !== 'all' ? 1 : 0) +
    (organizationFilter ? 1 : 0) +
    (propertyCountFilter !== 'all' ? 1 : 0) +
    (hasValidEmail ? 1 : 0) +
    (hasPhone ? 1 : 0) +
    (hasLinkedIn ? 1 : 0);

  const clearAllFilters = () => {
    setTitleFilter('all');
    setOrganizationFilter(null);
    setOrgSearchQuery('');
    setPropertyCountFilter('all');
    setHasValidEmail(false);
    setHasPhone(false);
    setHasLinkedIn(false);
  };

  const fetchContacts = useCallback(async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      if (searchQuery) params.set('q', searchQuery);
      if (titleFilter && titleFilter !== 'all') params.set('title', titleFilter);
      if (organizationFilter) params.set('organizationId', organizationFilter.id);
      if (propertyCountFilter !== 'all') params.set('propertyCount', propertyCountFilter);
      if (hasValidEmail) params.set('hasValidEmail', 'true');
      if (hasPhone) params.set('hasPhone', 'true');
      if (hasLinkedIn) params.set('hasLinkedIn', 'true');

      const response = await fetch(`/api/contacts?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch contacts');
      }

      setContacts(data.contacts || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      if (data.availableTitles) {
        setAvailableTitles(data.availableTitles);
      }
      setSelectedContacts(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, titleFilter, organizationFilter, sortBy, sortOrder, propertyCountFilter, hasValidEmail, hasPhone, hasLinkedIn]);

  const searchOrganizations = useCallback(async (query: string) => {
    if (query.length < 2) {
      setOrgSearchResults([]);
      return;
    }
    try {
      const response = await fetch(`/api/organizations/list?q=${encodeURIComponent(query)}&limit=10`);
      const data = await response.json();
      setOrgSearchResults(data.organizations || []);
    } catch {
      setOrgSearchResults([]);
    }
  }, []);

  useEffect(() => {
    if (orgSearchTimeoutRef.current) {
      clearTimeout(orgSearchTimeoutRef.current);
    }

    if (orgSearchQuery.length >= 2) {
      orgSearchTimeoutRef.current = setTimeout(() => {
        searchOrganizations(orgSearchQuery);
      }, 300);
    } else {
      setOrgSearchResults([]);
    }

    return () => {
      if (orgSearchTimeoutRef.current) {
        clearTimeout(orgSearchTimeoutRef.current);
      }
    };
  }, [orgSearchQuery, searchOrganizations]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(event.target as Node)) {
        setShowOrgDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && isFilterOpen) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFilterOpen]);

  useEffect(() => {
    if (isFilterOpen && typeof window !== 'undefined' && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isFilterOpen]);

  const formatPhoneLabel = (label: string | null): string => {
    if (!label) return '';
    const labelMap: Record<string, string> = {
      'direct_work': 'Direct',
      'office': 'Office',
      'mobile': 'Mobile',
      'personal': 'Personal',
      'work': 'Work',
      'home': 'Home',
      'main': 'Main',
      'fax': 'Fax',
    };
    const lower = label.toLowerCase();
    return labelMap[lower] || label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, ' ');
  };

  const getPhoneNumbers = (contact: Contact): { number: string; label: string }[] => {
    const phones: { number: string; label: string }[] = [];
    
    if (contact.phone) {
      phones.push({ number: contact.phone, label: formatPhoneLabel(contact.phoneLabel) || '' });
    }
    if (contact.enrichmentPhoneWork && contact.enrichmentPhoneWork !== contact.phone) {
      phones.push({ number: contact.enrichmentPhoneWork, label: 'Work' });
    }
    if (contact.enrichmentPhonePersonal && contact.enrichmentPhonePersonal !== contact.phone && contact.enrichmentPhonePersonal !== contact.enrichmentPhoneWork) {
      phones.push({ number: contact.enrichmentPhonePersonal, label: 'Personal' });
    }
    if (contact.aiPhone && contact.aiPhone !== contact.phone && contact.aiPhone !== contact.enrichmentPhoneWork && contact.aiPhone !== contact.enrichmentPhonePersonal) {
      phones.push({ number: contact.aiPhone, label: formatPhoneLabel(contact.aiPhoneLabel) || '' });
    }
    
    return phones;
  };

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchContacts(1);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [fetchContacts]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchContacts(newPage);
    }
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const getEmailStatusColor = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case 'valid':
        return 'bg-green-100 text-green-800';
      case 'invalid':
        return 'bg-red-100 text-red-800';
      case 'pending':
      case 'unverified':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleSelectContact = useCallback((contactId: string, checked: boolean) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(contactId);
      } else {
        next.delete(contactId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const allIds = new Set(contacts.map(c => c.id));
      setSelectedContacts(allIds);
    } else {
      setSelectedContacts(new Set());
    }
  }, [contacts]);

  const handleDeselectAll = useCallback(() => {
    setSelectedContacts(new Set());
  }, []);

  const handleFindPhones = useCallback(() => {
    const selectedIds = Array.from(selectedContacts);
    toast({
      title: 'Phone Lookup Started',
      description: `Finding phone numbers for ${selectedIds.length} selected contacts...`,
    });
  }, [selectedContacts, toast]);

  const handleFindEmails = useCallback(() => {
    const selectedIds = Array.from(selectedContacts);
    toast({
      title: 'Email Lookup Started',
      description: `Finding emails for ${selectedIds.length} selected contacts...`,
    });
  }, [selectedContacts, toast]);

  const handleAddToList = useCallback(() => {
    const selectedIds = Array.from(selectedContacts);
    toast({
      title: 'Add to List',
      description: `Adding ${selectedIds.length} contacts to list...`,
    });
  }, [selectedContacts, toast]);

  const allSelected = contacts.length > 0 && contacts.every(c => selectedContacts.has(c.id));
  const someSelected = contacts.some(c => selectedContacts.has(c.id));

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return null;
    return (
      <svg className="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {sortOrder === 'asc' ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        )}
      </svg>
    );
  };

  const filterContent = (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-gray-900">Filter Contacts</h3>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg active:bg-gray-100"
            data-testid="button-clear-all-contact-filters"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Title</label>
        <select
          value={titleFilter}
          onChange={(e) => setTitleFilter(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          data-testid="select-title"
        >
          <option value="all">All Titles</option>
          {availableTitles.map((title) => (
            <option key={title} value={title}>{title}</option>
          ))}
        </select>
      </div>

      <div ref={orgDropdownRef}>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Organization</label>
        {organizationFilter ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 px-3 py-2.5 rounded-lg text-sm">
            <span className="text-green-800 truncate">{organizationFilter.name || organizationFilter.domain}</span>
            <button
              onClick={() => {
                setOrganizationFilter(null);
                setOrgSearchQuery('');
              }}
              className="text-green-600 active:text-green-800 ml-2 flex-shrink-0 p-1"
              data-testid="button-clear-org-filter"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={orgSearchQuery}
              onChange={(e) => {
                setOrgSearchQuery(e.target.value);
                setShowOrgDropdown(true);
              }}
              onFocus={() => setShowOrgDropdown(true)}
              placeholder="Search organizations..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              data-testid="input-org-search"
            />
            {showOrgDropdown && orgSearchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                {orgSearchResults.map((org) => (
                  <button
                    key={org.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setOrganizationFilter(org);
                      setOrgSearchQuery('');
                      setShowOrgDropdown(false);
                    }}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100"
                    data-testid={`org-result-${org.id}`}
                  >
                    <span className="font-medium text-gray-900">{org.name || 'Unknown'}</span>
                    {org.domain && (
                      <span className="text-xs text-gray-500 ml-2">{org.domain}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Properties</label>
        <div className="flex flex-wrap gap-1.5">
          {PROPERTY_COUNT_BUCKETS.map((bucket) => (
            <button
              key={bucket.value}
              onClick={() => setPropertyCountFilter(bucket.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                propertyCountFilter === bucket.value
                  ? 'bg-green-100 border-green-300 text-green-800'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              data-testid={`filter-property-count-${bucket.value}`}
            >
              {bucket.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Contact Info Available</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setHasValidEmail(!hasValidEmail)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              hasValidEmail
                ? 'bg-green-100 border-green-300 text-green-800'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="filter-has-valid-email"
          >
            <Mail className="w-3.5 h-3.5" />
            Valid Email
          </button>
          <button
            onClick={() => setHasPhone(!hasPhone)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              hasPhone
                ? 'bg-green-100 border-green-300 text-green-800'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="filter-has-phone"
          >
            <Phone className="w-3.5 h-3.5" />
            Phone
          </button>
          <button
            onClick={() => setHasLinkedIn(!hasLinkedIn)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              hasLinkedIn
                ? 'bg-green-100 border-green-300 text-green-800'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="filter-has-linkedin"
          >
            <img src={linkedinLogo.src} alt="" className="w-3.5 h-3.5" />
            LinkedIn
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-4 md:px-6 py-6 md:py-8">
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search name, email, phone, company, title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 pl-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              data-testid="input-search-contacts"
            />
            <svg
              className="absolute left-3 top-3 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <div className="relative" ref={filterDropdownRef}>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border rounded-lg transition-colors ${
                activeFilterCount > 0
                  ? 'bg-green-50 border-green-500 text-green-700'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="button-open-contact-filters"
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {isFilterOpen && (
              <>
                <div className="hidden md:block absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  {filterContent}
                </div>
                <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-white">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="p-2 text-gray-500 hover:text-gray-700"
                      data-testid="button-close-contact-filters"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {filterContent}
                  </div>
                  <div className="px-4 py-3 border-t border-gray-200">
                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="w-full py-2.5 text-sm font-medium text-white bg-green-600 rounded-lg active:bg-green-700"
                      data-testid="button-apply-contact-filters"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
          </div>
        ) : contacts.length === 0 ? (
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
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No contacts found</h3>
            <p className="text-gray-500">
              {searchQuery || activeFilterCount > 0
                ? 'Try adjusting your search or filter criteria.'
                : 'Contacts will appear here once enriched.'}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left w-10">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={someSelected && !allSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          data-testid="checkbox-select-all-contacts"
                          aria-label="Select all contacts"
                        />
                      </th>
                      <th
                        onClick={() => handleSort('fullName')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Contact <SortIcon column="fullName" />
                      </th>
                      <th
                        onClick={() => handleSort('email')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Email <SortIcon column="email" />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Phone
                      </th>
                      <th
                        onClick={() => handleSort('title')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Title <SortIcon column="title" />
                      </th>
                      <th
                        onClick={() => handleSort('employerName')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Employer <SortIcon column="employerName" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {contacts.map((contact) => (
                      <React.Fragment key={contact.id}>
                        <tr 
                          className={`hover:bg-gray-50 ${contact.id ? 'cursor-pointer' : ''} ${selectedContacts.has(contact.id) ? 'bg-green-50' : ''}`}
                          data-testid={`contact-row-${contact.id}`}
                        >
                          <td className="px-4 py-4">
                            <Checkbox
                              checked={selectedContacts.has(contact.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleSelectContact(contact.id, e.target.checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`checkbox-contact-${contact.id}`}
                              aria-label={`Select ${contact.fullName || 'contact'}`}
                            />
                          </td>
                          <td 
                            className="px-4 py-3"
                            onClick={() => contact.id && (window.location.href = `/contact/${contact.id}`)}
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-900 truncate">
                                    {contact.fullName || 'Unknown'}
                                  </span>
                                  <LinkedInLink linkedinUrl={contact.linkedinUrl} size="sm" />
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0" data-testid={`contact-status-icons-${contact.id}`}>
                                <EmailStatusIcon 
                                  hasEmail={!!contact.email} 
                                  status={contact.emailValidationStatus || contact.emailStatus}
                                  size="sm"
                                />
                                <PhoneStatusIcon 
                                  hasPhone={hasAnyPhone(contact)}
                                  isOfficeOnly={hasOnlyOfficeLine(contact)}
                                  size="sm"
                                />
                                <LinkedInStatusIcon 
                                  hasLinkedIn={!!contact.linkedinUrl}
                                  size="sm"
                                />
                              </div>
                            </div>
                          </td>
                          <td 
                            className="px-4 py-3 whitespace-nowrap"
                            onClick={() => contact.id && (window.location.href = `/contact/${contact.id}`)}
                          >
                            {contact.email ? (
                              <a
                                href={`mailto:${contact.email}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm text-green-600 underline"
                                data-testid={`link-email-${contact.id}`}
                              >
                                {contact.email}
                              </a>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                          <td 
                            className="px-4 py-3"
                            onClick={() => contact.id && (window.location.href = `/contact/${contact.id}`)}
                          >
                            {(() => {
                              const phones = getPhoneNumbers(contact);
                              if (phones.length === 0) {
                                return <span className="text-sm text-gray-400">—</span>;
                              }
                              return (
                                <div className="flex flex-col gap-0.5">
                                  {phones.map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-1">
                                      <a
                                        href={`tel:${p.number}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-sm text-green-600 underline"
                                        data-testid={`link-phone-${contact.id}-${idx}`}
                                      >
                                        {p.number}
                                      </a>
                                      <span className="text-xs text-gray-400">({p.label})</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                          <td 
                            className="px-4 py-3 whitespace-nowrap"
                            onClick={() => contact.id && (window.location.href = `/contact/${contact.id}`)}
                          >
                            {contact.title ? (
                              <span className="text-sm text-gray-900 truncate max-w-[200px] block">{contact.title}</span>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                          <td 
                            className="px-4 py-3 whitespace-nowrap"
                            onClick={() => contact.id && (window.location.href = `/contact/${contact.id}`)}
                          >
                            {contact.employerName ? (
                              <span className="text-sm text-gray-900 truncate max-w-[180px] block">{contact.employerName}</span>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                        {expandedContact === contact.id && (
                          <tr>
                            <td colSpan={6} className="px-4 py-3 bg-gray-50">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {contact.properties.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-700 mb-2">Properties</h4>
                                    <ul className="space-y-1">
                                      {contact.properties.slice(0, 5).map((prop, idx) => (
                                        <li key={idx} className="text-sm text-gray-600">
                                          <Link href={`/property/${prop.propertyId}`} className="text-green-600 hover:underline">
                                            {prop.address || prop.propertyKey || 'Unknown'}
                                          </Link>
                                          {prop.role && <span className="text-gray-400 ml-2">({prop.role})</span>}
                                        </li>
                                      ))}
                                      {contact.properties.length > 5 && (
                                        <li className="text-sm text-gray-400">+{contact.properties.length - 5} more</li>
                                      )}
                                    </ul>
                                  </div>
                                )}
                                {contact.organizations.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-700 mb-2">Organizations</h4>
                                    <ul className="space-y-1">
                                      {contact.organizations.slice(0, 5).map((org, idx) => (
                                        <li key={idx} className="text-sm text-gray-600">
                                          <Link href={`/organization/${org.orgId}`} className="text-green-600 hover:underline">
                                            {org.orgName || org.orgDomain || 'Unknown'}
                                          </Link>
                                          {org.title && <span className="text-gray-400 ml-2">({org.title})</span>}
                                        </li>
                                      ))}
                                      {contact.organizations.length > 5 && (
                                        <li className="text-sm text-gray-400">+{contact.organizations.length - 5} more</li>
                                      )}
                                    </ul>
                                  </div>
                                )}
                                {contact.linkedinUrl && (
                                  <div>
                                    <a
                                      href={contact.linkedinUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                                    >
                                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                                      </svg>
                                      LinkedIn Profile
                                    </a>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
              {contacts.map((contact) => (
                <Link
                  key={contact.id}
                  href={`/contact/${contact.id}`}
                  className="block p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {contact.fullName || 'Unknown'}
                      </p>
                      {contact.email && (
                        <p className="text-sm text-green-600 truncate">{contact.email}</p>
                      )}
                      {contact.title && (
                        <p className="text-xs text-gray-500 mt-1">{contact.title}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {contact.emailStatus && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getEmailStatusColor(contact.emailStatus)}`}>
                          {contact.emailStatus}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {contact.propertyCount} properties
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      {contact.organizationCount} orgs
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 mt-6">
                <div className="text-sm text-gray-500">
                  Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total} contacts
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <div className="flex items-center space-x-1">
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      let pageNum;
                      if (pagination.totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (pagination.page <= 3) {
                        pageNum = i + 1;
                      } else if (pagination.page >= pagination.totalPages - 2) {
                        pageNum = pagination.totalPages - 4 + i;
                      } else {
                        pageNum = pagination.page - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`px-3 py-1 text-sm font-medium rounded-lg ${
                            pagination.page === pageNum
                              ? 'bg-green-600 text-white'
                              : 'text-gray-700 bg-white border border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page === pagination.totalPages}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {selectedContacts.size > 0 && (
          <BulkActionBar
            selectedCount={selectedContacts.size}
            itemLabel="contact"
            onDeselectAll={handleDeselectAll}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={handleFindPhones}
              className="bg-white text-gray-900"
              data-testid="button-bulk-find-phones"
            >
              <Phone className="h-4 w-4 mr-1" />
              Find Phones
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFindEmails}
              className="bg-white text-gray-900"
              data-testid="button-bulk-find-emails"
            >
              <Mail className="h-4 w-4 mr-1" />
              Find Emails
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddToList}
              className="bg-white text-gray-900"
              data-testid="button-bulk-add-to-list"
            >
              <ListPlus className="h-4 w-4 mr-1" />
              Add to List
            </Button>
          </BulkActionBar>
        )}
      </main>
    </div>
  );
}
