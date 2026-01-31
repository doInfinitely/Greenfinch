'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { MapBounds } from '@/map/DashboardMap';
import type { MapCanvasHandle } from '@/map/MapCanvas';
import PropertyFilters, { FilterState, emptyFilters, UNKNOWN_CATEGORY, QuickFilterChips } from '@/components/PropertyFilters';
import MapSearchBar from '@/components/MapSearchBar';

const MapCanvas = dynamic(() => import('@/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
    </div>
  ),
});

interface PropertyFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    propertyKey: string;
    address: string;
    city: string;
    zip: string;
    primaryOwner: string;
    commonName: string | null;
    category: string | null;
    subcategory: string | null;
    enriched: boolean;
    lotSqft: number;
  };
}

interface SearchSuggestion {
  id: string;
  text: string;
  place_name: string;
  address: string;
  lat: number;
  lon: number;
  type: string;
  propertyKey?: string;
}

function getZoomForType(type: string, hasPropertyKey: boolean): number {
  if (hasPropertyKey) return 17;
  switch (type) {
    case 'poi':
    case 'address':
      return 16;
    case 'street':
      return 15;
    case 'neighborhood':
      return 14;
    case 'postcode':
      return 13;
    case 'place':
      return 12;
    default:
      return 15;
  }
}

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

export default function MapPage() {
  const mapRef = useRef<MapCanvasHandle>(null);
  const [config, setConfig] = useState<{ mapboxToken: string; regridToken: string; regridTileUrl: string } | null>(null);
  const [allProperties, setAllProperties] = useState<PropertyFeature[]>([]);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({ lat: 32.8639, lon: -96.7784 });
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
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
    Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/properties/geojson').then(r => r.json()),
    ]).then(([configData, geoData]) => {
      setConfig({ mapboxToken: configData.mapboxToken, regridToken: configData.regridToken, regridTileUrl: configData.regridTileUrl });
      setAllProperties(geoData.features || []);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);


  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
    const centerLat = (newBounds.north + newBounds.south) / 2;
    const centerLon = (newBounds.east + newBounds.west) / 2;
    setMapCenter({ lat: centerLat, lon: centerLon });
  }, []);

  const handlePropertyClick = useCallback((propertyKey: string) => {
    window.open(`/property/${propertyKey}`, '_blank');
  }, []);

  const handleSearchSelect = useCallback((suggestion: SearchSuggestion) => {
    const zoom = getZoomForType(suggestion.type, !!suggestion.propertyKey);
    mapRef.current?.flyTo(suggestion.lat, suggestion.lon, zoom);
    
    if (suggestion.propertyKey) {
      setTimeout(() => {
        window.open(`/property/${suggestion.propertyKey}`, '_blank');
      }, 1600);
    }
  }, []);

  const filteredProperties = useMemo(() => {
    return allProperties.filter((f) => {
      // Lot size filter
      const lotAcres = f.properties.lotSqft / 43560;
      if (filters.minLotAcres && lotAcres < filters.minLotAcres) return false;
      if (filters.maxLotAcres && lotAcres > filters.maxLotAcres) return false;
      
      // Category filter - supports "Unknown / Unassigned" for null categories
      if (filters.categories.length > 0) {
        const hasUnknown = filters.categories.includes(UNKNOWN_CATEGORY);
        const matchesCategory = f.properties.category && filters.categories.includes(f.properties.category);
        const matchesUnknown = hasUnknown && !f.properties.category;
        if (!matchesCategory && !matchesUnknown) {
          return false;
        }
      }
      
      // Enrichment status filter
      if (filters.enrichmentStatus === 'researched') {
        if (!f.properties.enriched) return false;
      } else if (filters.enrichmentStatus === 'not_researched') {
        if (f.properties.enriched) return false;
      }
      
      return true;
    });
  }, [allProperties, filters]);

  const visibleProperties = useMemo(() => {
    if (!bounds || filteredProperties.length === 0) return [];
    return filteredProperties.filter((f) => {
      const [lng, lat] = f.geometry.coordinates;
      return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
    });
  }, [bounds, filteredProperties]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!config?.mapboxToken) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Map configuration unavailable</p>
      </div>
    );
  }

  return (
    <div className="flex h-full relative">
      <div className="flex-1 relative">
        <MapCanvas
          ref={mapRef}
          accessToken={config.mapboxToken}
          regridToken={config.regridToken}
          regridTileUrl={config.regridTileUrl}
          properties={filteredProperties}
          onBoundsChange={handleBoundsChange}
          onPropertyClick={handlePropertyClick}
        />
        <div className="absolute top-3 left-3 right-14 md:right-auto z-10 flex flex-col gap-2">
          <MapSearchBar onSelect={handleSearchSelect} mapCenter={mapCenter} />
          <div className="flex items-start gap-2">
            <PropertyFilters filters={filters} onFiltersChange={setFilters} />
          </div>
          <div className="md:hidden">
            <QuickFilterChips filters={filters} onFiltersChange={setFilters} />
          </div>
        </div>
      </div>

      <div className="hidden md:flex md:w-80 bg-white border-l border-gray-200 flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Properties in View <span className="text-green-600 font-normal">({visibleProperties.length})</span>
          </h2>
          {(filters.minLotAcres || filters.maxLotAcres || filters.categories.length > 0 || filters.organizationId || filters.contactId || filters.enrichmentStatus !== 'all') && (
            <p className="text-xs text-gray-500 mt-1">
              Filtered from {allProperties.length} total
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleProperties.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <p>Pan or zoom to see properties</p>
            </div>
          ) : (
            visibleProperties.map((f, idx) => (
              <button
                key={`property-${f.properties.propertyKey || idx}-${idx}`}
                onClick={() => handlePropertyClick(f.properties.propertyKey)}
                className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                data-testid={`property-item-${f.properties.propertyKey}`}
              >
                {f.properties.commonName ? (
                  <>
                    <p className="font-medium text-gray-900 truncate">{f.properties.commonName}</p>
                    <p className="text-sm text-gray-500 truncate">{f.properties.address}</p>
                  </>
                ) : (
                  <p className="font-medium text-gray-900 truncate">{f.properties.address}</p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {f.properties.category && (
                    <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                      {f.properties.category}
                    </span>
                  )}
                  {f.properties.lotSqft > 0 && (
                    <span className="text-xs text-gray-500">
                      {(f.properties.lotSqft / 43560).toFixed(1)} ac
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
