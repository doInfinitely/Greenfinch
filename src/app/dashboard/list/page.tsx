'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { normalizeCommonName } from '@/lib/normalization';
import { useDebounce } from '@/hooks/use-debounce';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { BulkActionBar } from '@/components/BulkActionBar';
import { Sparkles, ListPlus, Users } from 'lucide-react';
import { TableSkeleton } from '@/components/PageSkeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLORS } from '@/lib/constants';
import { useToast } from '@/hooks/use-toast';
import BulkAddToListModal from '@/components/BulkAddToListModal';
import { useEnrichment } from '@/hooks/use-enrichment';
import PropertyFilters, { FilterState, parseFiltersFromParams, serializeFiltersToParams } from '@/components/PropertyFilters';

interface Property {
  propertyKey: string;
  propertyId: string;
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
  // Prioritize pipeline status over isCurrentCustomer for consistency with filters
  if (p.pipelineStatus && PIPELINE_STATUS_CONFIG[p.pipelineStatus]) {
    return PIPELINE_STATUS_CONFIG[p.pipelineStatus];
  }
  // Fallback: isCurrentCustomer without a pipeline entry shows as Customer
  if (p.isCurrentCustomer) {
    return { label: 'Customer', className: 'bg-purple-100 text-purple-700' };
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

const PAGE_SIZE = 20;

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [filters, setFilters] = useState<FilterState>(() => parseFiltersFromParams(searchParams));

  const debouncedQuery = useDebounce(searchQuery, 300);

  const handleFiltersChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setCurrentPage(1);
    const params = serializeFiltersToParams(newFilters);
    const queryString = params.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ''}`, { scroll: false });
  }, [router, pathname]);

  const { data, isLoading, isFetching } = useQuery<{ properties: Property[]; pagination: PaginationInfo }>({
    queryKey: ['/api/properties/search', debouncedQuery, currentPage, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(currentPage));
      params.set('limit', String(PAGE_SIZE));
      if (debouncedQuery) {
        params.set('q', debouncedQuery);
      }
      // Add filter params
      if (filters.categories.length > 0) {
        params.set('categories', filters.categories.join(','));
      }
      if (filters.subcategories.length > 0) {
        params.set('subcategories', filters.subcategories.join(','));
      }
      if (filters.enrichmentStatus && filters.enrichmentStatus !== 'all') {
        params.set('enrichmentStatus', filters.enrichmentStatus);
      }
      if (filters.customerStatuses && filters.customerStatuses.length > 0) {
        params.set('customerStatuses', filters.customerStatuses.join(','));
      }
      if (filters.zipCodes && filters.zipCodes.length > 0) {
        params.set('zipCodes', filters.zipCodes.join(','));
      }
      if (filters.buildingClasses && filters.buildingClasses.length > 0) {
        params.set('buildingClasses', filters.buildingClasses.join(','));
      }
      if (filters.minLotAcres !== null) {
        params.set('minLotAcres', String(filters.minLotAcres));
      }
      if (filters.maxLotAcres !== null) {
        params.set('maxLotAcres', String(filters.maxLotAcres));
      }
      if (filters.minNetSqft !== null) {
        params.set('minNetSqft', String(filters.minNetSqft));
      }
      if (filters.maxNetSqft !== null) {
        params.set('maxNetSqft', String(filters.maxNetSqft));
      }
      if (filters.organizationId) {
        params.set('organizationId', filters.organizationId);
      }
      if (filters.contactId) {
        params.set('contactId', filters.contactId);
      }
      const response = await fetch(`/api/properties/search?${params.toString()}`);
      return response.json();
    },
    staleTime: 30000,
  });

  const properties = data?.properties || [];
  const pagination = data?.pagination || { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 };

  useEffect(() => {
    setCurrentPage(1);
    setSelectedProperties(new Set());
  }, [debouncedQuery]);


  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setCurrentPage(newPage);
      setSelectedProperties(new Set());
    }
  }, [pagination.totalPages]);

  const handleRowClick = useCallback((propertyKey: string) => {
    router.push(`/property/${propertyKey}`);
  }, [router]);

  const handleSelectProperty = useCallback((propertyId: string | undefined, checked: boolean) => {
    if (!propertyId) return;
    setSelectedProperties(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(propertyId);
      } else {
        next.delete(propertyId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const allIds = new Set(properties.map(p => p.propertyId).filter(Boolean));
      setSelectedProperties(allIds);
    } else {
      setSelectedProperties(new Set());
    }
  }, [properties]);

  const handleDeselectAll = useCallback(() => {
    setSelectedProperties(new Set());
  }, []);

  const { startEnrichment } = useEnrichment();

  const handleRunAIResearch = useCallback(() => {
    const selectedIds = Array.from(selectedProperties);
    const selectedProps = properties.filter(p => p.propertyId && selectedIds.includes(p.propertyId));
    
    if (selectedProps.length === 0) {
      toast({
        title: 'No Properties Selected',
        description: 'Please select properties to enrich.',
        variant: 'destructive',
      });
      return;
    }
    
    for (const prop of selectedProps) {
      startEnrichment({
        type: 'property',
        entityId: prop.propertyKey,
        entityName: prop.commonName || prop.address,
        apiEndpoint: '/api/enrich',
        requestBody: {
          propertyKey: prop.propertyKey,
          storeResults: true,
        },
      });
    }
    
    toast({
      title: 'AI Research Started',
      description: `Running AI research on ${selectedProps.length} selected properties...`,
    });
    
    setSelectedProperties(new Set());
  }, [selectedProperties, properties, startEnrichment, toast]);

  const handleAddToList = useCallback(() => {
    setShowAddToListModal(true);
  }, []);

  const allSelected = properties.length > 0 && properties.every(p => selectedProperties.has(p.propertyId));
  const someSelected = properties.some(p => selectedProperties.has(p.propertyId));

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base md:text-lg font-semibold text-gray-900">
                Properties <span className="text-green-600 font-normal">({pagination.total.toLocaleString()})</span>
              </h1>
            </div>
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
          <TableSkeleton rows={12} />
        ) : properties.length === 0 ? (
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
                        aria-label="Select all properties on this page"
                        title="Select all on this page"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contacts</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Orgs</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lot</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {properties.map((p: Property) => (
                    <tr
                      key={p.propertyKey}
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedProperties.has(p.propertyId) ? 'bg-green-50' : ''}`}
                      data-testid={`row-property-${p.propertyKey}`}
                    >
                      <td className="px-4 py-4">
                        <Checkbox
                          checked={selectedProperties.has(p.propertyId)}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleSelectProperty(p.propertyId, e.target.checked);
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
                        {p.category && (() => {
                          const colors = CATEGORY_COLORS[p.category] ?? DEFAULT_CATEGORY_COLORS;
                          return (
                            <span className={`inline-block px-2 py-1 text-xs ${colors.bg} ${colors.text} rounded-md font-medium`}>
                              {p.category}
                            </span>
                          );
                        })()}
                        {p.subcategory && p.category && (() => {
                          const colors = CATEGORY_COLORS[p.category] ?? DEFAULT_CATEGORY_COLORS;
                          return (
                            <div className="mt-1">
                              <span className={`inline-block px-2 py-0.5 text-[10px] ${colors.subBg} ${colors.subText} rounded-md`}>
                                {p.subcategory}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4" onClick={() => handleRowClick(p.propertyKey)}>
                        {(() => {
                          const status = getStatusDisplay(p);
                          return (
                            <span className={`inline-block px-2 py-1 text-xs rounded-md font-medium ${status.className}`}>
                              {status.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.contactCount > 0 ? p.contactCount : '-'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.organizations?.length > 0 ? p.organizations.length : '-'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600" onClick={() => handleRowClick(p.propertyKey)}>
                        {formatLotSize(p.lotSqft)}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500" onClick={() => handleRowClick(p.propertyKey)}>
                        {p.city}, {p.state}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="md:hidden divide-y divide-gray-200">
              {properties.map((p: Property) => (
                <div
                  key={p.propertyKey}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3 ${selectedProperties.has(p.propertyId) ? 'bg-green-50' : ''}`}
                  data-testid={`card-property-${p.propertyKey}`}
                >
                  <Checkbox
                    checked={selectedProperties.has(p.propertyId)}
                    onChange={(e) => handleSelectProperty(p.propertyId, e.target.checked)}
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

            {pagination.totalPages > 1 && (
              <div className="px-4 md:px-6 py-3 border-t border-gray-200 bg-white sticky bottom-0">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="text-sm text-gray-500">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                    {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                    {pagination.total.toLocaleString()} properties
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page === 1 || isFetching}
                      data-testid="button-prev-page"
                    >
                      Previous
                    </Button>
                    <div className="flex items-center space-x-1">
                      {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                        let pageNum: number;
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
                            disabled={isFetching}
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
                      disabled={pagination.page === pagination.totalPages || isFetching}
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
