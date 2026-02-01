'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import PropertyFilters, { FilterState, emptyFilters, UNKNOWN_CATEGORY, UNKNOWN_BUILDING_CLASS, serializeFiltersToParams, parseFiltersFromParams } from '@/components/PropertyFilters';
import { normalizeCommonName } from '@/lib/normalization';
import { useDebounce } from '@/hooks/use-debounce';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { BulkActionBar } from '@/components/BulkActionBar';
import { Sparkles, ListPlus, Users } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import BulkAddToListModal from '@/components/BulkAddToListModal';

interface Property {
  propertyKey: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  primaryOwner: string | null;
  category: string | null;
  subcategory: string | null;
  commonName: string | null;
  enrichmentStatus: string | null;
  enriched: boolean;
  lotSqft: number | null;
  buildingSqft: number | null;
  pipelineStatus: string | null;
  isCurrentCustomer: boolean;
  contactCount: number;
  organizations: Array<{ id: string; name: string }>;
}

const PIPELINE_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  qualified: { label: 'Qualified', className: 'bg-green-100 text-green-700' },
  disqualified: { label: 'Disqualified', className: 'bg-gray-100 text-gray-500' },
  proposal: { label: 'Proposal', className: 'bg-blue-100 text-blue-700' },
  negotiation: { label: 'Negotiation', className: 'bg-yellow-100 text-yellow-700' },
  won: { label: 'Won', className: 'bg-purple-100 text-purple-700' },
  lost: { label: 'Lost', className: 'bg-red-100 text-red-700' },
};

const getStatusDisplay = (p: Property): { label: string; className: string } => {
  if (p.isCurrentCustomer) {
    return { label: 'Customer', className: 'bg-purple-100 text-purple-700' };
  }
  if (p.pipelineStatus && PIPELINE_STATUS_CONFIG[p.pipelineStatus]) {
    return PIPELINE_STATUS_CONFIG[p.pipelineStatus];
  }
  return { label: 'Prospect', className: 'bg-gray-100 text-gray-600' };
};

const formatLotSize = (sqft: number | null) => {
  if (!sqft) return '-';
  const acres = sqft / 43560;
  return `${acres.toFixed(1)} ac`;
};

