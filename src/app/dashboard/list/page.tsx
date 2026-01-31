'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import PropertyFilters, { FilterState, emptyFilters, UNKNOWN_CATEGORY, UNKNOWN_BUILDING_CLASS, QuickFilterChips } from '@/components/PropertyFilters';
import { normalizeCommonName } from '@/lib/normalization';

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
}

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
const FILTERS_STORAGE_KEY = 'greenfinch_property_filters';

function loadFiltersFromStorage(): FilterState {
  if (typeof window === 'undefined') return emptyFilters;
  try {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...emptyFilters, ...parsed };
    }
  } catch {}
  return emptyFilters;
}

function saveFiltersToStorage(filters: FilterState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {}
}

export default function ListPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  useEffect(() => {
    const storedFilters = loadFiltersFromStorage();
    setFilters(storedFilters);
    setFiltersInitialized(true);
  }, []);

  useEffect(() => {
    if (filtersInitialized) {
      saveFiltersToStorage(filters);
    }
  }, [filters, filtersInitialized]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setIsLoading(true);
    const url = debouncedQuery
      ? `/api/properties/search?q=${encodeURIComponent(debouncedQuery)}`
      : '/api/properties/search';
    
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setProperties(data.properties || []);
        setTotalCount(data.total || 0);
        setIsLoading(false);
        setCurrentPage(1);
      })
      .catch(() => setIsLoading(false));
  }, [debouncedQuery]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      // Lot size filter
      if (filters.minLotAcres) {
        const lotAcres = (p.lotSqft || 0) / 43560;
        if (lotAcres < filters.minLotAcres) return false;
      }
      if (filters.maxLotAcres) {
        const lotAcres = (p.lotSqft || 0) / 43560;
        if (lotAcres > filters.maxLotAcres) return false;
      }
      
      // Category filter - supports "Unknown / Unassigned" for null categories
      if ((filters.categories?.length ?? 0) > 0) {
        const hasUnknown = filters.categories?.includes(UNKNOWN_CATEGORY);
        const matchesCategory = p.category && filters.categories?.includes(p.category);
        const matchesUnknown = hasUnknown && !p.category;
        if (!matchesCategory && !matchesUnknown) {
          return false;
        }
      }
      
      // Enrichment status filter - normalize on enriched boolean
      const isEnriched = p.enriched || p.enrichmentStatus === 'completed';
      if (filters.enrichmentStatus === 'researched') {
        if (!isEnriched) return false;
      } else if (filters.enrichmentStatus === 'not_researched') {
        if (isEnriched) return false;
      }
      
      return true;
    });
  }, [properties, filters]);

  // Paginate filtered results
  const totalPages = Math.ceil(filteredProperties.length / PAGE_SIZE);
  const paginatedProperties = filteredProperties.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const handleRowClick = useCallback((propertyKey: string) => {
    router.push(`/property/${propertyKey}`);
  }, [router]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100">
              Properties <span className="text-green-600 dark:text-green-500 font-normal">({filteredProperties.length.toLocaleString()})</span>
            </h1>
            {filteredProperties.length !== totalCount && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                of {totalCount.toLocaleString()} total
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PropertyFilters filters={filters} onFiltersChange={setFilters} />
            <div className="relative flex-1 min-w-[200px] md:flex-none">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, address..."
                className="w-full md:w-80 pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                data-testid="input-search-properties"
              />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
        <QuickFilterChips filters={filters} onFiltersChange={setFilters} />
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
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lot Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bldg Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Location</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Owner</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {paginatedProperties.map((p) => (
                    <tr
                      key={p.propertyKey}
                      onClick={() => handleRowClick(p.propertyKey)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                      data-testid={`row-property-${p.propertyKey}`}
                    >
                      <td className="px-6 py-4">
                        {p.commonName ? (
                          <>
                            <p className="font-medium text-gray-900">{normalizeCommonName(p.commonName)}</p>
                            <p className="text-sm text-gray-500">{p.address}</p>
                          </>
                        ) : (
                          <p className="font-medium text-gray-900">{p.address}</p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {p.category && (
                          <span className="inline-block px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                            {p.category}
                          </span>
                        )}
                        {p.subcategory && (
                          <p className="text-xs text-gray-500 mt-1">{p.subcategory}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatLotSize(p.lotSqft)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatBuildingSqft(p.buildingSqft)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {p.city}, {p.zip}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                        {p.primaryOwner || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-2 py-1 text-xs rounded ${
                          p.enrichmentStatus === 'completed' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {p.enrichmentStatus === 'completed' ? 'Enriched' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-800">
              {paginatedProperties.map((p) => (
                <button
                  key={p.propertyKey}
                  onClick={() => handleRowClick(p.propertyKey)}
                  className="w-full text-left px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800 transition-colors"
                  data-testid={`card-property-${p.propertyKey}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {p.commonName ? (
                        <>
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{normalizeCommonName(p.commonName)}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{p.address}</p>
                        </>
                      ) : (
                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{p.address}</p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.city}, {p.zip}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {p.category && (
                        <span className="inline-block px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                          {p.category}
                        </span>
                      )}
                      <span className="text-xs text-gray-500 dark:text-gray-400">{formatLotSize(p.lotSqft)}</span>
                    </div>
                  </div>
                  {p.subcategory && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{p.subcategory}</p>
                  )}
                </button>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 md:px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky bottom-0">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, filteredProperties.length)} of {filteredProperties.length.toLocaleString()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 active:bg-gray-50 dark:active:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-prev-page"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 active:bg-gray-50 dark:active:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-next-page"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
