'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Filter } from 'lucide-react';
import { TableSkeleton } from '@/components/PageSkeleton';
import { Button } from '@/components/ui/button';

interface Organization {
  id: string;
  name: string | null;
  domain: string | null;
  orgType: string | null;
  industry: string | null;
  employees: number | null;
  employeesRange: string | null;
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

const EMPLOYEE_BUCKETS = [
  { value: 'all', label: 'All Sizes' },
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '500+', label: '500+' },
];

const PROPERTY_COUNT_BUCKETS = [
  { value: 'all', label: 'All' },
  { value: '1', label: '1' },
  { value: '2-5', label: '2-5' },
  { value: '6-10', label: '6-10' },
  { value: '10+', label: '10+' },
];

const CONTACT_COUNT_BUCKETS = [
  { value: 'all', label: 'All' },
  { value: '0', label: '0' },
  { value: '1-5', label: '1-5' },
  { value: '6-10', label: '6-10' },
  { value: '10+', label: '10+' },
];

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [employeesFilter, setEmployeesFilter] = useState('all');
  const [propertyCountFilter, setPropertyCountFilter] = useState('all');
  const [contactCountFilter, setContactCountFilter] = useState('all');
  const [sortBy, setSortBy] = useState('propertyCount');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [availableIndustries, setAvailableIndustries] = useState<string[]>([]);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = 
    (typeFilter !== 'all' ? 1 : 0) +
    (industryFilter !== 'all' ? 1 : 0) +
    (employeesFilter !== 'all' ? 1 : 0) +
    (propertyCountFilter !== 'all' ? 1 : 0) +
    (contactCountFilter !== 'all' ? 1 : 0);

  const clearAllFilters = () => {
    setTypeFilter('all');
    setIndustryFilter('all');
    setEmployeesFilter('all');
    setPropertyCountFilter('all');
    setContactCountFilter('all');
  };

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
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (industryFilter !== 'all') params.set('industry', industryFilter);
      if (employeesFilter !== 'all') params.set('employees', employeesFilter);
      if (propertyCountFilter !== 'all') params.set('propertyCount', propertyCountFilter);
      if (contactCountFilter !== 'all') params.set('contactCount', contactCountFilter);

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
      if (data.availableIndustries) {
        setAvailableIndustries(data.availableIndustries);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, typeFilter, industryFilter, employeesFilter, propertyCountFilter, contactCountFilter, sortBy, sortOrder]);

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

  const formatEmployeeCount = (employees: number | null, employeesRange: string | null) => {
    if (employees) {
      if (employees >= 1000) {
        return `${(employees / 1000).toFixed(1)}k`;
      }
      return employees.toLocaleString();
    }
    if (employeesRange) {
      return employeesRange;
    }
    return null;
  };

  const filterContent = (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-gray-900">Filter Organizations</h3>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg active:bg-gray-100"
            data-testid="button-clear-all-org-filters"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Type</label>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          data-testid="select-org-type"
        >
          <option value="all">All Types</option>
          {availableTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Industry</label>
        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          data-testid="select-industry"
        >
          <option value="all">All Industries</option>
          {availableIndustries.map((ind) => (
            <option key={ind} value={ind}>{ind}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Employees</label>
        <select
          value={employeesFilter}
          onChange={(e) => setEmployeesFilter(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          data-testid="select-employees"
        >
          {EMPLOYEE_BUCKETS.map((bucket) => (
            <option key={bucket.value} value={bucket.value}>{bucket.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Properties</label>
        <select
          value={propertyCountFilter}
          onChange={(e) => setPropertyCountFilter(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          data-testid="select-property-count"
        >
          {PROPERTY_COUNT_BUCKETS.map((bucket) => (
            <option key={bucket.value} value={bucket.value}>{bucket.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Contacts</label>
        <select
          value={contactCountFilter}
          onChange={(e) => setContactCountFilter(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          data-testid="select-contact-count"
        >
          {CONTACT_COUNT_BUCKETS.map((bucket) => (
            <option key={bucket.value} value={bucket.value}>{bucket.label}</option>
          ))}
        </select>
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

          <div className="relative" ref={filterDropdownRef}>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border rounded-lg transition-colors ${
                activeFilterCount > 0
                  ? 'bg-green-50 border-green-500 text-green-700'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="button-open-org-filters"
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
                      data-testid="button-close-org-filters"
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
                      data-testid="button-apply-org-filters"
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
          <TableSkeleton rows={12} />
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
              {searchQuery || activeFilterCount > 0
                ? 'Try adjusting your search or filter criteria.'
                : 'Organizations will appear here once enriched.'}
            </p>
          </div>
        ) : (
          <>
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
                        onClick={() => handleSort('industry')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Industry <SortIcon column="industry" />
                      </th>
                      <th
                        onClick={() => handleSort('employees')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        Employees <SortIcon column="employees" />
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
                          {org.industry ? (
                            <span className="text-sm text-gray-700">
                              {org.industry}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {formatEmployeeCount(org.employees, org.employeesRange) ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              {formatEmployeeCount(org.employees, org.employeesRange)}
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
                          <svg className="w-4 h-4 inline-block text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

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
                      {org.industry && (
                        <p className="text-xs text-gray-500 mt-1">{org.industry}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {formatEmployeeCount(org.employees, org.employeesRange) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {formatEmployeeCount(org.employees, org.employeesRange)} emp
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
              <div className="px-4 md:px-6 py-3 border-t border-gray-200 bg-white sticky bottom-0">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="text-sm text-gray-500">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                    {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                    {pagination.total} organizations
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page === 1}
                      data-testid="button-prev-page"
                    >
                      Previous
                    </Button>
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
                          <Button
                            key={pageNum}
                            variant={pagination.page === pageNum ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handlePageChange(pageNum)}
                            className={pagination.page === pageNum ? 'bg-green-600 hover:bg-green-700' : ''}
                            data-testid={`button-page-${pageNum}`}
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page === pagination.totalPages}
                      data-testid="button-next-page"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