const formatBuildingSqft = (sqft: number | null) => {
  if (!sqft) return '-';
  if (sqft >= 1000) {
    const k = sqft / 1000;
    return sqft < 19000 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  return sqft.toString();
};

const PAGE_SIZE = 50;
const API_LIMIT = 100;

export default function ListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>(() => parseFiltersFromParams(searchParams));
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [loadAll, setLoadAll] = useState(false);
  const [showAddToListModal, setShowAddToListModal] = useState(false);

  const debouncedQuery = useDebounce(searchQuery, 300);

  const { data, isLoading, isFetching } = useQuery<{ properties: Property[]; total: number; hasMore: boolean }>({
    queryKey: ['/api/properties/search', debouncedQuery, loadAll ? 'all' : 'initial'],
    queryFn: async () => {
      const limit = loadAll ? 10000 : API_LIMIT;
      const url = debouncedQuery
        ? `/api/properties/search?q=${encodeURIComponent(debouncedQuery)}&limit=${limit}`
        : `/api/properties/search?limit=${limit}`;
      const response = await fetch(url);
      return response.json();
    },
    staleTime: 30000,
  });

  const properties = data?.properties || [];
  const totalCount = data?.total || 0;
  const hasMore = data?.hasMore || false;

  const handleFiltersChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    const params = serializeFiltersToParams(newFilters);
    const queryString = params.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ''}`, { scroll: false });
  }, [router, pathname]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedProperties(new Set());
    setLoadAll(false);
  }, [debouncedQuery]);

  useEffect(() => {
    setCurrentPage(1);
    setLoadAll(false);
  }, [filters]);

  const handleLoadMore = useCallback(() => {
    setLoadAll(true);
  }, []);

  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      if (filters.minLotAcres) {
        const lotAcres = (p.lotSqft || 0) / 43560;
        if (lotAcres < filters.minLotAcres) return false;
      }
      if (filters.maxLotAcres) {
        const lotAcres = (p.lotSqft || 0) / 43560;
        if (lotAcres > filters.maxLotAcres) return false;
      }
      
      if (filters.minNetSqft) {
        if ((p.buildingSqft || 0) < filters.minNetSqft) return false;
      }
      if (filters.maxNetSqft) {
        if ((p.buildingSqft || 0) > filters.maxNetSqft) return false;
      }
      
      if ((filters.categories?.length ?? 0) > 0) {
        const hasUnknown = filters.categories?.includes(UNKNOWN_CATEGORY);
        const matchesCategory = p.category && filters.categories?.includes(p.category);
        const matchesUnknown = hasUnknown && !p.category;
        if (!matchesCategory && !matchesUnknown) {
          return false;
        }
      }
      
      if (filters.zipCode) {
        if (!p.zip || !p.zip.includes(filters.zipCode)) return false;
      }
      
      const isEnriched = p.enriched || p.enrichmentStatus === 'completed';
      if (filters.enrichmentStatus === 'researched') {
        if (!isEnriched) return false;
      } else if (filters.enrichmentStatus === 'not_researched') {
        if (isEnriched) return false;
      }
      
      if (filters.customerStatus === 'customers') {
        if (!p.isCurrentCustomer) return false;
      } else if (filters.customerStatus === 'prospects') {
        if (p.isCurrentCustomer) return false;
      }
      
      return true;
    });
  }, [properties, filters]);

  const totalPages = Math.ceil(filteredProperties.length / PAGE_SIZE);
  const paginatedProperties = filteredProperties.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const handleRowClick = useCallback((propertyKey: string) => {
    router.push(`/property/${propertyKey}`);
  }, [router]);

  const handleSelectProperty = useCallback((propertyKey: string, checked: boolean) => {
    setSelectedProperties(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(propertyKey);
      } else {
        next.delete(propertyKey);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const allKeys = new Set(paginatedProperties.map(p => p.propertyKey));
      setSelectedProperties(allKeys);
    } else {
      setSelectedProperties(new Set());
    }
  }, [paginatedProperties]);

  const handleDeselectAll = useCallback(() => {
    setSelectedProperties(new Set());
  }, []);

  const handleRunAIResearch = useCallback(() => {
    const selectedKeys = Array.from(selectedProperties);
    toast({
      title: 'AI Research Started',
      description: `Running AI research on ${selectedKeys.length} selected properties...`,
    });
  }, [selectedProperties, toast]);

  const handleAddToList = useCallback(() => {
    setShowAddToListModal(true);
  }, []);

  const allSelected = paginatedProperties.length > 0 && paginatedProperties.every(p => selectedProperties.has(p.propertyKey));
  const someSelected = paginatedProperties.some(p => selectedProperties.has(p.propertyKey));

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base md:text-lg font-semibold text-gray-900">
                Properties <span className="text-green-600 font-normal">({filteredProperties.length.toLocaleString()})</span>
              </h1>
            </div>
            {properties.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-sm">
                {hasMore ? (
                  <span className="text-gray-600">
                    Showing first {API_LIMIT} of {totalCount.toLocaleString()} properties
                  </span>
                ) : (
                  <span className="text-gray-500">
                    {filteredProperties.length !== totalCount && `of ${totalCount.toLocaleString()} total`}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PropertyFilters filters={filters} onFiltersChange={handleFiltersChange} />
            <div className="relative flex-1 min-w-[200px] md:flex-none">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, address..."
                className="w-full md:w-80 pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                data-testid="input-search-properties"
              />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          </div>
        ) : filteredProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p>No properties found</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left w-10">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        data-testid="checkbox-select-all-properties"
                        aria-label="Select all properties"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contacts</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Orgs</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lot</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedProperties.map((p) => (
                    <tr
                      key={p.propertyKey}
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedProperties.has(p.propertyKey) ? 'bg-green-50' : ''}`}
                      data-testid={`row-property-${p.propertyKey}`}
                    >
                      <td className="px-4 py-4">
                        <Checkbox
                          checked={selectedProperties.has(p.propertyKey)}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleSelectProperty(p.propertyKey, e.target.checked);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`checkbox-property-${p.propertyKey}`}
                          aria-label={`Select ${p.address}`}
                        />
                      </td>
                      <td className="px-6 py-4" onClick={() => handleRowClick(p.propertyKey)}>
                        <div className="flex items-start gap-1.5">
                          {p.enriched && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Sparkles className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Researched with AI</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <div className="min-w-0">
                            {p.commonName ? (
                              <>
                                <p className="font-medium text-gray-900">{normalizeCommonName(p.commonName)}</p>
                                <p className="text-sm text-gray-500">{p.address}</p>
                              </>
                            ) : (
                              <p className="font-medium text-gray-900">{p.address}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.category && (
                          <span className="inline-block px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                            {p.category}
                          </span>
                        )}
                        {p.subcategory && (
                          <p className="text-xs text-gray-500 mt-1">{p.subcategory}</p>
                        )}
                      </td>
                      <td className="px-6 py-4" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.contactCount > 0 ? (
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <Users className="w-4 h-4" />
                            <span>{p.contactCount}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.organizations.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[140px]">
                            {p.organizations.slice(0, 2).map((org) => (
                              <span
                                key={org.id}
                                className="inline-block px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded truncate max-w-[100px]"
                                title={org.name}
                              >
                                {org.name}
                              </span>
                            ))}
                            {p.organizations.length > 2 && (
                              <span className="text-xs text-gray-500">+{p.organizations.length - 2}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600" onClick={() => handleRowClick(p.propertyKey)}>
                        {formatLotSize(p.lotSqft)}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.city}, {p.zip}
                      </td>
                      <td className="px-6 py-4" onClick={() => handleRowClick(p.propertyKey)}>
                        {(() => {
                          const status = getStatusDisplay(p);
                          return (
                            <span className={`inline-block px-2 py-1 text-xs rounded ${status.className}`}>
                              {status.label}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="md:hidden divide-y divide-gray-200">
              {paginatedProperties.map((p) => (
                <div
                  key={p.propertyKey}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3 ${selectedProperties.has(p.propertyKey) ? 'bg-green-50' : ''}`}
                  data-testid={`card-property-${p.propertyKey}`}
                >
                  <Checkbox
                    checked={selectedProperties.has(p.propertyKey)}
                    onChange={(e) => handleSelectProperty(p.propertyKey, e.target.checked)}
                    className="mt-1 flex-shrink-0"
                    data-testid={`checkbox-mobile-property-${p.propertyKey}`}
                    aria-label={`Select ${p.address}`}
                  />
                  <button
                    onClick={() => handleRowClick(p.propertyKey)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {p.commonName ? (
                          <>
                            <p className="font-medium text-gray-900 truncate">{normalizeCommonName(p.commonName)}</p>
                            <p className="text-sm text-gray-500 truncate">{p.address}</p>
                          </>
                        ) : (
                          <p className="font-medium text-gray-900 truncate">{p.address}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-0.5">{p.city}, {p.zip}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {(() => {
                          const status = getStatusDisplay(p);
                          return (
                            <span className={`inline-block px-2 py-0.5 text-xs rounded ${status.className}`}>
                              {status.label}
                            </span>
                          );
                        })()}
                        <span className="text-xs text-gray-500">{formatLotSize(p.lotSqft)}</span>
                      </div>
                    </div>
                    {p.subcategory && (
                      <p className="text-xs text-gray-500 mt-1">{p.subcategory}</p>
                    )}
                  </button>
                </div>
              ))}
            </div>

            {(hasMore || totalPages > 1) && (
              <div className="px-4 md:px-6 py-3 border-t border-gray-200 bg-white sticky bottom-0">
                {hasMore ? (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="text-sm text-gray-600">
                      Showing first {filteredProperties.length.toLocaleString()} of {totalCount.toLocaleString()} properties
                    </div>
                    <button
                      onClick={handleLoadMore}
                      disabled={isFetching}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      data-testid="button-load-more-all"
                    >
                      {isFetching ? 'Loading more...' : 'Load More'}
                    </button>
                  </div>
                ) : totalPages > 1 ? (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="text-sm text-gray-500">
                      Showing {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, filteredProperties.length)} of {filteredProperties.length.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="button-prev-page"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-600">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="button-next-page"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>

      <BulkActionBar
        selectedCount={selectedProperties.size}
        itemLabel="property"
        onDeselectAll={handleDeselectAll}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={handleRunAIResearch}
          data-testid="button-bulk-ai-research"
        >
          <Sparkles className="h-4 w-4" />
          Run AI Research
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddToList}
          data-testid="button-bulk-add-to-list"
        >
          <ListPlus className="h-4 w-4" />
          Add to List
        </Button>
      </BulkActionBar>

      <BulkAddToListModal
        isOpen={showAddToListModal}
        onClose={() => setShowAddToListModal(false)}
        itemIds={Array.from(selectedProperties)}
        itemType="properties"
      />
    </div>
  );
}
