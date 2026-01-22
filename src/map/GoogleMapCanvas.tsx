'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { GoogleMapController, MapBounds } from './GoogleMap';

interface GoogleMapCanvasProps {
  apiKey: string;
  regridToken?: string;
  regridTileUrl?: string;
  properties: GeoJSON.Feature[];
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
}

export interface GoogleMapCanvasHandle {
  flyTo: (lat: number, lon: number, zoom?: number) => void;
}

const GoogleMapCanvas = forwardRef<GoogleMapCanvasHandle, GoogleMapCanvasProps>(({
  apiKey,
  regridToken,
  regridTileUrl,
  properties,
  initialCenter,
  initialZoom,
  onBoundsChange,
  onPropertyClick,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GoogleMapController | null>(null);
  const callbacksRef = useRef({ onBoundsChange, onPropertyClick });

  callbacksRef.current = { onBoundsChange, onPropertyClick };

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lon: number, zoom?: number) => {
      controllerRef.current?.flyTo(lat, lon, zoom);
    },
  }));

  useEffect(() => {
    if (!containerRef.current || !apiKey) return;

    controllerRef.current = new GoogleMapController({
      container: containerRef.current,
      apiKey,
      regridToken,
      regridTileUrl,
      initialCenter,
      initialZoom,
      onBoundsChange: (bounds, zoom) => {
        callbacksRef.current.onBoundsChange?.(bounds, zoom);
      },
      onPropertyClick: (propertyKey) => {
        callbacksRef.current.onPropertyClick?.(propertyKey);
      },
    });

    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [apiKey, regridToken, regridTileUrl, initialCenter?.lat, initialCenter?.lon, initialZoom]);

  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setData({
        type: 'FeatureCollection',
        features: properties,
      });
    }
  }, [properties]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
});

GoogleMapCanvas.displayName = 'GoogleMapCanvas';

export default GoogleMapCanvas;
