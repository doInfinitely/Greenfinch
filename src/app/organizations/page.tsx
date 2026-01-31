'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Organization {
  id: string;
  name: string | null;
  domain: string | null;
  orgType: string | null;
  createdAt: string;
  propertyCount: number;
  contactCount: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [hasPropertiesFilter, setHasPropertiesFilter] = useState<'all' | 'true' | 'false'>('all');
  const [hasContactsFilter, setHasContactsFilter] = useState<'all' | 'true' | 'false'>('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFilterCount = (typeFilter && typeFilter !== 'all' ? 1 : 0) +
    (hasPropertiesFilter !== 'all' ? 1 : 0) +
    (hasContactsFilter !== 'all' ? 1 : 0);

  const clearAllFilters = () => {
    setTypeFilter('');
    setHasPropertiesFilter('all');
    setHasContactsFilter('all');
    setSearchQuery('');
  };

  const fetchOrganizations = useCallback(async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      if (searchQuery) params.set('q', searchQuery);
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter);
      if (hasPropertiesFilter !== 'all') params.set('hasProperties', hasPropertiesFilter);
      if (hasContactsFilter !== 'all') params.set('hasContacts', hasContactsFilter);

      const response = await fetch(`/api/organizations?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch organizations');
      }

      setOrganizations(data.organizations || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      if (data.availableTypes) {
        setAvailableTypes(data.availableTypes);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, typeFilter, hasPropertiesFilter, hasContactsFilter, sortBy, sortOrder]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchOrganizations(1);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [fetchOrganizations]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchOrganizations(newPage);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-4 md:px-6 py-6 md:py-8">
        {/* Search and Filters */}
        <div className="flex flex-col gap-4 mb-6">
          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 pl-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              data-testid="input-search-orgs"
            />
            <svg
              className="absolute left-3 top-3 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Filter Row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Type Filter */}
            <Select value={typeFilter || 'all'} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-40" data-testid="select-org-type">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Has Properties Filter */}
            <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
              <button
                onClick={() => setHasPropertiesFilter('all')}
                className={`px-3 py-2 text-sm transition-colors ${
                  hasPropertiesFilter === 'all'
                    ? 'bg-green-100 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid="button-properties-all"
              >
                Properties: All
              </button>
              <button
                onClick={() => setHasPropertiesFilter('true')}
                className={`px-3 py-2 text-sm border-l border-gray-200 transition-colors ${
                  hasPropertiesFilter === 'true'
                    ? 'bg-green-100 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid="button-properties-has"
              >
                Has
              </button>
              <button
                onClick={() => setHasPropertiesFilter('false')}
                className={`px-3 py-2 text-sm border-l border-gray-200 transition-colors ${
                  hasPropertiesFilter === 'false'
                    ? 'bg-green-100 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid="button-properties-none"
              >
                None
              </button>
            </div>

            {/* Has Contacts Filter */}
            <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
              <button
                onClick={() => setHasContactsFilter('all')}
                className={`px-3 py-2 text-sm transition-colors ${
                  hasContactsFilter === 'all'
                    ? 'bg-green-100 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid="button-contacts-all"
              >
                Contacts: All
              </button>
              <button
                onClick={() => setHasContactsFilter('true')}
                className={`px-3 py-2 text-sm border-l border-gray-200 transition-colors ${
                  hasContactsFilter === 'true'
                    ? 'bg-green-100 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid="button-contacts-has"
              >
                Has
              </button>
              <button
                onClick={() => setHasContactsFilter('false')}
                className={`px-3 py-2 text-sm border-l border-gray-200 transition-colors ${
                  hasContactsFilter === 'false'
                    ? 'bg-green-100 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid="button-contacts-none"
              >
                None
              </button>
            </div>

            {/* Clear All Button */}
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg active:bg-gray-100"
                data-testid="button-clear-org-filters"
              >
                Clear ({activeFilterCount})
              </button>
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
        ) : organizations.length === 0 ? (
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
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No organizations found</h3>
            <p className="text-gray-500">
              {searchQuery || (typeFilter && typeFilter !== 'all')
                ? 'Try adjusting your search or filter criteria.'
                : 'Organizations will appear here once enriched.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table view */}
            <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        onClick={() => handleSort('name')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Name <SortIcon column="name" />
                      </th>
                      <th
                        onClick={() => handleSort('domain')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Domain <SortIcon column="domain" />
                      </th>
                      <th
                        onClick={() => handleSort('type')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Type <SortIcon column="type" />
                      </th>
                      <th
                        onClick={() => handleSort('propertyCount')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Properties <SortIcon column="propertyCount" />
                      </th>
                      <th
                        onClick={() => handleSort('contactCount')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Contacts <SortIcon column="contactCount" />
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {organizations.map((org) => (
                      <tr 
                        key={org.id} 
                        className={`hover:bg-gray-50 ${org.id ? 'cursor-pointer' : ''}`}
                        onClick={() => org.id && (window.location.href = `/organization/${org.id}`)}
                        data-testid={`org-row-${org.id}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {org.name || 'Unnamed'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {org.domain ? (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`https://${org.domain}`, '_blank');
                              }}
                              className="text-sm text-green-600 hover:text-green-700 hover:underline cursor-pointer"
                            >
                              {org.domain}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {org.orgType ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              {org.orgType}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {org.propertyCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                            {org.contactCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              window.location.href = `/dashboard?org=${org.id}`;
                            }}
                            className="text-gray-500 hover:text-gray-700 cursor-pointer"
                          >
                            Map
                          </span>
                          <svg className="w-4 h-4 inline-block ml-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
              {organizations.map((org) => (
                <Link
                  key={org.id}
                  href={`/organization/${org.id}`}
                  className="block p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {org.name || 'Unnamed'}
                      </p>
                      {org.domain && (
                        <p className="text-sm text-green-600 truncate">{org.domain}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {org.orgType && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {org.orgType}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {org.propertyCount} properties
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      {org.contactCount} contacts
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
                  {pagination.total} organizations
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
      </main>
    </div>
  );
}
