'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { MapBounds } from '@/map/GoogleMap';
import type { GoogleMapCanvasHandle } from '@/map/GoogleMapCanvas';
import PropertyFilters, { FilterState } from '@/components/PropertyFilters';

const GoogleMapCanvas = dynamic(() => import('@/map/GoogleMapCanvas'), {
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
    totalParval: number;
    primaryOwner: string;
    commonName: string | null;
    category: string | null;
    subcategory: string | null;
    operationalStatus: string | null;
    enriched: boolean;
    lotSqft: number;
  };
}

export default function GoogleMapPage() {
  const router = useRouter();
  const mapRef = useRef<GoogleMapCanvasHandle>(null);
  const [config, setConfig] = useState<{ googleMapsApiKey: string; regridToken: string } | null>(null);
  const [allProperties, setAllProperties] = useState<PropertyFeature[]>([]);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({ minLotAcres: null, categories: [] });

  useEffect(() => {
    Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/properties/geojson').then(r => r.json()),
    ]).then(([configData, geoData]) => {
      setConfig({ googleMapsApiKey: configData.googleMapsApiKey, regridToken: configData.regridToken });
      setAllProperties(geoData.features || []);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  const handlePropertyClick = useCallback((propertyKey: string) => {
    router.push(`/property/${propertyKey}`);
  }, [router]);

  const filteredProperties = useMemo(() => {
    return allProperties.filter((f) => {
      if (filters.minLotAcres) {
        const lotAcres = f.properties.lotSqft / 43560;
        if (lotAcres < filters.minLotAcres) return false;
      }
      if (filters.categories.length > 0) {
        if (!f.properties.category || !filters.categories.includes(f.properties.category)) {
          return false;
        }
      }
      return true;
    });
  }, [allProperties, filters]);

  const visibleProperties = useMemo(() => {
    if (!bounds) return filteredProperties;
    return filteredProperties.filter((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return (
        lat >= bounds.south &&
        lat <= bounds.north &&
        lon >= bounds.west &&
        lon <= bounds.east
      );
    });
  }, [filteredProperties, bounds]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!config?.googleMapsApiKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-medium">Google Maps API key not configured</p>
          <p className="text-gray-500 text-sm mt-2">Please add GOOGLE_MAPS_API_KEY to your environment variables</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 relative">
        <GoogleMapCanvas
          ref={mapRef}
          apiKey={config.googleMapsApiKey}
          regridToken={config.regridToken}
          properties={filteredProperties}
          onBoundsChange={handleBoundsChange}
          onPropertyClick={handlePropertyClick}
        />
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
          <div className="bg-white px-3 py-2 rounded-lg shadow-md">
            <span className="text-sm font-medium text-green-600">Google Maps POC</span>
          </div>
          <PropertyFilters filters={filters} onFiltersChange={setFilters} />
        </div>
      </div>

      <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Properties ({visibleProperties.length})
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleProperties.slice(0, 50).map((property) => {
            const props = property.properties;
            return (
              <button
                key={props.propertyKey}
                onClick={() => handlePropertyClick(props.propertyKey)}
                className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                {props.enriched && props.commonName && (
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {props.commonName}
                  </p>
                )}
                <p className={`text-sm ${props.enriched && props.commonName ? 'text-gray-500' : 'text-gray-900 font-medium'} truncate`}>
                  {props.address}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {props.city}, TX {props.zip}
                </p>
              </button>
            );
          })}
          {visibleProperties.length > 50 && (
            <div className="px-4 py-3 text-center text-sm text-gray-500">
              Showing 50 of {visibleProperties.length} properties
            </div>
          )}
          {visibleProperties.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              No properties in view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
