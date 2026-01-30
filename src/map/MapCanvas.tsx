'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { DashboardMap, MapBounds } from './DashboardMap';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapCanvasProps {
  accessToken: string;
  regridToken?: string;
  regridTileUrl?: string;
  properties: GeoJSON.Feature[];
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
}

export interface MapCanvasHandle {
  flyTo: (lat: number, lon: number, zoom?: number) => void;
}

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(({
  accessToken,
  regridToken,
  regridTileUrl,
  properties,
  initialCenter,
  initialZoom,
  onBoundsChange,
  onPropertyClick,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<DashboardMap | null>(null);
  const callbacksRef = useRef({ onBoundsChange, onPropertyClick });
  const [mapError, setMapError] = useState<string | null>(null);
  
  // Store initial values in refs to prevent re-initialization when parent re-renders
  const initialCenterRef = useRef(initialCenter);
  const initialZoomRef = useRef(initialZoom);

  callbacksRef.current = { onBoundsChange, onPropertyClick };

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lon: number, zoom: number = 16) => {
      mapRef.current?.flyTo(lat, lon, zoom);
    },
  }));

  // Initialize map only once - don't reinitialize when props change
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = new DashboardMap({
      container: containerRef.current,
      accessToken,
      regridToken,
      regridTileUrl,
      initialCenter: initialCenterRef.current,
      initialZoom: initialZoomRef.current,
      onBoundsChange: (bounds, zoom) => {
        callbacksRef.current.onBoundsChange?.(bounds, zoom);
      },
      onPropertyClick: (propertyKey) => {
        callbacksRef.current.onPropertyClick?.(propertyKey);
      },
      onError: (error) => {
        setMapError(error);
      },
    });

    const initError = mapRef.current.getInitError();
    if (initError) {
      setMapError(initError);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
    // Only depend on tokens - don't reinit for center/zoom changes
  }, [accessToken, regridToken, regridTileUrl]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setData({
      type: 'FeatureCollection',
      features: properties,
    });
  }, [properties]);

  if (mapError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="text-center p-4">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <p className="text-gray-600 text-sm">Map unavailable</p>
          <p className="text-gray-400 text-xs mt-1">Your browser may not support interactive maps</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
});

MapCanvas.displayName = 'MapCanvas';

export default MapCanvas;
