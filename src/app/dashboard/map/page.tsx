'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { MapBounds } from '@/map/DashboardMap';
import type { MapCanvasHandle } from '@/map/MapCanvas';
import PropertyFilters, { FilterState, serializeFiltersToParams, parseFiltersFromParams } from '@/components/PropertyFilters';
import MapSearchBar from '@/components/MapSearchBar';
import { useToast } from '@/hooks/use-toast';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLORS } from '@/lib/constants';

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
    buildingSqft: number;
    isCurrentCustomer: boolean;
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

export default function MapPage() {
  const mapRef = useRef<MapCanvasHandle>(null);
  const mapZoomRef = useRef<number>(13);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [config, setConfig] = useState<{ mapboxToken: string; regridToken: string; regridTileUrl: string } | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [allProperties, setAllProperties] = useState<PropertyFeature[]>([]);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({ lat: 32.8639, lon: -96.7784 });
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(() => parseFiltersFromParams(searchParams));

  const savedViewport = useMemo(() => {
    try {
      const saved = sessionStorage.getItem('greenfinch_map_viewport');
      if (saved) {
        sessionStorage.removeItem('greenfinch_map_viewport');
        const parsed = JSON.parse(saved);
        if (parsed.center && Date.now() - parsed.timestamp < 30 * 60 * 1000) {
          return parsed;
        }
      }
    } catch {}
    return null;
  }, []);

  // Build API URL with all active filters
  const buildGeojsonUrl = useCallback((filterState: FilterState): string => {
    const params = new URLSearchParams();
    
    if (filterState.categories.length > 0) {
      params.set('categories', filterState.categories.join(','));
    }
    if (filterState.subcategories.length > 0) {
      params.set('subcategories', filterState.subcategories.join(','));
    }
    if (filterState.enrichmentStatus !== 'all') {
      params.set('enrichmentStatus', filterState.enrichmentStatus);
    }
    if (filterState.customerStatuses && filterState.customerStatuses.length > 0) {
      params.set('customerStatuses', filterState.customerStatuses.join(','));
    }
    if (filterState.zipCodes && filterState.zipCodes.length > 0) {
      params.set('zipCodes', filterState.zipCodes.join(','));
    }
    if (filterState.minLotAcres) {
      params.set('minLotAcres', String(filterState.minLotAcres));
    }
    if (filterState.maxLotAcres) {
      params.set('maxLotAcres', String(filterState.maxLotAcres));
    }
    if (filterState.minNetSqft) {
      params.set('minNetSqft', String(filterState.minNetSqft));
    }
    if (filterState.maxNetSqft) {
      params.set('maxNetSqft', String(filterState.maxNetSqft));
    }
    if (filterState.organizationId) {
      params.set('organizationId', filterState.organizationId);
    }
    if (filterState.contactId) {
      params.set('contactId', filterState.contactId);
    }
    if (filterState.buildingClasses && filterState.buildingClasses.length > 0) {
      params.set('buildingClasses', filterState.buildingClasses.join(','));
    }
    
    const queryString = params.toString();
    return `/api/properties/geojson${queryString ? `?${queryString}` : ''}`;
  }, []);

  const handleFiltersChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    const params = serializeFiltersToParams(newFilters);
    const queryString = params.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ''}`, { scroll: false });
  }, [router, pathname]);

  // Fetch config on mount
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(configData => {
      setConfig({ mapboxToken: configData.mapboxToken, regridToken: configData.regridToken, regridTileUrl: configData.regridTileUrl });
      setConfigLoading(false);
    }).catch(() => setConfigLoading(false));
  }, []);

  // Fetch properties when filters change - applies all filters server-side
  useEffect(() => {
    setIsLoading(true);
    const url = buildGeojsonUrl(filters);
    fetch(url)
      .then(r => r.json())
      .then(geoData => {
        setAllProperties(geoData.features || []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [filters, buildGeojsonUrl]);


  const handleBoundsChange = useCallback((newBounds: MapBounds, zoom: number) => {
    setBounds(newBounds);
    const centerLat = (newBounds.north + newBounds.south) / 2;
    const centerLon = (newBounds.east + newBounds.west) / 2;
    setMapCenter({ lat: centerLat, lon: centerLon });
    mapZoomRef.current = zoom;
  }, []);

  const handlePropertyClick = useCallback((propertyKey: string) => {
    try {
      sessionStorage.setItem('greenfinch_map_viewport', JSON.stringify({
        center: mapCenter,
        zoom: mapZoomRef.current,
        timestamp: Date.now(),
      }));
    } catch {}
    router.push(`/property/${propertyKey}`);
  }, [router, mapCenter]);

  const handleSearchSelect = useCallback((suggestion: SearchSuggestion) => {
    const zoom = getZoomForType(suggestion.type, !!suggestion.propertyKey);
    mapRef.current?.flyTo(suggestion.lat, suggestion.lon, zoom);
    
    if (suggestion.propertyKey) {
      setTimeout(() => {
        router.push(`/property/${suggestion.propertyKey}`);
      }, 1600);
    }
  }, [router]);

  // All filtering is done server-side - allProperties already contains only matching properties
  // visibleProperties filters to what's in the current map bounds (for sidebar display)
  const visibleProperties = useMemo(() => {
    if (!bounds || allProperties.length === 0) return [];
    return allProperties.filter((f) => {
      const [lng, lat] = f.geometry.coordinates;
      return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
    });
  }, [bounds, allProperties]);

  if (configLoading) {
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
        <div className={`w-full h-full ${isLoading ? "opacity-50 pointer-events-none" : ""}`}>
          <MapCanvas
            ref={mapRef}
            accessToken={config.mapboxToken}
            regridToken={config.regridToken}
            regridTileUrl={config.regridTileUrl}
            properties={allProperties}
            initialCenter={savedViewport?.center}
            initialZoom={savedViewport?.zoom}
            onBoundsChange={handleBoundsChange}
            onPropertyClick={handlePropertyClick}
          />
        </div>
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none">
          <div className="flex items-center gap-2 flex-wrap pointer-events-auto w-fit">
            <MapSearchBar onSelect={handleSearchSelect} mapCenter={mapCenter} />
            <PropertyFilters filters={filters} onFiltersChange={handleFiltersChange} />
          </div>
        </div>
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/20 pointer-events-none">
            <div className="bg-white p-3 rounded-full shadow-lg border border-gray-100">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
            </div>
          </div>
        )}
      </div>

      <div className="hidden md:flex md:w-80 bg-white border-l border-gray-200 flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Properties in View <span className="text-green-600 font-normal">({visibleProperties.length})</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {allProperties.length} matching filters
          </p>
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
            visibleProperties.slice(0, 100).map((f) => (
              <button
                key={f.properties.propertyKey}
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
                <div className="flex flex-col gap-1 mt-1">
                  {f.properties.category && (() => {
                    const colors = CATEGORY_COLORS[f.properties.category] ?? DEFAULT_CATEGORY_COLORS;
                    return (
                      <span className={`inline-block px-2 py-0.5 text-[10px] ${colors.bg} ${colors.text} rounded self-start font-medium`}>
                        {f.properties.category}
                      </span>
                    );
                  })()}
                  {f.properties.subcategory && f.properties.category && (() => {
                    const colors = CATEGORY_COLORS[f.properties.category] ?? DEFAULT_CATEGORY_COLORS;
                    return (
                      <span className={`inline-block px-2 py-0.5 text-[10px] ${colors.subBg} ${colors.subText} rounded self-start`}>
                        {f.properties.subcategory}
                      </span>
                    );
                  })()}
                  {f.properties.lotSqft > 0 && (
                    <span className="text-[10px] text-gray-500">
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
